import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

class CodeFlairWidget extends WidgetType {
  constructor(readonly language: string, readonly getCode: () => string) {
    super();
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-codeblock-flair select-none';

    if (this.language) {
      const langBadge = document.createElement('span');
      langBadge.className = 'cm-codeblock-lang-badge';
      langBadge.textContent = this.language.toLowerCase();
      wrap.appendChild(langBadge);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-code-button';
    copyBtn.type = 'button';
    copyBtn.title = 'Copiar código';
    copyBtn.innerHTML = `
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <span>Copiar</span>
    `;

    copyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = this.getCode();
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = `
          <svg width="12" height="12" fill="none" stroke="#22c55e" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style="color: #22c55e">¡Copiado!</span>
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

    wrap.appendChild(copyBtn);
    return wrap;
  }

  eq(other: CodeFlairWidget): boolean {
    return other.language === this.language;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// Line decorations matching Obsidian's .HyperMD-codeblock specifications
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
        getCode: () => string;
      }

      const blocks: CodeBlockInfo[] = [];
      let inBlock = false;
      let startLine = 1;
      let lang = '';

      // 1. Detect code blocks between opening and closing ```
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
            const s = startLine;
            const e = i;
            const currentLang = lang;
            const startObj = doc.line(s);
            const endObj = doc.line(e);
            const isInside = selection.from <= endObj.to && selection.to >= startObj.from;

            const getCode = () => {
              const lines: string[] = [];
              for (let l = s + 1; l < e; l++) {
                lines.push(doc.line(l).text);
              }
              return lines.join('\n');
            };

            blocks.push({
              startLine: s,
              endLine: e,
              language: currentLang,
              isCursorInside: isInside,
              getCode,
            });
          }
        }
      }

      if (inBlock) {
        const s = startLine;
        const e = doc.lines;
        const currentLang = lang;
        const startObj = doc.line(s);
        const endObj = doc.line(e);
        const isInside = selection.from <= endObj.to && selection.to >= startObj.from;

        const getCode = () => {
          const lines: string[] = [];
          for (let l = s + 1; l <= e; l++) {
            lines.push(doc.line(l).text);
          }
          return lines.join('\n');
        };

        blocks.push({
          startLine: s,
          endLine: e,
          language: currentLang,
          isCursorInside: isInside,
          getCode,
        });
      }

      // 2. Map line numbers to block info
      const lineMap = new Map<number, CodeBlockInfo>();
      for (const b of blocks) {
        for (let l = b.startLine; l <= b.endLine; l++) {
          lineMap.set(l, b);
        }
      }

      // 3. Emit decorations strictly in ascending line order
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
          if (lineNum === block.startLine || lineNum === block.endLine) {
            if (line.to > line.from) {
              builder.add(line.from, line.to, delimiterHiddenMark);
            }
          }

          // Top-right corner flair widget on the opening line
          if (lineNum === block.startLine) {
            builder.add(
              line.to,
              line.to,
              Decoration.widget({
                widget: new CodeFlairWidget(block.language, block.getCode),
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
