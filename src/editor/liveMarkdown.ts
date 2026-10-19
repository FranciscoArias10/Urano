import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { Range } from '@codemirror/state';

// Line decorations for Obsidian-style typography
const h1Line = Decoration.line({ class: 'cm-h1-line' });
const h2Line = Decoration.line({ class: 'cm-h2-line' });
const h3Line = Decoration.line({ class: 'cm-h3-line' });
const h4Line = Decoration.line({ class: 'cm-h4-line' });
const h5Line = Decoration.line({ class: 'cm-h5-line' });
const h6Line = Decoration.line({ class: 'cm-h6-line' });
const blockquoteLine = Decoration.line({ class: 'cm-blockquote-line' });
const hrLine = Decoration.line({ class: 'cm-hr-line' });

// Delimiter hider: replaces markdown syntax tokens with empty widget
const hideDelimiter = Decoration.replace({});

// Inline marker decorations
const headingMarker = Decoration.mark({ class: 'cm-heading-marker' });
const blockquoteMarker = Decoration.mark({ class: 'cm-blockquote-marker' });
const strongMark = Decoration.mark({ class: 'cm-strong' });
const emMark = Decoration.mark({ class: 'cm-em' });
const strikeMark = Decoration.mark({ class: 'cm-strikethrough' });
const codeInlineMark = Decoration.mark({ class: 'cm-inline-code' });

// 6 Obsidian Highlight color marks
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

      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          if (pos > doc.length) break;
          const line = doc.lineAt(pos);
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
            widgets.push(hrLine.range(line.from));
          }

          // Track ranges occupied by inline tokens to prevent overlaps
          const occupied: [number, number][] = [];
          const isOverlapping = (s: number, e: number) =>
            occupied.some(([os, oe]) => (s >= os && s < oe) || (e > os && e <= oe));

          // 2. Bold: **text** or __text__
          const boldRegex = /(?:\*\*([^\*]+)\*\*|__([^_]+)__)/g;
          let bMatch: RegExpExecArray | null;
          while ((bMatch = boldRegex.exec(text)) !== null) {
            const start = line.from + bMatch.index;
            const end = start + bMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(start, start + 2));
              widgets.push(strongMark.range(start + 2, end - 2));
              widgets.push(hideDelimiter.range(end - 2, end));
            } else {
              widgets.push(strongMark.range(start + 2, end - 2));
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

            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(start, start + 2));
              widgets.push(strikeMark.range(start + 2, end - 2));
              widgets.push(hideDelimiter.range(end - 2, end));
            } else {
              widgets.push(strikeMark.range(start + 2, end - 2));
            }
          }

          // 4. Inline Code: `code`
          const codeRegex = /(?<!`)`([^`\n]+)`(?!`)/g;
          let cMatch: RegExpExecArray | null;
          while ((cMatch = codeRegex.exec(text)) !== null) {
            const start = line.from + cMatch.index;
            const end = start + cMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(start, start + 1));
              widgets.push(codeInlineMark.range(start + 1, end - 1));
              widgets.push(hideDelimiter.range(end - 1, end));
            } else {
              widgets.push(codeInlineMark.range(start + 1, end - 1));
            }
          }

          // 5. Highlights: /==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\n]+)==/g
          const hlRegex = /==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\n]+)==/g;
          let hMatch: RegExpExecArray | null;
          while ((hMatch = hlRegex.exec(text)) !== null) {
            const start = line.from + hMatch.index;
            const end = start + hMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            const circleEmoji = hMatch[1] || '';
            const color = emojiColorMap[circleEmoji] || 'default';
            const markDeco = highlightMarks[color] || highlightMarks.default;

            // Check if cursor/selection is INSIDE this specific highlight
            const isCursorInside = sel.from <= end && sel.to >= start;

            if (isCursorInside) {
              // Cursor ESTÁ dentro del resaltado (al hacer clic sobre él):
              // Muestra los signos == y el círculo 🔵 (==🔵esto va a estar resaltado==)
              // y aplica Decoration.mark del color de fondo al RANGO COMPLETO [start, end]
              widgets.push(markDeco.range(start, end));
            } else {
              // Cursor NO está dentro de este resaltado (Cursor FUERA):
              // Esconde el == inicial y el círculo de color (==🔵) con Decoration.replace({})
              // Esconde el == final con Decoration.replace({})
              // Mantiene Decoration.mark sobre el texto limpio
              let openLen = 2 + circleEmoji.length;
              if (text.charAt(start + openLen - line.from) === ' ') {
                openLen += 1;
              }
              widgets.push(hideDelimiter.range(start, start + openLen));
              widgets.push(markDeco.range(start + openLen, end - 2));
              widgets.push(hideDelimiter.range(end - 2, end));
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
            const isCursorInside = sel.from <= end && sel.to >= start;

            if (isCursorInside) {
              widgets.push(markDeco.range(start, end));
            } else {
              widgets.push(hideDelimiter.range(start, start + openTagLen));
              widgets.push(markDeco.range(start + openTagLen, end - closeTagLen));
              widgets.push(hideDelimiter.range(end - closeTagLen, end));
            }
          }

          // 6. Italic: *text* or _text_ (must be after bold to avoid matching inside **text**)
          const italicRegex = /(?:(?<!\*)\*([^\*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_))/g;
          let iMatch: RegExpExecArray | null;
          while ((iMatch = italicRegex.exec(text)) !== null) {
            const start = line.from + iMatch.index;
            const end = start + iMatch[0].length;
            if (isOverlapping(start, end)) continue;
            occupied.push([start, end]);

            if (!isCursorOnLine) {
              widgets.push(hideDelimiter.range(start, start + 1));
              widgets.push(emMark.range(start + 1, end - 1));
              widgets.push(hideDelimiter.range(end - 1, end));
            } else {
              widgets.push(emMark.range(start + 1, end - 1));
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
  }
);
