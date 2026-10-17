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

// Inline marker decorations (dims markdown tokens so text reads cleanly)
const headingMarker = Decoration.mark({ class: 'cm-heading-marker' });
const blockquoteMarker = Decoration.mark({ class: 'cm-blockquote-marker' });
const highlightMark = Decoration.mark({ class: 'cm-highlight-text' });
const strikeMark = Decoration.mark({ class: 'cm-strikethrough' });
const codeInlineMark = Decoration.mark({ class: 'cm-inline-code' });

export const liveMarkdownExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view: EditorView): DecorationSet {
      const widgets: Range<Decoration>[] = [];

      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const text = line.text;
          const trimmed = text.trim();

          // 1. Headings (H1 to H6)
          if (/^#\s/.test(text)) {
            widgets.push(h1Line.range(line.from));
            widgets.push(headingMarker.range(line.from, line.from + 2));
          } else if (/^##\s/.test(text)) {
            widgets.push(h2Line.range(line.from));
            widgets.push(headingMarker.range(line.from, line.from + 3));
          } else if (/^###\s/.test(text)) {
            widgets.push(h3Line.range(line.from));
            widgets.push(headingMarker.range(line.from, line.from + 4));
          } else if (/^####\s/.test(text)) {
            widgets.push(h4Line.range(line.from));
            widgets.push(headingMarker.range(line.from, line.from + 5));
          } else if (/^#####\s/.test(text)) {
            widgets.push(h5Line.range(line.from));
            widgets.push(headingMarker.range(line.from, line.from + 6));
          } else if (/^######\s/.test(text)) {
            widgets.push(h6Line.range(line.from));
            widgets.push(headingMarker.range(line.from, line.from + 7));
          } else if (/^>\s?/.test(text)) {
            widgets.push(blockquoteLine.range(line.from));
            const markLen = text.startsWith('> ') ? 2 : 1;
            widgets.push(blockquoteMarker.range(line.from, line.from + markLen));
          } else if (/^(---|\*\*\*|___)$/.test(trimmed)) {
            widgets.push(hrLine.range(line.from));
          }

          // 2. Obsidian Highlight syntax ==text==
          const highlightRegex = /==([^=]+)==/g;
          let hMatch: RegExpExecArray | null;
          while ((hMatch = highlightRegex.exec(text)) !== null) {
            const start = line.from + hMatch.index;
            const end = start + hMatch[0].length;
            widgets.push(highlightMark.range(start, end));
          }

          // 3. Strikethrough ~~text~~
          const strikeRegex = /~~([^~]+)~~/g;
          let sMatch: RegExpExecArray | null;
          while ((sMatch = strikeRegex.exec(text)) !== null) {
            const start = line.from + sMatch.index;
            const end = start + sMatch[0].length;
            widgets.push(strikeMark.range(start, end));
          }

          // 4. Inline Code `code`
          const codeRegex = /(?<!`)`([^`\n]+)`(?!`)/g;
          let cMatch: RegExpExecArray | null;
          while ((cMatch = codeRegex.exec(text)) !== null) {
            const start = line.from + cMatch.index;
            const end = start + cMatch[0].length;
            widgets.push(codeInlineMark.range(start, end));
          }

          pos = line.to + 1;
        }
      }

      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
