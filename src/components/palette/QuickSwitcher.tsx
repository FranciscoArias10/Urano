import type { FileItem } from '../../types';
import { getRelativeVaultPath, isPathExcluded, normalizePath } from '../../utils/pathUtils';

export const QUICK_SWITCHER_DOC_EXTENSIONS = new Set([
  'md',
  'markdown',
  'canvas',
  'base',
]);

export const QUICK_SWITCHER_ATTACHMENT_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'mp4',
  'webm',
  'ogv',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'pdf',
]);

export interface QuickSwitcherEntry {
  key: string;
  name: string;
  path: string;
  basename: string;
  ext: string;
  relPath: string;
  isUnresolved: boolean;
  isAttachment: boolean;
}

export function isQuickSwitcherDocumentExt(ext: string): boolean {
  return QUICK_SWITCHER_DOC_EXTENSIONS.has(ext.toLowerCase());
}

export function isQuickSwitcherAttachmentExt(ext: string): boolean {
  return QUICK_SWITCHER_ATTACHMENT_EXTENSIONS.has(ext.toLowerCase());
}

export interface BuildQuickSwitcherFileEntriesParams {
  files: FileItem[];
  vaultPath: string;
  userIgnoreFilters: string[];
  showAttachments: boolean;
}

/**
 * Filters existing vault files for Quick Switcher (`Ctrl + O`), keeping `.md`,
 * `.canvas`, and `.base` documents always visible and including attachments only
 * when `showAttachments` is enabled.
 */
export function buildQuickSwitcherFileEntries({
  files,
  vaultPath,
  userIgnoreFilters,
  showAttachments,
}: BuildQuickSwitcherFileEntriesParams): QuickSwitcherEntry[] {
  const entries: QuickSwitcherEntry[] = [];
  const seen = new Set<string>();

  for (const item of files) {
    if (item.isDir) continue;
    if (isPathExcluded(item.path, userIgnoreFilters)) continue;

    const normKey = normalizePath(item.path).toLowerCase();
    if (seen.has(normKey)) continue;

    const lastDot = item.name.lastIndexOf('.');
    const ext = lastDot > 0 ? item.name.substring(lastDot + 1).toLowerCase() : '';
    const basename = lastDot > 0 ? item.name.substring(0, lastDot) : item.name;

    const isDoc = isQuickSwitcherDocumentExt(ext);
    const isAtt = isQuickSwitcherAttachmentExt(ext);
    if (!isDoc && !(showAttachments && isAtt)) {
      continue;
    }

    seen.add(normKey);
    const relPath = vaultPath
      ? getRelativeVaultPath(item.path, vaultPath)
      : normalizePath(item.path);

    entries.push({
      key: normalizePath(item.path),
      name: item.name,
      path: item.path,
      basename,
      ext,
      relPath,
      isUnresolved: false,
      isAttachment: isAtt,
    });
  }

  return entries;
}
