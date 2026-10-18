import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

interface TableData {
  headers: string[];
  rows: string[][];
  startPos: number;
}

class TableWidget extends WidgetType {
  constructor(readonly data: TableData, readonly onClick: () => void) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-table-widget select-none cursor-pointer animate-fadeIn my-4 overflow-x-auto';

    const table = document.createElement('table');
    table.className = 'w-full border-collapse text-sm';

    // Thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'border-b border-stone-700 bg-stone-900/60';

    for (const h of this.data.headers) {
      const th = document.createElement('th');
      th.className = 'px-3 py-2 text-left font-semibold text-stone-200 border border-stone-800';
      th.textContent = h;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Tbody
    const tbody = document.createElement('tbody');
    for (const row of this.data.rows) {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-stone-800/80 hover:bg-stone-800/30 transition-colors';
      for (const cell of row) {
        const td = document.createElement('td');
        td.className = 'px-3 py-1.5 text-stone-300 border border-stone-800/60';
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    // Switch to text editing on click
    container.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });

    return container;
  }

  eq(other: TableWidget): boolean {
    return (
      JSON.stringify(other.data.headers) === JSON.stringify(this.data.headers) &&
      JSON.stringify(other.data.rows) === JSON.stringify(this.data.rows)
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const tableLineHidden = Decoration.line({ class: 'cm-table-line-hidden' });

export const tableExtension = ViewPlugin.fromClass(
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

      interface TableBlock {
        startLine: number;
        endLine: number;
        headers: string[];
        rows: string[][];
      }

      const tables: TableBlock[] = [];
      let i = 1;

      while (i <= doc.lines) {
        const line = doc.line(i);
        const text = line.text.trim();

        // Check if line looks like markdown table header
        if (text.startsWith('|') && text.endsWith('|') && text.includes('|')) {
          // Check if next line is separator: |---|---|
          if (i + 1 <= doc.lines) {
            const nextLine = doc.line(i + 1).text.trim();
            if (
              nextLine.startsWith('|') &&
              nextLine.endsWith('|') &&
              /^\|[\s\-:|]+\|$/.test(nextLine)
            ) {
              const headers = text
                .split('|')
                .slice(1, -1)
                .map((c) => c.trim());

              const rows: string[][] = [];
              let endLine = i + 1;

              // Collect rows
              for (let r = i + 2; r <= doc.lines; r++) {
                const rowText = doc.line(r).text.trim();
                if (rowText.startsWith('|') && rowText.endsWith('|')) {
                  const cells = rowText
                    .split('|')
                    .slice(1, -1)
                    .map((c) => c.trim());
                  rows.push(cells);
                  endLine = r;
                } else {
                  break;
                }
              }

              tables.push({
                startLine: i,
                endLine,
                headers,
                rows,
              });

              i = endLine + 1;
              continue;
            }
          }
        }
        i++;
      }

      for (const tbl of tables) {
        const startLineObj = doc.line(tbl.startLine);
        const endLineObj = doc.line(tbl.endLine);

        const isCursorInside =
          selection.from <= endLineObj.to && selection.to >= startLineObj.from;

        if (!isCursorInside) {
          // Add rendered table widget
          builder.add(
            startLineObj.from,
            startLineObj.from,
            Decoration.widget({
              widget: new TableWidget(
                {
                  headers: tbl.headers,
                  rows: tbl.rows,
                  startPos: startLineObj.from,
                },
                () => {
                  view.dispatch({
                    selection: { anchor: startLineObj.from + 2 },
                  });
                  view.focus();
                }
              ),
              side: -1,
              block: true,
            })
          );

          // Hide raw pipe lines
          for (let l = tbl.startLine; l <= tbl.endLine; l++) {
            const lineObj = doc.line(l);
            builder.add(lineObj.from, lineObj.from, tableLineHidden);
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
