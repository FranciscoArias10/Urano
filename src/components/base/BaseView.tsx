import React, { useState, useMemo } from 'react';
import {
  Table,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileText,
  Folder,
  Tag,
  Clock,
  HardDrive,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';
import { FileItem } from '../../types';

interface BaseViewProps {
  filePath: string;
}

interface NoteRow {
  path: string;
  name: string;
  folder: string;
  tags: string[];
  mtime: number;
  size: number;
}

export const BaseView: React.FC<BaseViewProps> = ({ filePath }) => {
  const { fileTree, notesContentMap, selectFile, createUntitledNote } = useVaultStore();
  const t = useT();
  const [filterQuery, setFilterQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'folder' | 'mtime' | 'size'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Flatten all files from fileTree
  const allNotes = useMemo(() => {
    const list: NoteRow[] = [];

    const traverse = (items: FileItem[], folderPath: string) => {
      for (const item of items) {
        if (item.isDir) {
          traverse(item.children || [], `${folderPath}/${item.name}`);
        } else {
          const content = notesContentMap[item.path] || '';
          // Extract #tags (ignoring markdown headings)
          const tagMatches = content.match(/(?:^|\s)#([a-zA-Z0-9_\-/]+)/g) || [];
          const tags = Array.from(
            new Set(tagMatches.map((t) => t.trim().replace(/^#/, '')))
          );

          list.push({
            path: item.path,
            name: item.name.replace(/\.md$/i, ''),
            folder: folderPath || '/',
            tags,
            mtime: item.mtime ? item.mtime * 1000 : Date.now(),
            size: item.size || 0,
          });
        }
      }
    };

    traverse(fileTree, '');
    return list;
  }, [fileTree, notesContentMap]);

  // Filtered & Sorted notes
  const displayedNotes = useMemo(() => {
    let result = allNotes;

    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.folder.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
      else if (sortField === 'folder') cmp = a.folder.localeCompare(b.folder);
      else if (sortField === 'mtime') cmp = a.mtime - b.mtime;
      else if (sortField === 'size') cmp = a.size - b.size;

      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [allNotes, filterQuery, sortField, sortDirection]);

  const toggleSort = (field: 'name' | 'folder' | 'mtime' | 'size') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDate = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const baseName = filePath.split('/').pop()?.replace(/\.base$/i, '') || t('base.defaultName');

  return (
    <div className="flex flex-col w-full h-full bg-obsidian-sidebar text-obsidian-text select-none overflow-hidden">
      {/* Base Header / Filter Bar */}
      <div className="px-6 py-4 border-b border-obsidian-border flex items-center justify-between gap-4 bg-obsidian-bg">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-orange-500/15 text-orange-400 rounded-md border border-orange-500/30">
            <Table size={16} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-obsidian-text">{baseName}</h1>
            <p className="text-[11px] text-obsidian-muted">
              {t('base.indexedNotes', { shown: displayedNotes.length, total: allNotes.length })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Search Filter */}
          <div className="flex items-center gap-2 bg-obsidian-sidebar px-2.5 py-1.5 rounded-md border border-obsidian-border text-xs">
            <Search size={13} className="text-obsidian-muted" />
            <input
              type="text"
              placeholder={t('base.filterPlaceholder')}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="bg-transparent text-obsidian-text outline-none w-64 placeholder-stone-500"
            />
          </div>

          {/* New Note Action */}
          <button
            onClick={() => createUntitledNote()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-md transition-colors shadow-sm"
          >
            <Plus size={13} />
            <span>{t('base.newNote')}</span>
          </button>
        </div>
      </div>

      {/* Database Table Container */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs border-collapse">
          {/* Table Headers */}
          <thead className="sticky top-0 bg-obsidian-sidebar border-b border-obsidian-border text-obsidian-muted z-10">
            <tr>
              <th
                onClick={() => toggleSort('name')}
                className="px-6 py-3 font-semibold cursor-pointer hover:text-obsidian-text transition-colors min-w-[220px]"
              >
                <div className="flex items-center gap-1.5">
                  <FileText size={13} />
                  <span>{t('base.columns.name')}</span>
                  {sortField === 'name' ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp size={12} className="text-orange-500" />
                    ) : (
                      <ArrowDown size={12} className="text-orange-500" />
                    )
                  ) : (
                    <ArrowUpDown size={11} className="opacity-30" />
                  )}
                </div>
              </th>

              <th
                onClick={() => toggleSort('folder')}
                className="px-4 py-3 font-semibold cursor-pointer hover:text-obsidian-text transition-colors min-w-[150px]"
              >
                <div className="flex items-center gap-1.5">
                  <Folder size={13} />
                  <span>{t('base.columns.folder')}</span>
                  {sortField === 'folder' ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp size={12} className="text-orange-500" />
                    ) : (
                      <ArrowDown size={12} className="text-orange-500" />
                    )
                  ) : (
                    <ArrowUpDown size={11} className="opacity-30" />
                  )}
                </div>
              </th>

              <th className="px-4 py-3 font-semibold min-w-[180px]">
                <div className="flex items-center gap-1.5">
                  <Tag size={13} />
                  <span>{t('base.columns.tags')}</span>
                </div>
              </th>

              <th
                onClick={() => toggleSort('mtime')}
                className="px-4 py-3 font-semibold cursor-pointer hover:text-obsidian-text transition-colors min-w-[160px]"
              >
                <div className="flex items-center gap-1.5">
                  <Clock size={13} />
                  <span>{t('base.columns.modified')}</span>
                  {sortField === 'mtime' ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp size={12} className="text-orange-500" />
                    ) : (
                      <ArrowDown size={12} className="text-orange-500" />
                    )
                  ) : (
                    <ArrowUpDown size={11} className="opacity-30" />
                  )}
                </div>
              </th>

              <th
                onClick={() => toggleSort('size')}
                className="px-4 py-3 font-semibold cursor-pointer hover:text-obsidian-text transition-colors w-24"
              >
                <div className="flex items-center gap-1.5">
                  <HardDrive size={13} />
                  <span>{t('base.columns.size')}</span>
                  {sortField === 'size' ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp size={12} className="text-orange-500" />
                    ) : (
                      <ArrowDown size={12} className="text-orange-500" />
                    )
                  ) : (
                    <ArrowUpDown size={11} className="opacity-30" />
                  )}
                </div>
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-[#262626]">
            {displayedNotes.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-obsidian-faint">
                  {t('base.noResults')}
                </td>
              </tr>
            ) : (
              displayedNotes.map((note) => (
                <tr
                  key={note.path}
                  onClick={() => selectFile(note.path)}
                  className="hover:bg-[var(--interactive-hover)] cursor-pointer transition-colors group"
                >
                  {/* Name */}
                  <td className="px-6 py-2.5 font-medium text-obsidian-text group-hover:text-orange-400 transition-colors flex items-center justify-between">
                    <span className="truncate">{note.name}</span>
                    <ExternalLink
                      size={12}
                      className="opacity-0 group-hover:opacity-60 text-orange-400 shrink-0 ml-2"
                    />
                  </td>

                  {/* Folder */}
                  <td className="px-4 py-2.5 text-obsidian-muted truncate">
                    {note.folder}
                  </td>

                  {/* Tags */}
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {note.tags.length > 0 ? (
                        note.tags.map((tag) => (
                          <span
                            key={tag}
                            className="bg-[var(--interactive-normal)] text-obsidian-text text-[10px] px-1.5 py-0.5 rounded border border-obsidian-border"
                          >
                            #{tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-obsidian-faint">—</span>
                      )}
                    </div>
                  </td>

                  {/* Mtime */}
                  <td className="px-4 py-2.5 text-obsidian-muted text-[11px] font-mono">
                    {formatDate(note.mtime)}
                  </td>

                  {/* Size */}
                  <td className="px-4 py-2.5 text-obsidian-muted text-[11px] font-mono">
                    {formatSize(note.size)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
