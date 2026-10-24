import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';

interface MatchSnippet {
  lineNum: number;
  lineText: string;
  before: string;
  match: string;
  after: string;
}

interface FileSearchResult {
  filePath: string;
  fileName: string;
  matches: MatchSnippet[];
}

export const GlobalSearchPanel: React.FC = () => {
  const t = useT();
  const { notesContentMap, selectFile } = useVaultStore();
  const [query, setQuery] = useState(() => (window as any).__uranoInitialSearchQuery || '');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleSearchEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ query: string }>;
      if (customEvent.detail?.query) {
        setQuery(customEvent.detail.query);
        (window as any).__uranoInitialSearchQuery = customEvent.detail.query;
      }
    };
    window.addEventListener('urano-search', handleSearchEvent);
    return () => window.removeEventListener('urano-search', handleSearchEvent);
  }, []);

  const searchResults: FileSearchResult[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const results: FileSearchResult[] = [];

    for (const [filePath, content] of Object.entries(notesContentMap)) {
      const fileName = filePath.substring(filePath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
      const lines = content.split('\n');
      const matches: MatchSnippet[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        let idx = lowerLine.indexOf(q);

        if (idx !== -1) {
          const matchLen = q.length;
          const start = Math.max(0, idx - 30);
          const end = Math.min(line.length, idx + matchLen + 30);

          matches.push({
            lineNum: i + 1,
            lineText: line.trim(),
            before: line.slice(start, idx),
            match: line.slice(idx, idx + matchLen),
            after: line.slice(idx + matchLen, end),
          });
        }
      }

      if (matches.length > 0) {
        results.push({ filePath, fileName, matches });
      }
    }

    return results;
  }, [query, notesContentMap]);

  const toggleCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  const totalMatches = useMemo(() => {
    return searchResults.reduce((acc, curr) => acc + curr.matches.length, 0);
  }, [searchResults]);

  return (
    <div className="flex flex-col h-full bg-obsidian-sidebar text-stone-200 select-none overflow-hidden">
      {/* Search Input Box */}
      <div className="p-3 border-b border-obsidian-border bg-[#181818]">
        <div className="flex items-center gap-2 bg-[#141414] px-2.5 py-1.5 rounded-md border border-[#333333] text-xs">
          <Search size={13} className="text-stone-400 shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-white outline-none placeholder-stone-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-stone-400 hover:text-white"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {query && (
          <div className="mt-2 text-[11px] text-stone-400 flex items-center justify-between">
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
        {!query ? (
          <div className="p-4 text-center text-xs text-stone-500">
            {t('search.emptyHint')}
          </div>
        ) : searchResults.length === 0 ? (
          <div className="p-4 text-center text-xs text-stone-500">
            {t('search.noMatches', { query })}
          </div>
        ) : (
          searchResults.map((res) => {
            const isCollapsed = Boolean(collapsedFiles[res.filePath]);

            return (
              <div key={res.filePath} className="rounded-md overflow-hidden bg-[#161616]/60 border border-white/5">
                {/* File Header */}
                <div
                  onClick={() => toggleCollapse(res.filePath)}
                  className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-stone-800/40 text-xs text-stone-300 font-medium"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <FileText size={13} className="text-orange-400 shrink-0" />
                    <span className="truncate">{res.fileName}</span>
                  </div>
                  <span className="text-[10px] bg-stone-800 text-stone-400 px-1.5 py-0.2 rounded-full border border-stone-700/60 font-mono">
                    {res.matches.length}
                  </span>
                </div>

                {/* Snippets */}
                {!isCollapsed && (
                  <div className="divide-y divide-white/5 border-t border-white/5">
                    {res.matches.map((m, idx) => (
                      <div
                        key={idx}
                        onClick={() => selectFile(res.filePath)}
                        className="px-3 py-1.5 hover:bg-orange-500/10 cursor-pointer text-[11px] text-stone-400 transition-colors"
                      >
                        <span className="text-stone-600 font-mono mr-1.5">
                          {t('search.lineNumber', { line: m.lineNum })}
                        </span>
                        <span>...{m.before}</span>
                        <span className="text-orange-400 font-semibold bg-orange-500/20 px-0.5 rounded">
                          {m.match}
                        </span>
                        <span>{m.after}...</span>
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
