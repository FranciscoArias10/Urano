import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

interface CalloutData {
  type: string;
  title: string;
  content: string;
  startPos: number;
  endPos: number;
}

class CalloutWidget extends WidgetType {
  constructor(readonly data: CalloutData, readonly onClick: () => void) {
    super();
  }

  toDOM(): HTMLElement {
    const callout = document.createElement('div');
    callout.className = `callout select-none cursor-pointer animate-fadeIn`;
    callout.setAttribute('data-callout', this.data.type.toLowerCase());

    const titleEl = document.createElement('div');
    titleEl.className = 'callout-title';

    const iconEl = document.createElement('div');
    iconEl.className = 'callout-icon';

    // Type-based SVG icons matching Obsidian
    const type = this.data.type.toLowerCase();
    let svgIcon = '';
    if (type === 'tip' || type === 'hint' || type === 'important') {
      svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`;
    } else if (type === 'warning' || type === 'caution' || type === 'attention') {
      svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else if (type === 'danger' || type === 'error' || type === 'bug') {
      svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (type === 'example') {
      svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
    } else if (type === 'quote') {
      svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>`;
    } else {
      // Default: note / info
      svgIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    iconEl.innerHTML = svgIcon;

    const titleInnerEl = document.createElement('div');
    titleInnerEl.className = 'callout-title-inner font-semibold';
    titleInnerEl.textContent =
      this.data.title || this.data.type.charAt(0).toUpperCase() + this.data.type.slice(1);

    titleEl.appendChild(iconEl);
    titleEl.appendChild(titleInnerEl);

    const contentEl = document.createElement('div');
    contentEl.className = 'callout-content text-sm';
    contentEl.textContent = this.data.content;

    callout.appendChild(titleEl);
    if (this.data.content.trim()) {
      callout.appendChild(contentEl);
    }

    // Switch to edit mode on click
    callout.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });

    return callout;
  }

  eq(other: CalloutWidget): boolean {
    return (
      other.data.type === this.data.type &&
      other.data.title === this.data.title &&
      other.data.content === this.data.content
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const calloutLineHidden = Decoration.line({ class: 'cm-callout-line-hidden' });

export const calloutExtension = ViewPlugin.fromClass(
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

      const callouts: {
        startLine: number;
        endLine: number;
        type: string;
        title: string;
        contentLines: string[];
      }[] = [];

      let currentCallout: {
        startLine: number;
        endLine: number;
        type: string;
        title: string;
        contentLines: string[];
      } | null = null;

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;

        const headerMatch = text.match(/^>\s*\[!([a-zA-Z0-9_-]+)\](?:\s+(.*))?$/);

        if (headerMatch) {
          if (currentCallout) {
            callouts.push(currentCallout);
          }
          currentCallout = {
            startLine: i,
            endLine: i,
            type: headerMatch[1],
            title: (headerMatch[2] || '').trim(),
            contentLines: [],
          };
        } else if (currentCallout && text.startsWith('>')) {
          currentCallout.endLine = i;
          const content = text.replace(/^>\s?/, '');
          currentCallout.contentLines.push(content);
        } else {
          if (currentCallout) {
            callouts.push(currentCallout);
            currentCallout = null;
          }
        }
      }

      if (currentCallout) {
        callouts.push(currentCallout);
      }

      for (const callout of callouts) {
        const startLineObj = doc.line(callout.startLine);
        const endLineObj = doc.line(callout.endLine);

        const isCursorInside =
          selection.from <= endLineObj.to && selection.to >= startLineObj.from;

        if (!isCursorInside) {
          // 1. Hide raw markdown quote lines first (Line decorations must precede point decorations at same line.from)
          for (let l = callout.startLine; l <= callout.endLine; l++) {
            const lineObj = doc.line(l);
            builder.add(lineObj.from, lineObj.from, calloutLineHidden);
          }

          // 2. Render Live Preview Callout Widget
          builder.add(
            startLineObj.from,
            startLineObj.from,
            Decoration.widget({
              widget: new CalloutWidget(
                {
                  type: callout.type,
                  title: callout.title,
                  content: callout.contentLines.join('\n'),
                  startPos: startLineObj.from,
                  endPos: endLineObj.to,
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
        }
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
