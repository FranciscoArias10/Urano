import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '../stores/vaultStore';
import { renameImageInCache } from '../editor/imageExtension';
import { getActiveEditorView } from '../components/editor/Editor';
import { FileItem } from '../types';

export type AlwaysUpdatePreference = 'always' | 'prompt' | 'never';

const PREF_KEY = 'urano_always_update_links';

/**
 * Gets the persistent preference from localStorage. Default is "prompt".
 */
export function getAlwaysUpdateLinksPref(): AlwaysUpdatePreference {
  try {
    const val = localStorage.getItem(PREF_KEY);
    if (val === 'always' || val === 'never' || val === 'prompt') {
      return val;
    }
  } catch {
    // localStorage unavailable
  }
  return 'prompt';
}

/**
 * Sets the persistent preference in localStorage.
 */
export function setAlwaysUpdateLinksPref(pref: AlwaysUpdatePreference): void {
  try {
    localStorage.setItem(PREF_KEY, pref);
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

export const FILE_RENAMED_EVENT = 'urano-file-renamed';

const normalizePath = (p: string) => p.replace(/\\/g, '/');

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
 * Given a link target (e.g. `folder/oldName.png`, `oldName`), returns the
 * replacement target when it points to `oldPath`, or null if unrelated.
 * Mirrors Obsidian: a target written without extension stays without it for
 * markdown notes, while non-markdown targets always carry the extension.
 */
function resolveReplacementTarget(rawTarget: string, oldPath: string, newPath: string): string | null {
  const { fileName: oldFileName, baseName: oldBaseName, ext: oldExt } = splitPath(oldPath);
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);
  const isMd = oldExt.toLowerCase() === '.md' || oldExt.toLowerCase() === '.markdown';

  const cleanTarget = normalizePath(rawTarget.trim());
  const lastSlash = cleanTarget.lastIndexOf('/');
  const targetDir = lastSlash !== -1 ? cleanTarget.substring(0, lastSlash + 1) : '';
  const targetFile = lastSlash !== -1 ? cleanTarget.substring(lastSlash + 1) : cleanTarget;

  const matchesFileName = targetFile.toLowerCase() === oldFileName.toLowerCase();
  const matchesBaseName = targetFile.toLowerCase() === oldBaseName.toLowerCase();

  if (!matchesFileName && !matchesBaseName) {
    return null;
  }

  const replacementName = matchesFileName ? newFileName : isMd ? newBaseName : newFileName;
  return `${targetDir}${replacementName}`;
}

/**
 * Finds every wikilink / embed / markdown link that points to `oldPath` and
 * returns the exact ranges to replace. Aliases (`|Alias`), dimensions (`|300`)
 * and heading anchors (`#heading`) are preserved untouched.
 */
export function findLinkReplacements(text: string, oldPath: string, newPath: string): LinkReplacement[] {
  const replacements: LinkReplacement[] = [];

  // 1. Wikilinks & Embeds: [[target]] / ![[target]] / ![[target|300]] / [[target#head|alias]]
  const wikilinkRegex = /(!?\[\[)([^\]|#]+)(.*?)(\]\])/g;
  let m: RegExpExecArray | null;
  while ((m = wikilinkRegex.exec(text)) !== null) {
    const [full, prefix, rawTarget, rest, suffix] = m;
    const replacement = resolveReplacementTarget(rawTarget, oldPath, newPath);
    if (replacement === null) continue;
    replacements.push({
      from: m.index,
      to: m.index + full.length,
      insert: `${prefix}${replacement}${rest}${suffix}`,
    });
  }

  // 2. Standard markdown links: [alias](target) / ![alt](target)
  const mdLinkRegex = /(!?\[[^\]]*\]\()([^)#]+)(.*?\))/g;
  while ((m = mdLinkRegex.exec(text)) !== null) {
    const [full, prefix, rawTarget, rest] = m;
    const replacement = resolveReplacementTarget(rawTarget, oldPath, newPath);
    if (replacement === null) continue;
    replacements.push({
      from: m.index,
      to: m.index + full.length,
      insert: `${prefix}${replacement}${rest}`,
    });
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
  newPath: string
): { updatedText: string; count: number } {
  const replacements = findLinkReplacements(text, oldPath, newPath);
  return { updatedText: applyReplacements(text, replacements), count: replacements.length };
}

/**
 * Replaces references inside a .canvas JSON string
 */
export function replaceLinksInCanvas(
  content: string,
  oldPath: string,
  newPath: string
): { updatedContent: string; count: number } {
  const { fileName: oldFileName, baseName: oldBaseName } = splitPath(oldPath);
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);

  try {
    const canvasObj = JSON.parse(content);
    let count = 0;
    let changed = false;

    if (Array.isArray(canvasObj.nodes)) {
      for (const node of canvasObj.nodes) {
        if (node.type === 'file' && typeof node.file === 'string') {
          const normFile = normalizePath(node.file);
          const lastSlash = normFile.lastIndexOf('/');
          const nodeDir = lastSlash !== -1 ? normFile.substring(0, lastSlash + 1) : '';
          const nodeFile = lastSlash !== -1 ? normFile.substring(lastSlash + 1) : normFile;

          if (nodeFile.toLowerCase() === oldFileName.toLowerCase()) {
            node.file = `${nodeDir}${newFileName}`;
            count++;
            changed = true;
          } else if (nodeFile.toLowerCase() === oldBaseName.toLowerCase()) {
            node.file = `${nodeDir}${newBaseName}`;
            count++;
            changed = true;
          }
        } else if (node.type === 'text' && typeof node.text === 'string') {
          const res = replaceLinksInMarkdown(node.text, oldPath, newPath);
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
    const res = replaceLinksInMarkdown(content, oldPath, newPath);
    return { updatedContent: res.updatedText, count: res.count };
  }
}

/**
 * Scans the entire vault (all .md and .canvas files) for backlinks/embeds pointing to oldPath.
 * Returns exact counts: totalLinks and totalFiles, plus prepared changes.
 */
export async function scanAffectedLinks(
  vaultPath: string,
  oldPath: string,
  newPath: string
): Promise<LinkScanResult> {
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
  if (activeFile && isDirty && Object.prototype.hasOwnProperty.call(notesMap, activeFile)) {
    notesMap = { ...notesMap, [activeFile]: fileContent };
  }

  const changes: AffectedFileChange[] = [];
  let totalLinks = 0;
  const normOld = normalizePath(oldPath);

  for (const [filePath, content] of Object.entries(notesMap)) {
    // Skip scanning the file itself
    if (normalizePath(filePath) === normOld) {
      continue;
    }

    const isCanvas = filePath.toLowerCase().endsWith('.canvas');
    let updatedContent: string;
    let count: number;
    if (isCanvas) {
      const c = replaceLinksInCanvas(content, oldPath, newPath);
      updatedContent = c.updatedContent;
      count = c.count;
    } else {
      const r = replaceLinksInMarkdown(content, oldPath, newPath);
      updatedContent = r.updatedText;
      count = r.count;
    }

    if (count > 0 && updatedContent !== content) {
      totalLinks += count;
      changes.push({
        filePath,
        originalContent: content,
        newContent: updatedContent,
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
 * Returns a copy of the file tree where the item at `oldPath` is renamed to `newPath`.
 * Lets the sidebar, breadcrumbs and image resolver see the new name instantly,
 * before the asynchronous `refreshTree()` round-trip completes.
 */
export function renameInFileTree(tree: FileItem[], oldPath: string, newPath: string): FileItem[] {
  const normOld = normalizePath(oldPath);
  const { fileName } = splitPath(newPath);
  const walk = (items: FileItem[]): FileItem[] =>
    items.map((item) => {
      if (normalizePath(item.path) === normOld) {
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
  if (Object.prototype.hasOwnProperty.call(updatedMap, oldPath)) {
    updatedMap[newPath] = updatedMap[oldPath];
    delete updatedMap[oldPath];
  }

  // Tabs/breadcrumbs listen to this event. Dispatch BEFORE re-pointing activeFile so
  // the tab sync effect finds the renamed tab instead of opening a duplicate.
  const detail: FileRenamedDetail = { oldPath, newPath, newFileName, newBaseName };
  window.dispatchEvent(new CustomEvent<FileRenamedDetail>(FILE_RENAMED_EVENT, { detail }));

  const isActive = !!activeFile && normalizePath(activeFile) === normalizePath(oldPath);
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

  const { activeFile, notesContentMap } = useVaultStore.getState();
  const updatedMap = { ...notesContentMap };
  const normActive = activeFile ? normalizePath(activeFile) : null;

  for (const change of plan.changes) {
    try {
      let contentToWrite = change.newContent;
      const isActiveNote = normActive !== null && normActive === normalizePath(change.filePath);

      // Live update of the open CodeMirror 6 document: replace only the link ranges,
      // so cursor, scroll position and undo history survive.
      if (isActiveNote && !change.filePath.toLowerCase().endsWith('.canvas')) {
        const view = getActiveEditorView();
        if (view) {
          const liveDoc = view.state.doc.toString();
          const ranges = findLinkReplacements(liveDoc, oldPath, newPath);
          if (ranges.length > 0) {
            view.dispatch({ changes: ranges });
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

  // Sync sidebar with disk (sizes, mtimes, sort order)
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
