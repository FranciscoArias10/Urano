import { Text } from '@codemirror/state';

export interface FencedCodeBlock {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  language: string;
  hasClosingFence: boolean;
}

/**
 * Scans the document for fenced code blocks delimited by ``` lines.
 */
export function getFencedCodeBlocks(doc: Text): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];
  let inBlock = false;
  let startLine = 1;
  let language = '';

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();

    if (trimmed.startsWith('```')) {
      if (!inBlock) {
        inBlock = true;
        startLine = i;
        language = trimmed.slice(3).trim();
      } else {
        inBlock = false;
        blocks.push({
          startLine,
          endLine: i,
          from: doc.line(startLine).from,
          to: line.to,
          language,
          hasClosingFence: true,
        });
      }
    }
  }

  if (inBlock) {
    const endLine = doc.lines;
    blocks.push({
      startLine,
      endLine,
      from: doc.line(startLine).from,
      to: doc.line(endLine).to,
      language,
      hasClosingFence: false,
    });
  }

  return blocks;
}

/**
 * Returns a Set of 1-based line numbers belonging to any fenced code block.
 */
export function getFencedCodeLineSet(doc: Text): Set<number> {
  const codeLines = new Set<number>();
  const blocks = getFencedCodeBlocks(doc);
  for (const b of blocks) {
    for (let l = b.startLine; l <= b.endLine; l++) {
      codeLines.add(l);
    }
  }
  return codeLines;
}

/**
 * Finds inline code spans (`...`) within a single line.
 */
export function getInlineCodeRangesInLine(
  lineText: string,
  lineFrom = 0
): [number, number][] {
  const ranges: [number, number][] = [];
  const regex = /(?<!`)`([^`\n]+)`(?!`)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lineText)) !== null) {
    const from = lineFrom + match.index;
    const to = from + match[0].length;
    ranges.push([from, to]);
  }
  return ranges;
}

/**
 * Collects all character ranges `[from, to]` in the document belonging to fenced
 * code blocks or inline code spans outside fenced code blocks.
 */
export function getAllCodeRanges(doc: Text): [number, number][] {
  const ranges: [number, number][] = [];
  const blocks = getFencedCodeBlocks(doc);
  const codeLines = new Set<number>();

  for (const b of blocks) {
    ranges.push([b.from, b.to]);
    for (let l = b.startLine; l <= b.endLine; l++) {
      codeLines.add(l);
    }
  }

  for (let i = 1; i <= doc.lines; i++) {
    if (codeLines.has(i)) continue;
    const line = doc.line(i);
    ranges.push(...getInlineCodeRangesInLine(line.text, line.from));
  }

  return ranges;
}

/**
 * Checks whether `[from, to)` overlaps with any `[rFrom, rTo)` range.
 */
export function isRangeOverlapping(
  from: number,
  to: number,
  ranges: [number, number][]
): boolean {
  return ranges.some(([rFrom, rTo]) => from < rTo && to > rFrom);
}

