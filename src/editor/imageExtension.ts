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
import { useSettingsStore, resolveAttachmentDir } from '../stores/settingsStore';
import { useNoticeStore } from '../components/common/Notice';
import { t } from '../locales/i18n';
import { FileItem } from '../types';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import {
  getFencedCodeLineSet,
  getInlineCodeRangesInLine,
  isRangeOverlapping,
} from './codeRangeUtils';
import {
  normalizePath,
  resolveVaultLinkTarget,
  parseLinkTargetParts,
} from '../utils/pathUtils';

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

// Regex matching Urano Wikilink embed: ![[filename.png]] or ![[filename.png|300]]
const WIKILINK_IMAGE_REGEX = /!\[\[([^\]]+)\]\]/g;

// Regex matching standard Markdown image: ![alt|300](https://... or path)
const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Global cache of resolved image Object URLs to prevent flicker on CM6 rebuilds
 */
export const imageBlobUrlCache = new Map<string, string>();
const pendingSavedAttachmentPaths = new Map<string, string>();

function getCanonicalCacheKey(filePath: string): string {
  if (/^(https?:|blob:|data:|asset:)/i.test(filePath)) {
    return filePath;
  }
  return normalizePath(filePath).toLowerCase();
}

/**
 * Looks up a cached URL strictly by canonical resolved path or explicit external URL
 * (never by unscoped bare filename, avoiding cross-folder / cross-vault collisions).
 */
export function getCachedImageUrl(
  resolvedPath?: string | null,
  rawTarget?: string | null
): string | null {
  if (rawTarget && /^(https?:|blob:|data:|asset:)/i.test(rawTarget)) {
    return rawTarget;
  }
  if (resolvedPath) {
    const byCanon = imageBlobUrlCache.get(getCanonicalCacheKey(resolvedPath));
    if (byCanon) return byCanon;
    const byExact = imageBlobUrlCache.get(resolvedPath);
    if (byExact) return byExact;
  }
  return null;
}

function cacheImageUrl(resolvedPath: string, url: string): void {
  if (!resolvedPath || !url) return;
  imageBlobUrlCache.set(getCanonicalCacheKey(resolvedPath), url);
  imageBlobUrlCache.set(resolvedPath, url);
}

/**
 * Revokes all cached ObjectURLs and clears in-memory image caches plus the
 * underlying StorageAdapter cache. Should be called when switching or closing vaults.
 */
export function clearImageBlobUrlCache(): void {
  const revoked = new Set<string>();
  for (const url of imageBlobUrlCache.values()) {
    if (url.startsWith('blob:') && !revoked.has(url)) {
      revoked.add(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore in non-DOM environments
      }
    }
  }
  imageBlobUrlCache.clear();
  pendingSavedAttachmentPaths.clear();
  try {
    getStorageAdapter().clearCache?.();
  } catch {
    // Ignore if adapter is unavailable
  }
}

/**
 * Re-keys the image cache when a file is renamed so CodeMirror 6 widgets and
 * ImageView display the image under its new name instantly, without flicker.
 *
 * `blob:`/`data:` URLs are still valid after the rename, so they are carried over.
 * `asset://` URLs embed the old path (which no longer exists on disk), so the new
 * keys get a fresh `convertFileSrc(newPath)` instead.
 */
export function renameImageInCache(oldPath: string, newPath: string): void {
  const normOld = normalizePath(oldPath);
  const normNew = normalizePath(newPath);
  const canonOld = getCanonicalCacheKey(oldPath);
  const oldFileName = normOld.split('/').pop() || '';
  const newFileName = normNew.split('/').pop() || '';
  if (!isImagePath(newFileName) && !isImagePath(oldFileName)) return;

  const cachedUrl =
    imageBlobUrlCache.get(canonOld) ||
    imageBlobUrlCache.get(oldPath) ||
    imageBlobUrlCache.get(normOld);

  imageBlobUrlCache.delete(canonOld);
  imageBlobUrlCache.delete(oldPath);
  imageBlobUrlCache.delete(normOld);
  pendingSavedAttachmentPaths.delete(canonOld);

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
    cacheImageUrl(newPath, newUrl);
    if (normNew !== newPath) {
      imageBlobUrlCache.set(normNew, newUrl);
    }
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
  const effectivePath = resolvedFilePath || resolveVaultImagePath(targetPathOrUrl);
  const cached = getCachedImageUrl(effectivePath, targetPathOrUrl);
  if (cached) return cached;

  if (effectivePath && !/^(https?:|blob:|data:|asset:)/i.test(effectivePath)) {
    try {
      const assetUrl = convertFileSrc(effectivePath);
      if (assetUrl) {
        cacheImageUrl(effectivePath, assetUrl);
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
  if (!rawTarget) return '';
  if (/^(https?:|blob:|data:|asset:)/i.test(rawTarget)) {
    return rawTarget;
  }

  const { fileTree, files, activeVault } = useVaultStore.getState();
  const combinedItems = files.length > 0 ? [...fileTree, ...files] : fileTree;
  const resolvedFromVault = resolveVaultLinkTarget(rawTarget, combinedItems, activeVault);
  if (resolvedFromVault) {
    return resolvedFromVault;
  }

  const cleanParsed = parseLinkTargetParts(rawTarget).targetPath || rawTarget.split('|')[0].trim();
  const cleanRel = cleanParsed.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const lowerCleanRel = normalizePath(cleanRel).toLowerCase();

  // Resolve freshly pasted/dropped files scoped to the active vault before refreshTree finishes
  if (pendingSavedAttachmentPaths.size > 0 && lowerCleanRel) {
    const normVaultPrefix = activeVault ? `${normalizePath(activeVault).toLowerCase()}/` : '';
    const hasDir = lowerCleanRel.includes('/');
    for (const [canonPending, fullPending] of pendingSavedAttachmentPaths) {
      if (normVaultPrefix && !canonPending.startsWith(normVaultPrefix)) continue;
      if (hasDir) {
        if (
          canonPending === `${normVaultPrefix}${lowerCleanRel}` ||
          canonPending.endsWith(`/${lowerCleanRel}`)
        ) {
          return fullPending;
        }
      } else {
        const pendingBase = canonPending.split('/').pop() || '';
        if (pendingBase === lowerCleanRel) {
          return fullPending;
        }
      }
    }
  }

  const normClean = normalizePath(cleanParsed);
  if (/^[a-zA-Z]:\//.test(normClean) || normClean.startsWith('/')) {
    return activeVault?.includes('\\') ? normClean.replace(/\//g, '\\') : normClean;
  }

  if (activeVault) {
    const separator = activeVault.includes('\\') ? '\\' : '/';
    const cleanVault = activeVault.endsWith(separator) ? activeVault.slice(0, -1) : activeVault;
    const relJoined = cleanRel.replace(/[\\/]+/g, separator);
    return relJoined ? `${cleanVault}${separator}${relJoined}` : cleanVault;
  }

  return cleanParsed;
}

/**
 * Loads image binary bytes using StorageAdapter (same mechanism as ImageView)
 * and creates a cached Blob URL.
 */
export async function resolveImageBlobUrl(rawPathOrName: string): Promise<string> {
  if (!rawPathOrName) return '';
  if (/^(https?:|blob:|data:|asset:)/i.test(rawPathOrName)) {
    return rawPathOrName;
  }

  // 1. Separate filename from dimensions if any pipe remains
  const rawTarget = rawPathOrName.split('|')[0].trim();

  // 2. Resolve real absolute path in vault
  const absolutePath = resolveVaultImagePath(rawTarget);

  // Check memory cache first (never by unscoped bare filename)
  const existing = getCachedImageUrl(absolutePath, rawTarget);
  if (existing) {
    return existing;
  }

  // 3. Fast Tauri Asset Protocol conversion: streams directly from disk via Rust with 0ms IPC overhead
  try {
    const assetUrl = convertFileSrc(absolutePath);
    if (assetUrl) {
      cacheImageUrl(absolutePath, assetUrl);
      return assetUrl;
    }
  } catch (err) {
    console.warn('[Urano] convertFileSrc fallback to readBinary:', err);
  }

  // 4. Fallback: Read binary via StorageAdapter
  try {
    const blob = await getStorageAdapter().readBinary(absolutePath);
    const blobUrl = URL.createObjectURL(blob);
    cacheImageUrl(absolutePath, blobUrl);
    return blobUrl;
  } catch (err) {
    console.error(`[Urano] Error cargando binario de imagen para "${absolutePath}":`, err);
    return '';
  }
}

/**
 * Loads an image Blob uniformly for both remote URLs (`https://`, `blob:`, `data:`)
 * and vault-local files (via StorageAdapter or asset fallback).
 */
export async function loadImageBlobFromSource(
  src?: string | null,
  filePath?: string | null
): Promise<Blob> {
  const trimmedSrc = (src || '').trim();
  const trimmedPath = (filePath || '').trim();

  if (/^(https?:|blob:|data:)/i.test(trimmedSrc)) {
    const res = await fetch(trimmedSrc);
    if (!res.ok) {
      throw new Error(`Failed to fetch image (${res.status})`);
    }
    return await res.blob();
  }

  if (trimmedPath && !/^(https?:|blob:|data:|asset:)/i.test(trimmedPath)) {
    return await getStorageAdapter().readBinary(trimmedPath);
  }

  if (trimmedSrc) {
    const res = await fetch(trimmedSrc);
    if (!res.ok) {
      throw new Error(`Failed to fetch image (${res.status})`);
    }
    return await res.blob();
  }

  throw new Error('No image source or file path available');
}

/**
 * Helper to copy image blob to system clipboard as image/png
 */
export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  let pngBlob = blob;
  if (blob.type !== 'image/png') {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    try {
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

      const converted = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/png')
      );
      if (converted) pngBlob = converted;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': pngBlob }),
  ]);
}

/**
 * Computes a collision-free filename inside `targetDir` against `existingItems`
 * and any `reservedNames` already allocated in the current batch.
 */
export function getUniqueAttachmentName(
  targetDir: string,
  desiredFileName: string,
  existingItems: FileItem[],
  reservedNames?: Set<string>
): string {
  const cleanDesired = desiredFileName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'image.png';
  const dotIdx = cleanDesired.lastIndexOf('.');
  const baseName = dotIdx > 0 ? cleanDesired.slice(0, dotIdx) : cleanDesired;
  const ext = dotIdx > 0 ? cleanDesired.slice(dotIdx) : '';

  const normTargetDir = normalizePath(targetDir).toLowerCase();
  const existingLower = new Set<string>();
  if (reservedNames) {
    for (const name of reservedNames) existingLower.add(name.toLowerCase());
  }

  const walk = (items: FileItem[]) => {
    for (const item of items) {
      if (!item.isDir) {
        const normItem = normalizePath(item.path);
        const lastSlash = normItem.lastIndexOf('/');
        const itemDir = (lastSlash >= 0 ? normItem.slice(0, lastSlash) : '').toLowerCase();
        if (itemDir === normTargetDir) {
          existingLower.add(item.name.toLowerCase());
        }
      }
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(existingItems || []);

  let candidate = cleanDesired;
  let counter = 1;
  while (existingLower.has(candidate.toLowerCase())) {
    candidate = `${baseName} ${counter}${ext}`;
    counter++;
  }
  reservedNames?.add(candidate.toLowerCase());
  return candidate;
}

function allocateUniqueAttachmentTarget(
  targetDir: string,
  desiredFileName: string,
  separator: string,
  batchReserved?: Set<string>
): { fileName: string; fullPath: string } {
  const { fileTree, files } = useVaultStore.getState();
  const normTargetDir = normalizePath(targetDir).toLowerCase();
  const combinedReserved = new Set<string>(batchReserved || []);

  for (const [canonPending, fullPending] of pendingSavedAttachmentPaths) {
    const lastSlash = canonPending.lastIndexOf('/');
    const pendingDir = lastSlash >= 0 ? canonPending.slice(0, lastSlash) : '';
    if (pendingDir === normTargetDir) {
      const pendingName = normalizePath(fullPending).split('/').pop() || '';
      if (pendingName) combinedReserved.add(pendingName.toLowerCase());
    }
  }

  const existingItems = files.length > 0 ? [...fileTree, ...files] : fileTree;
  const fileName = getUniqueAttachmentName(
    targetDir,
    desiredFileName,
    existingItems,
    combinedReserved
  );
  batchReserved?.add(fileName.toLowerCase());

  const cleanDir = targetDir.endsWith(separator) ? targetDir.slice(0, -1) : targetDir;
  const fullPath = `${cleanDir}${separator}${fileName}`;
  pendingSavedAttachmentPaths.set(getCanonicalCacheKey(fullPath), fullPath);
  return { fileName, fullPath };
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

    // Synchronously check cache / convert via Tauri asset protocol (0ms)
    const targetKey = resolvedFilePath || targetPathOrUrl;
    const cachedUrl = getSyncImageUrl(targetPathOrUrl, resolvedFilePath);

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
     * Hover action bar (top-right corner) — Urano `.embed-actions`
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
      // Ctrl/Cmd + click opens the file in a new leaf (Urano behaviour)
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
  /** Opens the full-screen lightbox for the embed (Urano `showImage`). */
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
        const codeLines = getFencedCodeLineSet(doc);
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to && pos <= doc.length) {
            const line = doc.lineAt(pos);
            if (codeLines.has(line.number)) {
              pos = line.to + 1;
              continue;
            }
            const text = line.text;
            const inlineCodeRanges = getInlineCodeRangesInLine(text, line.from);
            // Quick scan for image patterns
            WIKILINK_IMAGE_REGEX.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = WIKILINK_IMAGE_REGEX.exec(text)) !== null) {
              const start = line.from + m.index;
              const end = start + m[0].length;
              if (isRangeOverlapping(start, end, inlineCodeRanges)) continue;
              const parts = m[1].trim().split('|');
              const rawTarget = parts[0].trim();
              if (isImagePath(rawTarget)) {
                const resolved = resolveVaultImagePath(rawTarget);
                if (!getCachedImageUrl(resolved, rawTarget)) {
                  resolveImageBlobUrl(rawTarget); // fire-and-forget prefetch
                }
              }
            }
            MD_IMAGE_REGEX.lastIndex = 0;
            while ((m = MD_IMAGE_REGEX.exec(text)) !== null) {
              const start = line.from + m.index;
              const end = start + m[0].length;
              if (isRangeOverlapping(start, end, inlineCodeRanges)) continue;
              const targetUrl = m[2].trim();
              if (isImagePath(targetUrl) && !/^(https?:|data:|blob:)/i.test(targetUrl)) {
                const resolved = resolveVaultImagePath(targetUrl);
                if (!getCachedImageUrl(resolved, targetUrl)) {
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
        const codeLines = getFencedCodeLineSet(doc);

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
            const inlineCodeRanges = getInlineCodeRangesInLine(text, line.from);

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
                const start = line.from + wikiMatch.index;
                const end = start + fullMatch.length;
                if (isRangeOverlapping(start, end, inlineCodeRanges)) continue;

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
                const start = line.from + mdMatch.index;
                const end = start + fullMatch.length;
                if (isRangeOverlapping(start, end, inlineCodeRanges)) continue;

                const { width, height, alt } = parseImageEmbed(altOrDim);
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
 * Saves a clipboard image into the root of the active vault using Urano's
 * naming convention (`Pasted Image YYYYMMDDHHmmss.png`).
 *
 * Returns the created file name, or null when it could not be stored.
 * Shared by the editor (paste) and by the Canvas (paste onto the canvas).
 */
export async function saveClipboardImageToVault(file: File): Promise<string | null> {
  try {
    // Exact Urano naming convention: Pasted Image YYYYMMDDHHmmss.png
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

    const desiredName = `Pasted Image ${timestamp}.${ext}`;
    const { activeVault, refreshTree } = useVaultStore.getState();

    if (!activeVault) {
      console.error('[Urano] No hay un directorio de vault activo para guardar la imagen');
      return null;
    }

    // Destination follows Settings → Files and links → "Default location for new attachments"
    const separator = activeVault.includes('\\') ? '\\' : '/';
    const targetDir = resolveAttachmentDir(activeVault, useVaultStore.getState().activeFile);
    const { fileName: nombreImagen, fullPath: rutaDestino } = allocateUniqueAttachmentTarget(
      targetDir,
      desiredName,
      separator
    );
    const canonDestinoKey = getCanonicalCacheKey(rutaDestino);

    let memoryUrl = '';
    try {
      // Convert file to Uint8Array for writing
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Pre-cache immediate blob URL in memory under canonical path so the image renders instantly
      const mime = file.type || getImageMimeType(nombreImagen);
      const memoryBlob = new Blob([uint8Array], { type: mime });
      memoryUrl = URL.createObjectURL(memoryBlob);
      cacheImageUrl(rutaDestino, memoryUrl);

      // Save physically to disk using storageAdapter (raw bytes over IPC, no JSON)
      const adapter = getStorageAdapter();
      await adapter.writeBinary(rutaDestino, uint8Array);
      console.log('[Urano] Imagen guardada físicamente en disco:', rutaDestino);

      // Refresh the explorer in the background: a full vault listing must never block the UI
      refreshTree()
        .catch((err) => console.warn('[Urano] refreshTree tras pegado falló:', err))
        .finally(() => {
          pendingSavedAttachmentPaths.delete(canonDestinoKey);
        });

      return nombreImagen;
    } catch (writeErr) {
      pendingSavedAttachmentPaths.delete(canonDestinoKey);
      imageBlobUrlCache.delete(canonDestinoKey);
      imageBlobUrlCache.delete(rutaDestino);
      if (memoryUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(memoryUrl); } catch {}
      }
      throw writeErr;
    }
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

    // Insert link at the exact cursor position right away (Wikilink or standard Markdown)
    const useWiki = useSettingsStore.getState().settings.useWikilinks;
    const link = useWiki ? `\n![[${nombreImagen}]]\n` : `\n![${nombreImagen}](${nombreImagen})\n`;
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
        const batchReserved = new Set<string>();
        const pendingKeys: string[] = [];

        Promise.all(
          imageFiles.map(async (file) => {
            const { fileName: savedName, fullPath } = allocateUniqueAttachmentTarget(
              targetDir,
              file.name,
              separator,
              batchReserved
            );
            const canonKey = getCanonicalCacheKey(fullPath);
            pendingKeys.push(canonKey);

            let bUrl = '';
            try {
              const arrayBuffer = await file.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              // Pre-cache canonical blob url without bare filename collisions
              const mime = file.type || getImageMimeType(savedName);
              const blob = new Blob([uint8Array], { type: mime });
              bUrl = URL.createObjectURL(blob);
              cacheImageUrl(fullPath, bUrl);

              await getStorageAdapter().writeBinary(fullPath, uint8Array);
              return savedName;
            } catch (err) {
              pendingSavedAttachmentPaths.delete(canonKey);
              imageBlobUrlCache.delete(canonKey);
              imageBlobUrlCache.delete(fullPath);
              if (bUrl.startsWith('blob:')) {
                try { URL.revokeObjectURL(bUrl); } catch {}
              }
              throw err;
            }
          })
        )
          .then(async (savedNames) => {
            try {
              await refreshTree();
            } finally {
              for (const key of pendingKeys) {
                pendingSavedAttachmentPaths.delete(key);
              }
            }
            const useWiki = useSettingsStore.getState().settings.useWikilinks;
            const insertText =
              '\n' +
              savedNames
                .map((n) => (useWiki ? `![[${n}]]` : `![${n}](${n})`))
                .join('\n') +
              '\n';
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

          const useWiki = useSettingsStore.getState().settings.useWikilinks;
          const insertText = useWiki
            ? `\n![[${fileName}]]\n`
            : `\n![${fileName}](${fileName})\n`;
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

          const useWiki = useSettingsStore.getState().settings.useWikilinks;
          const insertText = useWiki ? `[[${cleanName}]]` : `[${cleanName}](${fileName})`;
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
