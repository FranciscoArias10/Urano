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
  toUint8Array,
} from '../services/storageAdapter';
import { useVaultStore } from '../stores/vaultStore';
import { resolveAttachmentDir } from '../stores/settingsStore';
import { useNoticeStore } from '../components/common/Notice';
import { t } from '../locales/i18n';
import { FileItem } from '../types';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/** Resize constraints (pixels) */
const MIN_IMAGE_WIDTH = 50;
const MAX_IMAGE_WIDTH = 1200;

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
 * Re-keys the image cache when a file is renamed so CodeMirror 6 widgets and
 * ImageView display the image under its new name instantly, without flicker.
 *
 * `blob:`/`data:` URLs are still valid after the rename, so they are carried over.
 * `asset://` URLs embed the old path (which no longer exists on disk), so the new
 * keys get a fresh `convertFileSrc(newPath)` instead.
 */
export function renameImageInCache(oldPath: string, newPath: string): void {
  const normOld = oldPath.replace(/\\/g, '/');
  const normNew = newPath.replace(/\\/g, '/');
  const oldFileName = normOld.split('/').pop() || '';
  const newFileName = normNew.split('/').pop() || '';
  if (!isImagePath(newFileName) && !isImagePath(oldFileName)) return;

  const cachedUrl =
    imageBlobUrlCache.get(oldPath) ||
    imageBlobUrlCache.get(normOld) ||
    imageBlobUrlCache.get(oldFileName);

  imageBlobUrlCache.delete(oldPath);
  imageBlobUrlCache.delete(normOld);
  imageBlobUrlCache.delete(oldFileName);

  let newUrl: string | undefined;
  if (cachedUrl && /^(blob:|data:)/i.test(cachedUrl)) {
    newUrl = cachedUrl;
  } else {
    try {
      newUrl = convertFileSrc(newPath);
    } catch {
      newUrl = undefined;
    }
  }

  if (newUrl) {
    imageBlobUrlCache.set(newPath, newUrl);
    imageBlobUrlCache.set(normNew, newUrl);
    imageBlobUrlCache.set(newFileName, newUrl);
  }
}

/**
 * Synchronously resolves the URL for an embed (cache hit or Tauri asset protocol).
 * Returns null when only an asynchronous resolution is possible.
 */
export function getSyncImageUrl(targetPathOrUrl: string, resolvedFilePath?: string): string | null {
  if (/^(https?:|blob:|data:|asset:)/i.test(targetPathOrUrl)) {
    return targetPathOrUrl;
  }
  const targetKey = resolvedFilePath || targetPathOrUrl;
  const cached =
    imageBlobUrlCache.get(targetKey) ||
    imageBlobUrlCache.get(targetPathOrUrl) ||
    (resolvedFilePath ? imageBlobUrlCache.get(resolvedFilePath) : undefined);
  if (cached) return cached;

  if (resolvedFilePath && !/^(https?:|blob:|data:|asset:)/i.test(resolvedFilePath)) {
    try {
      const assetUrl = convertFileSrc(resolvedFilePath);
      if (assetUrl) {
        imageBlobUrlCache.set(resolvedFilePath, assetUrl);
        imageBlobUrlCache.set(targetPathOrUrl, assetUrl);
        return assetUrl;
      }
    } catch {
      // fall through
    }
  }
  return null;
}

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

  // 3. Fast Tauri Asset Protocol conversion: streams directly from disk via Rust with 0ms IPC overhead
  try {
    const assetUrl = convertFileSrc(absolutePath);
    if (assetUrl) {
      imageBlobUrlCache.set(absolutePath, assetUrl);
      imageBlobUrlCache.set(rawTarget, assetUrl);
      return assetUrl;
    }
  } catch (err) {
    console.warn('[Urano] convertFileSrc fallback to readBinary:', err);
  }

  // 4. Fallback: Read binary via StorageAdapter
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

export interface ImageEmbedInfo {
  rawText: string;
  targetPathOrUrl: string;
  resolvedFilePath?: string;
  alt: string;
  width: number;
  height: number;
  from: number;
  to: number;
  isWikilink: boolean;
}

interface ImageWidgetDomState {
  info: ImageEmbedInfo;
  img: HTMLImageElement;
}

/** Live state of each widget DOM node, so `updateDOM` can patch it in place. */
const widgetDomState = new WeakMap<HTMLElement, ImageWidgetDomState>();

/**
 * Reads the live state of an image widget DOM node. Used by the editor to
 * collect every image in the document when opening the lightbox.
 */
export function getImageWidgetState(
  dom: HTMLElement
): { info: ImageEmbedInfo; img: HTMLImageElement } | undefined {
  return widgetDomState.get(dom);
}

function applyImageDimensions(img: HTMLImageElement, width: number, height: number): void {
  if (width > 0) {
    const clampedW = Math.min(Math.max(width, MIN_IMAGE_WIDTH), MAX_IMAGE_WIDTH);
    img.style.width = `${clampedW}px`;
    img.style.maxWidth = '100%';
    if (height > 0) {
      img.style.height = `${height}px`;
      img.style.objectFit = 'cover';
    } else {
      img.style.height = 'auto';
      img.style.objectFit = '';
    }
  } else {
    img.style.width = '';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.objectFit = '';
  }
}

/**
 * Re-derives the document range of an embed from its live DOM node.
 * Positions captured when the widget was built go stale as soon as text above
 * the image changes, so they are never trusted at interaction time.
 */
export function locateEmbedRange(
  view: EditorView,
  dom: HTMLElement,
  rawText: string,
  fallback: { from: number; to: number }
): { from: number; to: number } {
  let pos: number;
  try {
    pos = view.posAtDOM(dom);
  } catch {
    return fallback;
  }
  const doc = view.state.doc;
  pos = Math.max(0, Math.min(pos, doc.length));
  const line = doc.lineAt(pos);

  let best: { from: number; to: number } | null = null;
  let idx = line.text.indexOf(rawText);
  while (idx !== -1) {
    const from = line.from + idx;
    const to = from + rawText.length;
    if (pos >= from && pos <= to) return { from, to };
    if (!best || Math.abs(from - pos) < Math.abs(best.from - pos)) best = { from, to };
    idx = line.text.indexOf(rawText, idx + 1);
  }
  return best ?? fallback;
}

/**
 * Image Embed Widget for CodeMirror 6 Live Preview
 * Styled as a block element (display: block; margin: 8px 0;) without using block: true.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly info: ImageEmbedInfo,
    readonly isBlockPreview: boolean = false,
    readonly onOpenInNewTab?: (filePath: string) => void,
    readonly onZoomImage?: (info: ImageEmbedInfo, src: string) => void
  ) {
    super();
  }

  /**
   * `from`/`to` are intentionally NOT compared: they shift on every edit above
   * the image, and re-creating the <img> would re-request and re-decode the file.
   */
  eq(other: ImageWidget): boolean {
    return (
      other.info.rawText === this.info.rawText &&
      other.info.targetPathOrUrl === this.info.targetPathOrUrl &&
      (other.info.resolvedFilePath || '') === (this.info.resolvedFilePath || '') &&
      other.info.alt === this.info.alt &&
      other.info.width === this.info.width &&
      other.info.height === this.info.height &&
      other.isBlockPreview === this.isBlockPreview
    );
  }

  /** Same image with different syntax (e.g. typing `|300`): patch the DOM instead of redrawing. */
  updateDOM(dom: HTMLElement): boolean {
    const state = widgetDomState.get(dom);
    if (!state) return false;
    const sameSource =
      state.info.targetPathOrUrl === this.info.targetPathOrUrl &&
      (state.info.resolvedFilePath || '') === (this.info.resolvedFilePath || '') &&
      state.info.isWikilink === this.info.isWikilink &&
      dom.classList.contains('cm-image-block-preview') === this.isBlockPreview;
    if (!sameSource) {
      // Same embed kind but the target changed (e.g. the image file was renamed and the
      // link rewritten): swap the <img> source in place instead of rebuilding the widget,
      // so the already-decoded picture stays on screen until the new one is ready.
      const sameKind =
        state.info.isWikilink === this.info.isWikilink &&
        dom.classList.contains('cm-image-block-preview') === this.isBlockPreview;
      if (!sameKind) return false;
      const newUrl = getSyncImageUrl(this.info.targetPathOrUrl, this.info.resolvedFilePath);
      if (!newUrl) return false;
      if (state.img.src !== newUrl) {
        state.img.src = newUrl;
      }
    }

    state.info = { ...this.info };
    applyImageDimensions(state.img, this.info.width, this.info.height);
    state.img.alt = this.info.alt || this.info.targetPathOrUrl.split(/[/\\]/).pop() || 'Imagen';
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const { targetPathOrUrl, resolvedFilePath, alt, width, height } = this.info;

    const container = document.createElement('div');
    container.className = `image-embed cm-image-embed ${
      this.isBlockPreview ? 'cm-image-block-preview' : ''
    }`;
    container.tabIndex = -1;
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    container.style.margin = '6px 0';
    container.style.maxWidth = '100%';
    container.style.clear = 'both';

    const wrapper = document.createElement('div');
    wrapper.className = 'image-wrapper';

    // Skeleton placeholder — shown while the image loads
    const skeleton = document.createElement('div');
    skeleton.className = 'image-skeleton';
    const skelW = width > 0 ? Math.min(Math.max(width, MIN_IMAGE_WIDTH), MAX_IMAGE_WIDTH) : 320;
    const skelH = height > 0 ? height : Math.round(skelW * 0.6);
    skeleton.style.width = `${skelW}px`;
    skeleton.style.height = `${skelH}px`;
    wrapper.appendChild(skeleton);

    const img = document.createElement('img');
    img.alt = alt || targetPathOrUrl.split(/[/\\]/).pop() || 'Imagen';
    img.draggable = false;
    img.loading = 'eager';
    (img as any).decoding = 'async';
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.15s ease';

    const state: ImageWidgetDomState = { info: { ...this.info }, img };
    widgetDomState.set(container, state);

    // Once loaded, remove skeleton and fade in
    const onLoaded = () => {
      skeleton.remove();
      img.style.opacity = '1';
    };
    img.addEventListener('load', onLoaded, { once: true });
    img.addEventListener('error', () => skeleton.remove(), { once: true });

    applyImageDimensions(img, width, height);

    // Synchronously check memory cache first to eliminate any flicker
    const targetKey = resolvedFilePath || targetPathOrUrl;
    let cachedUrl =
      imageBlobUrlCache.get(targetKey) ||
      imageBlobUrlCache.get(targetPathOrUrl) ||
      (resolvedFilePath ? imageBlobUrlCache.get(resolvedFilePath) : undefined);

    // If not yet in cache, convert synchronously via Tauri asset protocol (0ms)
    if (!cachedUrl && resolvedFilePath && !/^(https?:|blob:|data:|asset:)/i.test(resolvedFilePath)) {
      try {
        const assetUrl = convertFileSrc(resolvedFilePath);
        if (assetUrl) {
          cachedUrl = assetUrl;
          imageBlobUrlCache.set(resolvedFilePath, assetUrl);
          imageBlobUrlCache.set(targetPathOrUrl, assetUrl);
        }
      } catch {
        // Fallback
      }
    }

    if (cachedUrl) {
      img.src = cachedUrl;
      // If already in browser cache too, the load event fires synchronously
      if (img.complete && img.naturalWidth > 0) {
        skeleton.remove();
        img.style.opacity = '1';
      }
    } else {
      // Asynchronously resolve and load fallback
      resolveImageBlobUrl(targetKey).then((url) => {
        if (url) {
          img.src = url;
        } else {
          skeleton.remove();
        }
      });
    }

    wrapper.appendChild(img);

    /* --------------------------------------------------------------- *
     * Hover action bar (top-right corner) — Obsidian `.embed-actions`
     * Two buttons: `lucide-zoom-in` (lightbox) and `lucide-code-2`
     * (edit the `![[image.png]]` markdown source line).
     * --------------------------------------------------------------- */
    const actions = document.createElement('div');
    actions.className = 'embed-actions image-embed-actions';

    // 1. Zoom / lightbox button
    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'embed-action image-embed-action image-zoom-button';
    zoomBtn.title = t('imageEmbed.zoom');
    zoomBtn.setAttribute('aria-label', t('imageEmbed.zoom'));
    zoomBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-in"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>';
    zoomBtn.addEventListener('mousedown', (e) => {
      // Ctrl/Cmd + click opens the file in a new leaf (Obsidian behaviour)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (this.onOpenInNewTab) {
          this.onOpenInNewTab(state.info.resolvedFilePath || state.info.targetPathOrUrl);
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (this.onZoomImage) {
        this.onZoomImage(state.info, img.src);
      }
    });
    actions.appendChild(zoomBtn);

    // 2. `</>` edit block button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'embed-action image-embed-action edit-block-button';
    editBtn.title = t('imageEmbed.editBlock');
    editBtn.setAttribute('aria-label', t('imageEmbed.editBlock'));
    editBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code-2"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>';
    editBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Move the cursor inside the `![[image.png]]` line so the source is revealed
      const { from } = locateEmbedRange(view, container, state.info.rawText, state.info);
      try {
        const line = view.state.doc.lineAt(from);
        view.dispatch({
          selection: { anchor: Math.min(line.from + 3, line.to) },
          scrollIntoView: true,
        });
        view.focus();
      } catch {
        // Ignore out-of-range positions after concurrent edits
      }
    });
    actions.appendChild(editBtn);

    container.appendChild(actions);

    /* --------------------------------------------------------------- *
     * Resize handle (bottom-right corner showcase `┘`)
     * --------------------------------------------------------------- */
    const resizeCorner = document.createElement('div');
    resizeCorner.className = 'image-resize-corner cm-image-resize-handle';
    resizeCorner.title = t('imageEmbed.dragToResize');

    // Interactive mouse drag resizing with MIN/MAX constraints and size tooltip
    resizeCorner.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = img.offsetWidth || state.info.width || 300;
      container.classList.add('is-resizing');

      let currentNewWidth = startWidth;

      // Create floating size tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'image-resize-tooltip';
      tooltip.textContent = `${startWidth}px`;
      container.appendChild(tooltip);

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        currentNewWidth = Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, Math.round(startWidth + delta)));
        img.style.width = `${currentNewWidth}px`;
        img.style.height = 'auto';
        tooltip.textContent = `${currentNewWidth}px`;
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        container.classList.remove('is-resizing');
        tooltip.remove();

        // Update document text with new width
        if (currentNewWidth !== startWidth) {
          const { rawText, targetPathOrUrl: target, alt: currentAlt, isWikilink } = state.info;
          const { from, to } = locateEmbedRange(view, container, rawText, state.info);

          let replacement = '';
          if (isWikilink) {
            replacement = currentAlt
              ? `![[${target}|${currentAlt}|${currentNewWidth}]]`
              : `![[${target}|${currentNewWidth}]]`;
          } else {
            replacement = currentAlt
              ? `![${currentAlt}|${currentNewWidth}](${target})`
              : `![${currentNewWidth}](${target})`;
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

      const { from, to } = locateEmbedRange(view, container, state.info.rawText, state.info);
      const customEvent = new CustomEvent('urano-image-contextmenu', {
        bubbles: true,
        detail: {
          x: e.clientX,
          y: e.clientY,
          filePath: state.info.resolvedFilePath || state.info.targetPathOrUrl,
          src: img.src,
          alt: state.info.alt,
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
      target.classList.contains('cm-image-resize-handle') ||
      target.closest('.embed-actions') ||
      target.closest('.image-embed-actions') ||
      event.type === 'contextmenu'
    ) {
      return false;
    }
    return true;
  }
}

export interface ImageExtensionOptions {
  onOpenInNewTab?: (filePath: string) => void;
  /** Opens the full-screen lightbox for the embed (Obsidian `showImage`). */
  onZoomImage?: (info: ImageEmbedInfo, src: string) => void;
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
        // Prefetch visible images on first render to warm cache
        this.prefetchVisibleImages(view);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet
        ) {
          this.decorations = this.computeDecorations(update.view);
        }
        // Prefetch whenever viewport changes
        if (update.viewportChanged) {
          this.prefetchVisibleImages(update.view);
        }
      }

      /** Pre-resolve blob URLs for all image embeds currently in the viewport */
      prefetchVisibleImages(view: EditorView) {
        const doc = view.state.doc;
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to && pos <= doc.length) {
            const line = doc.lineAt(pos);
            const text = line.text;
            // Quick scan for image patterns
            WIKILINK_IMAGE_REGEX.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = WIKILINK_IMAGE_REGEX.exec(text)) !== null) {
              const parts = m[1].trim().split('|');
              const rawTarget = parts[0].trim();
              if (isImagePath(rawTarget)) {
                const resolved = resolveVaultImagePath(rawTarget);
                if (!imageBlobUrlCache.has(resolved) && !imageBlobUrlCache.has(rawTarget)) {
                  resolveImageBlobUrl(rawTarget); // fire-and-forget prefetch
                }
              }
            }
            MD_IMAGE_REGEX.lastIndex = 0;
            while ((m = MD_IMAGE_REGEX.exec(text)) !== null) {
              const targetUrl = m[2].trim();
              if (isImagePath(targetUrl) && !/^(https?:|data:|blob:)/i.test(targetUrl)) {
                const resolved = resolveVaultImagePath(targetUrl);
                if (!imageBlobUrlCache.has(resolved) && !imageBlobUrlCache.has(targetUrl)) {
                  resolveImageBlobUrl(targetUrl);
                }
              }
            }
            pos = line.to + 1;
          }
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
                  options?.onOpenInNewTab,
                  options?.onZoomImage
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
                  options?.onOpenInNewTab,
                  options?.onZoomImage
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
 * Saves a clipboard image into the root of the active vault using Obsidian's
 * naming convention (`Pasted Image YYYYMMDDHHmmss.png`).
 *
 * Returns the created file name, or null when it could not be stored.
 * Shared by the editor (paste) and by the Canvas (paste onto the canvas).
 */
export async function saveClipboardImageToVault(file: File): Promise<string | null> {
  try {
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

    // Destination follows Settings → Files and links → "Default location for new attachments"
    const separator = activeVault.includes('\\') ? '\\' : '/';
    const targetDir = resolveAttachmentDir(activeVault, useVaultStore.getState().activeFile);
    const rutaDestino = `${targetDir}${separator}${nombreImagen}`;

    // Convert file to Uint8Array for writing
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Pre-cache immediate blob URL in memory so the image renders instantly
    const mime = file.type || getImageMimeType(nombreImagen);
    const memoryBlob = new Blob([uint8Array], { type: mime });
    const memoryUrl = URL.createObjectURL(memoryBlob);
    imageBlobUrlCache.set(rutaDestino, memoryUrl);
    imageBlobUrlCache.set(nombreImagen, memoryUrl);

    // Save physically to disk using storageAdapter (raw bytes over IPC, no JSON)
    const adapter = getStorageAdapter();
    await adapter.writeBinary(rutaDestino, uint8Array);
    console.log('[Urano] Imagen guardada físicamente en disco:', rutaDestino);

    // Refresh the explorer in the background: a full vault listing must never block the UI
    refreshTree().catch((err) => console.warn('[Urano] refreshTree tras pegado falló:', err));

    return nombreImagen;
  } catch (err) {
    console.error('[Urano] Error guardando la imagen del portapapeles:', err);
    useNoticeStore
      .getState()
      .showNotice(t('imageEmbed.notices.pasteSaveFailed'), 3000, 'error');
    return null;
  }
}

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
  if (nowMs - lastPastedTimestamp < 300) {
    console.log('[Urano] Pegado de imagen ignorado por debounce');
    return null;
  }
  lastPastedTimestamp = nowMs;

  try {
    console.log('[Urano] Imagen detectada en portapapeles, procesando...', file.name);

    const nombreImagen = await saveClipboardImageToVault(file);
    if (!nombreImagen) return null;

    // Insert \n![[Pasted Image YYYYMMDDHHmmss.png]]\n at the exact cursor position right away
    const link = `\n![[${nombreImagen}]]\n`;
    const fromPos = view.state.selection.main.from;
    view.dispatch({
      changes: { from: fromPos, insert: link },
      selection: { anchor: fromPos + link.length },
    });

    useNoticeStore
      .getState()
      .showNotice(t('imageEmbed.notices.saved', { name: nombreImagen }), 2500, 'success');

    return nombreImagen;
  } catch (err) {
    console.error('[Urano] Error procesando pegado de imagen:', err);
    useNoticeStore
      .getState()
      .showNotice(t('imageEmbed.notices.pasteSaveFailed'), 3000, 'error');
    return null;
  }
}

/**
 * Unified Paste and Drag & Drop Event Handlers for CodeMirror 6
 */
export function createImageDropPasteHandler() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      let file: File | null = null;

      const items = data?.items;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            file = item.getAsFile();
            if (file) break;
          }
        }
      }

      if (!file && data?.files && data.files.length > 0) {
        for (let i = 0; i < data.files.length; i++) {
          const f = data.files[i];
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

      // Plain text paste: let CodeMirror handle it. The native clipboard is NOT consulted
      // here, so text pasting never pays for an OS clipboard round-trip.
      const plainText = data?.getData('text/plain') ?? '';
      const html = data?.getData('text/html') ?? '';
      const htmlHasImage = /<img\b/i.test(html);
      if (plainText.length > 0 && !htmlHasImage) {
        return false;
      }

      // No usable text (WebKitGTK often exposes no image items for screenshots) or HTML
      // embedding an image: ask the OS clipboard for raw PNG bytes via Rust.
      event.preventDefault();
      const pasteInterceptedText = () => {
        if (!plainText) return;
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: plainText },
          selection: { anchor: sel.from + plainText.length },
        });
      };

      invoke<ArrayBuffer | number[] | null>('read_clipboard_image')
        .then(async (raw) => {
          const nativeBytes = toUint8Array(raw);
          if (nativeBytes && nativeBytes.length > 0) {
            console.log('[Urano] Imagen obtenida de portapapeles nativo en evento paste');
            const nativeFile = new File([nativeBytes], 'pasted_image.png', { type: 'image/png' });
            await procesarPegadoDeImagen(nativeFile, view);
          } else {
            pasteInterceptedText();
          }
        })
        .catch(pasteInterceptedText);

      return true;
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
        const targetDir = resolveAttachmentDir(activeVault, useVaultStore.getState().activeFile);

        Promise.all(
          imageFiles.map(async (file) => {
            const fullPath = `${targetDir}${separator}${file.name}`;
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
                t('imageEmbed.notices.addedCount', { count: savedNames.length }),
                2500,
                'success'
              );
          })
          .catch((err) => {
            console.error('[Urano] Error guardando imagen soltada:', err);
            useNoticeStore
              .getState()
              .showNotice(t('imageEmbed.notices.dropSaveFailed'), 3000, 'error');
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
            .showNotice(t('imageEmbed.notices.added', { name: fileName }), 2000, 'success');
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
