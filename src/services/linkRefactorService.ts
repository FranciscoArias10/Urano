import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '../stores/vaultStore';
import { renameImageInCache } from '../editor/imageExtension';
import { getActiveEditorView } from '../components/editor/Editor';

export type AlwaysUpdatePreference = 'always' | 'prompt' | 'never';

const PREF_KEY = 'urano_always_update_links';

/**
 * Gets the persistent preference from localStorage. Default is "prompt".
 */
export function getAlwaysUpdateLinksPref(): AlwaysUpdatePreference {
  const val = localStorage.getItem(PREF_KEY);
  if (val === 'always' || val === 'never' || val === 'prompt') {
    return val;
  }
  return 'prompt';
}

/**
 * Sets the persistent preference in localStorage.
 */
export function setAlwaysUpdateLinksPref(pref: AlwaysUpdatePreference): void {
  localStorage.setItem(PREF_KEY, pref);
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

export function splitPath(path: string): { dir: string; fileName: string; baseName: string; ext: string } {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash !== -1 ? normalized.substring(0, lastSlash) : '';
  const fileName = lastSlash !== -1 ? normalized.substring(lastSlash + 1) : normalized;
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot > 0 ? fileName.substring(lastDot) : '';
  const baseName = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  return { dir, fileName, baseName, ext };
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
  let count = 0;
  const { fileName: oldFileName, baseName: oldBaseName, ext: oldExt } = splitPath(oldPath);
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);
  const isMd = oldExt.toLowerCase() === '.md' || oldExt.toLowerCase() === '.markdown';

  // 1. Wikilinks & Embeds: [[target]] or ![[target]] or ![[target|300]] or [[target#head|alias]]
  // Group 1: (!?\[\[)
  // Group 2: ([^\]|#]+) - target
  // Group 3: (.*?) - anchor/alias/dimensions
  // Group 4: (\]\])
  const wikilinkRegex = /(!?\[\[)([^\]|#]+)(.*?)(\]\])/g;

  let result = text.replace(wikilinkRegex, (match, prefix, rawTarget, rest, suffix) => {
    const cleanTarget = rawTarget.trim().replace(/\\/g, '/');
    const lastSlash = cleanTarget.lastIndexOf('/');
    const targetDir = lastSlash !== -1 ? cleanTarget.substring(0, lastSlash + 1) : '';
    const targetFile = lastSlash !== -1 ? cleanTarget.substring(lastSlash + 1) : cleanTarget;

    const matchesFileName = targetFile.toLowerCase() === oldFileName.toLowerCase();
    const matchesBaseName = targetFile.toLowerCase() === oldBaseName.toLowerCase();

    if (!matchesFileName && !matchesBaseName) {
      return match;
    }

    count++;

    // Determine replacement target name
    let replacementName: string;
    if (matchesFileName) {
      replacementName = newFileName;
    } else {
      // Original was without extension
      replacementName = isMd ? newBaseName : newFileName;
    }

    return `${prefix}${targetDir}${replacementName}${rest}${suffix}`;
  });

  // 2. Standard markdown links: [alias](target) or ![alt](target)
  const mdLinkRegex = /(!?\[[^\]]*\]\()([^\)#]+)(.*?\))/g;
  result = result.replace(mdLinkRegex, (match, prefix, rawTarget, rest) => {
    const cleanTarget = rawTarget.trim().replace(/\\/g, '/');
    const lastSlash = cleanTarget.lastIndexOf('/');
    const targetDir = lastSlash !== -1 ? cleanTarget.substring(0, lastSlash + 1) : '';
    const targetFile = lastSlash !== -1 ? cleanTarget.substring(lastSlash + 1) : cleanTarget;

    const matchesFileName = targetFile.toLowerCase() === oldFileName.toLowerCase();
    const matchesBaseName = targetFile.toLowerCase() === oldBaseName.toLowerCase();

    if (!matchesFileName && !matchesBaseName) {
      return match;
    }

    count++;

    let replacementName: string;
    if (matchesFileName) {
      replacementName = newFileName;
    } else {
      replacementName = isMd ? newBaseName : newFileName;
    }

    return `${prefix}${targetDir}${replacementName}${rest}`;
  });

  return { updatedText: result, count };
}

/**
 * Replaces references inside a .canvas JSON string
 */
export function replaceLinksInCanvas(
  content: string,
  oldPath: string,
  newPath: string
): { updatedContent: string; count: number } {
  const { fileName: oldFileName, baseName: oldBaseName, ext: oldExt } = splitPath(oldPath);
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);

  try {
    const canvasObj = JSON.parse(content);
    let count = 0;
    let changed = false;

    if (Array.isArray(canvasObj.nodes)) {
      for (const node of canvasObj.nodes) {
        if (node.type === 'file' && typeof node.file === 'string') {
          const normFile = node.file.replace(/\\/g, '/');
          const lastSlash = normFile.lastIndexOf('/');
          const nodeDir = lastSlash !== -1 ? normFile.substring(0, lastSlash + 1) : '';
          const nodeFile = lastSlash !== -1 ? normFile.substring(lastSlash + 1) : normFile;

          if (
            nodeFile.toLowerCase() === oldFileName.toLowerCase() ||
            nodeFile.toLowerCase() === oldBaseName.toLowerCase()
          ) {
            const hasExt =
              nodeFile.toLowerCase().endsWith(oldExt.toLowerCase()) || nodeFile.includes('.');
            const replacement = hasExt ? newFileName : newBaseName;
            node.file = `${nodeDir}${replacement}`;
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

  const changes: AffectedFileChange[] = [];
  let totalLinks = 0;

  for (const [filePath, content] of Object.entries(notesMap)) {
    // Skip scanning the file itself
    if (filePath.replace(/\\/g, '/') === oldPath.replace(/\\/g, '/')) {
      continue;
    }

    const isCanvas = filePath.toLowerCase().endsWith('.canvas');
    const { updatedText: updatedContent, count } = isCanvas
      ? (() => {
          const c = replaceLinksInCanvas(content, oldPath, newPath);
          return { updatedText: c.updatedContent, count: c.count };
        })()
      : replaceLinksInMarkdown(content, oldPath, newPath);

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
 * Executes file rename AND updates all affected links across disk, CodeMirror 6,
 * blob URL image cache, and in-memory stores.
 */
export async function executeLinkRefactor(
  plan: LinkScanResult,
  oldPath: string,
  newPath: string
): Promise<void> {
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);
  const { activeFile, notesContentMap, refreshTree } = useVaultStore.getState();

  // 1. Immediately update image cache so CM6 widget displays new filename instantly
  renameImageInCache(oldPath, newPath);

  // 2. Rename the physical file on disk
  await invoke('rename_item', { oldPath, newPath });

  // 3. Write all modified files to disk and update notesContentMap
  const updatedMap = { ...notesContentMap };

  for (const change of plan.changes) {
    try {
      await invoke('write_file', { filePath: change.filePath, content: change.newContent });
      updatedMap[change.filePath] = change.newContent;

      // 4. Live update active CodeMirror 6 editor if this note is currently open
      if (activeFile && activeFile.replace(/\\/g, '/') === change.filePath.replace(/\\/g, '/')) {
        useVaultStore.setState({ fileContent: change.newContent });
        const view = getActiveEditorView();
        if (view) {
          const currentDoc = view.state.doc.toString();
          if (currentDoc !== change.newContent) {
            view.dispatch({
              changes: { from: 0, to: currentDoc.length, insert: change.newContent },
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error updating links in ${change.filePath}:`, err);
    }
  }

  // 5. Update activeFile reference in vaultStore if the renamed file was currently open
  if (activeFile && activeFile.replace(/\\/g, '/') === oldPath.replace(/\\/g, '/')) {
    useVaultStore.setState({
      activeFile: newPath,
      activeFileName: newFileName,
    });
    if (updatedMap[oldPath]) {
      updatedMap[newPath] = updatedMap[oldPath];
      delete updatedMap[oldPath];
    }
  }

  useVaultStore.setState({ notesContentMap: updatedMap });

  // 6. Notify UI (tabs, breadcrumbs) via custom window event
  window.dispatchEvent(
    new CustomEvent('urano-file-renamed', {
      detail: {
        oldPath,
        newPath,
        newFileName,
        newBaseName,
      },
    })
  );

  // 7. Refresh sidebar file tree
  await refreshTree();
}

/**
 * Renames ONLY the physical file on disk without refactoring any links in other notes.
 * Used when user selects "Do not update" or closes the modal.
 */
export async function executeFileRenameOnly(oldPath: string, newPath: string): Promise<void> {
  const { fileName: newFileName, baseName: newBaseName } = splitPath(newPath);
  const { activeFile, notesContentMap, refreshTree } = useVaultStore.getState();

  // 1. Update image cache
  renameImageInCache(oldPath, newPath);

  // 2. Rename physical file
  await invoke('rename_item', { oldPath, newPath });

  // 3. Update activeFile in vaultStore if open
  const updatedMap = { ...notesContentMap };
  if (activeFile && activeFile.replace(/\\/g, '/') === oldPath.replace(/\\/g, '/')) {
    useVaultStore.setState({
      activeFile: newPath,
      activeFileName: newFileName,
    });
    if (updatedMap[oldPath]) {
      updatedMap[newPath] = updatedMap[oldPath];
      delete updatedMap[oldPath];
    }
    useVaultStore.setState({ notesContentMap: updatedMap });
  }

  // 4. Notify UI (tabs, breadcrumbs)
  window.dispatchEvent(
    new CustomEvent('urano-file-renamed', {
      detail: {
        oldPath,
        newPath,
        newFileName,
        newBaseName,
      },
    })
  );

  // 5. Refresh sidebar file tree
  await refreshTree();
}
