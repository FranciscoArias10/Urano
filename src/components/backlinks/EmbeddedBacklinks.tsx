import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  X,
} from 'lucide-react';
import { UranoMenu, MenuItemData } from '../common/UranoMenu';
import { useVaultStore } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import { FileItem } from '../../types';
import {
  getCleanFileName,
  getRelativeVaultPath,
  isPathExcluded,
  isSamePath,
  normalizePath,
} from '../../utils/pathUtils';

export type BacklinkSortOrder =
  | 'alphabetical'
  | 'alphabetical-reverse'
  | 'modified-new'
  | 'modified-old';

export interface MentionMatch {
  lineIndex: number;
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
  matchedText: string;
}

export interface MentionFileGroup {
  filePath: string;
  fileName: string;
  mtime: number;
  matches: MentionMatch[];
}

export interface EmbeddedBacklinksProps {
  activeFile: string;
  cleanTitle: string;
  readableLineLength: boolean;
}

function collectFileMtimes(items: FileItem[], out: Record<string, number>): void {
  for (const item of items) {
    if (!item.isDir && item.mtime !== undefined) {
      out[normalizePath(item.path)] = item.mtime;
    }
    if (item.children) {
      collectFileMtimes(item.children, out);
    }
  }
}

function normalizeLinkTarget(raw: string): string {
  const withoutAnchor = raw.split('#')[0].split('|')[0].trim();
  const withoutDotSlash = withoutAnchor.replace(/^\.\//, '');
  let decoded = withoutDotSlash;
  try {
    decoded = decodeURIComponent(withoutDotSlash);
  } catch {
    decoded = withoutDotSlash;
  }
  return decoded.replace(/\.md$/i, '').toLowerCase();
}

function isRangeMasked(
  start: number,
  end: number,
  maskedRanges: Array<[number, number]>
): boolean {
  for (const [mStart, mEnd] of maskedRanges) {
    if (start < mEnd && end > mStart) {
      return true;
    }
  }
  return false;
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function hasValidBoundaries(line: string, start: number, end: number): boolean {
  const firstChar = line[start];
  const lastChar = line[end - 1];
  if (firstChar && WORD_CHAR_RE.test(firstChar) && start > 0) {
    if (WORD_CHAR_RE.test(line[start - 1])) return false;
  }
  if (lastChar && WORD_CHAR_RE.test(lastChar) && end < line.length) {
    if (WORD_CHAR_RE.test(line[end])) return false;
  }
  return true;
}

export function scanBacklinkMentions(
  activeFile: string,
  cleanTitle: string,
  activeVault: string | null,
  notesContentMap: Record<string, string>,
  fileTree: FileItem[],
  userIgnoreFilters: string[]
): { linkedGroups: MentionFileGroup[]; unlinkedGroups: MentionFileGroup[] } {
  const trimmedTitle = cleanTitle.trim();
  if (!activeFile || !trimmedTitle) {
    return { linkedGroups: [], unlinkedGroups: [] };
  }

  const targetTitleLower = trimmedTitle.toLowerCase();
  const targetRelLower = getRelativeVaultPath(activeFile, activeVault || '')
    .trim()
    .toLowerCase();

  const mtimeMap: Record<string, number> = {};
  collectFileMtimes(fileTree, mtimeMap);

  const linkedGroups: MentionFileGroup[] = [];
  const unlinkedGroups: MentionFileGroup[] = [];

  for (const [filePath, content] of Object.entries(notesContentMap)) {
    if (!filePath || isSamePath(filePath, activeFile)) continue;
    if (!filePath.toLowerCase().endsWith('.md')) continue;
    if (isPathExcluded(filePath, userIgnoreFilters)) continue;

    const fileName = getCleanFileName(filePath);
    const mtime = mtimeMap[normalizePath(filePath)] || 0;
    const lines = content.split('\n');

    const linkedMatches: MentionMatch[] = [];
    const unlinkedMatches: MentionMatch[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const rawLine = lines[lineIndex];
      const lineText = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!lineText) continue;

      const maskedRanges: Array<[number, number]> = [];

      // 1. Scan wikilinks: [[Target]], [[Target|Alias]], [[Target#Heading]]
      const wikiRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
      let wikiMatch: RegExpExecArray | null;
      while ((wikiMatch = wikiRegex.exec(lineText)) !== null) {
        const matchStart = wikiMatch.index;
        const matchEnd = matchStart + wikiMatch[0].length;
        maskedRanges.push([matchStart, matchEnd]);

        const normalizedTarget = normalizeLinkTarget(wikiMatch[1]);
        if (
          normalizedTarget === targetTitleLower ||
          (targetRelLower && normalizedTarget === targetRelLower)
        ) {
          linkedMatches.push({
            lineIndex,
            lineNumber: lineIndex + 1,
            lineText,
            matchStart,
            matchEnd,
            matchedText: wikiMatch[0],
          });
        }
      }

      // 2. Scan Markdown links: [text](Note.md) / [text](folder/Note.md#section)
      const mdLinkRegex = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
      let mdMatch: RegExpExecArray | null;
      while ((mdMatch = mdLinkRegex.exec(lineText)) !== null) {
        const matchStart = mdMatch.index;
        const matchEnd = matchStart + mdMatch[0].length;
        maskedRanges.push([matchStart, matchEnd]);

        // Skip embeds (![...](...))
        if (mdMatch[1] === '!') continue;

        const rawHref = mdMatch[3].trim().replace(/^<|>$/g, '').split(/\s+/)[0] || '';
        if (/^(https?:|mailto:|obsidian:|urano:|file:)/i.test(rawHref)) continue;

        const normalizedHref = normalizeLinkTarget(rawHref);
        if (
          normalizedHref === targetTitleLower ||
          (targetRelLower && normalizedHref === targetRelLower)
        ) {
          linkedMatches.push({
            lineIndex,
            lineNumber: lineIndex + 1,
            lineText,
            matchStart,
            matchEnd,
            matchedText: mdMatch[0],
          });
        }
      }

      // 3. Scan plain-text unlinked mentions outside [[...]] and [...](...)
      const lowerLine = lineText.toLowerCase();
      let searchPos = 0;
      while (searchPos <= lowerLine.length - targetTitleLower.length) {
        const foundIdx = lowerLine.indexOf(targetTitleLower, searchPos);
        if (foundIdx === -1) break;
        const endIdx = foundIdx + targetTitleLower.length;

        if (
          !isRangeMasked(foundIdx, endIdx, maskedRanges) &&
          hasValidBoundaries(lineText, foundIdx, endIdx)
        ) {
          unlinkedMatches.push({
            lineIndex,
            lineNumber: lineIndex + 1,
            lineText,
            matchStart: foundIdx,
            matchEnd: endIdx,
            matchedText: lineText.slice(foundIdx, endIdx),
          });
        }

        searchPos = endIdx;
      }
    }

    if (linkedMatches.length > 0) {
      linkedGroups.push({
        filePath,
        fileName,
        mtime,
        matches: linkedMatches,
      });
    }
    if (unlinkedMatches.length > 0) {
      unlinkedGroups.push({
        filePath,
        fileName,
        mtime,
        matches: unlinkedMatches,
      });
    }
  }

  return { linkedGroups, unlinkedGroups };
}

export function filterAndSortGroups(
  groups: MentionFileGroup[],
  query: string,
  sortOrder: BacklinkSortOrder
): MentionFileGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups
        .map((group) => {
          if (group.fileName.toLowerCase().includes(q)) return group;
          const matchingLines = group.matches.filter((m) =>
            m.lineText.toLowerCase().includes(q)
          );
          if (matchingLines.length === 0) return null;
          return { ...group, matches: matchingLines };
        })
        .filter((g): g is MentionFileGroup => g !== null)
    : [...groups];

  filtered.sort((a, b) => {
    switch (sortOrder) {
      case 'alphabetical-reverse':
        return b.fileName.localeCompare(a.fileName, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      case 'modified-new':
        return (
          b.mtime - a.mtime ||
          a.fileName.localeCompare(b.fileName, undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        );
      case 'modified-old':
        return (
          a.mtime - b.mtime ||
          a.fileName.localeCompare(b.fileName, undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        );
      case 'alphabetical':
      default:
        return a.fileName.localeCompare(b.fileName, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
    }
  });

  return filtered;
}

export const EmbeddedBacklinks: React.FC<EmbeddedBacklinksProps> = ({
  activeFile,
  cleanTitle,
  readableLineLength,
}) => {
  const t = useT();
  const activeVault = useVaultStore((s) => s.activeVault);
  const notesContentMap = useVaultStore((s) => s.notesContentMap);
  const fileTree = useVaultStore((s) => s.fileTree);
  const selectFile = useVaultStore((s) => s.selectFile);
  const updateNoteContent = useVaultStore((s) => s.updateNoteContent);
  const userIgnoreFilters = useSettingsStore((s) => s.settings.userIgnoreFilters) || [];

  const [showSearch, setShowSearch] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [collapseResults, setCollapseResults] = useState(false);
  const [sortOrder, setSortOrder] = useState<BacklinkSortOrder>('alphabetical');
  const [sortMenuPos, setSortMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [linkedOpen, setLinkedOpen] = useState(true);
  const [unlinkedOpen, setUnlinkedOpen] = useState(true);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const { linkedGroups, unlinkedGroups } = useMemo(
    () =>
      scanBacklinkMentions(
        activeFile,
        cleanTitle,
        activeVault,
        notesContentMap,
        fileTree,
        userIgnoreFilters
      ),
    [activeFile, cleanTitle, activeVault, notesContentMap, fileTree, userIgnoreFilters]
  );

  const visibleLinkedGroups = useMemo(
    () => filterAndSortGroups(linkedGroups, filterQuery, sortOrder),
    [linkedGroups, filterQuery, sortOrder]
  );

  const visibleUnlinkedGroups = useMemo(
    () => filterAndSortGroups(unlinkedGroups, filterQuery, sortOrder),
    [unlinkedGroups, filterQuery, sortOrder]
  );

  const linkedTotal = useMemo(
    () => visibleLinkedGroups.reduce((acc, g) => acc + g.matches.length, 0),
    [visibleLinkedGroups]
  );

  const unlinkedTotal = useMemo(
    () => visibleUnlinkedGroups.reduce((acc, g) => acc + g.matches.length, 0),
    [visibleUnlinkedGroups]
  );

  const handleToggleCollapseAll = () => {
    setCollapseResults((prev) => !prev);
    setCollapsedFiles({});
  };

  const toggleFileCollapsed = (section: 'linked' | 'unlinked', filePath: string) => {
    const key = `${section}:${filePath}`;
    setCollapsedFiles((prev) => {
      const current = key in prev ? prev[key] : collapseResults;
      return { ...prev, [key]: !current };
    });
  };

  const handleLinkMention = async (
    filePath: string,
    match: MentionMatch,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const targetTitle = cleanTitle.trim();
    if (!targetTitle) return;

    const latestMap = useVaultStore.getState().notesContentMap;
    const currentContent = latestMap[filePath] ?? notesContentMap[filePath];
    if (typeof currentContent !== 'string') return;

    const lines = currentContent.split('\n');
    if (match.lineIndex < 0 || match.lineIndex >= lines.length) return;

    const rawLine = lines[match.lineIndex];
    const hasCarriageReturn = rawLine.endsWith('\r');
    const lineBody = hasCarriageReturn ? rawLine.slice(0, -1) : rawLine;

    if (
      match.matchStart < 0 ||
      match.matchEnd > lineBody.length ||
      lineBody.slice(match.matchStart, match.matchEnd).toLowerCase() !==
        targetTitle.toLowerCase()
    ) {
      return;
    }

    const updatedLine =
      lineBody.slice(0, match.matchStart) +
      `[[${targetTitle}]]` +
      lineBody.slice(match.matchEnd) +
      (hasCarriageReturn ? '\r' : '');
    lines[match.lineIndex] = updatedLine;

    await updateNoteContent(filePath, lines.join('\n'));
  };

  const handleOpenMentionFile = (filePath: string) => {
    selectFile(filePath);
  };

  const searchInputRef = useRef<HTMLInputElement>(null);

  const sortMenuItems: MenuItemData[] = useMemo(
    () => [
      {
        title: t('embeddedBacklinks.sortAlphabetical'),
        checked: sortOrder === 'alphabetical',
        action: () => setSortOrder('alphabetical'),
      },
      {
        title: t('embeddedBacklinks.sortAlphabeticalReverse'),
        checked: sortOrder === 'alphabetical-reverse',
        action: () => setSortOrder('alphabetical-reverse'),
      },
      { type: 'separator' },
      {
        title: t('embeddedBacklinks.sortModifiedNew'),
        checked: sortOrder === 'modified-new',
        action: () => setSortOrder('modified-new'),
      },
      {
        title: t('embeddedBacklinks.sortModifiedOld'),
        checked: sortOrder === 'modified-old',
        action: () => setSortOrder('modified-old'),
      },
    ],
    [sortOrder, t]
  );

  const toggleSearchBar = () => {
    setShowSearch((prev) => {
      const next = !prev;
      if (next) {
        window.setTimeout(() => searchInputRef.current?.focus(), 20);
      } else {
        setFilterQuery('');
      }
      return next;
    });
  };

  const renderMatchLine = (
    group: MentionFileGroup,
    match: MentionMatch,
    idx: number,
    isUnlinked: boolean
  ) => {
    const before = match.lineText.slice(0, match.matchStart);
    const matched = match.lineText.slice(match.matchStart, match.matchEnd);
    const after = match.lineText.slice(match.matchEnd);

    return (
      <div
        key={`${group.filePath}-${match.lineIndex}-${match.matchStart}-${idx}`}
        className="search-result-file-match tappable"
        onClick={() => handleOpenMentionFile(group.filePath)}
      >
        <div className="search-result-file-match-content">
          {before}
          <span className="search-result-file-matched-text">{matched}</span>
          {after}
        </div>
        {isUnlinked && (
          <button
            type="button"
            className="search-result-file-match-destination-file"
            onClick={(e) => handleLinkMention(group.filePath, match, e)}
          >
            {t('embeddedBacklinks.linkButton')}
          </button>
        )}
      </div>
    );
  };

  const renderResultGroups = (
    groups: MentionFileGroup[],
    section: 'linked' | 'unlinked',
    emptyText: string
  ) => {
    if (groups.length === 0) {
      return <div className="backlink-empty-state">{emptyText}</div>;
    }

    const isUnlinked = section === 'unlinked';

    return (
      <div className="search-result-container">
        {groups.map((group) => {
          const fileKey = `${section}:${group.filePath}`;
          const isFileCollapsed =
            fileKey in collapsedFiles ? collapsedFiles[fileKey] : collapseResults;

          return (
            <div
              key={fileKey}
              className={`search-result${isFileCollapsed ? ' is-collapsed' : ''}`}
            >
              <div
                className="search-result-file-title is-clickable"
                onClick={() => handleOpenMentionFile(group.filePath)}
              >
                <button
                  type="button"
                  className="tree-item-icon collapse-icon clickable-icon"
                  aria-expanded={!isFileCollapsed}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFileCollapsed(section, group.filePath);
                  }}
                >
                  {isFileCollapsed ? (
                    <ChevronRight size={14} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={14} strokeWidth={2} />
                  )}
                </button>
                <span className="tree-item-inner">{group.fileName}</span>
                <span className="tree-item-flair-outer">
                  <span className="tree-item-flair">{group.matches.length}</span>
                </span>
              </div>

              {!isFileCollapsed && (
                <div className="search-result-file-matches">
                  {group.matches.map((m, idx) =>
                    renderMatchLine(group, m, idx, isUnlinked)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`embedded-backlinks${readableLineLength ? '' : ' is-full-width'}`}
      data-sort-order={sortOrder}
    >
      <div className="embedded-backlinks-header">
        <div className="embedded-backlinks-title">{t('embeddedBacklinks.title')}</div>
        <div className="embedded-backlinks-actions">
          <button
            type="button"
            className={`clickable-icon${showSearch ? ' is-active' : ''}`}
            aria-label={t('embeddedBacklinks.showSearch')}
            title={t('embeddedBacklinks.showSearch')}
            onClick={toggleSearchBar}
          >
            <Search size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={`clickable-icon${collapseResults ? ' is-active' : ''}`}
            aria-label={
              collapseResults
                ? t('embeddedBacklinks.expandResults')
                : t('embeddedBacklinks.collapseResults')
            }
            title={
              collapseResults
                ? t('embeddedBacklinks.expandResults')
                : t('embeddedBacklinks.collapseResults')
            }
            onClick={handleToggleCollapseAll}
          >
            {collapseResults ? (
              <ChevronsUpDown size={15} strokeWidth={1.9} />
            ) : (
              <ChevronsDownUp size={15} strokeWidth={1.9} />
            )}
          </button>
          <button
            type="button"
            className={`clickable-icon${sortMenuPos ? ' is-active' : ''}`}
            aria-label={t('embeddedBacklinks.sortOrder')}
            title={t('embeddedBacklinks.sortOrder')}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSortMenuPos((prev) =>
                prev ? null : { x: rect.right, y: rect.bottom + 4 }
              );
            }}
          >
            <ArrowUpDown size={15} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="embedded-backlinks-search">
          <div className="search-input-container">
            <span className="search-input-icon">
              <Search size={14} strokeWidth={2} />
            </span>
            <input
              ref={searchInputRef}
              type="search"
              spellCheck={false}
              placeholder={t('embeddedBacklinks.filterPlaceholder')}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            {filterQuery.length > 0 && (
              <button
                type="button"
                className="search-input-clear-button"
                aria-label={t('embeddedBacklinks.clearFilter')}
                title={t('embeddedBacklinks.clearFilter')}
                onClick={() => {
                  setFilterQuery('');
                  searchInputRef.current?.focus();
                }}
              >
                <X size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="backlink-pane">
        {/* Section 1: Linked mentions */}
        <div className="backlink-section">
          <div
            className={`backlink-section-header tree-item-self is-clickable${
              linkedOpen ? '' : ' is-collapsed'
            }`}
            onClick={() => setLinkedOpen((prev) => !prev)}
          >
            <span className="tree-item-icon collapse-icon">
              {linkedOpen ? (
                <ChevronDown size={14} strokeWidth={2} />
              ) : (
                <ChevronRight size={14} strokeWidth={2} />
              )}
            </span>
            <span className="tree-item-inner">
              {t('embeddedBacklinks.linkedMentions')}
            </span>
            <span className="tree-item-flair-outer">
              <span className="tree-item-flair">{linkedTotal}</span>
            </span>
          </div>
          {linkedOpen &&
            renderResultGroups(
              visibleLinkedGroups,
              'linked',
              t('embeddedBacklinks.noLinkedMentions')
            )}
        </div>

        {/* Section 2: Unlinked mentions */}
        <div className="backlink-section">
          <div
            className={`backlink-section-header tree-item-self is-clickable${
              unlinkedOpen ? '' : ' is-collapsed'
            }`}
            onClick={() => setUnlinkedOpen((prev) => !prev)}
          >
            <span className="tree-item-icon collapse-icon">
              {unlinkedOpen ? (
                <ChevronDown size={14} strokeWidth={2} />
              ) : (
                <ChevronRight size={14} strokeWidth={2} />
              )}
            </span>
            <span className="tree-item-inner">
              {t('embeddedBacklinks.unlinkedMentions')}
            </span>
            <span className="tree-item-flair-outer">
              <span className="tree-item-flair">{unlinkedTotal}</span>
            </span>
          </div>
          {unlinkedOpen &&
            renderResultGroups(
              visibleUnlinkedGroups,
              'unlinked',
              t('embeddedBacklinks.noUnlinkedMentions')
            )}
        </div>
      </div>

      {sortMenuPos && (
        <UranoMenu
          x={sortMenuPos.x}
          y={sortMenuPos.y}
          align="right"
          items={sortMenuItems}
          onClose={() => setSortMenuPos(null)}
        />
      )}
    </div>
  );
};
