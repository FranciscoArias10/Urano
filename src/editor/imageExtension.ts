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
  getImageMimeType,
} from '../services/storageAdapter';
import { useVaultStore } from '../stores/vaultStore';
import { useNoticeStore } from '../components/common/Notice';
import { FileItem } from '../types';
import { invoke } from '@tauri-apps/api/core';

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
const WIKILINK_IMAGE_REGEX = /!\[\[([^\]]+)\]\]/g;

// Regex matching standard Markdown image: ![alt|300](https://... or path)
const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Global cache of resolved image Object URLs to prevent flicker on CM6 rebuilds
 */
export const imageBlobUrlCache = new Map<string, string>();

/**
 * Resolves absolute path of an image within active vault and fileTree
 */
export function resolveVaultImagePath(rawTarget: string): string {
  if (/^(https?:|blob:|data:)/i.test(rawTarget)) {
    return rawTarget;
  }

  const { fileTree, activeVault } = useVaultStore.getState();

  const traverse = (items: FileItem[]): string | null => {
    for (const item of items) {
      if (
        item.name.toLowerCase() === rawTarget.toLowerCase() ||
        item.path.endsWith(rawTarget)
      ) {
        return item.path;
      }
      if (item.children) {
        const found = traverse(item.children);
        if (found) return found;
      }
    }
    return null;
  };

  const matched = traverse(fileTree);
  if (matched) return matched;

  if (activeVault) {
    const separator = activeVault.includes('\\') ? '\\' : '/';
    const cleanVault = activeVault.endsWith(separator) ? activeVault.slice(0, -1) : activeVault;
    return `${cleanVault}${separator}${rawTarget}`;
  }

  return rawTarget;
}

/**
 * Loads image binary bytes using StorageAdapter (same mechanism as ImageView)
 * and creates a cached Blob URL.
 */
export async function resolveImageBlobUrl(rawPathOrName: string): Promise<string> {
  if (!rawPathOrName) return '';
  if (/^(https?:|blob:|data:)/i.test(rawPathOrName)) {
    return rawPathOrName;
  }

  // 1. Separate filename from dimensions if any pipe remains
  const rawTarget = rawPathOrName.split('|')[0].trim();

  // 2. Resolve real absolute path in vault
  const absolutePath = resolveVaultImagePath(rawTarget);

  // Check memory cache first
  if (imageBlobUrlCache.has(absolutePath)) {
    return imageBlobUrlCache.get(absolutePath)!;
  }
  if (imageBlobUrlCache.has(rawTarget)) {
    return imageBlobUrlCache.get(rawTarget)!;
  }

  // 3. Read binary via StorageAdapter (same as ImageView)
  try {
    const blob = await getStorageAdapter().readBinary(absolutePath);
    const blobUrl = URL.createObjectURL(blob);
    imageBlobUrlCache.set(absolutePath, blobUrl);
    imageBlobUrlCache.set(rawTarget, blobUrl);
    return blobUrl;
  } catch (err) {
    console.error(`[Urano] Error cargando binario de imagen para "${absolutePath}":`, err);
    return '';
  }
}

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
 * Stiled as a block element (display: block; margin: 8px 0;) without using block: true.
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
    container.style.display = 'block';
    container.style.margin = '8px 0';
    container.style.maxWidth = '100%';
    container.style.clear = 'both';

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

    // Synchronously check memory cache first to eliminate any flicker
    const targetKey = resolvedFilePath || targetPathOrUrl;
    const cachedUrl =
      imageBlobUrlCache.get(targetKey) ||
      imageBlobUrlCache.get(targetPathOrUrl) ||
      (resolvedFilePath ? imageBlobUrlCache.get(resolvedFilePath) : undefined);

    if (cachedUrl) {
      img.src = cachedUrl;
    } else {
      // Asynchronously resolve and load
      resolveImageBlobUrl(targetKey).then((url) => {
        if (url) {
          img.src = url;
        }
      });
    }

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
 * CodeMirror 6 ViewPlugin for Image Live Preview
 * STRICT RULE: Absolutely NO block: true is used (avoids RangeError: Block decorations may not be specified via plugins).
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

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            if (pos > doc.length) break;
            const line = doc.lineAt(pos);
            const text = line.text;

            // 1. Check Wikilink image embed: ![[imagen.png]] or ![[imagen.png|300]]
            let wikiMatch: RegExpExecArray | null;
            WIKILINK_IMAGE_REGEX.lastIndex = 0;

            while ((wikiMatch = WIKILINK_IMAGE_REGEX.exec(text)) !== null) {
              const fullMatch = wikiMatch[0];
              const innerText = wikiMatch[1].trim();

              // Always separate target filename from dimension and alt parameters
              const parts = innerText.split('|').map((p) => p.trim());
              const rawTarget = parts[0];

              if (isImagePath(rawTarget)) {
                let width = 0;
                let height = 0;
                let alt = '';

                for (let i = 1; i < parts.length; i++) {
                  const dim = parseImageDimensions(parts[i]);
                  if (dim) {
                    width = dim.width;
                    height = dim.height;
                  } else {
                    alt = parts[i];
                  }
                }

                const start = line.from + wikiMatch.index;
                const end = start + fullMatch.length;
                const resolved = resolveVaultImagePath(rawTarget);

                // Cursor is actively inside this image embed range
                const isCursorInside = sel.from <= end && sel.to >= start;

                const widget = new ImageWidget(
                  {
                    rawText: fullMatch,
                    targetPathOrUrl: rawTarget,
                    resolvedFilePath: resolved,
                    alt,
                    width,
                    height,
                    from: start,
                    to: end,
                    isWikilink: true,
                  },
                  isCursorInside,
                  options?.onOpenInNewTab
                );

                if (!isCursorInside) {
                  // Clean live preview: replace markdown syntax with the image widget
                  widgets.push(Decoration.replace({ widget }).range(start, end));
                } else {
                  // Cursor inside: keep raw text visible for editing and append widget right after
                  widgets.push(
                    Decoration.widget({
                      widget,
                      side: 1,
                    }).range(end)
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
                const resolved = isWeb ? targetUrl : resolveVaultImagePath(targetUrl);

                const isCursorInside = sel.from <= end && sel.to >= start;

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
                  isCursorInside,
                  options?.onOpenInNewTab
                );

                if (!isCursorInside) {
                  widgets.push(Decoration.replace({ widget }).range(start, end));
                } else {
                  widgets.push(
                    Decoration.widget({
                      widget,
                      side: 1,
                    }).range(end)
                  );
                }
              }
            }

            pos = line.to + 1;
          }
        }

        // Sort decorations by CM6 invariant
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
    }
  );
}

let lastPastedTimestamp = 0;

/**
 * Processes an image file pasted from clipboard.
 * Saves it physically to the active vault root, updates the file tree,
 * keeps the current .md note active (NO tab change, NO ImageView open),
 * and inserts \n![[Pasted Image YYYYMMDDHHmmss.png]]\n at the cursor position.
 */
export async function procesarPegadoDeImagen(
  file: File,
  view: EditorView
): Promise<string | null> {
  const nowMs = Date.now();
  if (nowMs - lastPastedTimestamp < 700) {
    console.log('[Urano] Pegado de imagen ignorado por debounce');
    return null;
  }
  lastPastedTimestamp = nowMs;

  try {
    console.log('[Urano] Imagen detectada en portapapeles, procesando...', file.name);

    // Exact Obsidian naming convention: Pasted Image YYYYMMDDHHmmss.png
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
      now.getDate()
    )}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    let ext = 'png';
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
      ext = 'jpg';
    } else if (file.type === 'image/webp') {
      ext = 'webp';
    } else if (file.type === 'image/gif') {
      ext = 'gif';
    } else if (file.type === 'image/svg+xml') {
      ext = 'svg';
    } else if (file.type === 'image/avif') {
      ext = 'avif';
    } else if (file.type === 'image/bmp') {
      ext = 'bmp';
    } else if (file.name && file.name.includes('.')) {
      const parts = file.name.split('.');
      ext = parts[parts.length - 1].toLowerCase();
    }

    const nombreImagen = `Pasted Image ${timestamp}.${ext}`;
    const { activeVault, refreshTree } = useVaultStore.getState();

    if (!activeVault) {
      console.error('[Urano] No hay un directorio de vault activo para guardar la imagen');
      return null;
    }

    // Save directly in the root of the active vault as requested
    const separator = activeVault.includes('\\') ? '\\' : '/';
    const cleanVault = activeVault.endsWith(separator) ? activeVault.slice(0, -1) : activeVault;
    const rutaDestino = `${cleanVault}${separator}${nombreImagen}`;

    // Convert file to Uint8Array for writing
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Pre-cache immediate blob URL in memory so the image widget renders instantly
    const mime = file.type || getImageMimeType(nombreImagen);
    const memoryBlob = new Blob([uint8Array], { type: mime });
    const memoryUrl = URL.createObjectURL(memoryBlob);
    imageBlobUrlCache.set(rutaDestino, memoryUrl);
    imageBlobUrlCache.set(nombreImagen, memoryUrl);

    // Save physically to disk using storageAdapter
    const adapter = getStorageAdapter();
    await adapter.writeBinary(rutaDestino, uint8Array);
    console.log('[Urano] Imagen guardada físicamente en disco:', rutaDestino);

    // Refresh vault file tree (WITHOUT switching active file or opening ImageView tab)
    await refreshTree();

    // Insert \n![[Pasted Image YYYYMMDDHHmmss.png]]\n at exact cursor position
    const link = `\n![[${nombreImagen}]]\n`;
    const fromPos = view.state.selection.main.from;
    view.dispatch({
      changes: { from: fromPos, insert: link },
      selection: { anchor: fromPos + link.length },
    });

    useNoticeStore
      .getState()
      .showNotice(`Imagen guardada: ${nombreImagen}`, 2500, 'success');

    return nombreImagen;
  } catch (err) {
    console.error('[Urano] Error procesando pegado de imagen:', err);
    useNoticeStore
      .getState()
      .showNotice('Error al guardar imagen del portapapeles', 3000, 'error');
    return null;
  }
}

/**
 * Unified Paste and Drag & Drop Event Handlers for CodeMirror 6
 */
export function createImageDropPasteHandler() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      let file: File | null = null;

      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            file = item.getAsFile();
            if (file) break;
          }
        }
      }

      if (!file && event.clipboardData?.files && event.clipboardData.files.length > 0) {
        for (let i = 0; i < event.clipboardData.files.length; i++) {
          const f = event.clipboardData.files[i];
          if (f.type.startsWith('image/') || isImagePath(f.name)) {
            file = f;
            break;
          }
        }
      }

      if (file) {
        event.preventDefault();
        procesarPegadoDeImagen(file, view);
        return true;
      }

      // Fallback: Read directly from OS clipboard via Tauri command read_clipboard_image
      invoke<number[] | null>('read_clipboard_image')
        .then(async (nativeBytes) => {
          if (nativeBytes && nativeBytes.length > 0) {
            console.log('[Urano] Imagen obtenida de portapapeles nativo en evento paste');
            const uint8 = new Uint8Array(nativeBytes);
            const nativeFile = new File([uint8], 'pasted_image.png', { type: 'image/png' });
            await procesarPegadoDeImagen(nativeFile, view);
          }
        })
        .catch(() => {});

      return false;
    },

    dragover(event) {
      const types = event.dataTransfer?.types || [];
      if (
        types.includes('Files') ||
        types.includes('text/plain') ||
        types.includes('application/x-urano-path')
      ) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        return true;
      }
      return false;
    },

    drop(event, view) {
      // 1. Files dropped directly from OS
      const files = Array.from(event.dataTransfer?.files || []);
      const imageFiles = files.filter(
        (f) => f.type.startsWith('image/') || isImagePath(f.name)
      );

      if (imageFiles.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        const coords = { x: event.clientX, y: event.clientY };
        const dropPos = view.posAtCoords(coords) ?? view.state.selection.main.head;

        const { activeVault, refreshTree } = useVaultStore.getState();
        if (!activeVault) return true;

        const separator = activeVault.includes('\\') ? '\\' : '/';
        const cleanVault = activeVault.endsWith(separator) ? activeVault.slice(0, -1) : activeVault;

        Promise.all(
          imageFiles.map(async (file) => {
            const fullPath = `${cleanVault}${separator}${file.name}`;
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Pre-cache blob url
            const mime = file.type || getImageMimeType(file.name);
            const blob = new Blob([uint8Array], { type: mime });
            const bUrl = URL.createObjectURL(blob);
            imageBlobUrlCache.set(fullPath, bUrl);
            imageBlobUrlCache.set(file.name, bUrl);

            await getStorageAdapter().writeBinary(fullPath, uint8Array);
            return file.name;
          })
        )
          .then(async (savedNames) => {
            await refreshTree();
            const insertText = '\n' + savedNames.map((n) => `![[${n}]]`).join('\n') + '\n';
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
          })
          .catch((err) => {
            console.error('[Urano] Error guardando imagen soltada:', err);
            useNoticeStore
              .getState()
              .showNotice('Error al guardar imagen soltada', 3000, 'error');
          });

        return true;
      }

      // 2. Dragging existing image or note from Urano FileTree into Editor
      const uranoPath =
        event.dataTransfer?.getData('application/x-urano-path') ||
        event.dataTransfer?.getData('text/plain');

      if (uranoPath) {
        const fileName = uranoPath.split(/[/\\]/).pop() || '';

        if (isImagePath(uranoPath) || isImagePath(fileName)) {
          event.preventDefault();
          event.stopPropagation();
          const coords = { x: event.clientX, y: event.clientY };
          const dropPos = view.posAtCoords(coords) ?? view.state.selection.main.head;

          const insertText = `\n![[${fileName}]]\n`;
          view.dispatch({
            changes: { from: dropPos, insert: insertText },
            selection: { anchor: dropPos + insertText.length },
          });

          useNoticeStore
            .getState()
            .showNotice(`Imagen añadida: ${fileName}`, 2000, 'success');
          return true;
        } else if (
          uranoPath.endsWith('.md') ||
          uranoPath.endsWith('.canvas') ||
          uranoPath.endsWith('.base')
        ) {
          event.preventDefault();
          event.stopPropagation();
          const coords = { x: event.clientX, y: event.clientY };
          const dropPos = view.posAtCoords(coords) ?? view.state.selection.main.head;
          const cleanName = fileName.replace(/\.(md|canvas|base)$/i, '');

          const insertText = `[[${cleanName}]]`;
          view.dispatch({
            changes: { from: dropPos, insert: insertText },
            selection: { anchor: dropPos + insertText.length },
          });
          return true;
        }
      }

      return false;
    },
  });
}
