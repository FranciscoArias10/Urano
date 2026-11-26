import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Range } from '@codemirror/state';
import { isImagePath } from '../services/storageAdapter';
import { t } from '../locales/i18n';
import { useVaultStore } from '../stores/vaultStore';
import { resolveVaultLinkTarget } from '../utils/pathUtils';
import {
  getFencedCodeLineSet,
  getInlineCodeRangesInLine,
  isRangeOverlapping,
} from './codeRangeUtils';

// Los textos traducidos se insertan vía innerHTML: escapar por si un paquete de idioma
// de la bóveda (.urano/locales) trae marcado.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Regex for [[Target Note]] or [[Target Note|Display Text]], strictly ignoring ![[Embeds]]
const WIKILINK_REGEX = /(?<!\!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const hideBracketDeco = Decoration.replace({});

export interface WikilinkHandler {
  onWikilinkClick: (targetNote: string) => void;
  sourceMode?: boolean;
}

// Widget for embedded .base files (![[Sin título.base]])
class BaseEmbedWidget extends WidgetType {
  constructor(readonly fileName: string, readonly onClick: () => void) {
    super();
  }

  toDOM(): HTMLElement {
    const card = document.createElement('div');
    card.className =
      'cm-base-embed my-2.5 rounded-lg border border-[#2e2e2e] bg-[#1a1714] p-3 text-stone-300 font-sans shadow-md hover:border-orange-500/40 transition-all cursor-pointer select-none';
    card.setAttribute('data-page-preview-target', this.fileName);
    card.setAttribute('data-page-preview-context', 'editor');

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-2 pb-2 border-b border-stone-800/80';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-orange-500 flex items-center';
    iconSpan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3"/><path d="M21 15H3"/></svg>`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'font-semibold text-xs text-white';
    titleSpan.textContent = this.fileName.replace(/\.base$/i, '');

    const badge = document.createElement('span');
    badge.className =
      'text-[10px] px-1.5 py-0.2 rounded bg-orange-500/15 text-orange-400 border border-orange-500/30 font-mono uppercase';
    badge.textContent = 'Base';

    left.appendChild(iconSpan);
    left.appendChild(titleSpan);
    left.appendChild(badge);

    const right = document.createElement('div');
    right.className =
      'text-[11px] text-stone-400 hover:text-orange-400 flex items-center gap-1 font-medium transition-colors';
    right.innerHTML = `<span>${escapeHtml(t('editor.baseEmbed.open'))}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

    header.appendChild(left);
    header.appendChild(right);
    card.appendChild(header);

    const desc = document.createElement('div');
    desc.className = 'pt-2 text-[11px] text-stone-400 flex items-center justify-between';
    desc.innerHTML = `<span>${escapeHtml(t('editor.baseEmbed.description'))}</span><span class="text-stone-500 font-mono text-[10px]">${escapeHtml(this.fileName)}</span>`;
    card.appendChild(desc);

    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });

    return card;
  }

  eq(other: BaseEmbedWidget): boolean {
    return other.fileName === this.fileName;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export function createWikilinksExtension(handler?: WikilinkHandler) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private unsubscribeVault: (() => void) | null = null;
      private isDestroyed = false;

      constructor(readonly view: EditorView) {
        this.decorations = this.computeDecorations(view);
        this.unsubscribeVault = useVaultStore.subscribe((state, prev) => {
          if (
            this.isDestroyed ||
            (state.files === prev.files &&
              state.fileTree === prev.fileTree &&
              state.activeVault === prev.activeVault)
          ) {
            return;
          }
          queueMicrotask(() => {
            if (this.isDestroyed) return;
            try {
              this.decorations = this.computeDecorations(this.view);
              this.view.dispatch({});
            } catch {
              // Ignore if EditorView is mid-update or already disposed
            }
          });
        });
      }

      destroy() {
        this.isDestroyed = true;
        if (this.unsubscribeVault) {
          this.unsubscribeVault();
          this.unsubscribeVault = null;
        }
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet
        ) {
          this.decorations = this.computeDecorations(update.view);
        }
      }

      computeDecorations(view: EditorView): DecorationSet {
        const widgets: Range<Decoration>[] = [];
        const sel = view.state.selection.main;
        const doc = view.state.doc;
        const codeLines = getFencedCodeLineSet(doc);
        const { fileTree, activeVault } = useVaultStore.getState();

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            if (pos > doc.length) break;
            const line = doc.lineAt(pos);
            if (codeLines.has(line.number)) {
              pos = line.to + 1;
              continue;
            }
            const text = line.text;
            const isCursorOnLine = sel.from <= line.to && sel.to >= line.from;
            const inlineCodeRanges = getInlineCodeRangesInLine(text, line.from);

            // Check if entire line is an embedded .base file: ![[...base]]
            const baseEmbedMatch = text.trim().match(/^!\[\[([^\]|]+)\.base\]\]$/i);
            if (baseEmbedMatch && !handler?.sourceMode && !isCursorOnLine && line.from < line.to) {
              const baseName = `${baseEmbedMatch[1].trim()}.base`;
              widgets.push(
                Decoration.replace({
                  widget: new BaseEmbedWidget(baseName, () => {
                    handler?.onWikilinkClick(baseName);
                  }),
                }).range(line.from, line.to)
              );
              pos = line.to + 1;
              continue;
            }

            let match: RegExpExecArray | null;
            WIKILINK_REGEX.lastIndex = 0;

            while ((match = WIKILINK_REGEX.exec(text)) !== null) {
              if (match.index > 0 && text.charAt(match.index - 1) === '!') {
                continue;
              }
              const targetNote = match[1].trim();
              if (isImagePath(targetNote)) {
                continue;
              }

              const start = line.from + match.index;
              const end = start + match[0].length;
              if (isRangeOverlapping(start, end, inlineCodeRanges)) {
                continue;
              }

              const isResolved = Boolean(
                activeVault && resolveVaultLinkTarget(targetNote, fileTree, activeVault)
              );
              const linkClass = isResolved ? 'cm-wikilink' : 'cm-wikilink is-unresolved';
              const linkDeco = Decoration.mark({
                class: linkClass,
                attributes: {
                  'data-page-preview-target': targetNote,
                  'data-page-preview-context': 'editor',
                  'data-wikilink-unresolved': isResolved ? 'false' : 'true',
                },
              });

              if (!handler?.sourceMode && !isCursorOnLine) {
                const pipeIdx = match[2] !== undefined ? match[0].indexOf('|') : -1;
                const visibleFrom = pipeIdx !== -1 ? start + pipeIdx + 1 : start + 2;
                const visibleTo = end - 2;
                if (visibleFrom < visibleTo) {
                  widgets.push(hideBracketDeco.range(start, visibleFrom));
                  widgets.push(linkDeco.range(visibleFrom, visibleTo));
                  widgets.push(hideBracketDeco.range(visibleTo, end));
                } else {
                  widgets.push(linkDeco.range(start, end));
                }
              } else {
                widgets.push(linkDeco.range(start, end));
              }
            }

            pos = line.to + 1;
          }
        }

        widgets.sort(
          (a, b) =>
            a.from - b.from ||
            (a.value.startSide ?? 0) - (b.value.startSide ?? 0) ||
            a.to - b.to
        );

        return Decoration.set(widgets, true);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown: (e) => {
          if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
          const target = e.target as HTMLElement | null;
          const wikilinkEl = target?.closest('.cm-wikilink') as HTMLElement | null;
          if (wikilinkEl) {
            e.preventDefault();
            return true;
          }
          return false;
        },
        click: (e, view) => {
          if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
          const target = e.target as HTMLElement | null;
          const wikilinkEl = target?.closest('.cm-wikilink') as HTMLElement | null;
          if (wikilinkEl) {
            e.preventDefault();
            e.stopPropagation();
            const attrTarget = wikilinkEl.getAttribute('data-page-preview-target')?.trim();
            if (attrTarget) {
              handler?.onWikilinkClick(attrTarget);
              return true;
            }

            const pos = view.posAtDOM(wikilinkEl);
            const line = view.state.doc.lineAt(pos);
            const text = line.text;

            let match: RegExpExecArray | null;
            WIKILINK_REGEX.lastIndex = 0;
            while ((match = WIKILINK_REGEX.exec(text)) !== null) {
              if (match.index > 0 && text.charAt(match.index - 1) === '!') continue;
              const targetNote = match[1].trim();
              if (isImagePath(targetNote)) continue;

              const start = line.from + match.index;
              const end = start + match[0].length;
              if (pos >= start && pos <= end) {
                handler?.onWikilinkClick(targetNote);
                return true;
              }
            }
          }
          return false;
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
  const regex = /(?<!\!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > 0 && content.charAt(match.index - 1) === '!') continue;
    const target = match[1].trim();
    if (!isImagePath(target)) {
      links.push(target);
    }
  }
  return links;
}

