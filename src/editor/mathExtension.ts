import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { StateField, RangeSetBuilder, EditorState } from '@codemirror/state';
import katex from 'katex';

/**
 * Widget for multiline block equations ($$ ... $$)
 * Handles both:
 * - Estado 1 (Expanded): Displayed directly below the closing $$ line with interactive </> button
 * - Estado 2 (Collapsed): Replaces the raw source lines with the rendered box and hover </> button
 */
class MathBlockWidget extends WidgetType {
  constructor(
    readonly math: string,
    readonly startPos: number,
    readonly endPos: number,
    readonly isExpanded: boolean
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = `cm-katex-block-widget select-none relative my-3 p-4 border border-[#363636] rounded-md bg-[#181818] text-center transition-colors group ${
      this.isExpanded ? 'is-expanded' : 'is-collapsed'
    }`;
    box.style.cssText =
      'border: 1px solid #363636; border-radius: 6px; padding: 16px; position: relative; background-color: #181818; display: flex; justify-content: center; align-items: center; margin: 12px 0; text-align: center;';

    // The </> toggle button in top right corner
    const codeBtn = document.createElement('button');
    codeBtn.type = 'button';
    codeBtn.className = 'cm-katex-code-toggle-btn';
    codeBtn.style.cssText =
      'position: absolute; top: 8px; right: 12px; font-family: monospace; font-size: 13px; font-weight: 600; color: #888; background: transparent; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; user-select: none; transition: color 0.15s, background-color 0.15s, opacity 0.15s; z-index: 10;';
    codeBtn.textContent = '</>';
    codeBtn.title = this.isExpanded
      ? 'Ocultar código fuente LaTeX'
      : 'Editar código fuente LaTeX';

    // In Estado 2 (collapsed), button is hidden until hovering the box
    if (!this.isExpanded) {
      codeBtn.style.opacity = '0';
      box.addEventListener('mouseenter', () => {
        codeBtn.style.opacity = '1';
      });
      box.addEventListener('mouseleave', () => {
        codeBtn.style.opacity = '0';
      });
    } else {
      codeBtn.style.opacity = '1';
    }

    codeBtn.addEventListener('mouseenter', () => {
      codeBtn.style.color = '#e06c1b';
      codeBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    });
    codeBtn.addEventListener('mouseleave', () => {
      codeBtn.style.color = '#888';
      codeBtn.style.backgroundColor = 'transparent';
    });

    const triggerToggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isExpanded) {
        // Estado 1 -> collapse by moving cursor outside the $$ ... $$ block
        const afterPos = Math.min(
          view.state.doc.length,
          this.endPos + (view.state.doc.sliceString(this.endPos, this.endPos + 1) === '\n' ? 1 : 0)
        );
        view.dispatch({ selection: { anchor: afterPos } });
      } else {
        // Estado 2 -> expand by moving cursor inside the formula lines
        const formulaLinePos = Math.min(
          view.state.doc.length,
          this.startPos + (view.state.doc.sliceString(this.startPos, this.startPos + 3) === '$$\n' ? 3 : 2)
        );
        view.dispatch({ selection: { anchor: formulaLinePos } });
      }
      view.focus();
    };

    codeBtn.addEventListener('mousedown', triggerToggle);
    box.appendChild(codeBtn);

    // KaTeX Rendered Output
    const mathEl = document.createElement('div');
    mathEl.className = 'cm-katex-math-render overflow-x-auto w-full text-center py-1';
    mathEl.style.cssText = 'color: #fff7ed; font-size: 1.25em;';
    try {
      katex.render(this.math.trim(), mathEl, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      mathEl.textContent = this.math;
      mathEl.className += ' text-red-400 font-mono text-xs';
    }
    box.appendChild(mathEl);

    // In Estado 2 (collapsed), clicking anywhere on the box expands source code
    if (!this.isExpanded) {
      box.style.cursor = 'pointer';
      box.addEventListener('click', (e) => {
        if (e.target === codeBtn) return;
        triggerToggle(e);
      });
    }

    return box;
  }

  eq(other: MathBlockWidget): boolean {
    return (
      other.math === this.math &&
      other.isExpanded === this.isExpanded &&
      other.startPos === this.startPos &&
      other.endPos === this.endPos
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Widget for inline equations ($...$)
 */
class MathInlineWidget extends WidgetType {
  constructor(
    readonly math: string,
    readonly pos: number
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'cm-katex-inline-widget select-none cursor-pointer';
    dom.title = 'Haz clic para editar LaTeX';

    try {
      katex.render(this.math.trim(), dom, {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      dom.textContent = this.math;
      dom.className += ' cm-katex-error';
    }

    dom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: this.pos + 1 },
      });
      view.focus();
    });

    return dom;
  }

  eq(other: MathInlineWidget): boolean {
    return other.math === this.math && other.pos === this.pos;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Styling marks for LaTeX source code lines when cursor is inside ($$ ... $$)
const mathDelimiterMark = Decoration.mark({
  class: 'cm-math-delimiter text-[#e06c1b] font-bold font-mono',
});
const mathVarMark = Decoration.mark({
  class: 'cm-math-var text-[#2dd4bf] font-medium font-mono',
});
const mathExponentMark = Decoration.mark({
  class: 'cm-math-exponent text-[#fb923c] font-semibold font-mono bg-orange-500/15 rounded px-0.5',
});
const mathCommandMark = Decoration.mark({
  class: 'cm-math-command text-[#c084fc] font-mono',
});
const mathNumberMark = Decoration.mark({
  class: 'cm-math-number text-[#93c5fd] font-mono',
});

interface DecoEntry {
  from: number;
  to: number;
  deco: Decoration;
}

function tokenizeLatexSource(
  source: string,
  baseOffset: number,
  entries: DecoEntry[]
) {
  const tokenRegex =
    /(\\[a-zA-Z]+)|(\^(?:\{[^}]+\}|[0-9a-zA-Z]))|(_(?:\{[^}]+\}|[0-9a-zA-Z]))|([a-zA-Z])|([0-9]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(source)) !== null) {
    const from = baseOffset + match.index;
    const to = from + match[0].length;
    if (match[1]) {
      // LaTeX command (\alpha, \frac, \sqrt, etc.)
      entries.push({ from, to, deco: mathCommandMark });
    } else if (match[2] || match[3]) {
      // Exponents (^2, ^{x+1}) or Subscripts (_1, _{i})
      entries.push({ from, to, deco: mathExponentMark });
    } else if (match[4]) {
      // Variables (E, m, c, x, y, z) in cyan #2dd4bf
      entries.push({ from, to, deco: mathVarMark });
    } else if (match[5]) {
      // Numbers
      entries.push({ from, to, deco: mathNumberMark });
    }
  }
}

function buildMathDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const text = doc.toString();
  const selection = state.selection.main;

  const entries: DecoEntry[] = [];
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

    const isInside = selection.from <= end && selection.to >= start;

    if (isInside) {
      // Estado 1: Cursor DENTRO de las líneas $$ ... $$
      // Delimiter $$ at start in accent color #e06c1b
      entries.push({ from: start, to: start + 2, deco: mathDelimiterMark });
      // Inner formula lines colored: variables in cian #2dd4bf, exponents, commands
      if (end - 2 > start + 2) {
        tokenizeLatexSource(text.slice(start + 2, end - 2), start + 2, entries);
      }
      // Delimiter $$ at end in accent color #e06c1b
      entries.push({ from: end - 2, to: end, deco: mathDelimiterMark });
      // Preview widget placed directly below the closing $$ with </> button
      entries.push({
        from: end,
        to: end,
        deco: Decoration.widget({
          widget: new MathBlockWidget(mathContent, start, end, true),
          block: true,
          side: 1,
        }),
      });
    } else {
      // Estado 2: Cursor FUERA del bloque $$ ... $$
      // Replace raw lines with rendered box
      entries.push({
        from: start,
        to: end,
        deco: Decoration.replace({
          widget: new MathBlockWidget(mathContent, start, end, false),
        }),
      });
    }
  }

  // 2. Inline Math: $...$
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

    const isInside = selection.from <= end && selection.to >= start;
    if (isInside) {
      entries.push({ from: start, to: start + 1, deco: mathDelimiterMark });
      entries.push({ from: end - 1, to: end, deco: mathDelimiterMark });
    } else {
      entries.push({
        from: start,
        to: end,
        deco: Decoration.replace({
          widget: new MathInlineWidget(mathContent, start),
        }),
      });
    }
  }

  // Sort all decorations strictly by from, startSide, and to
  entries.sort(
    (a, b) =>
      a.from - b.from ||
      (a.deco.startSide ?? 0) - (b.deco.startSide ?? 0) ||
      a.to - b.to
  );

  for (const entry of entries) {
    builder.add(entry.from, entry.to, entry.deco);
  }

  return builder.finish();
}

/**
 * StateField for LaTeX math expressions with interactive </> button and dual states
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
