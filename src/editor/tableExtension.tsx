import { StateField, RangeSetBuilder, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { useVaultStore } from '../stores/vaultStore';
import { MenuItemData } from '../components/common/ObsidianMenu';
import { useNoticeStore } from '../components/common/Notice';
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

let pendingTableFocus: {
  tableFrom: number;
  row: number;
  col: number;
} | null = null;

export function setPendingTableFocus(
  focus: { tableFrom: number; row: number; col: number } | null
) {
  pendingTableFocus = focus;
}

function isTableRow(text: string): boolean {
  const t = text.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
}

function isTableSeparator(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return false;
  const cells = t.slice(1, -1).split('|');
  if (cells.length < 1) return false;
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function parseAlignments(
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

function parseTableRowCells(text: string, count: number): string[] {
  const raw = text.trim();
  const inner = raw.startsWith('|') && raw.endsWith('|') ? raw.slice(1, -1) : raw;
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && !escaped) {
      escaped = true;
      current += ch;
    } else if (ch === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
    } else {
      escaped = false;
      current += ch;
    }
  }
  cells.push(current.trim());

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

  const headerLine = `| ${normHeaders.map((h) => (h.trim() === '' ? ' ' : h.trim())).join(' | ')} |`;
  const sepLine = `| ${normAlign
    .map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : '---'))
    .join(' | ')} |`;
  const rowLines = normRows.map(
    (row) => `| ${row.map((c) => (c.trim() === '' ? ' ' : c.trim())).join(' | ')} |`
  );

  return [headerLine, sepLine, ...rowLines].join('\n');
}

export function findAllTables(doc: Text): ParsedTable[] {
  const tables: ParsedTable[] = [];
  let i = 1;
  const lineCount = doc.lines;

  while (i < lineCount) {
    const line1 = doc.line(i).text;
    const line2 = doc.line(i + 1).text;

    if (isTableRow(line1) && isTableSeparator(line2)) {
      const headerLine = line1;
      const sepLine = line2;
      const initialHeaderCells = headerLine
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      const colCount = Math.max(initialHeaderCells.length, 1);
      const headers = parseTableRowCells(headerLine, colCount);
      const alignments = parseAlignments(sepLine, colCount);

      const rows: string[][] = [];
      let endLine = i + 1;

      for (let r = i + 2; r <= lineCount; r++) {
        const nextText = doc.line(r).text;
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

function findTargetTable(
  doc: Text,
  widgetFrom: number,
  widgetIndex: number
): ParsedTable | null {
  const tables = findAllTables(doc);
  if (tables.length === 0) return null;

  // 1. Direct match by exact 'from' position
  const exact = tables.find((t) => t.from === widgetFrom);
  if (exact) return exact;

  // 2. Direct match by index if valid
  if (tables[widgetIndex]) return tables[widgetIndex];

  // 3. Proximity fallback
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

class TableWidget extends WidgetType {
  constructor(
    readonly tableData: ParsedTable,
    readonly tableIndex: number
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    if (this.tableData.rawText === other.tableData.rawText) {
      return true;
    }
    const activeEl = document.activeElement;
    const isEditingCell = Boolean(
      activeEl && activeEl.classList.contains('urano-table-cell-content')
    );
    if (
      isEditingCell &&
      this.tableData.headers.length === other.tableData.headers.length &&
      this.tableData.rows.length === other.tableData.rows.length &&
      JSON.stringify(this.tableData.alignments) ===
        JSON.stringify(other.tableData.alignments)
    ) {
      return true;
    }
    return false;
  }

  updateDOM(): boolean {
    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const { headers, alignments, rows, from } = this.tableData;

    // Working copies for in-place edits
    let currentHeaders = [...headers];
    let currentAlignments = [...alignments];
    let currentRows = rows.map((r) => [...r]);
    let commitTimer: any = null;

    const container = document.createElement('div');
    container.className =
      'cm-table-widget urano-table-container my-4 max-w-full overflow-x-auto select-text';
    container.setAttribute('data-table-from', String(from));

    const wrapper = document.createElement('div');
    wrapper.className = 'urano-table-wrapper relative inline-block min-w-full';

    const table = document.createElement('table');
    table.className =
      'urano-table-editor w-full border-collapse text-sm bg-transparent';

    const commitChanges = (immediateFocus?: { row: number; col: number }) => {
      if (commitTimer) {
        clearTimeout(commitTimer);
        commitTimer = null;
      }

      const activeView = (window as any).__uranoEditorView || view;
      if (!activeView) {
        console.error('[Urano Table] No active EditorView found');
        return;
      }

      const doc = activeView.state.doc;
      const tbl = findTargetTable(doc, from, this.tableIndex);
      if (!tbl) {
        console.warn('[Urano Table] Table not found in doc for from:', from);
        return;
      }

      const newMarkdown = serializeTable(
        currentHeaders,
        currentAlignments,
        currentRows
      );
      if (newMarkdown === tbl.rawText) return;

      console.log('[Urano Table] Aplicando cambios a la tabla en rango:', tbl.from, tbl.to);

      if (immediateFocus) {
        pendingTableFocus = {
          tableFrom: tbl.from,
          row: immediateFocus.row,
          col: immediateFocus.col,
        };
      }

      activeView.dispatch({
        changes: { from: tbl.from, to: tbl.to, insert: newMarkdown },
      });

      const newDoc = activeView.state.doc.toString();
      useVaultStore.getState().updateContent(newDoc);
    };

    const scheduleCommit = () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        commitChanges();
      }, 180);
    };

    const focusCell = (row: number, col: number, cursorAtEnd = true) => {
      const cellEl = container.querySelector(
        `[data-row="${row}"][data-col="${col}"].urano-table-cell-content`
      ) as HTMLElement;
      if (!cellEl) return;
      cellEl.focus();
      if (cursorAtEnd && cellEl.childNodes.length > 0) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(cellEl);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    };

    const openTableMenu = (e: MouseEvent, row: number, col: number) => {
      e.preventDefault();
      e.stopPropagation();

      const totalCols = currentHeaders.length;
      const totalRows = currentRows.length + 1; // 1 header + body rows

      const items: MenuItemData[] = [
        // Fila Submenu
        {
          title: 'Fila',
          icon: <Rows size={14} />,
          submenu: [
            {
              title: 'Insertar fila arriba',
              icon: <ArrowUp size={14} />,
              action: () => {
                if (row === 0) {
                  const oldHeader = [...currentHeaders];
                  currentHeaders = currentHeaders.map(() => '');
                  currentRows = [oldHeader, ...currentRows];
                  commitChanges({ row: 0, col });
                } else {
                  const newRow = new Array(totalCols).fill('');
                  currentRows.splice(row - 1, 0, newRow);
                  commitChanges({ row, col });
                }
              },
            },
            {
              title: 'Insertar fila abajo',
              icon: <ArrowDown size={14} />,
              action: () => {
                const newRow = new Array(totalCols).fill('');
                if (row === 0) {
                  currentRows.splice(0, 0, newRow);
                  commitChanges({ row: 1, col });
                } else {
                  currentRows.splice(row, 0, newRow);
                  commitChanges({ row: row + 1, col });
                }
              },
            },
            {
              title: 'Mover fila arriba',
              icon: <MoveUp size={14} />,
              disabled: row <= 1,
              action: () => {
                if (row > 1) {
                  const temp = currentRows[row - 1];
                  currentRows[row - 1] = currentRows[row - 2];
                  currentRows[row - 2] = temp;
                  commitChanges({ row: row - 1, col });
                }
              },
            },
            {
              title: 'Mover fila abajo',
              icon: <MoveDown size={14} />,
              disabled: row === 0 || row >= totalRows - 1,
              action: () => {
                if (row > 0 && row < totalRows - 1) {
                  const temp = currentRows[row - 1];
                  currentRows[row - 1] = currentRows[row];
                  currentRows[row] = temp;
                  commitChanges({ row: row + 1, col });
                }
              },
            },
            {
              title: 'Duplicar fila',
              icon: <Copy size={14} />,
              action: () => {
                if (row === 0) {
                  currentRows = [[...currentHeaders], ...currentRows];
                  commitChanges({ row: 1, col });
                } else {
                  const dup = [...currentRows[row - 1]];
                  currentRows.splice(row, 0, dup);
                  commitChanges({ row: row + 1, col });
                }
              },
            },
            {
              title: 'Eliminar fila',
              icon: <Trash2 size={14} />,
              action: () => {
                if (row === 0) {
                  if (currentRows.length > 0) {
                    currentHeaders = currentRows[0];
                    currentRows = currentRows.slice(1);
                    commitChanges({ row: 0, col });
                  } else {
                    currentHeaders = currentHeaders.map(() => '');
                    commitChanges({ row: 0, col });
                  }
                } else {
                  currentRows.splice(row - 1, 1);
                  commitChanges({ row: Math.min(row, currentRows.length), col });
                }
              },
            },
          ],
        },
        // Columna Submenu
        {
          title: 'Columna',
          icon: <Columns size={14} />,
          submenu: [
            {
              title: 'Insertar columna a la izquierda',
              icon: <ArrowLeft size={14} />,
              action: () => {
                currentHeaders.splice(col, 0, '');
                currentAlignments.splice(col, 0, 'left');
                for (const r of currentRows) r.splice(col, 0, '');
                commitChanges({ row, col });
              },
            },
            {
              title: 'Insertar columna a la derecha',
              icon: <ArrowRight size={14} />,
              action: () => {
                currentHeaders.splice(col + 1, 0, '');
                currentAlignments.splice(col + 1, 0, 'left');
                for (const r of currentRows) r.splice(col + 1, 0, '');
                commitChanges({ row, col: col + 1 });
              },
            },
            {
              title: 'Mover columna a la izquierda',
              icon: <MoveLeft size={14} />,
              disabled: col === 0,
              action: () => {
                if (col > 0) {
                  const th = currentHeaders[col];
                  currentHeaders[col] = currentHeaders[col - 1];
                  currentHeaders[col - 1] = th;

                  const ta = currentAlignments[col];
                  currentAlignments[col] = currentAlignments[col - 1];
                  currentAlignments[col - 1] = ta;

                  for (const r of currentRows) {
                    const temp = r[col];
                    r[col] = r[col - 1];
                    r[col - 1] = temp;
                  }
                  commitChanges({ row, col: col - 1 });
                }
              },
            },
            {
              title: 'Mover columna a la derecha',
              icon: <MoveRight size={14} />,
              disabled: col >= totalCols - 1,
              action: () => {
                if (col < totalCols - 1) {
                  const th = currentHeaders[col];
                  currentHeaders[col] = currentHeaders[col + 1];
                  currentHeaders[col + 1] = th;

                  const ta = currentAlignments[col];
                  currentAlignments[col] = currentAlignments[col + 1];
                  currentAlignments[col + 1] = ta;

                  for (const r of currentRows) {
                    const temp = r[col];
                    r[col] = r[col + 1];
                    r[col + 1] = temp;
                  }
                  commitChanges({ row, col: col + 1 });
                }
              },
            },
            {
              title: 'Duplicar columna',
              icon: <Copy size={14} />,
              action: () => {
                currentHeaders.splice(col + 1, 0, currentHeaders[col]);
                currentAlignments.splice(col + 1, 0, currentAlignments[col]);
                for (const r of currentRows) {
                  r.splice(col + 1, 0, r[col]);
                }
                commitChanges({ row, col: col + 1 });
              },
            },
            {
              title: 'Eliminar columna',
              icon: <Trash2 size={14} />,
              disabled: totalCols <= 1,
              action: () => {
                if (totalCols > 1) {
                  currentHeaders.splice(col, 1);
                  currentAlignments.splice(col, 1);
                  for (const r of currentRows) {
                    r.splice(col, 1);
                  }
                  commitChanges({
                    row,
                    col: Math.min(col, currentHeaders.length - 1),
                  });
                }
              },
            },
          ],
        },
        // Alineación de columna
        {
          title: 'Alineación de columna',
          icon: <AlignLeft size={14} />,
          submenu: [
            {
              title: 'Alinear a la izquierda',
              icon: <AlignLeft size={14} />,
              action: () => {
                currentAlignments[col] = 'left';
                commitChanges({ row, col });
              },
            },
            {
              title: 'Centrar',
              icon: <AlignCenter size={14} />,
              action: () => {
                currentAlignments[col] = 'center';
                commitChanges({ row, col });
              },
            },
            {
              title: 'Alinear a la derecha',
              icon: <AlignRight size={14} />,
              action: () => {
                currentAlignments[col] = 'right';
                commitChanges({ row, col });
              },
            },
          ],
        },
        // Ordenar
        {
          title: 'Ordenar',
          icon: <ArrowUpDown size={14} />,
          submenu: [
            {
              title: 'Ordenar ascendente (A → Z)',
              icon: <ArrowUpDown size={14} />,
              action: () => {
                currentRows.sort((a, b) =>
                  (a[col] || '').localeCompare(b[col] || '', undefined, {
                    numeric: true,
                  })
                );
                commitChanges({ row, col });
              },
            },
            {
              title: 'Ordenar descendente (Z → A)',
              icon: <ArrowUpDown size={14} />,
              action: () => {
                currentRows.sort((a, b) =>
                  (b[col] || '').localeCompare(a[col] || '', undefined, {
                    numeric: true,
                  })
                );
                commitChanges({ row, col });
              },
            },
          ],
        },
        { type: 'separator' },
        {
          title: 'Cortar',
          shortcut: 'Ctrl+X',
          icon: <Scissors size={14} />,
          action: () => {
            const cellVal =
              row === 0 ? currentHeaders[col] : currentRows[row - 1][col];
            navigator.clipboard.writeText(cellVal);
            if (row === 0) currentHeaders[col] = '';
            else currentRows[row - 1][col] = '';
            commitChanges({ row, col });
          },
        },
        {
          title: 'Copiar',
          shortcut: 'Ctrl+C',
          icon: <Copy size={14} />,
          action: () => {
            const cellVal =
              row === 0 ? currentHeaders[col] : currentRows[row - 1][col];
            navigator.clipboard.writeText(cellVal);
            useNoticeStore.getState().showNotice('Celda copiada', 2000, 'success');
          },
        },
        {
          title: 'Pegar',
          shortcut: 'Ctrl+V',
          icon: <Clipboard size={14} />,
          action: async () => {
            try {
              const text = await navigator.clipboard.readText();
              const clean = text.replace(/[\r\n]+/g, ' ').trim();
              if (row === 0) currentHeaders[col] = clean;
              else currentRows[row - 1][col] = clean;
              commitChanges({ row, col });
            } catch (err) {
              console.error('Error al pegar:', err);
            }
          },
        },
        { type: 'separator' },
        {
          title: 'Eliminar tabla',
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: () => {
            const activeView = (window as any).__uranoEditorView || view;
            if (!activeView) return;
            const doc = activeView.state.doc;
            const tbl = findTargetTable(doc, from, this.tableIndex);
            if (!tbl) return;

            let endPos = tbl.to;
            if (
              endPos < activeView.state.doc.length &&
              activeView.state.sliceDoc(endPos, endPos + 1) === '\n'
            ) {
              endPos += 1;
            }

            activeView.dispatch({
              changes: { from: tbl.from, to: endPos, insert: '' },
              selection: { anchor: tbl.from },
            });

            const newDoc = activeView.state.doc.toString();
            useVaultStore.getState().updateContent(newDoc);
            useNoticeStore.getState().showNotice('Tabla eliminada', 2500, 'info');
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
        const val = cellContent.innerText.replace(/\n/g, ' ').trim();
        if (row === 0) {
          currentHeaders[col] = val;
        } else {
          currentRows[row - 1][col] = val;
        }
        scheduleCommit();
      });

      // Context menu
      parentCell.addEventListener('contextmenu', (e) => {
        openTableMenu(e, row, col);
      });

      // Keyboard Navigation
      cellContent.addEventListener('keydown', (e: KeyboardEvent) => {
        const totalRows = currentRows.length + 1;
        const totalCols = currentHeaders.length;

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
              currentRows.push(new Array(totalCols).fill(''));
              commitChanges({ row: totalRows, col: 0 });
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
            currentRows.push(new Array(totalCols).fill(''));
            commitChanges({ row: totalRows, col });
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
        'urano-table-cell-content outline-none w-full h-full min-h-[32px] px-3 py-1.5 text-stone-200 font-semibold';
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
          'urano-table-cell-content outline-none w-full h-full min-h-[32px] px-3 py-1.5 text-stone-300';
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
    addColBtn.title = 'Añadir columna a la derecha';
    addColBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

    const handleAddCol = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Urano Table] Añadir columna clicada');
      currentHeaders.push('');
      currentAlignments.push('left');
      for (const r of currentRows) {
        r.push('');
      }
      commitChanges({ row: 0, col: currentHeaders.length - 1 });
    };
    addColBtn.addEventListener('mousedown', handleAddCol);
    addColBtn.addEventListener('click', handleAddCol);
    wrapper.appendChild(addColBtn);

    // Add Row Button (+) on bottom edge
    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.className = 'urano-table-row-btn';
    addRowBtn.title = 'Añadir fila abajo';
    addRowBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

    const handleAddRow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Urano Table] Añadir fila clicada');
      const newRow = new Array(currentHeaders.length).fill('');
      currentRows.push(newRow);
      commitChanges({ row: currentRows.length, col: 0 });
    };
    addRowBtn.addEventListener('mousedown', handleAddRow);
    addRowBtn.addEventListener('click', handleAddRow);
    wrapper.appendChild(addRowBtn);

    container.appendChild(wrapper);

    // Handle auto-focus if this table has pendingFocus
    if (pendingTableFocus) {
      const target = pendingTableFocus;
      setTimeout(() => {
        const targetCell = container.querySelector(
          `[data-row="${target.row}"][data-col="${target.col}"].urano-table-cell-content`
        ) as HTMLElement;
        if (targetCell) {
          targetCell.focus();
        }
        pendingTableFocus = null;
      }, 30);
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
