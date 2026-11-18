import React from 'react';
import { FilePlus, FileText, LayoutDashboard, LayoutList } from 'lucide-react';
import type { FileItem } from '../../types';
import { getRelativeVaultPath, isPathExcluded, normalizePath } from '../../utils/pathUtils';
import { CommandPalette } from './CommandPalette';

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

export interface BuildQuickSwitcherEntriesParams {
  fileEntries: QuickSwitcherEntry[];
  unresolvedLinks: string[];
  showExistingOnly: boolean;
  query: string;
}

/**
 * Combines filtered vault file entries with unresolved `[[Target]]` wikilink
 * candidates when `showExistingOnly` is disabled.
 */
export function buildQuickSwitcherEntries({
  fileEntries,
  unresolvedLinks,
  showExistingOnly,
  query,
}: BuildQuickSwitcherEntriesParams): QuickSwitcherEntry[] {
  const q = query.trim().toLowerCase();
  const matchesFile = (f: QuickSwitcherEntry) =>
    !q ||
    f.basename.toLowerCase().includes(q) ||
    f.name.toLowerCase().includes(q) ||
    f.relPath.toLowerCase().includes(q) ||
    f.path.toLowerCase().includes(q);

  const matchedExisting = fileEntries.filter(matchesFile);
  if (showExistingOnly || unresolvedLinks.length === 0) {
    return matchedExisting;
  }

  const unresolvedEntries: QuickSwitcherEntry[] = [];
  for (const target of unresolvedLinks) {
    const base = target.split('/').pop() || target;
    if (q && !target.toLowerCase().includes(q) && !base.toLowerCase().includes(q)) {
      continue;
    }
    unresolvedEntries.push({
      key: `unresolved:${target.toLowerCase()}`,
      name: `${target}.md`,
      path: target,
      basename: base,
      ext: 'md',
      relPath: target,
      isUnresolved: true,
      isAttachment: false,
    });
  }

  return [...matchedExisting, ...unresolvedEntries];
}

export interface QuickSwitcherItemRowProps {
  entry: QuickSwitcherEntry;
  isSelected: boolean;
  unresolvedHint?: string;
  onSelect: () => void;
  onHover: () => void;
}

export const QuickSwitcherItemRow: React.FC<QuickSwitcherItemRowProps> = ({
  entry,
  isSelected,
  unresolvedHint,
  onSelect,
  onHover,
}) => {
  const isSubfolder = entry.relPath.includes('/');
  const isMarkdown = entry.ext === 'md' || entry.ext === 'markdown';
  const displayName = entry.isUnresolved
    ? entry.basename
    : isMarkdown
      ? (isSubfolder
          ? entry.relPath.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || entry.basename
          : entry.relPath.replace(/\.(md|markdown)$/i, '') || entry.basename)
      : entry.name;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`suggestion-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
        isSelected ? 'is-selected' : 'text-urano-text hover:bg-[var(--interactive-hover)]'
      }${entry.isUnresolved ? ' quick-switcher-item-unresolved' : ''}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {entry.isUnresolved ? (
          <FilePlus size={14} className="quick-switcher-unresolved-icon shrink-0" />
        ) : entry.ext === 'canvas' ? (
          <LayoutDashboard size={14} className="text-urano-muted shrink-0" />
        ) : entry.ext === 'base' ? (
          <LayoutList size={14} className="text-urano-muted shrink-0" />
        ) : (
          <FileText size={14} className="text-urano-muted shrink-0" />
        )}
        <span className="font-medium truncate">{displayName}</span>
      </div>

      <div className="quick-switcher-item-right">
        {isSubfolder && (
          <span className="text-[10px] text-urano-faint truncate max-w-[220px] font-mono">
            {entry.relPath}
          </span>
        )}
        {entry.isUnresolved && unresolvedHint && (
          <span className="text-[10px] text-urano-faint">{unresolvedHint}</span>
        )}
        {!entry.isUnresolved && entry.ext === 'canvas' && (
          <span className="nav-file-tag quick-switcher-ext-badge">CANVAS</span>
        )}
        {!entry.isUnresolved && entry.ext === 'base' && (
          <span className="nav-file-tag quick-switcher-ext-badge">BASE</span>
        )}
        {!entry.isUnresolved && entry.isAttachment && entry.ext && (
          <span className="nav-file-tag quick-switcher-ext-badge uppercase">
            {entry.ext.toUpperCase()}
          </span>
        )}
        {!entry.isUnresolved &&
          !isMarkdown &&
          entry.ext !== 'canvas' &&
          entry.ext !== 'base' &&
          !entry.isAttachment &&
          entry.ext && (
            <span className="nav-file-tag quick-switcher-ext-badge uppercase">
              {entry.ext.toUpperCase()}
            </span>
          )}
      </div>
    </div>
  );
};

export interface QuickSwitcherProps {
  isOpen: boolean;
  fileTree: FileItem[];
  onClose: () => void;
  onSelectFile: (filePath: string) => void;
  onOpenInNewTab?: (filePath: string) => void;
}

export const QuickSwitcher: React.FC<QuickSwitcherProps> = ({
  isOpen,
  fileTree,
  onClose,
  onSelectFile,
  onOpenInNewTab,
}) => (
  <CommandPalette
    isOpen={isOpen}
    mode="files"
    fileTree={fileTree}
    commands={[]}
    onClose={onClose}
    onSelectFile={onSelectFile}
    onOpenInNewTab={onOpenInNewTab}
  />
);
