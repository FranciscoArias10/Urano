import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '../stores/vaultStore';
import { renameImageInCache } from '../editor/imageExtension';
import { getActiveEditorView } from '../components/editor/Editor';
import { FileItem } from '../types';

export type AlwaysUpdatePreference = boolean | 'always' | 'prompt' | 'never';

const PREF_KEY = 'urano_always_update_links';

/**
 * Gets the persistent preference from localStorage. Default is true (always update).
 */
export function getAlwaysUpdateLinksPref(): boolean {
  try {
    const val = localStorage.getItem(PREF_KEY);
    if (val === 'true' || val === 'always') {
      return true;
    }
    if (val === 'false' || val === 'never' || val === 'prompt') {
      return false;
    }
  } catch {
    // localStorage unavailable
  }
  return true;
}

/**
 * Sets the persistent preference in localStorage.
 */
export function setAlwaysUpdateLinksPref(pref: boolean | 'always' | 'prompt' | 'never'): void {
  try {
    const boolVal = typeof pref === 'boolean' ? pref : pref === 'always';
    localStorage.setItem(PREF_KEY, String(boolVal));
  } catch {
    // localStorage unavailable
  }
}

export interface AffectedFileChange {
  filePath: string;
  originalContent: string;
  newContent: string;
  count: number;
}

export interface LinkScanResult {
  totalLinks: number;
  totalFiles: number;
  changes: AffectedFileChange[];
}

/** A single text replacement expressed as a range over the ORIGINAL text (CodeMirror ChangeSpec compatible). */
export interface LinkReplacement {
  from: number;
  to: number;
  insert: string;
}

export interface FileRenamedDetail {
  oldPath: string;
  newPath: string;
  newFileName: string;
  newBaseName: string;
}

export interface MovedFilePair {
  oldPath: string;
  newPath: string;
}

export const FILE_RENAMED_EVENT = 'urano-file-renamed';

const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');

export function splitPath(path: string): { dir: string; fileName: string; baseName: string; ext: string } {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash !== -1 ? normalized.substring(0, lastSlash) : '';
  const fileName = lastSlash !== -1 ? normalized.substring(lastSlash + 1) : normalized;
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot > 0 ? fileName.substring(lastDot) : '';
  const baseName = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  return { dir, fileName, baseName, ext };
}

/**
 * Computes exact character ranges `[from, to)` for fenced code blocks (```) and
 * inline code spans (`...`) while preserving `\r\n` vs `\n` offsets verbatim.
 */
function collectCodeMaskRanges(text: string): [number, number][] {
  const masked: [number, number][] = [];
  let pos = 0;
  let inFence = false;
  let fenceStart = 0;

  while (pos <= text.length) {
    const nlIdx = text.indexOf('\n', pos);
    const lineEnd = nlIdx === -1 ? text.length : nlIdx;
    const rawLine = text.slice(pos, lineEnd);
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceStart = pos;
      } else {
        inFence = false;
        masked.push([fenceStart, lineEnd]);
      }
    } else if (!inFence) {
      const inlineRe = /(?<!`)`([^`\r\n]+)`(?!`)/g;
      let m: RegExpExecArray | null;
      while ((m = inlineRe.exec(rawLine)) !== null) {
        masked.push([pos + m.index, pos + m.index + m[0].length]);
      }
    }

    if (nlIdx === -1) break;
    pos = nlIdx + 1;
  }

  if (inFence) {
    masked.push([fenceStart, text.length]);
  }

  return masked;
}

function isRangeMasked(from: number, to: number, masked: [number, number][]): boolean {
  return masked.some(([mFrom, mTo]) => from < mTo && to > mFrom);
}

/**
 * Separates optional Markdown link title or angle brackets (e.g. `<Sub/Nota Dos.md> "Title"`)
 * into the bare target portion and the preserved suffix (title + closing punctuation).
 */
function splitMarkdownTargetAndSuffix(rawAfterParen: string): {
  rawTarget: string;
  trailingTitle: string;
} | null {
  const match = rawAfterParen.match(/^(\s*(?:<[^>]+>|[^\s)]+))([\s\S]*)$/);
  if (!match) return null;
  let target = match[1].trim();
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  }
  return { rawTarget: target, trailingTitle: match[2] };
}

/**
 * Given a link target (e.g. `folder/oldName.png`, `oldName`), returns the
 * replacement target when it points to `oldPath`, or null if unrelated.
 * Mirrors Urano: a target written without extension stays without it for
 * markdown notes, while non-markdown targets always carry the extension.
 */
function resolveReplacementTarget(
  rawTarget: string,
  oldPath: string,
  newPath: string,
  isMarkdownLink = false,
  vaultRoot?: string
): string | null {
  const trimmed = rawTarget.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return null;
  }

  const wasUrlEncoded = /%[0-9a-fA-F]{2}/.test(trimmed);
  let decodedTarget = trimmed;
  if (wasUrlEncoded) {
    try {
      decodedTarget = decodeURIComponent(trimmed);
    } catch {
      decodedTarget = trimmed;
    }
  }

  const { dir: oldDir, fileName: oldFileName, baseName: oldBaseName, ext: oldExt } = splitPath(oldPath);
  const { dir: newDir, fileName: newFileName, baseName: newBaseName } = splitPath(newPath);
  const isMd = oldExt.toLowerCase() === '.md' || oldExt.toLowerCase() === '.markdown';

  const cleanTarget = normalizePath(decodedTarget);
  const lastSlash = cleanTarget.lastIndexOf('/');
  const targetDir = lastSlash !== -1 ? cleanTarget.substring(0, lastSlash) : '';
  const targetFile = lastSlash !== -1 ? cleanTarget.substring(lastSlash + 1) : cleanTarget;

  const matchesFileName = targetFile.toLowerCase() === oldFileName.toLowerCase();
  const matchesBaseName = isMd && targetFile.toLowerCase() === oldBaseName.toLowerCase();

  if (!matchesFileName && !matchesBaseName) {
    return null;
  }

  const lowerOldDir = oldDir.toLowerCase();
  const lowerNewDir = newDir.toLowerCase();
  const lowerTargetDir = targetDir.replace(/^(\.\/)+/, '').toLowerCase();

  let nextDirPrefix = '';
  if (lowerTargetDir) {
    const dirMatches =
      lowerOldDir === lowerTargetDir || lowerOldDir.endsWith(`/${lowerTargetDir}`);
    if (!dirMatches) {
      return null;
    }

    if (lowerOldDir === lowerNewDir) {
      nextDirPrefix = `${targetDir}/`;
    } else if (vaultRoot) {
      const normRoot = normalizePath(vaultRoot);
      const lowerRoot = normRoot.toLowerCase();
      if (lowerNewDir === lowerRoot) {
        nextDirPrefix = '';
      } else if (lowerNewDir.startsWith(`${lowerRoot}/`)) {
        const relNew = newDir.slice(normRoot.length).replace(/^\/+/, '');
        nextDirPrefix = relNew ? `${relNew}/` : '';
      } else {
        const newDirName = newDir.split('/').filter(Boolean).pop() || '';
        nextDirPrefix = newDirName ? `${newDirName}/` : '';
      }
    } else {
      const rootPrefixLen = oldDir.length - lowerTargetDir.length;
      const rootPrefix = oldDir.slice(0, rootPrefixLen).replace(/\/+$/, '');
      if (
        rootPrefix &&
        (lowerNewDir === rootPrefix.toLowerCase() ||
          lowerNewDir.startsWith(`${rootPrefix.toLowerCase()}/`))
      ) {
        const relNewDir = newDir.slice(rootPrefix.length).replace(/^\/+/, '');
        nextDirPrefix = relNewDir ? `${relNewDir}/` : '';
      } else if (lowerNewDir && lowerOldDir.startsWith(`${lowerNewDir}/`)) {
        // Moved up into an ancestor directory (e.g. vault root)
        nextDirPrefix = '';
      } else {
        const newDirName = newDir.split('/').filter(Boolean).pop() || '';
        nextDirPrefix = newDirName ? `${newDirName}/` : '';
      }
    }
  }

  const replacementName = matchesFileName ? newFileName : isMd ? newBaseName : newFileName;
  const finalTarget = `${nextDirPrefix}${replacementName}`;
  if (isMarkdownLink && wasUrlEncoded) {
    return encodeURI(finalTarget);
  }
  return finalTarget;
}

/**
 * Finds every wikilink / embed / markdown link that points to `oldPath` and
 * returns the exact ranges to replace. Aliases (`|Alias`), dimensions (`|300`)
 * and heading anchors (`#heading`) are preserved untouched, and code spans/blocks are skipped.
 */
export function findLinkReplacements(
  text: string,
  oldPath: string,
  newPath: string,
  vaultRoot?: string
): LinkReplacement[] {
  const replacements: LinkReplacement[] = [];
  const maskedRanges = collectCodeMaskRanges(text);

  // 1. Wikilinks & Embeds: [[target]] / ![[target]] / ![[target|300]] / [[target#head|alias]]
  const wikilinkRegex = /(!?\[\[)([^\]|#]+)(.*?)(\]\])/g;
  let m: RegExpExecArray | null;
  while ((m = wikilinkRegex.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (isRangeMasked(from, to, maskedRanges)) continue;
    const [, prefix, rawTarget, rest, suffix] = m;
    const replacement = resolveReplacementTarget(rawTarget, oldPath, newPath, false, vaultRoot);
    if (replacement === null) continue;
    const insert = `${prefix}${replacement}${rest}${suffix}`;
    if (insert === m[0]) continue;
    replacements.push({ from, to, insert });
  }

  // 2. Standard markdown links: [alias](target) / ![alt](target "title")
  const mdLinkRegex = /(!?\[[^\]]*\]\()([^)#]+)(.*?\))/g;
  while ((m = mdLinkRegex.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (isRangeMasked(from, to, maskedRanges)) continue;
    const [, prefix, rawTargetGroup, rest] = m;
    const parsedTarget = splitMarkdownTargetAndSuffix(rawTargetGroup);
    if (!parsedTarget) continue;
    const replacement = resolveReplacementTarget(
      parsedTarget.rawTarget,
      oldPath,
      newPath,
      true,
      vaultRoot
    );
    if (replacement === null) continue;
    const wrappedReplacement = rawTargetGroup.trimStart().startsWith('<')
      ? `<${replacement}>`
      : replacement;
    const insert = `${prefix}${wrappedReplacement}${parsedTarget.trailingTitle}${rest}`;
    if (insert === m[0]) continue;
    replacements.push({ from, to, insert });
  }

  // Sort and drop overlaps (keep the earliest match)
  replacements.sort((a, b) => a.from - b.from);
  const result: LinkReplacement[] = [];
  let lastEnd = -1;
  for (const r of replacements) {
    if (r.from < lastEnd) continue;
    result.push(r);
    lastEnd = r.to;
  }
  return result;
}

/** Applies range replacements (computed over `text`) and returns the new text. */
export function applyReplacements(text: string, replacements: LinkReplacement[]): string {
  if (replacements.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const r of replacements) {
    out += text.slice(cursor, r.from) + r.insert;
    cursor = r.to;
  }
  return out + text.slice(cursor);
}

/**
 * Replaces wikilinks and standard markdown links in a markdown text string.
 * Preserves subpaths (#heading), aliases (|alias), and embed dimensions (|300, |300x200).
 */
export function replaceLinksInMarkdown(
  text: string,
  oldPath: string,
  newPath: string,
  vaultRoot?: string
): { updatedText: string; count: number } {
  const replacements = findLinkReplacements(text, oldPath, newPath, vaultRoot);
  return { updatedText: applyReplacements(text, replacements), count: replacements.length };
}

/**
 * Replaces references inside a .canvas JSON string
 */
export function replaceLinksInCanvas(
  content: string,
  oldPath: string,
  newPath: string,
  vaultRoot?: string
): { updatedContent: string; count: number } {
  try {
    const canvasObj = JSON.parse(content);
    let count = 0;
    let changed = false;

    if (Array.isArray(canvasObj.nodes)) {
      for (const node of canvasObj.nodes) {
        if (node.type === 'file' && typeof node.file === 'string') {
          const replacement = resolveReplacementTarget(
            node.file,
            oldPath,
            newPath,
            false,
            vaultRoot
          );
          if (replacement !== null && replacement !== node.file) {
            node.file = replacement;
            count++;
            changed = true;
          }
        } else if (node.type === 'text' && typeof node.text === 'string') {
          const res = replaceLinksInMarkdown(node.text, oldPath, newPath, vaultRoot);
          if (res.count > 0) {
            node.text = res.updatedText;
            count += res.count;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      return {
        updatedContent: JSON.stringify(canvasObj, null, 2),
        count,
      };
    }
    return { updatedContent: content, count: 0 };
  } catch {
    // Fallback if not valid JSON
    const res = replaceLinksInMarkdown(content, oldPath, newPath, vaultRoot);
    return { updatedContent: res.updatedText, count: res.count };
  }
}

async function readAllVaultNotesWithUnsavedEdits(
  vaultPath: string
): Promise<Record<string, string>> {
  let notesMap: Record<string, string> = {};

  try {
    notesMap = await invoke<Record<string, string>>('get_vault_notes_content', {
      vaultPath,
    });
  } catch (err) {
    console.warn('Fallback to notesContentMap from store:', err);
    notesMap = useVaultStore.getState().notesContentMap || {};
  }

  // The active note may hold unsaved edits: scan what the user actually sees.
  const { activeFile, fileContent, isDirty } = useVaultStore.getState();
  if (activeFile && isDirty) {
    const normActive = normalizePath(activeFile).toLowerCase();
    const existingKey = Object.keys(notesMap).find(
      (k) => normalizePath(k).toLowerCase() === normActive
    );
    notesMap = { ...notesMap, [existingKey || activeFile]: fileContent };
  }

  return notesMap;
}

/**
 * Scans the entire vault (all .md and .canvas files) for backlinks/embeds pointing to `oldPath`.
 * Returns exact counts: totalLinks and totalFiles, plus prepared changes.
 */
export async function scanAffectedLinks(
  vaultPath: string,
  oldPath: string,
  newPath: string
): Promise<LinkScanResult> {
  const notesMap = await readAllVaultNotesWithUnsavedEdits(vaultPath);
  const changes: AffectedFileChange[] = [];
  let totalLinks = 0;
  const normOld = normalizePath(oldPath).toLowerCase();

  for (const [filePath, content] of Object.entries(notesMap)) {
    if (normalizePath(filePath).toLowerCase() === normOld) {
      continue;
    }

    const isCanvas = filePath.toLowerCase().endsWith('.canvas');
    const { updatedText, count } = isCanvas
      ? (() => {
          const c = replaceLinksInCanvas(content, oldPath, newPath, vaultPath);
          return { updatedText: c.updatedContent, count: c.count };
        })()
      : replaceLinksInMarkdown(content, oldPath, newPath, vaultPath);

    if (count > 0 && updatedText !== content) {
      totalLinks += count;
      changes.push({
        filePath,
        originalContent: content,
        newContent: updatedText,
        count,
      });
    }
  }

  return {
    totalLinks,
    totalFiles: changes.length,
    changes,
  };
}

/**
 * Scans links across the vault after renaming/moving a folder containing multiple files.
 * Applies all moved-file pair replacements sequentially per note so notes linking to multiple
 * moved files get all links updated together.
 */
export async function scanFolderLinkRefactor(
  vaultPath: string,
  filePairs: MovedFilePair[],
  remapMovedFilePath?: (oldFilePath: string) => string | null
): Promise<LinkScanResult> {
  if (filePairs.length === 0) {
    return { totalLinks: 0, totalFiles: 0, changes: [] };
  }

  const notesMap = await readAllVaultNotesWithUnsavedEdits(vaultPath);
  const changes: AffectedFileChange[] = [];
  let totalLinks = 0;

  for (const [rawFilePath, originalContent] of Object.entries(notesMap)) {
    const targetFilePath = remapMovedFilePath?.(rawFilePath) ?? rawFilePath;
    const isCanvas = targetFilePath.toLowerCase().endsWith('.canvas');
    let workingContent = originalContent;
    let fileCount = 0;

    for (const pair of filePairs) {
      if (isCanvas) {
        const res = replaceLinksInCanvas(workingContent, pair.oldPath, pair.newPath, vaultPath);
        workingContent = res.updatedContent;
        fileCount += res.count;
      } else {
        const res = replaceLinksInMarkdown(workingContent, pair.oldPath, pair.newPath, vaultPath);
        workingContent = res.updatedText;
        fileCount += res.count;
      }
    }

    if (fileCount > 0 && workingContent !== originalContent) {
      totalLinks += fileCount;
      changes.push({
        filePath: targetFilePath,
        originalContent,
        newContent: workingContent,
        count: fileCount,
      });
    }
  }

  return {
    totalLinks,
    totalFiles: changes.length,
    changes,
  };
}

/**
 * Applies precomputed link changes to disk, `notesContentMap`, and live CodeMirror 6 if active.
 */
export async function applyLinkChanges(
  changes: AffectedFileChange[],
  liveReplacementPairs?: MovedFilePair[]
): Promise<void> {
  if (changes.length === 0) return;

  const { activeFile, activeVault, notesContentMap } = useVaultStore.getState();
  const updatedMap = { ...notesContentMap };
  const normActive = activeFile ? normalizePath(activeFile).toLowerCase() : null;
  const vaultRoot = activeVault || undefined;

  for (const change of changes) {
    try {
      let contentToWrite = change.newContent;
      const isActiveNote =
        normActive !== null && normActive === normalizePath(change.filePath).toLowerCase();

      if (isActiveNote && !change.filePath.toLowerCase().endsWith('.canvas')) {
        const view = getActiveEditorView();
        if (view && liveReplacementPairs?.length) {
          for (const pair of liveReplacementPairs) {
            const liveDoc = view.state.doc.toString();
            const ranges = findLinkReplacements(liveDoc, pair.oldPath, pair.newPath, vaultRoot);
            if (ranges.length > 0) {
              view.dispatch({ changes: ranges });
            }
          }
          contentToWrite = view.state.doc.toString();
        }
        useVaultStore.setState({ fileContent: contentToWrite, isDirty: false });
      }

      await invoke('write_file', { filePath: change.filePath, content: contentToWrite });
      updatedMap[change.filePath] = contentToWrite;
    } catch (err) {
      console.error(`Error updating links in ${change.filePath}:`, err);
    }
  }

  useVaultStore.setState({ notesContentMap: updatedMap });
}

/**
 * Returns a copy of the file tree where the item at `oldPath` is renamed to `newPath`.
 * Lets the sidebar, breadcrumbs and image resolver see the new name instantly,
 * before the asynchronous `refreshTree()` round-trip completes.
 */
export function renameInFileTree(tree: FileItem[], oldPath: string, newPath: string): FileItem[] {
  const normOld = normalizePath(oldPath).toLowerCase();
  const { fileName } = splitPath(newPath);
  const walk = (items: FileItem[]): FileItem[] =>
    items.map((item) => {
      if (normalizePath(item.path).toLowerCase() === normOld) {
        return { ...item, path: newPath, name: fileName };
      }
      if (item.children && item.children.length > 0) {
        return { ...item, children: walk(item.children) };
      }
      return item;
    });
  return walk(tree);
}

/**
 * Shared part of every rename: disk rename, in-memory tree + cache patch,
 * tab/breadcrumb notification and active file re-pointing.
 */
async function applyPhysicalRename(oldPath: string, newPath: string): Promise<void> {
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);

  // 1. Rename the physical file on disk
  await invoke('rename_item', { oldPath, newPath });

  // 2. Image cache: the new name must resolve instantly in CM6 widgets / ImageView
  renameImageInCache(oldPath, newPath);

  // 3. Patch in-memory state synchronously (tree, content map, active file)
  const { activeFile, notesContentMap, fileTree } = useVaultStore.getState();
  const updatedMap = { ...notesContentMap };
  const normOld = normalizePath(oldPath).toLowerCase();
  const matchedKey = Object.keys(updatedMap).find(
    (k) => normalizePath(k).toLowerCase() === normOld
  );
  if (matchedKey) {
    updatedMap[newPath] = updatedMap[matchedKey];
    if (matchedKey !== newPath) {
      delete updatedMap[matchedKey];
    }
  }

  // Tabs/breadcrumbs listen to this event. Dispatch BEFORE re-pointing activeFile so
  // the tab sync effect finds the renamed tab instead of opening a duplicate.
  const detail: FileRenamedDetail = { oldPath, newPath, newFileName, newBaseName };
  window.dispatchEvent(new CustomEvent<FileRenamedDetail>(FILE_RENAMED_EVENT, { detail }));

  const isActive = !!activeFile && normalizePath(activeFile).toLowerCase() === normOld;
  useVaultStore.setState({
    fileTree: renameInFileTree(fileTree, oldPath, newPath),
    notesContentMap: updatedMap,
    ...(isActive ? { activeFile: newPath, activeFileName: newFileName } : {}),
  });
}

/**
 * Executes file rename AND updates all affected links across disk, CodeMirror 6,
 * blob URL image cache, and in-memory stores.
 */
export async function executeLinkRefactor(
  plan: LinkScanResult,
  oldPath: string,
  newPath: string
): Promise<void> {
  await applyPhysicalRename(oldPath, newPath);
  await applyLinkChanges(plan.changes, [{ oldPath, newPath }]);
  await useVaultStore.getState().refreshTree();
}

/**
 * Renames ONLY the physical file on disk without refactoring any links in other notes.
 * Used when user selects "Do not update" or closes the modal.
 */
export async function executeFileRenameOnly(oldPath: string, newPath: string): Promise<void> {
  await applyPhysicalRename(oldPath, newPath);
  await useVaultStore.getState().refreshTree();
}
