import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { Range } from '@codemirror/state';

// Regex for [[Target Note]] or [[Target Note|Display Text]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface WikilinkHandler {
  onWikilinkClick: (targetNote: string) => void;
}

export function createWikilinksExtension(handler?: WikilinkHandler) {
  const wikilinkDecoration = Decoration.mark({
    class: 'cm-wikilink',
  });

  return ViewPlugin.fromClass(
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
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          let match: RegExpExecArray | null;
          WIKILINK_REGEX.lastIndex = 0;

          while ((match = WIKILINK_REGEX.exec(text)) !== null) {
            const start = from + match.index;
            const end = start + match[0].length;
            widgets.push(wikilinkDecoration.range(start, end));
          }
        }
        return Decoration.set(widgets, true);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click: (e, view) => {
          const target = e.target as HTMLElement;
          if (target && target.classList.contains('cm-wikilink')) {
            const pos = view.posAtDOM(target);
            const line = view.state.doc.lineAt(pos);
            const text = line.text;

            let match: RegExpExecArray | null;
            WIKILINK_REGEX.lastIndex = 0;
            while ((match = WIKILINK_REGEX.exec(text)) !== null) {
              const start = line.from + match.index;
              const end = start + match[0].length;
              if (pos >= start && pos <= end) {
                const noteName = match[1].trim();
                if (handler?.onWikilinkClick) {
                  handler.onWikilinkClick(noteName);
                }
                break;
              }
            }
          }
        },
      },
    }
  );
}

/**
 * Extracts all [[Wikilinks]] from a given markdown string
 */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}
