import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Range } from '@codemirror/state';
import {
  getStorageAdapter,
  isImagePath,
} from '../services/storageAdapter';
import { useVaultStore } from '../stores/vaultStore';
import { useNoticeStore } from '../components/common/Notice';
import { FileItem } from '../types';

/**
 * Parses image dimension syntax like "300" or "300x200"
 */
export function parseImageDimensions(str: string): { width: number; height: number } | null {
  const match = str.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/);
  return match
    ? {
        width: parseInt(match[1], 10),
        height: match[2] ? parseInt(match[2], 10) : 0,
      }
    : null;
}

/**
 * Parses alt text and dimension parameters from Wikilink or Markdown image embed
 */
export function parseImageEmbed(altOrDimensions: string): {
  width: number;
  height: number;
  alt: string;
} {
  let width = 0;
  let height = 0;
  let alt = (altOrDimensions || '').trim();

  if (alt) {
    const checkDim = (part: string): boolean => {
      const d = parseImageDimensions(part);
      if (d) {
        width = d.width;
        height = d.height;
        return true;
      }
      return false;
    };

    const lastPipe = alt.lastIndexOf('|');
    if (lastPipe !== -1) {
      if (checkDim(alt.substring(lastPipe + 1))) {
        alt = alt.substring(0, lastPipe).trim();
      }
    } else {
      if (checkDim(alt)) {
        alt = '';
      }
    }
  }

  return { width, height, alt };
}

// Regex matching Obsidian Wikilink embed: ![[filename.png]] or ![[filename.png|300]]
const WIKILINK_IMAGE_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Regex matching standard Markdown image: ![alt|300](https://... or path)
const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Helper to copy image blob to system clipboard as image/png
 */
export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  let pngBlob = blob;
  if (blob.type !== 'image/png') {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const converted = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/png')
    );
    if (converted) pngBlob = converted;
  }

  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': pngBlob }),
  ]);
}

/**
 * Image Embed Widget for CodeMirror 6 Live Preview
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly info: {
      rawText: string;
      targetPathOrUrl: string;
      resolvedFilePath?: string;
      alt: string;
      width: number;
      height: number;
      from: number;
      to: number;
      isWikilink: boolean;
    },
    readonly isBlockPreview: boolean = false,
    readonly onOpenInNewTab?: (filePath: string) => void
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.info.rawText === this.info.rawText &&
      other.info.width === this.info.width &&
      other.info.height === this.info.height &&
      other.info.from === this.info.from &&
      other.info.to === this.info.to &&
      other.isBlockPreview === this.isBlockPreview
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const { targetPathOrUrl, resolvedFilePath, alt, width, height, from, to, isWikilink } =
      this.info;

    const container = document.createElement('div');
    container.className = `image-embed cm-image-embed ${
      this.isBlockPreview ? 'cm-image-block-preview' : ''
    }`;
    container.tabIndex = -1;

    const wrapper = document.createElement('div');
    wrapper.className = 'image-wrapper';

    const img = document.createElement('img');
    img.alt = alt || targetPathOrUrl.split(/[/\\]/).pop() || 'Imagen';
    img.draggable = false;

    // Apply dimensions if present
    if (width > 0) {
      img.style.width = `${width}px`;
      if (height > 0) {
        img.style.height = `${height}px`;
        img.style.objectFit = 'cover';
      } else {
        img.style.height = 'auto';
      }
    } else {
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }

    // Resolve URL asynchronously via StorageAdapter
    const loadSrc = async () => {
      try {
        let finalPath = targetPathOrUrl;
        if (/^(https?:|blob:|data:)/i.test(finalPath)) {
          img.src = finalPath;
          return;
        }

        // Check if resolvedFilePath is available or resolve from vault
        if (!resolvedFilePath) {
          const { fileTree, activeVault } = useVaultStore.getState();
          const findInTree = (items: FileItem[]): string | null => {
            for (const item of items) {
              if (
                item.name.toLowerCase() === targetPathOrUrl.toLowerCase() ||
                item.path.endsWith(targetPathOrUrl)
              ) {
                return item.path;
              }
              if (item.children) {
                const sub = findInTree(item.children);
                if (sub) return sub;
              }
            }
            return null;
          };

          const matched = findInTree(fileTree);
          finalPath = matched || (activeVault ? `${activeVault}/${targetPathOrUrl}` : targetPathOrUrl);
        } else {
          finalPath = resolvedFilePath;
        }

        const url = await getStorageAdapter().getResourcePath(finalPath);
        if (url) {
          img.src = url;
        }
      } catch (err) {
        console.error('Error resolving image src:', err);
      }
    };
    loadSrc();

    wrapper.appendChild(img);

    // Resize Handle Corner (Bottom-Right)
    const resizeCorner = document.createElement('div');
    resizeCorner.className = 'image-resize-corner';
    resizeCorner.title = 'Arrastrar para redimensionar';

    // Interactive mouse drag resizing
    resizeCorner.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = img.offsetWidth || width || 300;
      container.classList.add('is-resizing');

      let currentNewWidth = startWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        currentNewWidth = Math.max(40, Math.round(startWidth + delta));
        img.style.width = `${currentNewWidth}px`;
        img.style.height = 'auto';
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        container.classList.remove('is-resizing');

        // Update document text with new width
        if (currentNewWidth !== startWidth) {
          let replacement = '';
          if (isWikilink) {
            replacement = alt
              ? `![[${targetPathOrUrl}|${alt}|${currentNewWidth}]]`
              : `![[${targetPathOrUrl}|${currentNewWidth}]]`;
          } else {
            replacement = alt
              ? `![${alt}|${currentNewWidth}](${targetPathOrUrl})`
              : `![${currentNewWidth}](${targetPathOrUrl})`;
          }

          view.dispatch({
            changes: { from, to, insert: replacement },
          });
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    wrapper.appendChild(resizeCorner);
    container.appendChild(wrapper);

    // Right-Click Context Menu on Image
    wrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Trigger custom context menu event on editor container
      const customEvent = new CustomEvent('urano-image-contextmenu', {
        bubbles: true,
        detail: {
          x: e.clientX,
          y: e.clientY,
          filePath: resolvedFilePath || targetPathOrUrl,
          src: img.src,
          alt,
          from,
          to,
          onOpenInNewTab: this.onOpenInNewTab,
        },
      });
      container.dispatchEvent(customEvent);
    });

    return container;
  }

  ignoreEvent(event: Event): boolean {
    // Allow mousedown on resize corner or right click on wrapper
    const target = event.target as HTMLElement;
    if (
      target.classList.contains('image-resize-corner') ||
      event.type === 'contextmenu'
    ) {
      return false;
    }
    return true;
  }
}

export interface ImageExtensionOptions {
  onOpenInNewTab?: (filePath: string) => void;
}

/**
 * CodeMirror 6 ViewPlugin for Image Live Preview & Paste/Drop handlers
 */
export function createImageExtension(options?: ImageExtensionOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.computeDecorations(view);
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
        const { fileTree, activeVault } = useVaultStore.getState();

        // Helper to find real vault path of an image
        const findImagePath = (nameOrPath: string): string | undefined => {
          if (/^(https?:|blob:|data:)/i.test(nameOrPath)) return nameOrPath;
          const traverse = (items: FileItem[]): string | null => {
            for (const it of items) {
              if (
                it.name.toLowerCase() === nameOrPath.toLowerCase() ||
                it.path.endsWith(nameOrPath)
              ) {
                return it.path;
              }
              if (it.children) {
                const sub = traverse(it.children);
                if (sub) return sub;
              }
            }
            return null;
          };
          const res = traverse(fileTree);
          return res || (activeVault ? `${activeVault}/${nameOrPath}` : undefined);
        };

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            if (pos > doc.length) break;
            const line = doc.lineAt(pos);
            const text = line.text;
            const isCursorOnLine = sel.from <= line.to && sel.to >= line.from;

            // 1. Check Wikilink image embed: ![[imagen.png|300]]
            let wikiMatch: RegExpExecArray | null;
            WIKILINK_IMAGE_REGEX.lastIndex = 0;

            while ((wikiMatch = WIKILINK_IMAGE_REGEX.exec(text)) !== null) {
              const fullMatch = wikiMatch[0];
              const targetName = wikiMatch[1].trim();
              const altOrDim = wikiMatch[2] ? wikiMatch[2].trim() : '';

              if (isImagePath(targetName)) {
                const { width, height, alt } = parseImageEmbed(altOrDim);
                const start = line.from + wikiMatch.index;
                const end = start + fullMatch.length;
                const resolved = findImagePath(targetName);

                const widget = new ImageWidget(
                  {
                    rawText: fullMatch,
                    targetPathOrUrl: targetName,
                    resolvedFilePath: resolved,
                    alt,
                    width,
                    height,
                    from: start,
                    to: end,
                    isWikilink: true,
                  },
                  isCursorOnLine,
                  options?.onOpenInNewTab
                );

                if (!isCursorOnLine) {
                  // Hide raw text and show clean image
                  widgets.push(Decoration.replace({ widget }).range(start, end));
                } else {
                  // Keep text visible and show block preview right below line
                  widgets.push(
                    Decoration.widget({
                      widget,
                      block: true,
                      side: 1,
                    }).range(line.to)
                  );
                }
              }
            }

            // 2. Check Standard Markdown image: ![alt|300](url)
            let mdMatch: RegExpExecArray | null;
            MD_IMAGE_REGEX.lastIndex = 0;

            while ((mdMatch = MD_IMAGE_REGEX.exec(text)) !== null) {
              const fullMatch = mdMatch[0];
              const altOrDim = mdMatch[1] ? mdMatch[1].trim() : '';
              const targetUrl = mdMatch[2].trim();

              const isWeb = /^(https?:|data:|blob:)/i.test(targetUrl);
              const isLocalImg = isImagePath(targetUrl);

              if (isWeb || isLocalImg) {
                const { width, height, alt } = parseImageEmbed(altOrDim);
                const start = line.from + mdMatch.index;
                const end = start + fullMatch.length;
                const resolved = isWeb ? targetUrl : findImagePath(targetUrl);

                const widget = new ImageWidget(
                  {
                    rawText: fullMatch,
                    targetPathOrUrl: targetUrl,
                    resolvedFilePath: resolved,
                    alt,
                    width,
                    height,
                    from: start,
                    to: end,
                    isWikilink: false,
                  },
                  isCursorOnLine,
                  options?.onOpenInNewTab
                );

                if (!isCursorOnLine) {
                  widgets.push(Decoration.replace({ widget }).range(start, end));
                } else {
                  widgets.push(
                    Decoration.widget({
                      widget,
                      block: true,
                      side: 1,
                    }).range(line.to)
                  );
                }
              }
            }

            pos = line.to + 1;
          }
        }

        return Decoration.set(widgets, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * Paste and Drag & Drop Event Handlers for CodeMirror 6
 */
export function createImageDropPasteHandler() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = Array.from(event.clipboardData?.items || []);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;

          // Generate exact Obsidian timestamp name: Pasted image YYYYMMDDHHmmss.png
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
            now.getDate()
          )}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1] || 'png';
          const fileName = `Pasted image ${timestamp}.${ext}`;

          const { activeVault, activeFile, refreshTree } = useVaultStore.getState();
          const targetDir = activeFile
            ? activeFile.substring(0, activeFile.lastIndexOf('/'))
            : activeVault;

          if (!targetDir) return true;

          const fullPath = `${targetDir}/${fileName}`.replace(/\/+/g, '/');

          // Save binary asynchronously and insert embed
          getStorageAdapter()
            .writeBinary(fullPath, file)
            .then(async () => {
              await refreshTree();
              view.dispatch(view.state.replaceSelection(`![[${fileName}]]`));
              useNoticeStore
                .getState()
                .showNotice(`Imagen guardada: ${fileName}`, 2500, 'success');
            })
            .catch((err) => {
              console.error('Error saving pasted image:', err);
              useNoticeStore
                .getState()
                .showNotice('Error al guardar imagen pegada', 3000, 'error');
            });

          return true;
        }
      }
      return false;
    },

    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files || []);
      const imageFiles = files.filter(
        (f) => f.type.startsWith('image/') || isImagePath(f.name)
      );

      // A. Dropping images from OS into Editor
      if (imageFiles.length > 0) {
        event.preventDefault();
        const coords = { x: event.clientX, y: event.clientY };
        const dropPos = view.posAtCoords(coords) ?? view.state.selection.main.head;

        const { activeVault, activeFile, refreshTree } = useVaultStore.getState();
        const targetDir = activeFile
          ? activeFile.substring(0, activeFile.lastIndexOf('/'))
          : activeVault;

        if (!targetDir) return true;

        Promise.all(
          imageFiles.map(async (file) => {
            const fullPath = `${targetDir}/${file.name}`.replace(/\/+/g, '/');
            await getStorageAdapter().writeBinary(fullPath, file);
            return file.name;
          })
        ).then(async (savedNames) => {
          await refreshTree();
          const insertText = savedNames.map((n) => `![[${n}]]`).join('\n') + '\n';
          view.dispatch({
            changes: { from: dropPos, insert: insertText },
            selection: { anchor: dropPos + insertText.length },
          });
          useNoticeStore
            .getState()
            .showNotice(
              `${savedNames.length} imagen(es) añadida(s) al documento`,
              2500,
              'success'
            );
        });

        return true;
      }

      // B. Dragging existing image from Urano FileTree into Editor
      const draggedPath = event.dataTransfer?.getData('text/plain');
      if (draggedPath && isImagePath(draggedPath)) {
        event.preventDefault();
        const coords = { x: event.clientX, y: event.clientY };
        const dropPos = view.posAtCoords(coords) ?? view.state.selection.main.head;
        const fileName = draggedPath.split(/[/\\]/).pop() || '';

        const insertText = `![[${fileName}]]`;
        view.dispatch({
          changes: { from: dropPos, insert: insertText },
          selection: { anchor: dropPos + insertText.length },
        });

        return true;
      }

      return false;
    },
  });
}
