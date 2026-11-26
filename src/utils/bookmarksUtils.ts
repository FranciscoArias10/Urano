import { invoke } from '@tauri-apps/api/core';
import { BookmarkItem } from '../types';
import { isImagePath } from '../services/storageAdapter';
import { normalizePath } from './pathUtils';

export const URANO_BOOKMARKS_STORAGE_PREFIX = 'urano_bookmarks_';
export const LEGACY_GLOBAL_BOOKMARKS_KEY = 'urano_bookmarks';
export const URANO_REVEAL_FOLDER_EVENT = 'urano:reveal-folder';

const STRIP_NOTE_EXT_RE = /\.(md|markdown|canvas|base)$/i;

export function getVaultBookmarksStorageKey(vaultPath: string | null | undefined): string {
  if (!vaultPath) return '';
  const norm = normalizePath(vaultPath).replace(/\/+$/, '').toLowerCase();
  return norm ? `${URANO_BOOKMARKS_STORAGE_PREFIX}${norm}` : '';
}

export function normalizeSearchBookmarkQuery(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw.replace(/^search:/i, '').trim();
}

export function getDefaultBookmarkTitle(
  itemPath: string,
  type: BookmarkItem['type'],
  query?: string
): string {
  if (type === 'search') {
    return normalizeSearchBookmarkQuery(query ?? itemPath) || 'Search';
  }
  const norm = normalizePath(itemPath);
  const base = norm.substring(norm.lastIndexOf('/') + 1) || norm;
  if (type === 'folder' || isImagePath(base)) {
    return base;
  }
  return base.replace(STRIP_NOTE_EXT_RE, '') || base;
}

export function resolveBookmarkFullPath(
  rawPath: string,
  type: BookmarkItem['type'],
  vaultPath: string | null | undefined,
  query?: string
): string {
  if (type === 'search') {
    const q = normalizeSearchBookmarkQuery(query ?? rawPath);
    return q ? `search:${q}` : '';
  }

  const normPath = normalizePath(rawPath).replace(/^(\.\/)+/, '');
  if (!normPath) return '';
  if (!vaultPath) return normPath;

  const normVault = normalizePath(vaultPath).replace(/\/+$/, '');
  const lowerPath = normPath.toLowerCase();
  const lowerVault = normVault.toLowerCase();

  if (lowerPath === lowerVault || lowerPath.startsWith(`${lowerVault}/`)) {
    return normPath;
  }

  // Absolute path belonging to a different vault/root: keep as-is so vault-boundary check can reject it
  if (/^[a-zA-Z]:\//.test(normPath) || normPath.startsWith('/')) {
    return normPath;
  }

  return `${normVault}/${normPath}`.replace(/\/+/g, '/');
}

export function toRelativeVaultBookmarkPath(
  fullPath: string,
  vaultPath: string | null | undefined
): string {
  const normFull = normalizePath(fullPath);
  if (!vaultPath) return normFull;
  const normVault = normalizePath(vaultPath).replace(/\/+$/, '');
  const lowerFull = normFull.toLowerCase();
  const lowerVault = normVault.toLowerCase();

  if (normVault && lowerFull.startsWith(`${lowerVault}/`)) {
    return normFull.slice(normVault.length + 1);
  }
  return normFull;
}

export function isPathStrictlyInsideVault(filePath: string, vaultPath: string): boolean {
  const normFile = normalizePath(filePath).toLowerCase();
  const normVault = normalizePath(vaultPath).replace(/\/+$/, '').toLowerCase();
  if (!normFile || !normVault) return false;
  return normFile.startsWith(`${normVault}/`);
}

export function isSameBookmarkTarget(
  a: Pick<BookmarkItem, 'type' | 'path' | 'query'>,
  b: { type?: BookmarkItem['type']; path: string; query?: string }
): boolean {
  if (b.type && a.type !== b.type) {
    return false;
  }
  if (a.type === 'search' || b.type === 'search') {
    if (a.type !== 'search') return false;
    const qa = normalizeSearchBookmarkQuery(a.query ?? a.path);
    const qb = normalizeSearchBookmarkQuery(b.query ?? b.path);
    return Boolean(qa) && qa === qb;
  }
  const normA = normalizePath(a.path).toLowerCase();
  const normB = normalizePath(b.path).toLowerCase();
  return Boolean(normA) && normA === normB;
}

export function deduplicateBookmarks(items: BookmarkItem[]): BookmarkItem[] {
  const result: BookmarkItem[] = [];
  for (const item of items) {
    if (!result.some((existing) => isSameBookmarkTarget(existing, item))) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Safely parses raw JSON (`{ items: [...] }` or `[...]`) into validated `BookmarkItem[]`.
 * Never throws on malformed JSON or unexpected payloads.
 */
export function parseBookmarksJsonSafe(
  raw: string | null | undefined,
  vaultPath: string | null | undefined,
  options?: { requireInsideVault?: boolean }
): BookmarkItem[] {
  if (!raw || typeof raw !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
    ? ((parsed as { items: unknown[] }).items)
    : [];

  const sanitized: BookmarkItem[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const entry = rawList[i];
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const rawType = rec.type;
    if (rawType !== 'file' && rawType !== 'folder' && rawType !== 'search') continue;

    const rawQuery = typeof rec.query === 'string' ? rec.query : undefined;
    const rawPath = typeof rec.path === 'string' ? rec.path : rawQuery ? `search:${rawQuery}` : '';
    const fullPath = resolveBookmarkFullPath(rawPath, rawType, vaultPath, rawQuery);
    if (!fullPath) continue;

    if (options?.requireInsideVault) {
      if (rawType === 'search' || !vaultPath || !isPathStrictlyInsideVault(fullPath, vaultPath)) {
        continue;
      }
    } else if (
      vaultPath &&
      rawType !== 'search' &&
      (/^[a-zA-Z]:\//.test(fullPath) || fullPath.startsWith('/')) &&
      !isPathStrictlyInsideVault(fullPath, vaultPath)
    ) {
      continue;
    }

    const cleanQuery =
      rawType === 'search' ? normalizeSearchBookmarkQuery(rawQuery ?? fullPath) : undefined;
    if (rawType === 'search' && !cleanQuery) continue;

    const title =
      typeof rec.title === 'string' && rec.title.trim()
        ? rec.title.trim()
        : getDefaultBookmarkTitle(fullPath, rawType, cleanQuery);

    const createdAt = typeof rec.createdAt === 'number' ? rec.createdAt : Date.now();
    const id =
      typeof rec.id === 'string' && rec.id.trim()
        ? rec.id
        : `${rawType}-${fullPath}-${createdAt}-${i}`;

    sanitized.push({
      id,
      type: rawType,
      path: fullPath,
      title,
      ...(cleanQuery !== undefined ? { query: cleanQuery } : {}),
      createdAt,
    });
  }

  return deduplicateBookmarks(sanitized);
}

export function serializeBookmarksForDisk(
  bookmarks: BookmarkItem[],
  vaultPath: string | null | undefined
): string {
  const items = bookmarks.map((b) => {
    if (b.type === 'search') {
      const q = normalizeSearchBookmarkQuery(b.query ?? b.path);
      return {
        id: b.id,
        type: 'search' as const,
        path: `search:${q}`,
        query: q,
        title: b.title || q,
        createdAt: b.createdAt ?? Date.now(),
      };
    }
    return {
      id: b.id,
      type: b.type,
      path: toRelativeVaultBookmarkPath(b.path, vaultPath),
      title: b.title,
      createdAt: b.createdAt ?? Date.now(),
    };
  });
  return JSON.stringify({ items }, null, 2);
}

export function readVaultBookmarksFromLocalStorage(
  vaultPath: string | null | undefined
): BookmarkItem[] {
  if (!vaultPath) return [];
  try {
    if (typeof localStorage === 'undefined') return [];
    const key = getVaultBookmarksStorageKey(vaultPath);
    if (!key) return [];
    const scopedRaw = localStorage.getItem(key);
    if (scopedRaw !== null) {
      return parseBookmarksJsonSafe(scopedRaw, vaultPath);
    }
    // One-time migration from legacy global key, strictly filtered to paths inside this vault
    const legacyRaw = localStorage.getItem(LEGACY_GLOBAL_BOOKMARKS_KEY);
    if (legacyRaw) {
      const migrated = parseBookmarksJsonSafe(legacyRaw, vaultPath, {
        requireInsideVault: true,
      });
      localStorage.setItem(key, serializeBookmarksForDisk(migrated, vaultPath));
      return migrated;
    }
  } catch {
    // Ignore storage read/parse failures
  }
  return [];
}

export function writeVaultBookmarksToLocalStorage(
  vaultPath: string | null | undefined,
  bookmarks: BookmarkItem[]
): void {
  if (!vaultPath) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const key = getVaultBookmarksStorageKey(vaultPath);
    if (!key) return;
    localStorage.setItem(key, serializeBookmarksForDisk(bookmarks, vaultPath));
  } catch {
    // Ignore storage quota/access errors
  }
}

export function resolveVaultBookmarksFilePath(
  vaultPath: string,
  configFolderOverride?: string
): string {
  const rawCfg = (configFolderOverride || '.urano').trim();
  const cfgName = !rawCfg
    ? '.urano'
    : rawCfg.startsWith('.')
    ? rawCfg
    : `.${rawCfg}`;
  const cleanVault = normalizePath(vaultPath).replace(/\/+$/, '');
  return `${cleanVault}/${cfgName}/bookmarks.json`;
}

export async function loadVaultBookmarks(
  vaultPath: string | null | undefined,
  configFolderOverride?: string
): Promise<BookmarkItem[]> {
  if (!vaultPath) return [];
  const filePath = resolveVaultBookmarksFilePath(vaultPath, configFolderOverride);
  try {
    const diskRaw = await invoke<string>('read_file', { filePath });
    if (typeof diskRaw === 'string' && diskRaw.trim()) {
      const parsed = parseBookmarksJsonSafe(diskRaw, vaultPath);
      writeVaultBookmarksToLocalStorage(vaultPath, parsed);
      return parsed;
    }
  } catch {
    // `.urano/bookmarks.json` may not exist yet; fall back to per-vault localStorage / legacy migration
  }

  const fallback = readVaultBookmarksFromLocalStorage(vaultPath);
  if (fallback.length > 0) {
    void persistVaultBookmarks(vaultPath, fallback, configFolderOverride);
  }
  return fallback;
}

export async function persistVaultBookmarks(
  vaultPath: string | null | undefined,
  bookmarks: BookmarkItem[],
  configFolderOverride?: string
): Promise<void> {
  if (!vaultPath) return;
  writeVaultBookmarksToLocalStorage(vaultPath, bookmarks);
  const filePath = resolveVaultBookmarksFilePath(vaultPath, configFolderOverride);
  const serialized = serializeBookmarksForDisk(bookmarks, vaultPath);
  try {
    await invoke('write_file', { filePath, content: serialized });
  } catch {
    // Running in browser mock or read-only dir; localStorage mirror is already updated
  }
}

/**
 * Updates bookmarked file/folder paths (and default titles) when a file or folder is renamed or moved.
 */
export function remapBookmarksOnRename(
  bookmarks: BookmarkItem[],
  oldPath: string,
  newPath: string
): { bookmarks: BookmarkItem[]; changed: boolean } {
  if (!bookmarks.length || !oldPath || !newPath) {
    return { bookmarks, changed: false };
  }
  const normOld = normalizePath(oldPath);
  const normNew = normalizePath(newPath);
  const lowerOld = normOld.toLowerCase();
  if (!normOld || !normNew || lowerOld === normNew.toLowerCase()) {
    return { bookmarks, changed: false };
  }

  let changed = false;
  const oldRawName = normOld.substring(normOld.lastIndexOf('/') + 1) || normOld;
  const oldCleanName = oldRawName.replace(STRIP_NOTE_EXT_RE, '') || oldRawName;

  const mapped = bookmarks.map((b) => {
    if (b.type === 'search') return b;
    const normB = normalizePath(b.path);
    const lowerB = normB.toLowerCase();

    if (lowerB === lowerOld) {
      changed = true;
      const defaultNextTitle = getDefaultBookmarkTitle(normNew, b.type);
      const hadDefaultTitle =
        !b.title ||
        b.title.toLowerCase() === oldRawName.toLowerCase() ||
        b.title.toLowerCase() === oldCleanName.toLowerCase();
      return {
        ...b,
        path: normNew,
        title: hadDefaultTitle ? defaultNextTitle : b.title,
      };
    }

    if (lowerB.startsWith(`${lowerOld}/`)) {
      changed = true;
      const suffix = normB.slice(normOld.length);
      return {
        ...b,
        path: `${normNew}${suffix}`,
      };
    }

    return b;
  });

  if (!changed) {
    return { bookmarks, changed: false };
  }
  return { bookmarks: deduplicateBookmarks(mapped), changed: true };
}

/**
 * Removes any file/folder bookmarks matching `deletedPath` or nested inside `deletedPath/`.
 */
export function pruneBookmarksOnDelete(
  bookmarks: BookmarkItem[],
  deletedPath: string
): { bookmarks: BookmarkItem[]; changed: boolean } {
  if (!bookmarks.length || !deletedPath) {
    return { bookmarks, changed: false };
  }
  const lowerDeleted = normalizePath(deletedPath).toLowerCase();
  if (!lowerDeleted) {
    return { bookmarks, changed: false };
  }

  const filtered = bookmarks.filter((b) => {
    if (b.type === 'search') return true;
    const lowerB = normalizePath(b.path).toLowerCase();
    return lowerB !== lowerDeleted && !lowerB.startsWith(`${lowerDeleted}/`);
  });

  return {
    bookmarks: filtered,
    changed: filtered.length !== bookmarks.length,
  };
}

