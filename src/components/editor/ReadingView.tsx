import React, { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import {
  Info,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  Flame,
  Quote,
  Copy,
  Check,
} from 'lucide-react';
import { resolveImageBlobUrl, parseImageEmbed } from '../../editor/imageExtension';
import {
  isTableRow,
  isTableSeparator,
  parseAlignments,
  parseTableRowCells,
} from '../../editor/tableExtension';

/* ------------------------------------------------------------------ */
/* Frontmatter Parser                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedDocument {
  frontmatter: Record<string, string> | null;
  rawFrontmatter: string | null;
  body: string;
}

/**
 * Separates YAML Frontmatter from the markdown body.
 *
 * Requirements:
 * 1. Must start on line 1 with `^---\r?\n`.
 * 2. Must have a closing `\r?\n---\r?\n` (or `\r?\n---$`).
 * 3. Content between delimiters must follow key: value YAML structure.
 *
 * If the user simply typed `---` as a divider / horizontal rule, or if there is
 * no valid closed YAML block at the top, the entire text is preserved in `body`
 * so that `---` is rendered as an `<hr />` and NO content is lost or hidden.
 */
export function parseDocumentFrontmatter(source: string): ParsedDocument {
  if (!source) {
    return { frontmatter: null, rawFrontmatter: null, body: '' };
  }

  // Must begin on line 1 with `---`
  const startMatch = source.match(/^---\r?\n/);
  if (!startMatch) {
    return { frontmatter: null, rawFrontmatter: null, body: source };
  }

  const rest = source.slice(startMatch[0].length);
  // Find closing `---` on its own line
  const endMatch = rest.match(/\r?\n---\r?\n|\r?\n---$/);
  if (!endMatch || endMatch.index === undefined) {
    // No closing delimiter found -> treat initial `---` as content (<hr />)
    return { frontmatter: null, rawFrontmatter: null, body: source };
  }

  const rawYaml = rest.slice(0, endMatch.index);
  const remainingBody = rest.slice(endMatch.index + endMatch[0].length);

  // Validate that lines inside rawYaml look like valid YAML (key-value, comments, lists, or blanks)
  const lines = rawYaml.split(/\r?\n/);
  let hasValidKey = false;
  let isYaml = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^[\w\-. ]+:\s*/.test(trimmed)) {
      hasValidKey = true;
    } else if (/^-\s+/.test(trimmed)) {
      // List item in YAML
    } else {
      // Plain sentence or prose that is not YAML
      isYaml = false;
      break;
    }
  }

  if (!isYaml || !hasValidKey) {
    // Not valid YAML frontmatter -> do not crop or hide anything!
    return { frontmatter: null, rawFrontmatter: null, body: source };
  }

  // Parse key-value pairs
  const parsedMap: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([\w\-. ]+):\s*(.*)$/);
    if (kv) {
      let val = kv[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      parsedMap[kv[1].trim()] = val;
    }
  }

  return {
    frontmatter: parsedMap,
    rawFrontmatter: rawYaml,
    body: remainingBody,
  };
}

/* ------------------------------------------------------------------ */
/* Markdown AST & Block Parser                                         */
/* ------------------------------------------------------------------ */

type Align = 'left' | 'center' | 'right';

export interface MarkdownListItem {
  rawLineIndex: number;
  text: string;
  checked?: boolean;
  level: number;
}

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'math'; tex: string }
  | { kind: 'list'; ordered: boolean; items: MarkdownListItem[] }
  | { kind: 'table'; headers: string[]; alignments: Align[]; rows: string[][] }
  | { kind: 'callout'; calloutType: string; calloutTitle: string; content: string }
  | { kind: 'quote'; content: string }
  | { kind: 'hr' };

function countTableCells(text: string): number {
  const raw = text.trim();
  const inner = raw.startsWith('|') && raw.endsWith('|') ? raw.slice(1, -1) : raw;
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
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const CALLOUT_START_RE = /^\[!([\w-]+)\]([+-])?\s*(.*)$/;

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
    isTableRow(t)
  );
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = (source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // --- Fenced Code Block ---
    const fence = FENCE_RE.exec(trimmed);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ kind: 'code', lang, code: buf.join('\n') });
      continue;
    }

    // --- Math Block $$ ... $$ ---
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

    // --- Heading ---
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

    // --- Horizontal Rule (---, ***, ___) ---
    if (HR_RE.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // --- Table ---
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

    // --- Blockquote / Callout ---
    if (trimmed.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const calloutMatch = CALLOUT_START_RE.exec(buf[0] || '');
      if (calloutMatch) {
        const calloutType = calloutMatch[1];
        const calloutTitle = calloutMatch[3] || calloutType;
        const restContent = buf.slice(1).join('\n');
        blocks.push({
          kind: 'callout',
          calloutType,
          calloutTitle,
          content: restContent,
        });
      } else {
        blocks.push({ kind: 'quote', content: buf.join('\n') });
      }
      continue;
    }

    // --- Lists & Checklists ---
    const listMatch = LIST_RE.exec(rawLine);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items: MarkdownListItem[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m) {
          if (items.length > 0 && lines[i].trim() && !isBlockStart(lines[i])) {
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
        items.push({
          rawLineIndex: i,
          text,
          checked,
          level: Math.floor(indent / 2),
        });
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // --- Paragraph ---
    const paraLines: string[] = [];
    while (i < lines.length) {
      const lineText = lines[i];
      if (!lineText.trim()) break;
      if (paraLines.length > 0 && isBlockStart(lineText)) break;
      paraLines.push(lineText);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paraLines });
    } else {
      i++;
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/* Inline Tokens & Images                                              */
/* ------------------------------------------------------------------ */

interface InlineContext {
  onWikilinkClick?: (target: string) => void;
}

const INLINE_RE =
  /(!\[\[[^\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[\[[^\]]+\]\])|(\[[^\]]*\]\([^)]+\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(==[^=\n]+==)|(`[^`\n]+`)|(\$[^$\n]+\$)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

const ReadingImage: React.FC<{
  target: string;
  alt?: string;
  width?: number;
  height?: number;
}> = ({ target, alt, width, height }) => {
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
      <span className="inline-block py-1 text-urano-muted" aria-hidden="true">
        🖼 {alt || target}
      </span>
    );
  }

  return (
    <img
      className="max-w-full rounded my-2 block cursor-pointer transition-transform hover:scale-[1.01]"
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

  if (!html) return <span className="text-red-400 font-mono text-xs">{tex}</span>;
  return <span className="inline-math px-0.5" dangerouslySetInnerHTML={{ __html: html }} />;
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

  if (!html) return <pre className="text-red-400 font-mono text-xs my-2">{tex}</pre>;
  return (
    <div
      className="math-block my-4 py-2 text-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

function renderInline(text: string, ctx: InlineContext, keyPrefix: string): React.ReactNode[] {
  if (!text) return [];
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
      // Vault image embed: ![[file.png|300]]
      const inner = token.slice(3, -2);
      const { width, height, alt } = parseImageEmbed(inner);
      nodes.push(
        <ReadingImage
          key={key}
          target={inner.split('|')[0].trim()}
          alt={alt}
          width={width || undefined}
          height={height || undefined}
        />
      );
    } else if (token.startsWith('![')) {
      // Markdown image: ![alt](url)
      const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        const { width, height } = parseImageEmbed(m[1]);
        nodes.push(
          <ReadingImage
            key={key}
            target={m[2].trim()}
            alt={m[1]}
            width={width || undefined}
            height={height || undefined}
          />
        );
      }
    } else if (token.startsWith('[[') && !token.startsWith('![[')) {
      // Wikilink: [[note|alias]]
      const inner = token.slice(2, -2);
      const [target, alias] = inner.split('|');
      nodes.push(
        <a
          key={key}
          className="internal-link text-orange-400 hover:text-orange-300 underline cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            ctx.onWikilinkClick?.(target.trim());
          }}
          title={target.trim()}
        >
          {(alias || target).trim()}
        </a>
      );
    } else if (token.startsWith('[')) {
      // External link: [text](url)
      const m = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        nodes.push(
          <a
            key={key}
            className="external-link text-orange-400 hover:text-orange-300 underline cursor-pointer"
            href={m[2]}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {m[1]}
          </a>
        );
      }
    } else if (token.startsWith('***')) {
      nodes.push(
        <strong key={key}>
          <em>{token.slice(3, -3)}</em>
        </strong>
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('==')) {
      nodes.push(
        <mark key={key} className="bg-yellow-500/20 text-yellow-200 px-1 rounded">
          {token.slice(2, -2)}
        </mark>
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="bg-urano-secondary px-1.5 py-0.5 rounded font-mono text-sm">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('$')) {
      nodes.push(<InlineMath key={key} tex={token.slice(1, -1)} />);
    } else if (token.startsWith('*') || token.startsWith('_')) {
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

function getCalloutIcon(type: string): React.ReactNode {
  const norm = (type || '').toLowerCase();
  switch (norm) {
    case 'info':
    case 'note':
      return <Info size={16} />;
    case 'tip':
    case 'hint':
    case 'important':
      return <CheckCircle2 size={16} />;
    case 'warning':
    case 'caution':
    case 'attention':
      return <AlertTriangle size={16} />;
    case 'danger':
    case 'error':
    case 'bug':
      return <AlertCircle size={16} />;
    case 'flame':
      return <Flame size={16} />;
    case 'quote':
      return <Quote size={16} />;
    default:
      return <HelpCircle size={16} />;
  }
}

/* ------------------------------------------------------------------ */
/* ReadingView Component                                               */
/* ------------------------------------------------------------------ */

export interface ReadingViewProps {
  content: string;
  title: string;
  showInlineTitle: boolean;
  readableLineLength: boolean;
  strictLineBreaks: boolean;
  onWikilinkClick?: (noteName: string) => void;
  onTaskToggle?: (rawLineIndex: number, newChecked: boolean) => void;
}

export const ReadingView: React.FC<ReadingViewProps> = ({
  content,
  title,
  showInlineTitle,
  readableLineLength,
  strictLineBreaks,
  onWikilinkClick,
  onTaskToggle,
}) => {
  const [copiedCodeKey, setCopiedCodeKey] = useState<string | null>(null);

  // 1. Parse YAML Frontmatter safely (keeps `---` if horizontal rule or unclosed)
  const { frontmatter, body } = useMemo(
    () => parseDocumentFrontmatter(content || ''),
    [content]
  );

  // 2. Parse Markdown Blocks
  const blocks = useMemo(() => parseMarkdownBlocks(body), [body]);

  const ctx: InlineContext = useMemo(
    () => ({ onWikilinkClick }),
    [onWikilinkClick]
  );

  const handleCopyCode = (code: string, key: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        setCopiedCodeKey(key);
        setTimeout(() => setCopiedCodeKey(null), 2000);
      });
    }
  };

  const renderParagraph = (lines: string[], key: string) => {
    if (strictLineBreaks) {
      // Markdown spec: a single newline is a soft break (rendered as a space)
      // unless line ends with two spaces or backslash
      const renderedElements: React.ReactNode[] = [];
      lines.forEach((line, idx) => {
        const isHardBreak = line.endsWith('  ') || line.endsWith('\\');
        const cleanLine = isHardBreak
          ? line.endsWith('  ')
            ? line.slice(0, -2)
            : line.slice(0, -1)
          : line;

        renderedElements.push(
          <React.Fragment key={`${key}-span-${idx}`}>
            {renderInline(cleanLine, ctx, `${key}-l${idx}`)}
          </React.Fragment>
        );

        if (idx < lines.length - 1) {
          if (isHardBreak) {
            renderedElements.push(<br key={`${key}-br-${idx}`} />);
          } else {
            renderedElements.push(' ');
          }
        }
      });

      return (
        <p key={key} className="markdown-rendered-p">
          {renderedElements}
        </p>
      );
    } else {
      // Non-strict line breaks (Obsidian default): every single newline becomes <br />
      const renderedElements: React.ReactNode[] = [];
      lines.forEach((line, idx) => {
        renderedElements.push(
          <React.Fragment key={`${key}-span-${idx}`}>
            {renderInline(line, ctx, `${key}-l${idx}`)}
          </React.Fragment>
        );
        if (idx < lines.length - 1) {
          renderedElements.push(<br key={`${key}-br-${idx}`} />);
        }
      });

      return (
        <p key={key} className="markdown-rendered-p">
          {renderedElements}
        </p>
      );
    }
  };

  return (
    <div className="markdown-reading-view h-full w-full">
      <div
        className={`markdown-preview-view markdown-rendered node-insert-event h-full w-full overflow-y-auto px-12 py-10 ${
          readableLineLength ? 'is-readable-line-width' : ''
        }`}
      >
        <div
          className={`markdown-preview-sizer markdown-preview-section ${
            readableLineLength ? 'max-w-[var(--file-line-width,700px)] mx-auto' : 'w-full'
          }`}
        >
          {/* Inline Title (.inline-title) directly at top of preview sizer */}
          {showInlineTitle && (
            <div className="inline-title-container">
              <h1 className="inline-title" tabIndex={-1}>
                {title}
              </h1>
            </div>
          )}

          {/* Frontmatter Metadata Container (if valid YAML exists) */}
          {frontmatter && Object.keys(frontmatter).length > 0 && (
            <div className="metadata-container border border-urano-border rounded-lg p-3 mb-6 bg-urano-secondary/30 text-xs">
              <div className="text-[11px] font-semibold uppercase text-urano-muted tracking-wider mb-2">
                Propiedades
              </div>
              <div className="flex flex-col gap-1.5">
                {Object.entries(frontmatter).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-urano-muted font-medium w-28 truncate">{k}</span>
                    <span className="text-urano-text font-mono truncate">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rendered Markdown Blocks */}
          {blocks.map((block, bi) => {
            const key = `b${bi}`;
            switch (block.kind) {
              case 'heading': {
                const Tag = `h${Math.min(6, Math.max(1, block.level))}` as keyof JSX.IntrinsicElements;
                return (
                  <Tag key={key} className={`markdown-heading markdown-h${block.level}`}>
                    {renderInline(block.text, ctx, key)}
                  </Tag>
                );
              }

              case 'hr':
                return <hr key={key} className="markdown-rendered-hr" />;

              case 'paragraph':
                return renderParagraph(block.lines, key);

              case 'code':
                return (
                  <pre key={key} className="markdown-rendered-codeblock group relative">
                    {block.lang && (
                      <span className="code-lang-label text-[10px] text-urano-muted uppercase font-mono absolute top-2 right-12 select-none opacity-60">
                        {block.lang}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopyCode(block.code, key)}
                      className="copy-code-button absolute top-2 right-2 px-2 py-0.5 text-[11px] bg-urano-hover rounded text-urano-muted hover:text-white transition-opacity opacity-0 group-hover:opacity-100 flex items-center gap-1 cursor-pointer"
                      title="Copiar código"
                    >
                      {copiedCodeKey === key ? (
                        <>
                          <Check size={12} className="text-green-400" />
                          <span>Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                    <code>{block.code}</code>
                  </pre>
                );

              case 'math':
                return <BlockMath key={key} tex={block.tex} />;

              case 'callout':
                return (
                  <div
                    key={key}
                    className="callout"
                    data-callout={block.calloutType.toLowerCase()}
                  >
                    <div className="callout-title">
                      <div className="callout-icon">
                        {getCalloutIcon(block.calloutType)}
                      </div>
                      <div className="callout-title-inner font-semibold">
                        {block.calloutTitle || block.calloutType}
                      </div>
                    </div>
                    {block.content && (
                      <div className="callout-content">
                        {renderInline(block.content, ctx, `${key}-content`)}
                      </div>
                    )}
                  </div>
                );

              case 'quote':
                return (
                  <blockquote key={key} className="markdown-rendered-quote">
                    {renderInline(block.content, ctx, key)}
                  </blockquote>
                );

              case 'list':
                return (
                  <ul
                    key={key}
                    className={block.ordered ? 'markdown-rendered-ol' : 'markdown-rendered-ul'}
                  >
                    {block.items.map((item, ii) => (
                      <li
                        key={`${key}-l${ii}`}
                        className="markdown-rendered-li flex items-start"
                        style={{ paddingLeft: `${item.level * 20}px` }}
                      >
                        {item.checked !== undefined ? (
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={(e) => onTaskToggle?.(item.rawLineIndex, e.target.checked)}
                            className="task-list-item-checkbox mr-2 mt-1 cursor-pointer accent-orange-500 rounded"
                          />
                        ) : null}
                        <span className={item.checked ? 'line-through text-urano-muted flex-1' : 'flex-1'}>
                          {renderInline(item.text, ctx, `${key}-l${ii}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                );

              case 'table':
                return (
                  <div key={key} className="cm-table-widget my-4 overflow-x-auto">
                    <div className="urano-table-wrapper inline-block min-w-full">
                      <table className="urano-table-editor w-full border-collapse">
                        <thead>
                          <tr>
                            {block.headers.map((h, hi) => (
                              <th
                                key={`${key}-h${hi}`}
                                className="border border-urano-border bg-urano-hover/40 px-3 py-1.5 text-xs font-semibold"
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
                                  className="border border-urano-border px-3 py-1.5 text-xs"
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
                  </div>
                );

              default:
                return null;
            }
          })}

          {/* Bottom spacing pusher matching Obsidian */}
          <div className="markdown-preview-pusher" style={{ height: '30vh' }} />
        </div>
      </div>
    </div>
  );
};
