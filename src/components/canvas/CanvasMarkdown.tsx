import React, { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import {
  resolveImageBlobUrl,
  parseImageEmbed,
} from '../../editor/imageExtension';
import {
  isTableRow,
  isTableSeparator,
  parseAlignments,
  parseTableRowCells,
} from '../../editor/tableExtension';

/**
 * Renderizador de Markdown para los nodos del Canvas.
 *
 * Reutiliza el mismo motor que el editor de Urano:
 *  - Tablas  -> `tableExtension.tsx` (parseAlignments / parseTableRowCells)
 *  - Imágenes-> `imageExtension.ts` (resolveImageBlobUrl / parseImageEmbed)
 *  - Ecuaciones -> KaTeX (misma librería que `mathExtension.ts`)
 *
 * Soporta: encabezados, negritas/cursivas/tachado, listas y checklists,
 * tablas, bloques de código, ecuaciones KaTeX, citas/callouts, imágenes
 * incrustadas `![[...]]` y wikilinks `[[...]]`.
 */

type Align = 'left' | 'center' | 'right';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'math'; tex: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; headers: string[]; alignments: Align[]; rows: string[][] }
  | { kind: 'quote'; text: string; calloutType?: string; calloutTitle?: string }
  | { kind: 'hr' };

interface ListItem {
  text: string;
  checked?: boolean;
  level: number;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function countTableCells(text: string): number {
  const raw = text.trim();
  const inner =
    raw.startsWith('|') && raw.endsWith('|') ? raw.slice(1, -1) : raw;
  let count = 1;
  let escaped = false;
  for (const ch of inner) {
    if (ch === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === '|' && !escaped) count++;
    escaped = false;
  }
  return count;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```\s*([\w+-]*)\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const CALLOUT_RE = /^\[!([\w-]+)\]([+-])?\s*(.*)$/;

function isBlockStart(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return (
    HEADING_RE.test(t) ||
    FENCE_RE.test(t) ||
    HR_RE.test(t) ||
    /^\$\$/.test(t) ||
    LIST_RE.test(line) ||
    t.startsWith('>') ||
    (isTableRow(t) && true)
  );
}

export function parseMarkdownBlocks(source: string): Block[] {
  const lines = (source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // --- Bloque de código delimitado ---------------------------------
    const fence = FENCE_RE.exec(trimmed);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consumir el cierre
      blocks.push({ kind: 'code', lang, code: buf.join('\n') });
      continue;
    }

    // --- Ecuación de bloque $$ ... $$ --------------------------------
    if (/^\$\$\s*$/.test(trimmed)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: 'math', tex: buf.join('\n') });
      continue;
    }
    if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) {
      blocks.push({ kind: 'math', tex: trimmed.slice(2, -2) });
      i++;
      continue;
    }

    // --- Encabezado ---------------------------------------------------
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    // --- Separador ----------------------------------------------------
    if (HR_RE.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // --- Tabla --------------------------------------------------------
    if (
      isTableRow(trimmed) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1].trim())
    ) {
      const headers = parseTableRowCells(trimmed, countTableCells(trimmed));
      const alignments = parseAlignments(
        lines[i + 1].trim(),
        headers.length
      ) as Align[];
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(parseTableRowCells(lines[i].trim(), headers.length));
        i++;
      }
      blocks.push({ kind: 'table', headers, alignments, rows });
      continue;
    }

    // --- Cita / Callout ----------------------------------------------
    if (trimmed.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const callout = CALLOUT_RE.exec(buf[0] || '');
      if (callout) {
        const rest = [callout[3], ...buf.slice(1)].filter(Boolean).join('\n');
        blocks.push({
          kind: 'quote',
          text: rest,
          calloutType: callout[1],
          calloutTitle: callout[3] || callout[1],
        });
      } else {
        blocks.push({ kind: 'quote', text: buf.join('\n') });
      }
      continue;
    }

    // --- Listas -------------------------------------------------------
    const listMatch = LIST_RE.exec(rawLine);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m) {
          // Continuación suelta de un elemento anterior
          if (
            items.length > 0 &&
            lines[i].trim() &&
            !isBlockStart(lines[i])
          ) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        const indent = m[1].replace(/\t/g, '  ').length;
        let text = m[3];
        let checked: boolean | undefined;
        const task = TASK_RE.exec(text);
        if (task) {
          checked = task[1].toLowerCase() === 'x';
          text = task[2];
        }
        items.push({ text, checked, level: Math.floor(indent / 2) });
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // --- Párrafo ------------------------------------------------------
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) break;
      if (para.length > 0 && isBlockStart(lines[i])) break;
      para.push(t);
      i++;
    }
    if (para.length) {
      blocks.push({ kind: 'paragraph', text: para.join('\n') });
    } else {
      i++;
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/* Componentes auxiliares                                              */
/* ------------------------------------------------------------------ */

interface CanvasImageProps {
  target: string;
  alt?: string;
  width?: number;
  height?: number;
}

const CanvasImage: React.FC<CanvasImageProps> = ({
  target,
  alt,
  width,
  height,
}) => {
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    resolveImageBlobUrl(target).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!url) {
    return (
      <span className="canvas-md-image-placeholder" aria-hidden="true">
        🖼
      </span>
    );
  }

  return (
    <img
      className="canvas-md-image"
      src={url}
      alt={alt || target}
      style={{
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
      }}
      draggable={false}
    />
  );
};

const InlineMath: React.FC<{ tex: string }> = ({ tex }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode: false,
        output: 'html',
      });
    } catch {
      return null;
    }
  }, [tex]);

  if (!html) return <span className="canvas-md-math-error">{tex}</span>;
  return <span className="canvas-md-math" dangerouslySetInnerHTML={{ __html: html }} />;
};

const BlockMath: React.FC<{ tex: string }> = ({ tex }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
      });
    } catch {
      return null;
    }
  }, [tex]);

  if (!html) return <pre className="canvas-md-math-error">{tex}</pre>;
  return (
    <div
      className="canvas-md-math canvas-md-math-block"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

/* ------------------------------------------------------------------ */
/* Render inline                                                       */
/* ------------------------------------------------------------------ */

const INLINE_RE =
  /(!\[\[[^\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[\[[^\]]+\]\])|(\[[^\]]*\]\([^)]+\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(==[^=\n]+==)|(`[^`\n]+`)|(\$[^$\n]+\$)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

interface InlineContext {
  onOpenLink?: (target: string) => void;
}

function renderInline(text: string, ctx: InlineContext, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;

    if (token.startsWith('![[')) {
      // Imagen incrustada del vault: ![[archivo.png|300]]
      const inner = token.slice(3, -2);
      const { width, height, alt } = parseImageEmbed(inner);
      nodes.push(
        <CanvasImage
          key={key}
          target={inner.split('|')[0].trim()}
          alt={alt}
          width={width || undefined}
          height={height || undefined}
        />
      );
    } else if (token.startsWith('![')) {
      // Imagen markdown: ![alt](url)
      const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        const { width, height } = parseImageEmbed(m[1]);
        nodes.push(
          <CanvasImage
            key={key}
            target={m[2].trim()}
            alt={m[1]}
            width={width || undefined}
            height={height || undefined}
          />
        );
      }
    } else if (token.startsWith('[[') && !token.startsWith('![[')) {
      // Wikilink: [[nota|alias]]
      const inner = token.slice(2, -2);
      const [target, alias] = inner.split('|');
      nodes.push(
        <a
          key={key}
          className="canvas-md-wikilink"
          onClick={(e) => {
            e.stopPropagation();
            ctx.onOpenLink?.(target.trim());
          }}
        >
          {(alias || target).trim()}
        </a>
      );
    } else if (token.startsWith('[')) {
      const m = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        nodes.push(
          <a
            key={key}
            className="canvas-md-link"
            href={m[2]}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {m[1]}
          </a>
        );
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('==')) {
      nodes.push(<mark key={key}>{token.slice(2, -2)}</mark>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key} className="canvas-md-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('$')) {
      nodes.push(<InlineMath key={key} tex={token.slice(1, -1)} />);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/* ------------------------------------------------------------------ */
/* Render principal                                                    */
/* ------------------------------------------------------------------ */

export interface CanvasMarkdownProps {
  content: string;
  /** Callback al pulsar un wikilink (abrir la nota en una pestaña). */
  onOpenLink?: (target: string) => void;
  className?: string;
}

export const CanvasMarkdown: React.FC<CanvasMarkdownProps> = ({
  content,
  onOpenLink,
  className,
}) => {
  const blocks = useMemo(() => parseMarkdownBlocks(content || ''), [content]);
  const ctx: InlineContext = { onOpenLink };

  return (
    <div className={`canvas-markdown ${className || ''}`}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.kind) {
          case 'heading':
            return (
              <h1 key={key} className={`canvas-md-h${block.level}`}>
                {renderInline(block.text, ctx, key)}
              </h1>
            );

          case 'paragraph':
            return (
              <p key={key} className="canvas-md-p">
                {renderInline(block.text, ctx, key)}
              </p>
            );

          case 'code':
            return (
              <pre key={key} className="canvas-md-codeblock">
                {block.lang && <span className="canvas-md-code-lang">{block.lang}</span>}
                <code>{block.code}</code>
              </pre>
            );

          case 'math':
            return <BlockMath key={key} tex={block.tex} />;

          case 'hr':
            return <hr key={key} className="canvas-md-hr" />;

          case 'quote': {
            if (block.calloutType) {
              return (
                <div key={key} className="canvas-md-callout">
                  <div className="canvas-md-callout-title">
                    {block.calloutTitle || block.calloutType}
                  </div>
                  <div className="canvas-md-callout-body">
                    {renderInline(block.text, ctx, key)}
                  </div>
                </div>
              );
            }
            return (
              <blockquote key={key} className="canvas-md-quote">
                {renderInline(block.text, ctx, key)}
              </blockquote>
            );
          }

          case 'list':
            return (
              <ul key={key} className={block.ordered ? 'canvas-md-ol' : 'canvas-md-ul'}>
                {block.items.map((item, ii) => (
                  <li
                    key={`${key}-l${ii}`}
                    className="canvas-md-li"
                    style={{ paddingLeft: `${item.level * 16}px` }}
                  >
                    {item.checked !== undefined ? (
                      <span
                        className={`canvas-md-checkbox ${item.checked ? 'is-checked' : ''}`}
                        aria-hidden="true"
                      >
                        {item.checked ? '☑' : '☐'}
                      </span>
                    ) : null}
                    <span className="canvas-md-li-text">
                      {renderInline(item.text, ctx, `${key}-l${ii}`)}
                    </span>
                  </li>
                ))}
              </ul>
            );

          case 'table':
            return (
              <div key={key} className="canvas-md-table-wrap">
                <table className="canvas-md-table">
                  <thead>
                    <tr>
                      {block.headers.map((h, hi) => (
                        <th
                          key={`${key}-h${hi}`}
                          style={{ textAlign: block.alignments[hi] || 'left' }}
                        >
                          {renderInline(h, ctx, `${key}-h${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={`${key}-r${ri}`}>
                        {row.map((cell, ci) => (
                          <td
                            key={`${key}-r${ri}c${ci}`}
                            style={{ textAlign: block.alignments[ci] || 'left' }}
                          >
                            {renderInline(cell, ctx, `${key}-r${ri}c${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
};

export default CanvasMarkdown;
