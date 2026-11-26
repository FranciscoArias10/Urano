import React, { useState } from 'react';
import { Bookmark, ExternalLink, FileText, Folder, FolderOpen, PlusCircle, Search, Trash2, X } from 'lucide-react';
import { BookmarkItem, FileItem } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';
import { useNoticeStore } from '../common/Notice';
import { UranoMenu, MenuItemData } from '../common/UranoMenu';
import { normalizePath } from '../../utils/pathUtils';
import {
  normalizeSearchBookmarkQuery,
  URANO_REVEAL_FOLDER_EVENT,
} from '../../utils/bookmarksUtils';

interface BookmarksPanelProps {
  onOpenFile?: (filePath: string) => void;
  onOpenInNewTab?: (filePath: string) => void;
  onRevealFolder?: (folderPath: string) => void;
  onOpenSearch?: (query: string) => void;
}

function findItemInTree(
  items: FileItem[],
  targetPath: string,
  expectDir: boolean
): FileItem | null {
  const lowerTarget = normalizePath(targetPath).toLowerCase();
  for (const it of items) {
    if (Boolean(it.isDir) === expectDir && normalizePath(it.path).toLowerCase() === lowerTarget) {
      return it;
    }
    if (it.children?.length) {
      const nested = findItemInTree(it.children, targetPath, expectDir);
      if (nested) return nested;
    }
  }
  return null;
}

export const BookmarksPanel: React.FC<BookmarksPanelProps> = ({
  onOpenFile,
  onOpenInNewTab,
  onRevealFolder,
  onOpenSearch,
}) => {
  const t = useT();
  const { bookmarks, removeBookmark, selectFile, fileTree, files } = useVaultStore();
  const { showNotice } = useNoticeStore();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  const triggerRevealInExplorer = (targetPath: string) => {
    if (onRevealFolder) {
      onRevealFolder(targetPath);
      return;
    }
    (window as any).__uranoPendingRevealFolder = targetPath;
    window.dispatchEvent(
      new CustomEvent(URANO_REVEAL_FOLDER_EVENT, { detail: { path: targetPath } })
    );
  };

  const triggerOpenSearch = (query: string) => {
    if (onOpenSearch) {
      onOpenSearch(query);
      return;
    }
    (window as any).__uranoInitialSearchQuery = query;
    window.dispatchEvent(new CustomEvent('urano-search', { detail: { query } }));
  };

  const resolveExistingFilePath = (targetPath: string): string | null => {
    const treeMatch = findItemInTree(fileTree, targetPath, false);
    if (treeMatch) return treeMatch.path;
    const lowerTarget = normalizePath(targetPath).toLowerCase();
    const flatMatch = files.find(
      (f) => !f.isDir && normalizePath(f.path).toLowerCase() === lowerTarget
    );
    return flatMatch ? flatMatch.path : null;
  };

  const handleActivateBookmark = (b: BookmarkItem, openInNewTab = false) => {
    if (b.type === 'file') {
      const existingFile = resolveExistingFilePath(b.path);
      if (!existingFile) {
        showNotice(t('bookmarks.notices.missingFile', { name: b.title }), 2500, 'error');
        return;
      }
      if (openInNewTab && onOpenInNewTab) {
        onOpenInNewTab(existingFile);
      } else if (onOpenFile) {
        onOpenFile(existingFile);
      } else {
        void selectFile(existingFile);
      }
      return;
    }

    if (b.type === 'folder') {
      const existingFolder = findItemInTree(fileTree, b.path, true);
      if (!existingFolder) {
        showNotice(t('bookmarks.notices.missingFolder', { name: b.title }), 2500, 'error');
        return;
      }
      triggerRevealInExplorer(existingFolder.path);
      return;
    }

    if (b.type === 'search') {
      const q = normalizeSearchBookmarkQuery(b.query ?? b.path);
      if (!q) return;
      triggerOpenSearch(q);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, b: BookmarkItem) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems: MenuItemData[] = [];
    if (b.type === 'file') {
      menuItems.push(
        {
          title: t('common.open'),
          icon: <ExternalLink size={14} />,
          action: () => handleActivateBookmark(b, false),
        },
        {
          title: t('fileTree.contextMenu.openInNewTab'),
          icon: <PlusCircle size={14} />,
          action: () => handleActivateBookmark(b, true),
        },
        {
          title: t('bookmarks.revealInExplorer'),
          icon: <FolderOpen size={14} />,
          action: () => {
            const existingFile = resolveExistingFilePath(b.path);
            if (!existingFile) {
              showNotice(t('bookmarks.notices.missingFile', { name: b.title }), 2500, 'error');
              return;
            }
            triggerRevealInExplorer(existingFile);
          },
        }
      );
    } else if (b.type === 'folder') {
      menuItems.push({
        title: t('bookmarks.revealInExplorer'),
        icon: <FolderOpen size={14} />,
        action: () => handleActivateBookmark(b, false),
      });
    } else if (b.type === 'search') {
      menuItems.push({
        title: t('bookmarks.openSearch'),
        icon: <Search size={14} />,
        action: () => handleActivateBookmark(b, false),
      });
    }

    menuItems.push(
      { type: 'separator' },
      {
        title: t('bookmarks.remove'),
        icon: <Trash2 size={14} />,
        isWarning: true,
        action: () => removeBookmark(b.path, b.type),
      }
    );

    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  };

  return (
    <div className="flex flex-col h-full bg-urano-sidebar text-urano-text select-none overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-urano-border bg-urano-sidebar flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark size={15} className="text-orange-500 fill-orange-500/20" />
          <span className="text-xs font-semibold text-urano-text">{t('bookmarks.title')}</span>
        </div>
        <span className="text-[11px] text-urano-muted">
          {t(bookmarks.length === 1 ? 'bookmarks.countOne' : 'bookmarks.countOther', {
            count: bookmarks.length,
          })}
        </span>
      </div>

      {/* Bookmarks List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {bookmarks.length === 0 ? (
          <div className="p-6 text-center text-xs text-urano-faint flex flex-col items-center gap-2">
            <Bookmark size={24} className="text-urano-faint stroke-[1.5]" />
            <p>{t('bookmarks.empty')}</p>
            <p className="text-[11px] text-urano-faint">{t('bookmarks.emptyHint')}</p>
          </div>
        ) : (
          bookmarks.map((b) => (
            <div
              key={b.id}
              data-page-preview-context={b.type === 'file' ? 'bookmarks' : undefined}
              data-page-preview-target={b.type === 'file' ? b.path : undefined}
              onClick={(e) => handleActivateBookmark(b, Boolean(e.ctrlKey || e.metaKey))}
              onAuxClick={(e) => {
                if (e.button === 1 && b.type === 'file') {
                  e.preventDefault();
                  handleActivateBookmark(b, true);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, b)}
              className="group flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-[var(--interactive-hover)] cursor-pointer text-xs text-urano-text transition-colors"
            >
              <div className="flex items-center gap-2 truncate">
                {b.type === 'file' ? (
                  <FileText size={13} className="text-orange-400 shrink-0" />
                ) : b.type === 'folder' ? (
                  <Folder size={13} className="text-amber-400 shrink-0" />
                ) : (
                  <Search size={13} className="text-sky-400 shrink-0" />
                )}
                <span className="truncate">{b.title}</span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBookmark(b.path, b.type);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 rounded text-urano-faint transition-opacity"
                title={t('bookmarks.remove')}
                aria-label={t('bookmarks.remove')}
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      {contextMenu && (
        <UranoMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
