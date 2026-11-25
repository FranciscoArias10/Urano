import {
  getCleanFileName,
  isPathExcluded,
  isSamePath,
  normalizePath,
} from '../../utils/pathUtils';

export interface SearchMatchSnippet {
  lineNum: number;
  colStart: number;
  colEnd: number;
  lineText: string;
  before: string;
  match: string;
  after: string;
  hasLeadingEllipsis: boolean;
  hasTrailingEllipsis: boolean;
}

export interface FileSearchResult {
  filePath: string;
  fileName: string;
  folderPath: string;
  matches: SearchMatchSnippet[];
}

export interface BuildGlobalSearchOptions {
  activeVault?: string | null;
  activeFile?: string | null;
  activeFileContent?: string;
  ignoreFilters?: string[];
}

export interface PendingEditorJump {
  filePath: string;
  lineNum: number;
  colStart?: number;
  colEnd?: number;
  requestId: number;
}

export const URANO_EDITOR_JUMP_EVENT = 'urano-editor-jump';

let pendingJumpState: PendingEditorJump | null = null;
let jumpRequestCounter = 0;

/**
 * Returns the vault-relative forward-slash path preserving file extension
 * (so `isPathExcluded` matches only paths inside the vault, never OS parent folders).
 */
export function getVaultRelativePathWithExt(
  filePath: string,
  activeVault?: string | null
): string {
  const normFile = normalizePath(filePath);
  if (activeVault) {
    const normVault = normalizePath(activeVault);
    if (normVault) {
      const lowerPrefix = `${normVault.toLowerCase()}/`;
      if (normFile.toLowerCase().startsWith(lowerPrefix)) {
        return normFile.slice(normVault.length + 1);
      }
    }
  }
  return normFile.replace(/^\/+/, '');
}

/**
 * Builds Global Search results across the vault:
 * - Normalizes Windows `\` paths so `fileName` never displays `C:\...`
 * - Counts and extracts ALL matches per line (not just the first)
 * - Filters out excluded files/folders via `userIgnoreFilters`
 * - Reflects live unsaved content of the active Markdown note
 */
export function buildGlobalSearchResults(
  rawQuery: string,
  notesContentMap: Record<string, string>,
  options: BuildGlobalSearchOptions = {}
): FileSearchResult[] {
  const qRaw = (rawQuery || '').trim();
  if (!qRaw) return [];

  const qLower = qRaw.toLowerCase();
  const matchLen = qRaw.length;
  const { activeVault, activeFile, activeFileContent, ignoreFilters = [] } = options;

  // Build effective map overlaying unsaved active Markdown buffer if present
  const entries = new Map<string, string>();
  let activeOverlayApplied = false;

  for (const [filePath, content] of Object.entries(notesContentMap || {})) {
    if (!/\.(md|markdown)$/i.test(filePath)) continue;
    if (activeFile && typeof activeFileContent === 'string' && isSamePath(filePath, activeFile)) {
      entries.set(filePath, activeFileContent);
      activeOverlayApplied = true;
    } else {
      entries.set(filePath, content);
    }
  }

  if (
    !activeOverlayApplied &&
    activeFile &&
    /\.(md|markdown)$/i.test(activeFile) &&
    typeof activeFileContent === 'string'
  ) {
    entries.set(activeFile, activeFileContent);
  }

  const results: FileSearchResult[] = [];

  for (const [filePath, content] of entries.entries()) {
    const relWithExt = getVaultRelativePathWithExt(filePath, activeVault);
    if (ignoreFilters.length > 0 && isPathExcluded(relWithExt, ignoreFilters)) {
      continue;
    }

    const fileName = getCleanFileName(filePath);
    const relSegments = relWithExt.split('/').filter(Boolean);
    relSegments.pop();
    const folderPath = relSegments.join('/');

    const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
    const matches: SearchMatchSnippet[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();
      let idx = lowerLine.indexOf(qLower);

      while (idx !== -1) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(line.length, idx + matchLen + 30);

        matches.push({
          lineNum: i + 1,
          colStart: idx,
          colEnd: idx + matchLen,
          lineText: line.trim(),
          before: line.slice(start, idx),
          match: line.slice(idx, idx + matchLen),
          after: line.slice(idx + matchLen, end),
          hasLeadingEllipsis: start > 0,
          hasTrailingEllipsis: end < line.length,
        });

        idx = lowerLine.indexOf(qLower, idx + Math.max(1, matchLen));
      }
    }

    if (matches.length > 0) {
      results.push({ filePath, fileName, folderPath, matches });
    }
  }

  results.sort((a, b) => {
    const byName = a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
    if (byName !== 0) return byName;
    return a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true });
  });

  return results;
}

/**
 * Registers a pending jump to `{ filePath, lineNum, colStart, colEnd }` and notifies
 * mounted editors via `URANO_EDITOR_JUMP_EVENT`.
 */
export function requestEditorJump(target: {
  filePath: string;
  lineNum: number;
  colStart?: number;
  colEnd?: number;
}): PendingEditorJump {
  const jump: PendingEditorJump = {
    ...target,
    requestId: ++jumpRequestCounter,
  };
  pendingJumpState = jump;
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(URANO_EDITOR_JUMP_EVENT, { detail: jump }));
  }
  return jump;
}

export function peekPendingEditorJump(
  activeFile: string | null | undefined
): PendingEditorJump | null {
  if (!pendingJumpState || !activeFile) return null;
  return isSamePath(pendingJumpState.filePath, activeFile) ? pendingJumpState : null;
}

export function clearPendingEditorJump(requestId: number): void {
  if (pendingJumpState && pendingJumpState.requestId === requestId) {
    pendingJumpState = null;
  }
}

/**
 * Computes safe CodeMirror `{ anchor, head }` offsets for a 1-based line and 0-based column range.
 */
export function computeJumpSelectionInDoc(
  doc: {
    lines: number;
    length: number;
    line: (n: number) => { from: number; to: number; length: number };
  },
  jump: { lineNum: number; colStart?: number; colEnd?: number }
): { anchor: number; head: number } {
  if (doc.lines <= 0) return { anchor: 0, head: 0 };
  const clampedLine = Math.min(Math.max(1, jump.lineNum), doc.lines);
  const lineObj = doc.line(clampedLine);
  const startCol = Math.max(0, jump.colStart ?? 0);
  const endCol = jump.colEnd !== undefined ? Math.max(startCol, jump.colEnd) : startCol;
  const anchor = Math.min(lineObj.to, lineObj.from + startCol);
  const head = Math.min(lineObj.to, lineObj.from + endCol);
  return { anchor, head };
}
