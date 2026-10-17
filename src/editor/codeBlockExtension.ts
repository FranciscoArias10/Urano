import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Range } from '@codemirror/state';

class CodeHeaderWidget extends WidgetType {
  constructor(readonly language: string, readonly code: string) {
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
    copyBtn.innerHTML = `
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
      <span>Copiar</span>
    `;

    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(this.code);
      copyBtn.innerHTML = `
        <svg class="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span class="text-emerald-400">¡Copiado!</span>
      `;
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
          </svg>
          <span>Copiar</span>
        `;
      }, 2000);
    });

    header.appendChild(langBadge);
    header.appendChild(copyBtn);
    return header;
  }

  eq(other: CodeHeaderWidget): boolean {
    return other.language === this.language && other.code === this.code;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const codeLineDecoration = Decoration.line({ class: 'cm-codeblock-line' });

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
      const widgets: Range<Decoration>[] = [];
      const doc = view.state.doc;
      let inCodeBlock = false;
      let currentLang = '';
      let codeLines: string[] = [];
      let blockStartLine = -1;

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        const trimmed = text.trim();

        if (trimmed.startsWith('```')) {
          if (!inCodeBlock) {
            // Opening fence
            inCodeBlock = true;
            currentLang = trimmed.slice(3).trim();
            codeLines = [];
            blockStartLine = line.from;
            widgets.push(codeLineDecoration.range(line.from));
          } else {
            // Closing fence
            inCodeBlock = false;
            widgets.push(codeLineDecoration.range(line.from));

            // Add header widget at opening line
            const fullCode = codeLines.join('\n');
            widgets.push(
              Decoration.widget({
                widget: new CodeHeaderWidget(currentLang, fullCode),
                side: -1,
                block: true,
              }).range(blockStartLine)
            );
          }
        } else if (inCodeBlock) {
          codeLines.push(text);
          widgets.push(codeLineDecoration.range(line.from));
        }
      }

      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
