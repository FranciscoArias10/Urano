import { StateField, RangeSetBuilder, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { MenuItemData } from '../components/common/UranoMenu';
import { useNoticeStore } from '../components/common/Notice';
import { t } from '../locales/i18n';
import { getFencedCodeLineSet } from './codeRangeUtils';
import {
  Rows,
  Columns,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  MoveUp,
  MoveDown,
  MoveLeft,
  MoveRight,
  Copy,
  Trash2,
  Scissors,
  Clipboard,
} from 'lucide-react';

export interface ParsedTable {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
  headers: string[];
  alignments: ('left' | 'center' | 'right')[];
  rows: string[][];
  rawText: string;
}

interface TableDomState {
  from: number;
  tableIndex: number;
  headers: string[];
  alignments: ('left' | 'center' | 'right')[];
  rows: string[][];
  lastCommittedRawText: string;
  lastDispatchedMarkdown: string | null;
  commitTimer: ReturnType<typeof setTimeout> | null;
  isDestroyed: boolean;
  forceDomSync: boolean;
  view: EditorView;
  focusCell: (row: number, col: number, cursorAtEnd?: boolean) => void;
}

const tableDomState = new WeakMap<HTMLElement, TableDomState>();

let pendingTableFocus: {
  tableIndex: number;
  row: number;
  col: number;
} | null = null;

export function setPendingTableFocus(
  focus: { tableIndex: number; row: number; col: number } | null
) {
  pendingTableFocus = focus;
}

function isTrailingPipeEscaped(trimmed: string): boolean {
  let backslashes = 0;
  for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function splitEscapedPipeCells(text: string): string[] {
  const raw = text.trim();
  const inner =
    raw.startsWith('|') && raw.endsWith('|') && !isTrailingPipeEscaped(raw)
      ? raw.slice(1, -1)
      : raw;
  const cells: string[] = [];
  let current = '';

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === '|') {
        current += '|';
        i++;
        continue;
      }
      if (next === '\\') {
        current += '\\\\';
        i++;
        continue;
      }
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function countTableCells(text: string): number {
  return splitEscapedPipeCells(text).length;
}

export function isTableRow(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('|') || !t.endsWith('|') || t.length < 2) return false;
  return !isTrailingPipeEscaped(t);
}

export function isTableSeparator(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('|') || !t.endsWith('|') || isTrailingPipeEscaped(t)) return false;
  const cells = t.slice(1, -1).split('|');
  if (cells.length < 1) return false;
  return cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
}

export function parseAlignments(
  sepLine: string,
  count: number
): ('left' | 'center' | 'right')[] {
  const cells = sepLine.trim().slice(1, -1).split('|');
  const result: ('left' | 'center' | 'right')[] = [];
  for (let i = 0; i < count; i++) {
    const raw = (cells[i] || '').trim();
    if (raw.startsWith(':') && raw.endsWith(':')) {
      result.push('center');
    } else if (raw.endsWith(':')) {
      result.push('right');
    } else {
      result.push('left');
    }
  }
  return result;
}

export function parseTableRowCells(text: string, count?: number): string[] {
  const cells = splitEscapedPipeCells(text);
  if (count === undefined) {
    return cells;
  }
  while (cells.length < count) {
    cells.push('');
  }
  return cells.slice(0, count);
}

export function serializeTable(
  headers: string[],
  alignments: ('left' | 'center' | 'right')[],
  rows: string[][]
): string {
  const colCount = Math.max(headers.length, 1);
  const normHeaders = Array.from({ length: colCount }, (_, i) => headers[i] ?? '');
  const normAlign = Array.from({ length: colCount }, (_, i) => alignments[i] ?? 'left');
  const normRows = rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => r[i] ?? '')
  );

  const cleanCell = (c: string) => {
    const escaped = c.replace(/(?<!\\)\|/g, '\\|');
    return escaped === '' ? ' ' : escaped;
  };

  const headerLine = `| ${normHeaders.map(cleanCell).join(' | ')} |`;
  const sepLine = `| ${normAlign
    .map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : '---'))
    .join(' | ')} |`;
  const rowLines = normRows.map(
    (row) => `| ${row.map(cleanCell).join(' | ')} |`
  );

  return [headerLine, sepLine, ...rowLines].join('\n');
}

export function findAllTables(doc: Text): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const codeLines = getFencedCodeLineSet(doc);
  let i = 1;
  const lineCount = doc.lines;

  while (i < lineCount) {
    if (codeLines.has(i) || codeLines.has(i + 1)) {
      i++;
      continue;
    }
    const line1 = doc.line(i).text;
    const line2 = doc.line(i + 1).text;

    if (isTableRow(line1) && isTableSeparator(line2)) {
      const headerLine = line1;
      const sepLine = line2;
      const colCount = Math.max(countTableCells(headerLine), 1);
      const headers = parseTableRowCells(headerLine, colCount);
      const alignments = parseAlignments(sepLine, colCount);

      const rows: string[][] = [];
      let endLine = i + 1;

      for (let r = i + 2; r <= lineCount; r++) {
        if (codeLines.has(r)) break;
        const nextText = doc.line(r).text;
        // If followed by another separator, it is the start of a next table
        if (
          r < lineCount &&
          !codeLines.has(r + 1) &&
          isTableRow(nextText) &&
          isTableSeparator(doc.line(r + 1).text)
        ) {
          break;
        }
        if (isTableRow(nextText) && !isTableSeparator(nextText)) {
          rows.push(parseTableRowCells(nextText, colCount));
          endLine = r;
        } else {
          break;
        }
      }

      const from = doc.line(i).from;
      const to = doc.line(endLine).to;
      const rawLines: string[] = [];
      for (let l = i; l <= endLine; l++) {
        rawLines.push(doc.line(l).text);
      }

      tables.push({
        startLine: i,
        endLine,
        from,
        to,
        headers,
        alignments,
        rows,
        rawText: rawLines.join('\n'),
      });

      i = endLine + 1;
      continue;
    }
    i++;
  }

  return tables;
}

export function findTargetTable(
  doc: Text,
  widgetFrom: number,
  widgetIndex: number,
  expectedRawText?: string,
  domPos?: number | null
): ParsedTable | null {
  const tables = findAllTables(doc);
  if (tables.length === 0) return null;

  // 1. Live DOM position inside a parsed table
  if (typeof domPos === 'number' && domPos >= 0) {
    const byDomPos = tables.find((t) => domPos >= t.from && domPos <= t.to);
    if (byDomPos && (!expectedRawText || byDomPos.rawText === expectedRawText)) {
      return byDomPos;
    }
  }

  // 2. Direct match by exact 'from' position (verified against expectedRawText when provided)
  const exact = tables.find((t) => t.from === widgetFrom);
  if (exact && (!expectedRawText || exact.rawText === expectedRawText)) {
    return exact;
  }

  // 3. Match by expectedRawText; if missing, refuse to overwrite a different table
  if (expectedRawText) {
    const rawMatches = tables.filter((t) => t.rawText === expectedRawText);
    if (rawMatches.length === 0) return null;
    let closestMatch = rawMatches[0];
    let minDiff = Math.abs(rawMatches[0].from - widgetFrom);
    for (let i = 1; i < rawMatches.length; i++) {
      const diff = Math.abs(rawMatches[i].from - widgetFrom);
      if (diff < minDiff) {
        minDiff = diff;
        closestMatch = rawMatches[i];
      }
    }
    return closestMatch;
  }

  // 4. Legacy fallback when caller omits expectedRawText
  if (tables[widgetIndex]) return tables[widgetIndex];

  let closest = tables[0];
  let minDiff = Math.abs(tables[0].from - widgetFrom);
  for (let i = 1; i < tables.length; i++) {
    const diff = Math.abs(tables[i].from - widgetFrom);
    if (diff < minDiff) {
      minDiff = diff;
      closest = tables[i];
    }
  }
  return closest;
}

export class TableWidget extends WidgetType {
  domNode: HTMLElement | null = null;

  constructor(
    readonly tableData: ParsedTable,
    readonly tableIndex: number
  ) {
    super();
  }

  destroy(dom: HTMLElement): void {
    const state = tableDomState.get(dom);
    if (state) {
      state.isDestroyed = true;
      if (state.commitTimer !== null) {
        clearTimeout(state.commitTimer);
        state.commitTimer = null;
      }
    }
    this.domNode = null;
  }

  eq(other: TableWidget): boolean {
    return (
      this.tableData.rawText === other.tableData.rawText &&
      this.tableIndex === other.tableIndex
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    const state = tableDomState.get(dom);
    if (!state || state.isDestroyed) {
      return false;
    }

    // Rebuild full table DOM when row/column structure changes
    if (
      state.headers.length !== this.tableData.headers.length ||
      state.rows.length !== this.tableData.rows.length
    ) {
      return false;
    }

    const shouldSyncActiveCell =
      state.forceDomSync || state.lastDispatchedMarkdown !== this.tableData.rawText;

    state.from = this.tableData.from;
    state.tableIndex = this.tableIndex;
    state.headers = [...this.tableData.headers];
    state.alignments = [...this.tableData.alignments];
    state.rows = this.tableData.rows.map((r) => [...r]);
    state.lastCommittedRawText = this.tableData.rawText;
    state.forceDomSync = false;

    dom.setAttribute('data-table-from', String(this.tableData.from));
    dom.setAttribute('data-table-index', String(this.tableIndex));

    const activeEl = document.activeElement;
    const cells = dom.querySelectorAll('.urano-table-cell');
    cells.forEach((cellEl) => {
      const td = cellEl as HTMLElement;
      const rAttr = td.getAttribute('data-row');
      const cAttr = td.getAttribute('data-col');
      if (rAttr === null || cAttr === null) return;
      const row = Number(rAttr);
      const col = Number(cAttr);
      td.style.textAlign = this.tableData.alignments[col] || 'left';

      const contentEl = td.querySelector('.urano-table-cell-content') as HTMLElement | null;
      if (!contentEl) return;

      if (!shouldSyncActiveCell && activeEl === contentEl) {
        return;
      }

      const nextValue =
        row === 0
          ? (this.tableData.headers[col] ?? '')
          : (this.tableData.rows[row - 1]?.[col] ?? '');
      contentEl.innerText = nextValue;
    });

    if (pendingTableFocus && pendingTableFocus.tableIndex === this.tableIndex) {
      const target = pendingTableFocus;
      pendingTableFocus = null;
      setTimeout(() => {
        if (!state.isDestroyed && dom.isConnected) {
          state.focusCell(target.row, target.col);
        }
      }, 25);
    }

    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const { headers, alignments, rows } = this.tableData;

    const container = document.createElement('div');
    container.className =
      'cm-embed-block cm-table-widget urano-table-container my-4 max-w-full overflow-x-auto select-text';
    container.setAttribute('data-table-from', String(this.tableData.from));
    container.setAttribute('data-table-index', String(this.tableIndex));
    this.domNode = container;

    const focusCell = (row: number, col: number, cursorAtEnd = true) => {
      const cellEl = container.querySelector(
        `[data-row="${row}"][data-col="${col}"].urano-table-cell-content`
      ) as HTMLElement | null;
      if (!cellEl) return;
      cellEl.focus();
      if (cursorAtEnd && cellEl.childNodes.length > 0 && typeof document.createRange === 'function') {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(cellEl);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    };

    const domState: TableDomState = {
      from: this.tableData.from,
      tableIndex: this.tableIndex,
      headers: [...headers],
      alignments: [...alignments],
      rows: rows.map((r) => [...r]),
      lastCommittedRawText: this.tableData.rawText,
      lastDispatchedMarkdown: null,
      commitTimer: null,
      isDestroyed: false,
      forceDomSync: false,
      view,
      focusCell,
    };
    tableDomState.set(container, domState);

    const wrapper = document.createElement('div');
    wrapper.className = 'urano-table-wrapper relative inline-block min-w-full';

    const table = document.createElement('table');
    table.className =
      'urano-table-editor w-full border-collapse text-sm bg-transparent';

    const commitChanges = (
      immediateFocus?: { row: number; col: number },
      forceDomSync = false
    ) => {
      if (domState.commitTimer !== null) {
        clearTimeout(domState.commitTimer);
        domState.commitTimer = null;
      }

      if (domState.isDestroyed || !container.isConnected || !domState.view.dom?.isConnected) {
        return;
      }

      let domPos: number | null = null;
      try {
        domPos = domState.view.posAtDOM(container);
      } catch {
        domPos = null;
      }

      const doc = domState.view.state.doc;
      const tbl = findTargetTable(
        doc,
        domState.from,
        domState.tableIndex,
        domState.lastCommittedRawText,
        domPos
      );
      if (!tbl) {
        console.warn('[Urano Table] Table not found in doc for from:', domState.from);
        return;
      }

      domState.from = tbl.from;
      container.setAttribute('data-table-from', String(domState.from));

      const newMarkdown = serializeTable(
        domState.headers,
        domState.alignments,
        domState.rows
      );
      if (newMarkdown === tbl.rawText) return;

      domState.forceDomSync = forceDomSync;
      domState.lastDispatchedMarkdown = newMarkdown;
      domState.lastCommittedRawText = newMarkdown;

      if (immediateFocus) {
        pendingTableFocus = {
          tableIndex: domState.tableIndex,
          row: immediateFocus.row,
          col: immediateFocus.col,
        };
      }

      domState.view.dispatch({
        changes: { from: tbl.from, to: tbl.to, insert: newMarkdown },
      });
    };

    const scheduleCommit = () => {
      if (domState.isDestroyed) return;
      if (domState.commitTimer !== null) clearTimeout(domState.commitTimer);
      domState.commitTimer = setTimeout(() => {
        domState.commitTimer = null;
        commitChanges();
      }, 600);
    };

    const openTableMenu = (e: MouseEvent, row: number, col: number) => {
      e.preventDefault();
      e.stopPropagation();

      const totalCols = domState.headers.length;
      const totalRows = domState.rows.length + 1; // 1 header + body rows

      const items: MenuItemData[] = [
        // Fila Submenu (1:1 with Urano)
        {
          title: t('table.row'),
          icon: <Rows size={14} />,
          submenu: [
            {
              title: t('table.addRowAbove'),
              icon: <ArrowUp size={14} />,
              action: () => {
                if (row === 0) {
                  const oldHeader = [...domState.headers];
                  domState.headers = domState.headers.map(() => '');
                  domState.rows = [oldHeader, ...domState.rows];
                  commitChanges({ row: 0, col }, true);
                } else {
                  const newRow = new Array(totalCols).fill('');
                  domState.rows.splice(row - 1, 0, newRow);
                  commitChanges({ row, col }, true);
                }
              },
            },
            {
              title: t('table.addRowBelow'),
              icon: <ArrowDown size={14} />,
              action: () => {
                const newRow = new Array(totalCols).fill('');
                if (row === 0) {
                  domState.rows.splice(0, 0, newRow);
                  commitChanges({ row: 1, col }, true);
                } else {
                  domState.rows.splice(row, 0, newRow);
                  commitChanges({ row: row + 1, col }, true);
                }
              },
            },
            {
              title: t('table.moveRowUp'),
              icon: <MoveUp size={14} />,
              disabled: row <= 1,
              action: () => {
                if (row > 1) {
                  const temp = domState.rows[row - 1];
                  domState.rows[row - 1] = domState.rows[row - 2];
                  domState.rows[row - 2] = temp;
                  commitChanges({ row: row - 1, col }, true);
                }
              },
            },
            {
              title: t('table.moveRowDown'),
              icon: <MoveDown size={14} />,
              disabled: row === 0 || row >= totalRows - 1,
              action: () => {
                if (row > 0 && row < totalRows - 1) {
                  const temp = domState.rows[row - 1];
                  domState.rows[row - 1] = domState.rows[row];
                  domState.rows[row] = temp;
                  commitChanges({ row: row + 1, col }, true);
                }
              },
            },
            {
              title: t('table.duplicateRow'),
              icon: <Copy size={14} />,
              action: () => {
                if (row === 0) {
                  domState.rows = [[...domState.headers], ...domState.rows];
                  commitChanges({ row: 1, col }, true);
                } else {
                  const dup = [...domState.rows[row - 1]];
                  domState.rows.splice(row, 0, dup);
                  commitChanges({ row: row + 1, col }, true);
                }
              },
            },
            {
              title: t('table.deleteRow'),
              icon: <Trash2 size={14} />,
              action: () => {
                if (row === 0) {
                  if (domState.rows.length > 0) {
                    domState.headers = domState.rows[0];
                    domState.rows = domState.rows.slice(1);
                    commitChanges({ row: 0, col }, true);
                  } else {
                    domState.headers = domState.headers.map(() => '');
                    commitChanges({ row: 0, col }, true);
                  }
                } else {
                  domState.rows.splice(row - 1, 1);
                  commitChanges({ row: Math.min(row, domState.rows.length), col }, true);
                }
              },
            },
          ],
        },
        // Columna Submenu (1:1 with Urano)
        {
          title: t('table.column'),
          icon: <Columns size={14} />,
          submenu: [
            {
              title: t('table.addColumnLeft'),
              icon: <ArrowLeft size={14} />,
              action: () => {
                domState.headers.splice(col, 0, '');
                domState.alignments.splice(col, 0, 'left');
                for (const r of domState.rows) r.splice(col, 0, '');
                commitChanges({ row, col }, true);
              },
            },
            {
              title: t('table.addColumnRight'),
              icon: <ArrowRight size={14} />,
              action: () => {
                domState.headers.splice(col + 1, 0, '');
                domState.alignments.splice(col + 1, 0, 'left');
                for (const r of domState.rows) r.splice(col + 1, 0, '');
                commitChanges({ row, col: col + 1 }, true);
              },
            },
            {
              title: t('table.moveColumnLeft'),
              icon: <MoveLeft size={14} />,
              disabled: col === 0,
              action: () => {
                if (col > 0) {
                  const th = domState.headers[col];
                  domState.headers[col] = domState.headers[col - 1];
                  domState.headers[col - 1] = th;

                  const ta = domState.alignments[col];
                  domState.alignments[col] = domState.alignments[col - 1];
                  domState.alignments[col - 1] = ta;

                  for (const r of domState.rows) {
                    const temp = r[col];
                    r[col] = r[col - 1];
                    r[col - 1] = temp;
                  }
                  commitChanges({ row, col: col - 1 }, true);
                }
              },
            },
            {
              title: t('table.moveColumnRight'),
              icon: <MoveRight size={14} />,
              disabled: col >= totalCols - 1,
              action: () => {
                if (col < totalCols - 1) {
                  const th = domState.headers[col];
                  domState.headers[col] = domState.headers[col + 1];
                  domState.headers[col + 1] = th;

                  const ta = domState.alignments[col];
                  domState.alignments[col] = domState.alignments[col + 1];
                  domState.alignments[col + 1] = ta;

                  for (const r of domState.rows) {
                    const temp = r[col];
                    r[col] = r[col + 1];
                    r[col + 1] = temp;
                  }
                  commitChanges({ row, col: col + 1 }, true);
                }
              },
            },
            {
              title: t('table.duplicateColumn'),
              icon: <Copy size={14} />,
              action: () => {
                domState.headers.splice(col + 1, 0, domState.headers[col]);
                domState.alignments.splice(col + 1, 0, domState.alignments[col]);
                for (const r of domState.rows) {
                  r.splice(col + 1, 0, r[col]);
                }
                commitChanges({ row, col: col + 1 }, true);
              },
            },
            {
              title: t('table.deleteColumn'),
              icon: <Trash2 size={14} />,
              disabled: totalCols <= 1,
              action: () => {
                if (totalCols > 1) {
                  domState.headers.splice(col, 1);
                  domState.alignments.splice(col, 1);
                  for (const r of domState.rows) {
                    r.splice(col, 1);
                  }
                  commitChanges({
                    row,
                    col: Math.min(col, domState.headers.length - 1),
                  }, true);
                }
              },
            },
          ],
        },
        // Alineación de columna
        {
          title: t('table.alignment'),
          icon: <AlignLeft size={14} />,
          submenu: [
            {
              title: t('table.alignLeft'),
              icon: <AlignLeft size={14} />,
              action: () => {
                domState.alignments[col] = 'left';
                commitChanges({ row, col }, true);
              },
            },
            {
              title: t('table.alignCenter'),
              icon: <AlignCenter size={14} />,
              action: () => {
                domState.alignments[col] = 'center';
                commitChanges({ row, col }, true);
              },
            },
            {
              title: t('table.alignRight'),
              icon: <AlignRight size={14} />,
              action: () => {
                domState.alignments[col] = 'right';
                commitChanges({ row, col }, true);
              },
            },
          ],
        },
        // Ordenar
        {
          title: t('table.sort'),
          icon: <ArrowUpDown size={14} />,
          submenu: [
            {
              title: t('table.sortAscending'),
              icon: <ArrowUpDown size={14} />,
              action: () => {
                domState.rows.sort((a, b) =>
                  (a[col] || '').localeCompare(b[col] || '', undefined, {
                    numeric: true,
                  })
                );
                commitChanges({ row, col }, true);
              },
            },
            {
              title: t('table.sortDescending'),
              icon: <ArrowUpDown size={14} />,
              action: () => {
                domState.rows.sort((a, b) =>
                  (b[col] || '').localeCompare(a[col] || '', undefined, {
                    numeric: true,
                  })
                );
                commitChanges({ row, col }, true);
              },
            },
          ],
        },
        { type: 'separator' },
        {
          title: t('common.cut'),
          shortcut: 'Ctrl+X',
          icon: <Scissors size={14} />,
          action: () => {
            const cellVal =
              row === 0 ? domState.headers[col] : domState.rows[row - 1][col];
            navigator.clipboard.writeText(cellVal);
            if (row === 0) domState.headers[col] = '';
            else domState.rows[row - 1][col] = '';
            commitChanges({ row, col }, true);
          },
        },
        {
          title: t('common.copy'),
          shortcut: 'Ctrl+C',
          icon: <Copy size={14} />,
          action: () => {
            const cellVal =
              row === 0 ? domState.headers[col] : domState.rows[row - 1][col];
            navigator.clipboard.writeText(cellVal);
            useNoticeStore.getState().showNotice(t('table.notices.cellCopied'), 2000, 'success');
          },
        },
        {
          title: t('common.paste'),
          shortcut: 'Ctrl+V',
          icon: <Clipboard size={14} />,
          action: async () => {
            try {
              const text = await navigator.clipboard.readText();
              const clean = text.replace(/[\r\n]+/g, ' ').trim();
              if (row === 0) domState.headers[col] = clean;
              else domState.rows[row - 1][col] = clean;
              commitChanges({ row, col }, true);
            } catch (err) {
              console.error('Error al pegar:', err);
            }
          },
        },
        { type: 'separator' },
        {
          title: t('table.deleteTable'),
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: () => {
            if (domState.commitTimer !== null) {
              clearTimeout(domState.commitTimer);
              domState.commitTimer = null;
            }
            if (domState.isDestroyed || !domState.view.dom?.isConnected) return;

            let domPos: number | null = null;
            try {
              domPos = domState.view.posAtDOM(container);
            } catch {
              domPos = null;
            }

            const doc = domState.view.state.doc;
            const tbl = findTargetTable(
              doc,
              domState.from,
              domState.tableIndex,
              domState.lastCommittedRawText,
              domPos
            );
            if (!tbl) return;

            domState.isDestroyed = true;

            let endPos = tbl.to;
            if (
              endPos < doc.length &&
              domState.view.state.sliceDoc(endPos, endPos + 1) === '\n'
            ) {
              endPos += 1;
            }

            domState.view.dispatch({
              changes: { from: tbl.from, to: endPos, insert: '' },
              selection: { anchor: tbl.from },
            });
            useNoticeStore.getState().showNotice(t('table.notices.tableDeleted'), 2500, 'info');
          },
        },
      ];

      window.dispatchEvent(
        new CustomEvent('urano-table-contextmenu', {
          detail: { x: e.clientX, y: e.clientY, items },
        })
      );
    };

    const attachCellEvents = (
      cellContent: HTMLElement,
      row: number,
      col: number,
      parentCell: HTMLElement
    ) => {
      // Cell Focus / Blur
      cellContent.addEventListener('focus', () => {
        container.querySelectorAll('.is-active-cell').forEach((el) => {
          el.classList.remove('is-active-cell');
        });
        parentCell.classList.add('is-active-cell');
      });

      cellContent.addEventListener('blur', () => {
        parentCell.classList.remove('is-active-cell');
        commitChanges();
      });

      // Cell Input (auto-sync value)
      cellContent.addEventListener('input', () => {
        const val = (cellContent.innerText ?? cellContent.textContent ?? '').replace(/[\r\n]+/g, ' ');
        if (row === 0) {
          domState.headers[col] = val;
        } else {
          domState.rows[row - 1][col] = val;
        }
        scheduleCommit();
      });

      // Context menu on right click
      parentCell.addEventListener('contextmenu', (e) => {
        openTableMenu(e, row, col);
      });

      // Keyboard Navigation (Exact 1:1 with Urano)
      cellContent.addEventListener('keydown', (e: KeyboardEvent) => {
        const totalRows = domState.rows.length + 1;
        const totalCols = domState.headers.length;

        if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();

          if (e.shiftKey) {
            // Shift + Tab: Move to previous cell
            if (col > 0) {
              focusCell(row, col - 1);
            } else if (row > 0) {
              focusCell(row - 1, totalCols - 1);
            }
          } else {
            // Tab: Move to next cell
            if (col < totalCols - 1) {
              focusCell(row, col + 1);
            } else if (row < totalRows - 1) {
              focusCell(row + 1, 0);
            } else {
              // Last cell in table -> Add new row!
              domState.rows.push(new Array(totalCols).fill(''));
              commitChanges({ row: totalRows, col: 0 }, true);
            }
          }
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();

          if (row < totalRows - 1) {
            // Move down to cell in next row, same column
            focusCell(row + 1, col);
          } else {
            // Last row -> Add new row below and focus same column
            domState.rows.push(new Array(totalCols).fill(''));
            commitChanges({ row: totalRows, col }, true);
          }
          return;
        }

        if (e.key === 'ArrowUp') {
          if (row > 0) {
            e.preventDefault();
            focusCell(row - 1, col);
          }
          return;
        }

        if (e.key === 'ArrowDown') {
          if (row < totalRows - 1) {
            e.preventDefault();
            focusCell(row + 1, col);
          }
          return;
        }

        if (e.key === 'ArrowLeft') {
          const sel = window.getSelection();
          if (sel && sel.isCollapsed && sel.anchorOffset === 0) {
            if (col > 0) {
              e.preventDefault();
              focusCell(row, col - 1, true);
            } else if (row > 0) {
              e.preventDefault();
              focusCell(row - 1, totalCols - 1, true);
            }
          }
          return;
        }

        if (e.key === 'ArrowRight') {
          const sel = window.getSelection();
          const textLen = cellContent.textContent?.length || 0;
          if (sel && sel.isCollapsed && sel.anchorOffset >= textLen) {
            if (col < totalCols - 1) {
              e.preventDefault();
              focusCell(row, col + 1, false);
            } else if (row < totalRows - 1) {
              e.preventDefault();
              focusCell(row + 1, 0, false);
            }
          }
          return;
        }
      });
    };

    // Build Table Header (Thead)
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'urano-table-header-row';

    headers.forEach((h, colIdx) => {
      const th = document.createElement('th');
      th.className = 'urano-table-cell';
      th.setAttribute('data-row', '0');
      th.setAttribute('data-col', String(colIdx));
      th.style.textAlign = alignments[colIdx] || 'left';

      const cellWrapper = document.createElement('div');
      cellWrapper.className = 'table-cell-wrapper w-full h-full';

      const content = document.createElement('div');
      content.className =
        'urano-table-cell-content outline-none w-full h-full min-h-[32px] px-3 py-1.5 text-urano-text font-semibold';
      content.contentEditable = 'true';
      content.spellcheck = false;
      content.setAttribute('data-row', '0');
      content.setAttribute('data-col', String(colIdx));
      content.innerText = h;

      attachCellEvents(content, 0, colIdx, th);
      cellWrapper.appendChild(content);
      th.appendChild(cellWrapper);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Build Table Body (Tbody)
    const tbody = document.createElement('tbody');
    rows.forEach((rowCells, rowIdx) => {
      const tr = document.createElement('tr');
      tr.className = 'urano-table-body-row';

      headers.forEach((_, colIdx) => {
        const cellValue = rowCells[colIdx] || '';
        const td = document.createElement('td');
        td.className = 'urano-table-cell';
        td.setAttribute('data-row', String(rowIdx + 1));
        td.setAttribute('data-col', String(colIdx));
        td.style.textAlign = alignments[colIdx] || 'left';

        const cellWrapper = document.createElement('div');
        cellWrapper.className = 'table-cell-wrapper w-full h-full';

        const content = document.createElement('div');
        content.className =
          'urano-table-cell-content outline-none w-full h-full min-h-[32px] px-3 py-1.5 text-urano-text';
        content.contentEditable = 'true';
        content.spellcheck = false;
        content.setAttribute('data-row', String(rowIdx + 1));
        content.setAttribute('data-col', String(colIdx));
        content.innerText = cellValue;

        attachCellEvents(content, rowIdx + 1, colIdx, td);
        cellWrapper.appendChild(content);
        td.appendChild(cellWrapper);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);

    // Add Column Button (+) on right edge
    const addColBtn = document.createElement('button');
    addColBtn.type = 'button';
    addColBtn.className = 'urano-table-col-btn';
    addColBtn.title = t('table.addColumnRight');
    addColBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

    let colAdding = false;
    const handleAddCol = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (colAdding) return;
      colAdding = true;
      setTimeout(() => {
        colAdding = false;
      }, 300);

      domState.headers.push('');
      domState.alignments.push('left');
      for (const r of domState.rows) {
        r.push('');
      }
      commitChanges({ row: 0, col: domState.headers.length - 1 }, true);
    };
    addColBtn.addEventListener('mousedown', handleAddCol);
    addColBtn.addEventListener('click', handleAddCol);
    wrapper.appendChild(addColBtn);

    // Add Row Button (+) on bottom edge
    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.className = 'urano-table-row-btn';
    addRowBtn.title = t('table.addRowBelow');
    addRowBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

    let rowAdding = false;
    const handleAddRow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (rowAdding) return;
      rowAdding = true;
      setTimeout(() => {
        rowAdding = false;
      }, 300);

      const newRow = new Array(domState.headers.length).fill('');
      domState.rows.push(newRow);
      commitChanges({ row: domState.rows.length, col: 0 }, true);
    };
    addRowBtn.addEventListener('mousedown', handleAddRow);
    addRowBtn.addEventListener('click', handleAddRow);
    wrapper.appendChild(addRowBtn);

    container.appendChild(wrapper);

    // Auto-focus if this table has pendingFocus
    if (pendingTableFocus && pendingTableFocus.tableIndex === this.tableIndex) {
      const target = pendingTableFocus;
      pendingTableFocus = null;
      setTimeout(() => {
        if (!domState.isDestroyed && container.isConnected) {
          focusCell(target.row, target.col);
        }
      }, 25);
    }

    return container;
  }
}

export const tableExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state.doc);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildTableDecorations(tr.state.doc);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildTableDecorations(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tables = findAllTables(doc);

  for (let idx = 0; idx < tables.length; idx++) {
    const tbl = tables[idx];
    builder.add(
      tbl.from,
      tbl.to,
      Decoration.replace({
        widget: new TableWidget(tbl, idx),
        block: true,
      })
    );
  }

  return builder.finish();
}
