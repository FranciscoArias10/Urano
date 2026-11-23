import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { t } from '../locales/i18n';
import { getFencedCodeBlocks } from './codeRangeUtils';

class CodeCopyWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-codeblock-copy-flair select-none';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-code-button';
    copyBtn.type = 'button';
    copyBtn.title = t('codeBlock.copyCode');
    copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="13" height="13" x="9" y="9" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    `;

    copyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code).then(() => {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e06c1b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        `;
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="13" height="13" x="9" y="9" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          `;
        }, 2000);
      });
    });

    wrap.appendChild(copyBtn);
    return wrap;
  }

  eq(other: CodeCopyWidget): boolean {
    return this.code === other.code;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// Line decorations matching Urano's .HyperMD-codeblock specifications
const codeblockBegin = Decoration.line({ class: 'cm-hypermd-codeblock cm-hypermd-codeblock-begin' });
const codeblockMid = Decoration.line({ class: 'cm-hypermd-codeblock' });
const codeblockEnd = Decoration.line({ class: 'cm-hypermd-codeblock cm-hypermd-codeblock-end' });
const codeblockSingle = Decoration.line({
  class: 'cm-hypermd-codeblock cm-hypermd-codeblock-begin cm-hypermd-codeblock-end',
});

// Mark decoration to visually hide ``` delimiter text when cursor is outside
const delimiterHiddenMark = Decoration.mark({ class: 'cm-codeblock-delimiter-hidden' });

export const codeBlockExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc;
      const selection = view.state.selection.main;

      interface CodeBlockInfo {
        startLine: number;
        endLine: number;
        language: string;
        isCursorInside: boolean;
        hasClosingFence: boolean;
        code: string;
      }

      const rawBlocks = getFencedCodeBlocks(doc);
      const blocks: CodeBlockInfo[] = rawBlocks.map((b) => {
        const isInside = selection.from <= b.to && selection.to >= b.from;
        const contentEndLine = b.hasClosingFence ? b.endLine - 1 : b.endLine;
        const lines: string[] = [];
        for (let l = b.startLine + 1; l <= contentEndLine; l++) {
          lines.push(doc.line(l).text);
        }
        return {
          startLine: b.startLine,
          endLine: b.endLine,
          language: b.language,
          isCursorInside: isInside,
          hasClosingFence: b.hasClosingFence,
          code: lines.join('\n'),
        };
      });

      // Map line numbers to block info
      const lineMap = new Map<number, CodeBlockInfo>();
      for (const b of blocks) {
        for (let l = b.startLine; l <= b.endLine; l++) {
          lineMap.set(l, b);
        }
      }

      // Emit decorations strictly in ascending line order
      for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
        const block = lineMap.get(lineNum);
        if (!block) continue;

        const line = doc.line(lineNum);

        // A. Line decoration first at line.from
        if (block.startLine === block.endLine) {
          builder.add(line.from, line.from, codeblockSingle);
        } else if (lineNum === block.startLine) {
          builder.add(line.from, line.from, codeblockBegin);
        } else if (lineNum === block.endLine) {
          builder.add(line.from, line.from, codeblockEnd);
        } else {
          builder.add(line.from, line.from, codeblockMid);
        }

        // B. Delimiter hiding marks & header flair widget when cursor is outside
        if (!block.isCursorInside) {
          const isClosingFenceLine =
            lineNum === block.endLine &&
            block.hasClosingFence &&
            block.endLine > block.startLine;
          if (lineNum === block.startLine || isClosingFenceLine) {
            if (line.to > line.from) {
              builder.add(line.from, line.to, delimiterHiddenMark);
            }
          }

          // Top-right corner copy button on the opening line
          if (lineNum === block.startLine) {
            builder.add(
              line.to,
              line.to,
              Decoration.widget({
                widget: new CodeCopyWidget(block.code),
                side: 1,
              })
            );
          }
        }
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
