import { EditorView } from '@codemirror/view';
import { EditorSelection, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

export interface TokenInfo {
  tokenStart: number;
  tokenEnd: number;
  contentStart: number;
  contentEnd: number;
  openLen: number;
  closeLen: number;
}

// All inline formatted token patterns supported in Urano
const INLINE_PATTERNS: {
  regex: RegExp;
  getDelims: (m: RegExpExecArray) => { openLen: number; closeLen: number };
}[] = [
  // 1. Bold: **text** or __text__
  {
    regex: /(?:\*\*([^\*\n]+)\*\*|__([^_\n]+)__)/g,
    getDelims: () => ({ openLen: 2, closeLen: 2 }),
  },
  // 2. Strikethrough: ~~text~~
  {
    regex: /~~([^~\n]+)~~/g,
    getDelims: () => ({ openLen: 2, closeLen: 2 }),
  },
  // 3. Inline Code: `text`
  {
    regex: /(?<!`)`([^`\n]+)`(?!`)/g,
    getDelims: () => ({ openLen: 1, closeLen: 1 }),
  },
  // 4. Highlight: ==text== or ==🔴text==
  {
    regex: /==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\n]+)==/g,
    getDelims: (m) => {
      let openLen = 2 + (m[1] ? m[1].length : 0);
      if (m[0].charAt(openLen) === ' ') openLen += 1;
      return { openLen, closeLen: 2 };
    },
  },
  // 5. HTML Highlight: <mark class="hl-...">...</mark>
  {
    regex: /<mark class="hl-(?:red|orange|yellow|green|blue|purple)">([^\n]+?)<\/mark>/gi,
    getDelims: (m) => ({ openLen: m[0].indexOf('>') + 1, closeLen: 7 }),
  },
  // 6. Italic: *text* or _text_
  {
    regex: /(?:(?<!\*)\*([^\*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_))/g,
    getDelims: () => ({ openLen: 1, closeLen: 1 }),
  },
  // 7. Math inline: $text$
  {
    regex: /(?<!\$)\$(?!\$)([^\$\n]+)\$(?!\$)/g,
    getDelims: () => ({ openLen: 1, closeLen: 1 }),
  },
  // 8. Comment: %%text%%
  {
    regex: /%%([^%\n]+)%%/g,
    getDelims: () => ({ openLen: 2, closeLen: 2 }),
  },
];

export function getLineTokens(lineText: string, lineFrom: number): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  for (const { regex, getDelims } of INLINE_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lineText)) !== null) {
      const tokenStart = lineFrom + match.index;
      const tokenEnd = tokenStart + match[0].length;
      const { openLen, closeLen } = getDelims(match);
      const contentStart = tokenStart + openLen;
      const contentEnd = tokenEnd - closeLen;

      // Avoid overlapping with already found tokens
      const overlaps = tokens.some(
        (t) =>
          (tokenStart >= t.tokenStart && tokenStart < t.tokenEnd) ||
          (tokenEnd > t.tokenStart && tokenEnd <= t.tokenEnd)
      );
      if (!overlaps) {
        tokens.push({
          tokenStart,
          tokenEnd,
          contentStart,
          contentEnd,
          openLen,
          closeLen,
        });
      }
    }
  }
  return tokens;
}

export function getAdjustedFormattingClickPos(
  view: EditorView,
  event: MouseEvent
): number | null {
  if (event.button !== 0 || event.detail > 1) return null;

  const target = event.target as HTMLElement | null;
  if (!target) return null;

  if (
    target.closest('.urano-table-editor') ||
    target.closest('.cm-table-widget') ||
    target.closest('.cm-callout') ||
    target.closest('.cm-codeblock-wrapper') ||
    target.closest('.cm-footnote-ref')
  ) {
    return null;
  }

  const clickPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (clickPos === null) return null;

  const doc = view.state.doc;
  const line = doc.lineAt(clickPos);
  const clickX = event.clientX;

  const tokens = getLineTokens(line.text, line.from);

  for (const token of tokens) {
    const { tokenStart, tokenEnd, contentStart, contentEnd } = token;

    const isNearby = clickPos >= tokenStart - 1 && clickPos <= tokenEnd + 1;
    const isAtLineEndPastToken =
      tokenEnd === line.to && clickPos >= contentEnd;

    if (isNearby || isAtLineEndPastToken) {
      const coordsContentEnd = view.coordsAtPos(contentEnd);
      const coordsContentStart = view.coordsAtPos(contentStart);

      // --- ZONE 2: CLICKING AFTER FORMATTED TEXT / ON CLOSING DELIMITER ("ATRÁS") ---
      // 1. Inside closing delimiter range: (contentEnd, tokenEnd]
      if (clickPos > contentEnd && clickPos <= tokenEnd) {
        return tokenEnd;
      }

      // 2. At contentEnd or tokenEnd
      if (clickPos === contentEnd || clickPos === tokenEnd) {
        if (coordsContentEnd && clickX >= coordsContentEnd.right - 6) {
          return tokenEnd;
        }
      }

      // 3. Trailing edge of inner content (e.g. clicked on the last letter)
      if (clickPos === contentEnd - 1 && coordsContentEnd && clickX >= coordsContentEnd.right - 4) {
        return tokenEnd;
      }

      // 4. Past the token at the end of the line
      if (tokenEnd === line.to && coordsContentEnd && clickX >= coordsContentEnd.right - 6) {
        return tokenEnd;
      }

      // --- ZONE 1: CLICKING BEFORE FORMATTED TEXT / ON OPENING DELIMITER ("ADELANTE") ---
      // 1. Inside opening delimiter range: [tokenStart, contentStart)
      if (clickPos >= tokenStart && clickPos < contentStart) {
        return tokenStart;
      }

      // 2. At contentStart or tokenStart
      if (clickPos === contentStart || clickPos === tokenStart) {
        if (coordsContentStart && clickX <= coordsContentStart.left + 6) {
          return tokenStart;
        }
      }

      // 3. Leading edge of inner content (e.g. clicked on first letter)
      if (clickPos === contentStart + 1 && coordsContentStart && clickX <= coordsContentStart.left + 4) {
        return tokenStart;
      }
    }
  }

  return null;
}

export function smartFormattingArrowKeys(view: EditorView, isRight: boolean): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const pos = sel.head;
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const tokens = getLineTokens(line.text, line.from);

  for (const token of tokens) {
    if (isRight) {
      // If cursor is at contentEnd (e.g. susu|**), jump directly to tokenEnd (**susu**|)
      if (pos === token.contentEnd) {
        view.dispatch({
          selection: { anchor: token.tokenEnd, head: token.tokenEnd },
          userEvent: 'move',
          scrollIntoView: true,
        });
        return true;
      }
      // If cursor is at tokenStart (|**susu**), jump directly to contentStart (**|susu**)
      if (pos === token.tokenStart) {
        view.dispatch({
          selection: { anchor: token.contentStart, head: token.contentStart },
          userEvent: 'move',
          scrollIntoView: true,
        });
        return true;
      }
    } else {
      // isLeft
      // If cursor is at contentStart (**|susu**), jump directly to tokenStart (|**susu**)
      if (pos === token.contentStart) {
        view.dispatch({
          selection: { anchor: token.tokenStart, head: token.tokenStart },
          userEvent: 'move',
          scrollIntoView: true,
        });
        return true;
      }
      // If cursor is at tokenEnd (**susu**|), jump directly to contentEnd (**susu|**)
      if (pos === token.tokenEnd) {
        view.dispatch({
          selection: { anchor: token.contentEnd, head: token.contentEnd },
          userEvent: 'move',
          scrollIntoView: true,
        });
        return true;
      }
    }
  }
  return false;
}

export const formattingClickExtension = [
  EditorView.mouseSelectionStyle.of(
    (view: EditorView, event: MouseEvent) => {
      const targetPos = getAdjustedFormattingClickPos(view, event);
      if (targetPos === null) return null;

      return {
        get(_curEvent: MouseEvent, extend: boolean) {
          if (extend) {
            const anchor = view.state.selection.main.anchor;
            return EditorSelection.create([EditorSelection.range(anchor, targetPos)]);
          }
          return EditorSelection.create([EditorSelection.cursor(targetPos)]);
        },
        update() {
          return false;
        },
      };
    }
  ),
  Prec.high(
    keymap.of([
      {
        key: 'ArrowRight',
        run: (view) => smartFormattingArrowKeys(view, true),
      },
      {
        key: 'ArrowLeft',
        run: (view) => smartFormattingArrowKeys(view, false),
      },
    ])
  ),
];
