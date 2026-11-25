import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import {
  buildGlobalSearchResults,
  FileSearchResult,
  requestEditorJump,
  SearchMatchSnippet,
} from './searchEngine';

interface GlobalSearchPanelProps {
  onOpenFile?: (filePath: string) => void;
}

export const GlobalSearchPanel: React.FC<GlobalSearchPanelProps> = ({ onOpenFile }) => {
  const t = useT();
  const { notesContentMap, activeVault, activeFile, fileContent, selectFile } = useVaultStore();
  const userIgnoreFilters = useSettingsStore((s) => s.settings.userIgnoreFilters) || [];
  const [query, setQuery] = useState(() => (window as any).__uranoInitialSearchQuery || '');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleSearchEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ query?: string }>;
      if (customEvent.detail?.query !== undefined) {
        setQuery(customEvent.detail.query);
        (window as any).__uranoInitialSearchQuery = customEvent.detail.query;
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('urano-search', handleSearchEvent);
    return () => window.removeEventListener('urano-search', handleSearchEvent);
  }, []);

  const searchResults: FileSearchResult[] = useMemo(
    () =>
      buildGlobalSearchResults(query, notesContentMap, {
        activeVault,
        activeFile,
        activeFileContent: fileContent,
        ignoreFilters: userIgnoreFilters,
      }),
    [query, notesContentMap, activeVault, activeFile, fileContent, userIgnoreFilters]
  );

  const toggleCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  const handleMatchClick = (filePath: string, match: SearchMatchSnippet) => {
    // Queue jump BEFORE opening so newly mounted or already-open Editor jumps to the exact match
    requestEditorJump({
      filePath,
      lineNum: match.lineNum,
      colStart: match.colStart,
      colEnd: match.colEnd,
    });
    if (onOpenFile) {
      onOpenFile(filePath);
    } else {
      void selectFile(filePath);
    }
  };

  const totalMatches = useMemo(() => {
    return searchResults.reduce((acc, curr) => acc + curr.matches.length, 0);
  }, [searchResults]);

  return (
    <div className="flex flex-col h-full bg-urano-sidebar text-urano-text select-none overflow-hidden">
      {/* Search Input Box */}
      <div className="p-3 border-b border-urano-border bg-urano-sidebar">
        <div className="flex items-center gap-2 bg-urano-sidebar px-2.5 py-1.5 rounded-md border border-urano-border text-xs">
          <Search size={13} className="text-urano-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              (window as any).__uranoInitialSearchQuery = e.target.value;
            }}
            className="w-full bg-transparent text-urano-text outline-none placeholder-stone-500"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                (window as any).__uranoInitialSearchQuery = '';
                inputRef.current?.focus();
              }}
              className="text-urano-muted hover:text-urano-text"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {query.trim() && (
          <div className="mt-2 text-[11px] text-urano-muted flex items-center justify-between">
            <span>
              {t('search.summary', {
                matches: t(totalMatches === 1 ? 'search.matchOne' : 'search.matchOther', {
                  count: totalMatches,
                }),
                files: t(searchResults.length === 1 ? 'search.fileOne' : 'search.fileOther', {
                  count: searchResults.length,
                }),
              })}
            </span>
          </div>
        )}
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {!query.trim() ? (
          <div className="p-4 text-center text-xs text-urano-faint">
            {t('search.emptyHint')}
          </div>
        ) : searchResults.length === 0 ? (
          <div className="p-4 text-center text-xs text-urano-faint">
            {t('search.noMatches', { query })}
          </div>
        ) : (
          searchResults.map((res) => {
            const isCollapsed = Boolean(collapsedFiles[res.filePath]);

            return (
              <div
                key={res.filePath}
                className="rounded-md overflow-hidden bg-urano-sidebar/60 border border-urano-border"
              >
                {/* File Header */}
                <div
                  data-page-preview-context="search"
                  data-page-preview-target={res.filePath}
                  onClick={() => toggleCollapse(res.filePath)}
                  className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-[var(--interactive-hover)] text-xs text-urano-text font-medium gap-2"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isCollapsed ? (
                      <ChevronRight size={13} className="shrink-0" />
                    ) : (
                      <ChevronDown size={13} className="shrink-0" />
                    )}
                    <FileText size={13} className="text-orange-400 shrink-0" />
                    <span className="truncate">{res.fileName}</span>
                    {res.folderPath && (
                      <span className="text-[10px] text-urano-faint truncate">
                        {res.folderPath}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] bg-[var(--interactive-normal)] text-urano-muted px-1.5 py-0.2 rounded-full border border-urano-border font-mono shrink-0">
                    {res.matches.length}
                  </span>
                </div>

                {/* Snippets */}
                {!isCollapsed && (
                  <div className="divide-y divide-white/5 border-t border-urano-border">
                    {res.matches.map((m, idx) => (
                      <div
                        key={`${m.lineNum}-${m.colStart}-${idx}`}
                        data-page-preview-context="search"
                        data-page-preview-target={res.filePath}
                        onClick={() => handleMatchClick(res.filePath, m)}
                        className="px-3 py-1.5 hover:bg-orange-500/10 cursor-pointer text-[11px] text-urano-muted transition-colors break-words"
                      >
                        <span className="text-urano-faint font-mono mr-1.5">
                          {t('search.lineNumber', { line: m.lineNum })}
                        </span>
                        <span>
                          {m.hasLeadingEllipsis ? '...' : ''}
                          {m.before}
                        </span>
                        <span className="text-orange-400 font-semibold bg-orange-500/20 px-0.5 rounded">
                          {m.match}
                        </span>
                        <span>
                          {m.after}
                          {m.hasTrailingEllipsis ? '...' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
