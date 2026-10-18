import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state';
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
    dom.className = this.block ? 'cm-katex-block-widget select-none' : 'cm-katex-inline-widget select-none';
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

function buildMathDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const text = doc.toString();
  const selection = state.selection.main;

  interface MathItem {
    from: number;
    to: number;
    math: string;
    block: boolean;
  }

  const items: MathItem[] = [];
  const coveredRanges: [number, number][] = [];

  // 1. Block Math: $$ ... $$ (supports multi-line equations)
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const start = blockMatch.index;
    const end = start + blockMatch[0].length;
    const mathContent = blockMatch[1].trim();

    if (mathContent.length === 0) continue;

    coveredRanges.push([start, end]);

    // If user cursor is strictly inside the equation, keep it as raw LaTeX so they can edit
    const isCursorInside = selection.head > start && selection.head < end;

    if (!isCursorInside) {
      items.push({
        from: start,
        to: end,
        math: mathContent,
        block: true,
      });
    }
  }

  // 2. Inline Math: $...$ (single line, avoid overlapping block math)
  const inlineRegex = /(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g;
  let inlineMatch: RegExpExecArray | null;

  while ((inlineMatch = inlineRegex.exec(text)) !== null) {
    const start = inlineMatch.index;
    const end = start + inlineMatch[0].length;
    const mathContent = inlineMatch[1].trim();

    if (mathContent.length === 0) continue;

    const isOverlapping = coveredRanges.some(
      ([bStart, bEnd]) => start >= bStart && end <= bEnd
    );
    if (isOverlapping) continue;

    const isCursorInside = selection.head > start && selection.head < end;

    if (!isCursorInside) {
      items.push({
        from: start,
        to: end,
        math: mathContent,
        block: false,
      });
    }
  }

  // Sort strictly by start position ascending to satisfy RangeSetBuilder invariant
  items.sort((a, b) => a.from - b.from || a.to - b.to);

  for (const item of items) {
    builder.add(
      item.from,
      item.to,
      Decoration.replace({
        widget: new MathWidget(item.math, item.block, item.from),
      })
    );
  }

  return builder.finish();
}

/**
 * StateField for math expressions.
 * In CodeMirror 6, replace decorations that span across line breaks (like multiline $$ ... $$)
 * MUST be provided by a StateField rather than a ViewPlugin to avoid RangeError.
 */
export const mathExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildMathDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection) {
      return buildMathDecorations(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
