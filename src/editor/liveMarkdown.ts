import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Range } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../locales/i18n';
import { getFencedCodeLineSet } from './codeRangeUtils';

export function openExternalUrl(url: string): void {
  const clean = (url || '').trim();
  if (!clean) return;
  invoke('open_path', { path: clean })
    .catch(() => invoke('open_file_in_default_app', { filePath: clean }))
    .catch(() => {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(clean, '_blank', 'noopener,noreferrer');
      }
    });
}

class ExternalLinkIconWidget extends WidgetType {
  constructor(readonly url: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-external-link-icon';
    span.setAttribute('data-external-href', this.url);
    span.setAttribute('aria-hidden', 'true');
    span.title = this.url;
    span.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>';
    span.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    span.addEventListener('click', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        openExternalUrl(this.url);
      }
    });
    return span;
  }

  eq(other: ExternalLinkIconWidget): boolean {
    return other.url === this.url;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Line decorations for Urano-style typography
const h1Line = Decoration.line({ class: 'cm-h1-line' });
const h2Line = Decoration.line({ class: 'cm-h2-line' });
const h3Line = Decoration.line({ class: 'cm-h3-line' });
const h4Line = Decoration.line({ class: 'cm-h4-line' });
const h5Line = Decoration.line({ class: 'cm-h5-line' });
const h6Line = Decoration.line({ class: 'cm-h6-line' });
const blockquoteLine = Decoration.line({ class: 'cm-blockquote-line' });
const hrLine = Decoration.line({ class: 'cm-hr-line' });

// Horizontal Rule Widget (<hr class="cm-hr">)
class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'cm-hr';
    return hr;
  }

  eq(): boolean {
    return true;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Footnote Reference Widget (Clickable superscript [n])
class FootnoteWidget extends WidgetType {
  constructor(readonly n: string) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const sup = document.createElement('sup');
    sup.className = 'cm-footnote-ref';
    sup.textContent = `[${this.n}]`;
    sup.setAttribute('data-footnote', this.n);
    sup.title = t('editor.footnote.tooltip', { n: this.n });

    sup.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const doc = view.state.doc;
      const targetStr = `[^${this.n}]:`;
      const fullText = doc.toString();
      const defIdx = fullText.indexOf(targetStr);
      if (defIdx !== -1) {
        const targetPos = defIdx + targetStr.length;
        const finalPos = fullText.charAt(targetPos) === ' ' ? targetPos + 1 : targetPos;
        view.dispatch({
          selection: { anchor: finalPos },
          scrollIntoView: true,
        });
        view.focus();
      }
    });

    return sup;
  }

  eq(other: FootnoteWidget): boolean {
    return other.n === this.n;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Delimiter hider: replaces markdown syntax tokens with empty widget
const hideDelimiter = Decoration.replace({});
const footnoteDefMark = Decoration.mark({ class: 'cm-footnote-def-prefix' });

// Inline marker decorations
const headingMarker = Decoration.mark({ class: 'cm-heading-marker' });
const blockquoteMarker = Decoration.mark({ class: 'cm-blockquote-marker' });
const strongMark = Decoration.mark({ class: 'cm-strong' });
const emMark = Decoration.mark({ class: 'cm-em' });
const strikeMark = Decoration.mark({ class: 'cm-strikethrough' });
const codeInlineMark = Decoration.mark({ class: 'cm-inline-code' });

// 6 Urano Highlight color marks
const highlightMarks: Record<string, Decoration> = {
  default: Decoration.mark({ class: 'cm-highlight-text' }),
  red: Decoration.mark({ class: 'cm-highlight-red' }),
  orange: Decoration.mark({ class: 'cm-highlight-orange' }),
  yellow: Decoration.mark({ class: 'cm-highlight-yellow' }),
  green: Decoration.mark({ class: 'cm-highlight-green' }),
  blue: Decoration.mark({ class: 'cm-highlight-blue' }),
  purple: Decoration.mark({ class: 'cm-highlight-purple' }),
};

const emojiColorMap: Record<string, string> = {
  '🔴': 'red',
  '🟥': 'red',
  '🟠': 'orange',
  '🟧': 'orange',
  '🟡': 'yellow',
  '🟨': 'yellow',
  '🟢': 'green',
  '🟩': 'green',
  '🔵': 'blue',
  '🟦': 'blue',
  '🟣': 'purple',
  '🟪': 'purple',
};

export const liveMarkdownExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view: EditorView): DecorationSet {
      const widgets: Range<Decoration>[] = [];
      const sel = view.state.selection.main;
      const doc = view.state.doc;
      const codeLines = getFencedCodeLineSet(doc);

      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          if (pos > doc.length) break;
          const line = doc.lineAt(pos);
          if (codeLines.has(line.number)) {
            pos = line.to + 1;
            continue;
          }
          const text = line.text;
          const trimmed = text.trim();

          // Check if cursor or selection touches this line
          const isCursorOnLine = sel.from <= line.to && sel.to >= line.from;

          // 1. Headings (H1 to H6)
          if (/^#\s/.test(text)) {
            widgets.push(h1Line.range(line.from));
            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(line.from, line.from + 2));
            } else {
              widgets.push(headingMarker.range(line.from, line.from + 2));
            }
          } else if (/^##\s/.test(text)) {
            widgets.push(h2Line.range(line.from));
            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(line.from, line.from + 3));
            } else {
              widgets.push(headingMarker.range(line.from, line.from + 3));
            }
          } else if (/^###\s/.test(text)) {
            widgets.push(h3Line.range(line.from));
            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(line.from, line.from + 4));
            } else {
              widgets.push(headingMarker.range(line.from, line.from + 4));
            }
          } else if (/^####\s/.test(text)) {
            widgets.push(h4Line.range(line.from));
            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(line.from, line.from + 5));
            } else {
              widgets.push(headingMarker.range(line.from, line.from + 5));
            }
          } else if (/^#####\s/.test(text)) {
            widgets.push(h5Line.range(line.from));
            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(line.from, line.from + 6));
            } else {
              widgets.push(headingMarker.range(line.from, line.from + 6));
            }
          } else if (/^######\s/.test(text)) {
            widgets.push(h6Line.range(line.from));
            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(line.from, line.from + 7));
            } else {
              widgets.push(headingMarker.range(line.from, line.from + 7));
            }
          } else if (/^>\s?/.test(text)) {
            widgets.push(blockquoteLine.range(line.from));
            const markLen = text.startsWith('> ') ? 2 : 1;
            widgets.push(blockquoteMarker.range(line.from, line.from + markLen));
          } else if (/^(---|\*\*\*|___)$/.test(trimmed)) {
            if (!isCursorOnLine && line.from < line.to) {
              widgets.push(
                Decoration.replace({
                  widget: new HrWidget(),
                }).range(line.from, line.to)
              );
            } else {
              widgets.push(hrLine.range(line.from));
            }
            pos = line.to + 1;
            continue;
          }

          // Track ranges occupied by inline tokens to prevent overlaps
          const occupied: [number, number][] = [];
          const isOverlapping = (s: number, e: number) =>
            occupied.some(([os, oe]) => s < oe && e > os);

          // 4 (moved first). Inline Code: `code`
          const codeRegex = /(?<!`)`([^`\n]+)`(?!`)/g;
          let cMatch: RegExpExecArray | null;
          while ((cMatch = codeRegex.exec(text)) !== null) {
            const start = line.from + cMatch.index;
            const end = start + cMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const isCursorInside = !sel.empty
              ? sel.from < end && sel.to > start
              : sel.head > start && sel.head < end;

            if (isCursorInside) {
              widgets.push(codeInlineMark.range(start + 1, end - 1));
            } else {
              widgets.push(hideDelimiter.range(start, start + 1));
              widgets.push(codeInlineMark.range(start + 1, end - 1));
              widgets.push(hideDelimiter.range(end - 1, end));
            }
          }

          // Pre-occupy image embed ranges (![[...]] and ![...](...))
          const imgWikiRegex = /!\[\[([^\]]+)\]\]/g;
          let iwMatch: RegExpExecArray | null;
          while ((iwMatch = imgWikiRegex.exec(text)) !== null) {
            const s = line.from + iwMatch.index;
            const e = s + iwMatch[0].length;
            if (!isOverlapping(s, e)) occupied.push([s, e]);
          }

          const imgMdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
          let imMatch: RegExpExecArray | null;
          while ((imMatch = imgMdRegex.exec(text)) !== null) {
            const s = line.from + imMatch.index;
            const e = s + imMatch[0].length;
            if (!isOverlapping(s, e)) occupied.push([s, e]);
          }

          // Pre-occupy wikilinks [[...]] so inner underscores/asterisks don't split link syntax
          const wikiLinkPreRegex = /(?<!\!)\[\[([^\]]+)\]\]/g;
          let wlPreMatch: RegExpExecArray | null;
          while ((wlPreMatch = wikiLinkPreRegex.exec(text)) !== null) {
            const s = line.from + wlPreMatch.index;
            const e = s + wlPreMatch[0].length;
            if (!isOverlapping(s, e)) occupied.push([s, e]);
          }

          // Standard Markdown Links: [label](url)
          const mdLinkRegex = /(?<!\!)\[([^\]\n]+)\]\(([^)\n]+)\)/g;
          let mdMatch: RegExpExecArray | null;
          while ((mdMatch = mdLinkRegex.exec(text)) !== null) {
            const start = line.from + mdMatch.index;
            const end = start + mdMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const label = mdMatch[1];
            const rawDest = mdMatch[2].trim();
            const url = rawDest.replace(/\s+(?:"[^"]*"|'[^']*')$/, '').trim();
            const isExternal = /^(?:https?:|mailto:|tel:|obsidian:|urano:)/i.test(url);

            const labelFrom = start + 1;
            const labelTo = labelFrom + label.length;
            if (labelFrom >= labelTo) continue;

            const linkDeco = Decoration.mark({
              class: isExternal ? 'cm-external-link' : 'cm-md-link',
              attributes: {
                'data-external-href': isExternal ? url : '',
                title: url,
              },
            });

            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(start, labelFrom));
              widgets.push(linkDeco.range(labelFrom, labelTo));
              if (isExternal) {
                widgets.push(
                  Decoration.replace({
                    widget: new ExternalLinkIconWidget(url),
                  }).range(labelTo, end)
                );
              } else {
                widgets.push(hideDelimiter.range(labelTo, end));
              }
            } else {
              widgets.push(linkDeco.range(labelFrom, labelTo));
            }
          }

          // 2. Bold: **text** or __text__
          const boldRegex = /(?:\*\*([^\*]+)\*\*|__([^_]+)__)/g;
          let bMatch: RegExpExecArray | null;
          while ((bMatch = boldRegex.exec(text)) !== null) {
            const start = line.from + bMatch.index;
            const end = start + bMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const isCursorInside = !sel.empty
              ? sel.from < end && sel.to > start
              : sel.head > start && sel.head < end;

            if (isCursorInside) {
              widgets.push(strongMark.range(start + 2, end - 2));
            } else {
              widgets.push(hideDelimiter.range(start, start + 2));
              widgets.push(strongMark.range(start + 2, end - 2));
              widgets.push(hideDelimiter.range(end - 2, end));
            }
          }

          // 3. Strikethrough: ~~text~~
          const strikeRegex = /~~([^~\n]+)~~/g;
          let sMatch: RegExpExecArray | null;
          while ((sMatch = strikeRegex.exec(text)) !== null) {
            const start = line.from + sMatch.index;
            const end = start + sMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const isCursorInside = !sel.empty
              ? sel.from < end && sel.to > start
              : sel.head > start && sel.head < end;

            if (isCursorInside) {
              widgets.push(strikeMark.range(start + 2, end - 2));
            } else {
              widgets.push(hideDelimiter.range(start, start + 2));
              widgets.push(strikeMark.range(start + 2, end - 2));
              widgets.push(hideDelimiter.range(end - 2, end));
            }
          }

          // 5. Highlights: /==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\n]+)==/g
          const hlRegex = /==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\n]+)==/g;
          let hMatch: RegExpExecArray | null;
          while ((hMatch = hlRegex.exec(text)) !== null) {
            if (!hMatch[2] || hMatch[2].trim().length === 0) continue;

            const start = line.from + hMatch.index;
            const end = start + hMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const circleEmoji = hMatch[1] || '';
            const color = emojiColorMap[circleEmoji] || 'default';
            const markDeco = highlightMarks[color] || highlightMarks.default;

            // Check if cursor/selection is strictly INSIDE this specific highlight
            const isCursorInside = !sel.empty
              ? sel.from < end && sel.to > start
              : sel.head > start && sel.head < end;

            if (isCursorInside) {
              widgets.push(markDeco.range(start, end));
            } else {
              let openLen = 2 + circleEmoji.length;
              if (
                circleEmoji.length > 0 &&
                text.charAt(start + openLen - line.from) === ' ' &&
                start + openLen + 1 < end - 2
              ) {
                openLen += 1;
              }
              if (start + openLen < end - 2) {
                widgets.push(hideDelimiter.range(start, start + openLen));
                widgets.push(markDeco.range(start + openLen, end - 2));
                widgets.push(hideDelimiter.range(end - 2, end));
              }
            }
          }

          // Backward compatibility for any legacy <mark class="hl-(...)">...</mark>
          const htmlHlRegex = /<mark class="hl-(red|orange|yellow|green|blue|purple)">([^\n]+?)<\/mark>/g;
          let htmlMatch: RegExpExecArray | null;
          while ((htmlMatch = htmlHlRegex.exec(text)) !== null) {
            const start = line.from + htmlMatch.index;
            const end = start + htmlMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const color = htmlMatch[1];
            const openTagLen = `<mark class="hl-${color}">`.length;
            const closeTagLen = '</mark>'.length;
            const markDeco = highlightMarks[color] || highlightMarks.default;
            const isCursorInside = !sel.empty
              ? sel.from < end && sel.to > start
              : sel.head > start && sel.head < end;

            if (isCursorInside) {
              widgets.push(markDeco.range(start, end));
            } else if (start + openTagLen < end - closeTagLen) {
              widgets.push(hideDelimiter.range(start, start + openTagLen));
              widgets.push(markDeco.range(start + openTagLen, end - closeTagLen));
              widgets.push(hideDelimiter.range(end - closeTagLen, end));
            }
          }

          // 6. Italic: *text* or _text_ (must be after bold to avoid matching inside **text**)
          const italicRegex = /(?:(?<!\*)\*([^\*]+)\*(?!\*)|(?<![\w_])_([^_]+)_(?![\w_]))/g;
          let iMatch: RegExpExecArray | null;
          while ((iMatch = italicRegex.exec(text)) !== null) {
            const start = line.from + iMatch.index;
            const end = start + iMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const isCursorInside = !sel.empty
              ? sel.from < end && sel.to > start
              : isCursorOnLine && sel.head >= start && sel.head <= end;

            if (isCursorInside) {
              widgets.push(emMark.range(start + 1, end - 1));
            } else {
              widgets.push(hideDelimiter.range(start, start + 1));
              widgets.push(emMark.range(start + 1, end - 1));
              widgets.push(hideDelimiter.range(end - 1, end));
            }
          }

          // 7. Footnotes: [^n] (when cursor not inside, replace with clickable superscript [n])
          const fnRegex = /\[\^(\d+)\](?!\:)/g;
          let fnMatch: RegExpExecArray | null;
          while ((fnMatch = fnRegex.exec(text)) !== null) {
            const start = line.from + fnMatch.index;
            const end = start + fnMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const num = fnMatch[1];
            const isCursorInside = sel.from <= end && sel.to >= start;

            if (!isCursorInside) {
              widgets.push(
                Decoration.replace({
                  widget: new FootnoteWidget(num),
                }).range(start, end)
              );
            }
          }

          // 8. Footnote definition line: [^n]: ...
          const fnDefMatch = text.match(/^\[\^(\d+)\]\:\s?/);
          if (fnDefMatch) {
            const start = line.from;
            const end = line.from + fnDefMatch[0].length;
            if (!isOverlapping(start, end)) {
              occupied.push([start, end]);
              widgets.push(footnoteDefMark.range(start, end));
            }
          }

          pos = line.to + 1;
        }
      }

      // Mandatory CodeMirror 6 sorting invariant
      widgets.sort(
        (a, b) =>
          a.from - b.from ||
          (a.value.startSide ?? 0) - (b.value.startSide ?? 0) ||
          a.to - b.to
      );

      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown: (e, view) => {
        if (e.button !== 0) return false;
        const target = e.target as HTMLElement | null;
        const extEl = target?.closest('.cm-external-link') as HTMLElement | null;
        if (!extEl) return false;
        const href = extEl.getAttribute('data-external-href');
        if (!href) return false;

        const pos = view.posAtDOM(extEl);
        const line = view.state.doc.lineAt(pos);
        const sel = view.state.selection.main;
        const isCursorOnLine = sel.from <= line.to && sel.to >= line.from;

        if ((e.ctrlKey || e.metaKey) || !isCursorOnLine) {
          e.preventDefault();
          return true;
        }
        return false;
      },
      click: (e, view) => {
        if (e.button !== 0) return false;
        const target = e.target as HTMLElement | null;
        const extEl = target?.closest('.cm-external-link') as HTMLElement | null;
        if (!extEl) return false;
        const href = extEl.getAttribute('data-external-href');
        if (!href) return false;

        const pos = view.posAtDOM(extEl);
        const line = view.state.doc.lineAt(pos);
        const sel = view.state.selection.main;
        const isCursorOnLine = sel.from <= line.to && sel.to >= line.from;

        if ((e.ctrlKey || e.metaKey) || !isCursorOnLine) {
          e.preventDefault();
          e.stopPropagation();
          openExternalUrl(href);
          return true;
        }
        return false;
      },
    },
  }
);
