import { invoke } from '@tauri-apps/api/core';
import type { FileItem } from '../types';
import {
  useSettingsStore,
  resolveNewFileDir,
  type NoteComposerAfterExtract,
} from '../stores/settingsStore';
import { useVaultStore } from '../stores/vaultStore';
import { scanAffectedLinks } from './linkRefactorService';
import {
  normalizePath,
  getCleanFileName,
  getRelativeVaultPath,
  isSamePath,
} from '../utils/pathUtils';

/**
 * Formats a Date according to Obsidian/Moment-style tokens commonly used in
 * Note Composer templates (`YYYY`, `YY`, `MM`, `M`, `DD`, `D`, `HH`, `H`,
 * `hh`, `h`, `mm`, `m`, `ss`, `s`).
 */
export function formatNoteComposerDate(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const pad2 = (n: number) => String(n).padStart(2, '0');

  return format.replace(
    /YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s/g,
    (token) => {
      switch (token) {
        case 'YYYY':
          return String(year);
        case 'YY':
          return String(year).slice(-2);
        case 'MM':
          return pad2(month);
        case 'M':
          return String(month);
        case 'DD':
          return pad2(day);
        case 'D':
          return String(day);
        case 'HH':
          return pad2(hours24);
        case 'H':
          return String(hours24);
        case 'hh':
          return pad2(hours12);
        case 'h':
          return String(hours12);
        case 'mm':
          return pad2(minutes);
        case 'm':
          return String(minutes);
        case 'ss':
          return pad2(seconds);
        case 's':
          return String(seconds);
        default:
          return token;
      }
    }
  );
}

/**
 * Resolves a relative note path or note name (with or without `.md`) inside `fileTree`.
 */
export function resolveVaultNotePath(
  relOrName: string,
  vaultPath: string,
  fileTree: FileItem[]
): string | null {
  const cleanQuery = normalizePath(relOrName).trim().replace(/^\/+/, '');
  if (!cleanQuery) return null;

  const queryWithMd = cleanQuery.toLowerCase().endsWith('.md')
    ? cleanQuery
    : `${cleanQuery}.md`;
  const queryNoMd = cleanQuery.replace(/\.md$/i, '');
  const normVault = normalizePath(vaultPath).replace(/\/+$/, '');

  let byExactRel: string | null = null;
  let byFileName: string | null = null;

  const walk = (items: FileItem[]) => {
    for (const item of items) {
      if (item.isDir) {
        if (item.children?.length) walk(item.children);
        continue;
      }
      if (!item.name.toLowerCase().endsWith('.md')) continue;
      const normItem = normalizePath(item.path);
      const rel =
        normVault && normItem.toLowerCase().startsWith(`${normVault.toLowerCase()}/`)
          ? normItem.slice(normVault.length + 1)
          : item.name;
      const relNoMd = rel.replace(/\.md$/i, '');
      const baseName = getCleanFileName(item.path);

      if (
        rel.toLowerCase() === queryWithMd.toLowerCase() ||
        relNoMd.toLowerCase() === queryNoMd.toLowerCase()
      ) {
        byExactRel = item.path;
        return;
      }
      if (
        !byFileName &&
        (item.name.toLowerCase() === queryWithMd.toLowerCase() ||
          baseName.toLowerCase() === queryNoMd.toLowerCase())
      ) {
        byFileName = item.path;
      }
    }
  };

  walk(fileTree);
  return byExactRel || byFileName;
}

export interface ApplyNoteComposerTemplateParams {
  content: string;
  fromTitle: string;
  newTitle: string;
  templatePath: string;
  vaultPath: string;
  fileTree: FileItem[];
}

/**
 * Applies the configured Note Composer template file, substituting:
 * `{{content}}`, `{{fromTitle}}`, `{{newTitle}}`, and `{{date:FORMAT}}` (plus `{{date}}`/`{{time}}`).
 * Returns `content` unchanged if no template is configured or the template note does not exist.
 */
export async function applyNoteComposerTemplate(
  params: ApplyNoteComposerTemplateParams
): Promise<string> {
  const { content, fromTitle, newTitle, templatePath, vaultPath, fileTree } = params;
  const trimmedTemplate = (templatePath || '').trim();
  if (!trimmedTemplate) return content;

  const resolvedTemplate = resolveVaultNotePath(trimmedTemplate, vaultPath, fileTree);
  if (!resolvedTemplate) return content;

  let templateRaw = '';
  try {
    templateRaw = await invoke<string>('read_file', { filePath: resolvedTemplate });
  } catch {
    return content;
  }

  if (!templateRaw) return content;

  const now = new Date();
  let hasContentPlaceholder = false;

  let result = templateRaw.replace(/\{\{date:([^}]+)\}\}/gi, (_, fmt: string) =>
    formatNoteComposerDate(now, fmt.trim())
  );
  result = result.replace(/\{\{date\}\}/gi, () => formatNoteComposerDate(now, 'YYYY-MM-DD'));
  result = result.replace(/\{\{time\}\}/gi, () => formatNoteComposerDate(now, 'HH:mm'));
  result = result.replace(/\{\{fromTitle\}\}/g, () => fromTitle);
  result = result.replace(/\{\{newTitle\}\}/g, () => newTitle);
  result = result.replace(/\{\{content\}\}/g, () => {
    hasContentPlaceholder = true;
    return content;
  });

  if (!hasContentPlaceholder) {
    const trimmed = result.trimEnd();
    return trimmed ? `${trimmed}\n\n${content}` : content;
  }

  return result;
}

export interface HeadingSectionRange {
  from: number;
  to: number;
  headingTitle: string;
  content: string;
  level: number;
  isHeadingLine: boolean;
}

/**
 * Finds the Markdown heading section containing `pos` (from the heading line
 * up to the start of the next heading of equal or higher level `<= level`,
 * skipping fenced code blocks).
 */
export function getHeadingSectionAtPos(
  docText: string,
  pos: number
): HeadingSectionRange | null {
  if (!docText) return null;

  const lines = docText.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  // Locate the 0-based line index for `pos`
  const clampedPos = Math.max(0, Math.min(pos, docText.length));
  let cursorLineIdx = lines.length - 1;
  for (let i = 0; i < lineStarts.length; i++) {
    const endOfLine = lineStarts[i] + lines[i].length;
    if (clampedPos <= endOfLine) {
      cursorLineIdx = i;
      break;
    }
  }

  // Scan headings outside fenced code blocks
  const headings: { lineIdx: number; level: number; title: string }[] = [];
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const hMatch = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (hMatch) {
      headings.push({
        lineIdx: i,
        level: hMatch[1].length,
        title: hMatch[2].trim(),
      });
    }
  }

  if (headings.length === 0) return null;

  // Find the last heading at or before `cursorLineIdx`
  let activeIdx = -1;
  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].lineIdx <= cursorLineIdx) {
      activeIdx = i;
      break;
    }
  }
  if (activeIdx === -1) return null;

  const currentHeading = headings[activeIdx];
  const isHeadingLine = currentHeading.lineIdx === cursorLineIdx;

  // Section ends before the next heading whose level <= currentHeading.level
  let endLineExclusive = lines.length;
  for (let i = activeIdx + 1; i < headings.length; i++) {
    if (headings[i].level <= currentHeading.level) {
      endLineExclusive = headings[i].lineIdx;
      break;
    }
  }

  const from = lineStarts[currentHeading.lineIdx];
  let to =
    endLineExclusive < lineStarts.length
      ? lineStarts[endLineExclusive] - 1
      : docText.length;

  // Trim trailing whitespace/newlines at section boundary if there is a following heading
  while (to > from && (docText[to - 1] === '\n' || docText[to - 1] === '\r')) {
    if (endLineExclusive >= lineStarts.length) break;
    to--;
  }

  const content = docText.slice(from, to);
  return {
    from,
    to,
    headingTitle: currentHeading.title,
    content,
    level: currentHeading.level,
    isHeadingLine,
  };
}

/**
 * Builds the replacement string left in the source note after extracting text.
 */
export function buildNoteComposerReplacement(
  targetNoteName: string,
  targetPath: string,
  vaultPath: string,
  afterExtract: NoteComposerAfterExtract,
  useWikilinks: boolean
): string {
  if (afterExtract === 'nothing') return '';

  const relNoExt = getRelativeVaultPath(targetPath, vaultPath) || targetNoteName;
  const targetMd = relNoExt.toLowerCase().endsWith('.md') ? relNoExt : `${relNoExt}.md`;

  if (afterExtract === 'embed') {
    return useWikilinks
      ? `![[${targetNoteName}]]`
      : `![${targetNoteName}](${encodeURI(targetMd)})`;
  }

  return useWikilinks
    ? `[[${targetNoteName}]]`
    : `[${targetNoteName}](${encodeURI(targetMd)})`;
}

const ILLEGAL_NOTE_NAME_CHARS = /[*"\\<>:|?#^\[\]]/g;

async function resolveTargetNoteDestination(params: {
  vaultPath: string;
  sourcePath: string;
  fileTree: FileItem[];
  targetPath?: string;
  newNoteName?: string;
}): Promise<{ finalPath: string; targetTitle: string; exists: boolean }> {
  const { vaultPath, sourcePath, fileTree, targetPath, newNoteName } = params;

  if (targetPath) {
    return {
      finalPath: targetPath,
      targetTitle: getCleanFileName(targetPath),
      exists: true,
    };
  }

  const rawName = (newNoteName || '').trim().replace(ILLEGAL_NOTE_NAME_CHARS, '').replace(/\.md$/i, '');
  if (!rawName) {
    throw new Error('Invalid destination note name');
  }

  const normalizedRel = normalizePath(rawName).replace(/^\/+|\/+$/g, '');
  const existingResolved = resolveVaultNotePath(normalizedRel, vaultPath, fileTree);
  if (existingResolved) {
    return {
      finalPath: existingResolved,
      targetTitle: getCleanFileName(existingResolved),
      exists: true,
    };
  }

  const segments = normalizedRel.split('/').filter(Boolean);
  const fileBase = segments.pop() || rawName;
  const subDir = segments.join('/');
  const baseDir = subDir
    ? `${normalizePath(vaultPath)}/${subDir}`.replace(/\/+/g, '/')
    : normalizePath(resolveNewFileDir(vaultPath, sourcePath));
  const finalPath = `${baseDir}/${fileBase}.md`.replace(/\/+/g, '/');

  return {
    finalPath,
    targetTitle: fileBase,
    exists: false,
  };
}

async function appendOrCreateNote(
  finalPath: string,
  vaultPath: string,
  exists: boolean,
  renderedContent: string
): Promise<string> {
  if (exists) {
    let existing = '';
    try {
      existing = await invoke<string>('read_file', { filePath: finalPath });
    } catch {
      existing = '';
    }
    const merged =
      existing.trim().length > 0
        ? `${existing.replace(/\s+$/, '')}\n\n${renderedContent}`
        : renderedContent;
    await invoke('write_file', { filePath: finalPath, content: merged });
    return merged;
  }

  const normFinal = normalizePath(finalPath);
  const parentDir = normFinal.substring(0, normFinal.lastIndexOf('/'));
  const normVault = normalizePath(vaultPath);
  if (parentDir && parentDir.toLowerCase() !== normVault.toLowerCase()) {
    try {
      await invoke('create_folder', { folderPath: parentDir });
    } catch {
      // Folder may already exist
    }
  }

  await invoke('create_file', { filePath: finalPath });
  await invoke('write_file', { filePath: finalPath, content: renderedContent });
  return renderedContent;
}

export interface ExecuteNoteExtractionParams {
  extractedText: string;
  fromPath: string;
  targetPath?: string;
  newNoteName?: string;
}

export interface ExecuteNoteExtractionResult {
  targetPath: string;
  targetTitle: string;
  replacementText: string;
}

/**
 * Extracts selected text or heading section into an existing or new note,
 * applying the configured Note Composer template and returning the replacement
 * text to leave behind in the source note.
 */
export async function executeNoteExtraction(
  params: ExecuteNoteExtractionParams
): Promise<ExecuteNoteExtractionResult> {
  const { extractedText, fromPath, targetPath, newNoteName } = params;
  const vaultState = useVaultStore.getState();
  const { activeVault, fileTree, notesContentMap } = vaultState;
  if (!activeVault) {
    throw new Error('No active vault');
  }

  const settings = useSettingsStore.getState().settings;
  const fromTitle = getCleanFileName(fromPath);
  const { finalPath, targetTitle, exists } = await resolveTargetNoteDestination({
    vaultPath: activeVault,
    sourcePath: fromPath,
    fileTree,
    targetPath,
    newNoteName,
  });

  const rendered = await applyNoteComposerTemplate({
    content: extractedText,
    fromTitle,
    newTitle: targetTitle,
    templatePath: settings.noteComposerTemplatePath,
    vaultPath: activeVault,
    fileTree,
  });

  const writtenContent = await appendOrCreateNote(finalPath, activeVault, exists, rendered);

  useVaultStore.setState({
    notesContentMap: { ...notesContentMap, [finalPath]: writtenContent },
  });
  await vaultState.refreshTree();

  const replacementText = buildNoteComposerReplacement(
    targetTitle,
    finalPath,
    activeVault,
    settings.noteComposerAfterExtract,
    settings.useWikilinks
  );

  return { targetPath: finalPath, targetTitle, replacementText };
}

export interface ExecuteNoteMergeParams {
  sourcePath: string;
  targetPath?: string;
  newNoteName?: string;
}

export interface ExecuteNoteMergeResult {
  targetPath: string;
  targetTitle: string;
  updatedLinks: number;
}

/**
 * Merges `sourcePath` into an existing or new destination note:
 * applies template if configured, appends content, updates internal links pointing
 * to the merged file, deletes the source note, and opens the destination note.
 */
export async function executeNoteMerge(
  params: ExecuteNoteMergeParams
): Promise<ExecuteNoteMergeResult> {
  const { sourcePath, targetPath, newNoteName } = params;
  const vaultState = useVaultStore.getState();
  const { activeVault, activeFile, fileContent, fileTree, notesContentMap } = vaultState;
  if (!activeVault) {
    throw new Error('No active vault');
  }

  const { finalPath, targetTitle, exists } = await resolveTargetNoteDestination({
    vaultPath: activeVault,
    sourcePath,
    fileTree,
    targetPath,
    newNoteName,
  });

  if (isSamePath(finalPath, sourcePath)) {
    throw new Error('Cannot merge a note into itself');
  }

  let sourceContent = '';
  if (isSamePath(activeFile, sourcePath)) {
    sourceContent = fileContent;
  } else {
    try {
      sourceContent = await invoke<string>('read_file', { filePath: sourcePath });
    } catch {
      sourceContent = notesContentMap[sourcePath] || '';
    }
  }

  const settings = useSettingsStore.getState().settings;
  const fromTitle = getCleanFileName(sourcePath);
  const rendered = await applyNoteComposerTemplate({
    content: sourceContent,
    fromTitle,
    newTitle: targetTitle,
    templatePath: settings.noteComposerTemplatePath,
    vaultPath: activeVault,
    fileTree,
  });

  const mergedContent = await appendOrCreateNote(finalPath, activeVault, exists, rendered);

  // Sync in-memory content before scanning links
  const updatedMap: Record<string, string> = {
    ...useVaultStore.getState().notesContentMap,
    [finalPath]: mergedContent,
  };
  if (isSamePath(activeFile, finalPath)) {
    useVaultStore.setState({ fileContent: mergedContent, isDirty: false, notesContentMap: updatedMap });
  } else {
    useVaultStore.setState({ notesContentMap: updatedMap });
  }

  // Update all internal links pointing to sourcePath -> finalPath
  const scanResult = await scanAffectedLinks(activeVault, sourcePath, finalPath);
  for (const change of scanResult.changes) {
    if (isSamePath(change.filePath, sourcePath)) continue;
    try {
      await invoke('write_file', { filePath: change.filePath, content: change.newContent });
      updatedMap[change.filePath] = change.newContent;
      if (isSamePath(useVaultStore.getState().activeFile, change.filePath)) {
        useVaultStore.setState({ fileContent: change.newContent, isDirty: false });
      }
    } catch (err) {
      console.error(`Error updating links during merge in ${change.filePath}:`, err);
    }
  }
  useVaultStore.setState({ notesContentMap: updatedMap });

  // Delete the merged source note and open the destination note
  await useVaultStore.getState().deleteItem(sourcePath);
  await useVaultStore.getState().selectFile(finalPath);
  await useVaultStore.getState().loadAllNotesContent();

  return {
    targetPath: finalPath,
    targetTitle,
    updatedLinks: scanResult.totalLinks,
  };
}


