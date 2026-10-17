import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Range } from '@codemirror/state';
import katex from 'katex';

class MathWidget extends WidgetType {
  constructor(
    readonly math: string,
    readonly block: boolean,
    readonly pos: number
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement(this.block ? 'div' : 'span');
    dom.className = this.block ? 'cm-katex-block-widget' : 'cm-katex-inline-widget';
    dom.title = 'Haz clic para editar LaTeX';

    try {
      katex.render(this.math.trim(), dom, {
        displayMode: this.block,
        throwOnError: false,
      });
    } catch {
      dom.textContent = this.math;
      dom.className += ' cm-katex-error';
    }

    // Clicking the rendered formula places cursor inside so it expands for editing
    dom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.pos + (this.block ? 2 : 1) },
      });
      view.focus();
    });

    return dom;
  }

  eq(other: MathWidget): boolean {
    return other.math === this.math && other.block === this.block;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export const mathExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged
      ) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view: EditorView): DecorationSet {
      const widgets: Range<Decoration>[] = [];
      const doc = view.state.doc;
      const text = doc.toString();
      const selection = view.state.selection.main;

      // 1. Block Math: $$ ... $$ (supports multi-line equations)
      const blockRegex = /\$\$([\s\S]+?)\$\$/g;
      let blockMatch: RegExpExecArray | null;

      while ((blockMatch = blockRegex.exec(text)) !== null) {
        const start = blockMatch.index;
        const end = start + blockMatch[0].length;
        const mathContent = blockMatch[1].trim();

        if (mathContent.length === 0) continue;

        // If user cursor is inside the equation, keep it as raw LaTeX so they can edit
        const isCursorInside = selection.head >= start && selection.head <= end;

        if (!isCursorInside) {
          // Replace raw $$...$$ with real KaTeX rendered formula!
          widgets.push(
            Decoration.replace({
              widget: new MathWidget(mathContent, true, start),
            }).range(start, end)
          );
        }
      }

      // 2. Inline Math: $...$ (single line)
      const inlineRegex = /(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g;
      let inlineMatch: RegExpExecArray | null;

      while ((inlineMatch = inlineRegex.exec(text)) !== null) {
        const start = inlineMatch.index;
        const end = start + inlineMatch[0].length;
        const mathContent = inlineMatch[1].trim();

        if (mathContent.length === 0) continue;

        const isCursorInside = selection.head >= start && selection.head <= end;

        if (!isCursorInside) {
          widgets.push(
            Decoration.replace({
              widget: new MathWidget(mathContent, false, start),
            }).range(start, end)
          );
        }
      }

      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
