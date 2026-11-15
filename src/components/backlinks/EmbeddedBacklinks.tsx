import React, { useMemo, useState } from 'react';
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

  return (
    <div
      className={`embedded-backlinks${readableLineLength ? '' : ' is-full-width'}`}
      data-sort-order={sortOrder}
      data-search-open={showSearch ? 'true' : 'false'}
      data-sort-menu={sortMenuPos ? 'open' : 'closed'}
    >
      <div className="embedded-backlinks-header">
        <div className="embedded-backlinks-title">{t('embeddedBacklinks.title')}</div>
      </div>
      <div className="backlink-pane">
        {linkedOpen && (
          <div className="backlink-section" data-count={linkedTotal}>
            {t('embeddedBacklinks.linkedMentions')} ({linkedTotal})
          </div>
        )}
        {unlinkedOpen && (
          <div className="backlink-section" data-count={unlinkedTotal}>
            {t('embeddedBacklinks.unlinkedMentions')} ({unlinkedTotal})
          </div>
        )}
      </div>
    </div>
  );
};
