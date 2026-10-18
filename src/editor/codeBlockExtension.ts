import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

class CodeHeaderWidget extends WidgetType {
  constructor(readonly language: string, readonly getCode: () => string) {
    super();
  }

  toDOM(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'cm-codeblock-header select-none';

    const langBadge = document.createElement('span');
    langBadge.className = 'cm-codeblock-lang';
    langBadge.textContent = (this.language || 'código').toUpperCase();

    const copyBtn = document.createElement('button');
    copyBtn.className = 'cm-codeblock-copy-btn';
    copyBtn.title = 'Copiar código al portapapeles';
    copyBtn.innerHTML = `
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <span>Copiar</span>
    `;

    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = this.getCode();
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = `
          <svg width="12" height="12" fill="none" stroke="#4ade80" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style="color: #4ade80">¡Copiado!</span>
        `;
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            <span>Copiar</span>
          `;
        }, 2000);
      });
    });

    header.appendChild(langBadge);
    header.appendChild(copyBtn);
    return header;
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.language === this.language;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const codeLineBegin = Decoration.line({ class: 'cm-codeblock-line cm-codeblock-begin' });
const codeLineMid = Decoration.line({ class: 'cm-codeblock-line' });
const codeLineEnd = Decoration.line({ class: 'cm-codeblock-line cm-codeblock-end' });

export const codeBlockExtension = ViewPlugin.fromClass(
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
      const builder = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc;

      interface CodeBlockInfo {
        startLineNum: number;
        endLineNum: number;
        language: string;
      }

      const blocks: CodeBlockInfo[] = [];
      let inBlock = false;
      let startLine = 1;
      let lang = '';

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const trimmed = line.text.trim();

        if (trimmed.startsWith('```')) {
          if (!inBlock) {
            inBlock = true;
            startLine = i;
            lang = trimmed.slice(3).trim();
          } else {
            inBlock = false;
            blocks.push({
              startLineNum: startLine,
              endLineNum: i,
              language: lang,
            });
          }
        }
      }

      // If document ends with unclosed code fence
      if (inBlock) {
        blocks.push({
          startLineNum: startLine,
          endLineNum: doc.lines,
          language: lang,
        });
      }

      // Add decorations strictly in ascending line order
      for (const block of blocks) {
        const startLineObj = doc.line(block.startLineNum);
        const endLineObj = doc.line(block.endLineNum);

        const getCode = () => {
          const lines: string[] = [];
          for (let l = block.startLineNum + 1; l < block.endLineNum; l++) {
            lines.push(doc.line(l).text);
          }
          return lines.join('\n');
        };

        // Header block widget above first line
        builder.add(
          startLineObj.from,
          startLineObj.from,
          Decoration.widget({
            widget: new CodeHeaderWidget(block.language, getCode),
            side: -1,
            block: true,
          })
        );

        // Opening line
        builder.add(startLineObj.from, startLineObj.from, codeLineBegin);

        // Middle code lines
        for (let l = block.startLineNum + 1; l < block.endLineNum; l++) {
          const midLine = doc.line(l);
          builder.add(midLine.from, midLine.from, codeLineMid);
        }

        // Closing line
        if (block.endLineNum > block.startLineNum) {
          builder.add(endLineObj.from, endLineObj.from, codeLineEnd);
        }
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
