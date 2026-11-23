import { isSamePath } from './pathUtils';

export interface TabHistoryEntry {
  stack: string[];
  index: number;
}

const MAX_HISTORY_ENTRIES = 100;

/**
 * Pushes `filePath` onto the tab's history stack after the current index,
 * avoiding only immediate consecutive duplicates (matching via `isSamePath`).
 * Truncates any forward history after `index`, matching standard browser / Obsidian leaf history.
 */
export function pushHistoryEntry(
  current: TabHistoryEntry | undefined,
  filePath: string
): TabHistoryEntry {
  if (!filePath) {
    return current ?? { stack: [], index: -1 };
  }
  if (!current || current.stack.length === 0) {
    return { stack: [filePath], index: 0 };
  }
  const currentPath = current.stack[current.index];
  if (currentPath && isSamePath(currentPath, filePath)) {
    return current;
  }
  const nextStack = current.stack.slice(0, current.index + 1);
  nextStack.push(filePath);
  if (nextStack.length > MAX_HISTORY_ENTRIES) {
    nextStack.shift();
  }
  return { stack: nextStack, index: nextStack.length - 1 };
}

/**
 * Steps backward (`delta = -1`) or forward (`delta = 1`) in a tab's history.
 * Returns `null` if stepping out of bounds.
 */
export function stepHistory(
  current: TabHistoryEntry | undefined,
  delta: -1 | 1
): { nextEntry: TabHistoryEntry; targetPath: string } | null {
  if (!current) return null;
  const nextIndex = current.index + delta;
  if (nextIndex < 0 || nextIndex >= current.stack.length) return null;
  const targetPath = current.stack[nextIndex];
  if (!targetPath) return null;
  return {
    nextEntry: { stack: current.stack, index: nextIndex },
    targetPath,
  };
}

/**
 * Rewrites matching paths in all tabs' navigation stacks when a file is renamed or moved.
 */
export function renameHistoryEntries(
  history: Record<string, TabHistoryEntry>,
  oldPath: string,
  newPath: string
): Record<string, TabHistoryEntry> {
  let changed = false;
  const next: Record<string, TabHistoryEntry> = {};
  for (const [tabId, entry] of Object.entries(history)) {
    let entryChanged = false;
    const nextStack = entry.stack.map((p) => {
      if (isSamePath(p, oldPath)) {
        entryChanged = true;
        return newPath;
      }
      return p;
    });
    if (entryChanged) {
      changed = true;
      next[tabId] = { ...entry, stack: nextStack };
    } else {
      next[tabId] = entry;
    }
  }
  return changed ? next : history;
}

/**
 * Removes navigation history entries for tabs that are no longer open.
 */
export function pruneHistoryForTabs(
  history: Record<string, TabHistoryEntry>,
  remainingTabIds: Iterable<string>
): Record<string, TabHistoryEntry> {
  const keep = new Set(remainingTabIds);
  const next: Record<string, TabHistoryEntry> = {};
  for (const [tabId, entry] of Object.entries(history)) {
    if (keep.has(tabId)) next[tabId] = entry;
  }
  return next;
}

