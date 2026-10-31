import React from 'react';
import { Bookmark, FileText, Folder, Search, X } from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';

export const BookmarksPanel: React.FC = () => {
  const t = useT();
  const { bookmarks, removeBookmark, selectFile } = useVaultStore();

  return (
    <div className="flex flex-col h-full bg-obsidian-sidebar text-obsidian-text select-none overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-obsidian-border bg-obsidian-sidebar flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark size={15} className="text-orange-500 fill-orange-500/20" />
          <span className="text-xs font-semibold text-obsidian-text">{t('bookmarks.title')}</span>
        </div>
        <span className="text-[11px] text-obsidian-muted">
          {t(bookmarks.length === 1 ? 'bookmarks.countOne' : 'bookmarks.countOther', {
            count: bookmarks.length,
          })}
        </span>
      </div>

      {/* Bookmarks List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {bookmarks.length === 0 ? (
          <div className="p-6 text-center text-xs text-obsidian-faint flex flex-col items-center gap-2">
            <Bookmark size={24} className="text-obsidian-faint stroke-[1.5]" />
            <p>{t('bookmarks.empty')}</p>
            <p className="text-[11px] text-obsidian-faint">
              {t('bookmarks.emptyHint')}
            </p>
          </div>
        ) : (
          bookmarks.map((b) => (
            <div
              key={b.id}
              onClick={() => {
                if (b.type === 'file') {
                  selectFile(b.path);
                }
              }}
              className="group flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-[var(--interactive-hover)] cursor-pointer text-xs text-obsidian-text transition-colors"
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
                onClick={(e) => {
                  e.stopPropagation();
                  removeBookmark(b.path);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 rounded text-obsidian-faint transition-opacity"
                title={t('bookmarks.remove')}
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
