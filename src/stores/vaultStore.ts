import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { FileItem, SortOrder, BookmarkItem } from '../types';
import { isImagePath } from '../services/storageAdapter';
import { renameImageInCache, clearImageBlobUrlCache } from '../editor/imageExtension';
import { useSettingsStore, resolveNewFileDir, resolveNewCanvasDir } from './settingsStore';
import { useSyncStore } from './syncStore';
import { useNoticeStore } from '../components/common/Notice';
import { t, getLanguageCode, setLanguage } from '../locales/i18n';
import { normalizeLanguageCode } from '../locales/languages';
import { defaultBaseConfig, serializeBaseConfig } from '../components/base/baseConfig';
import {
  scanAffectedLinks,
  scanFolderLinkRefactor,
  applyLinkChanges,
  executeLinkRefactor,
  executeFileRenameOnly,
  LinkScanResult,
  MovedFilePair,
  setAlwaysUpdateLinksPref,
  FILE_RENAMED_EVENT,
  FileRenamedDetail,
} from '../services/linkRefactorService';
import {
  normalizePath,
  isSamePath,
  resolveFilePathInVault,
  resolveVaultLinkTarget,
  parseLinkTargetParts,
  getRelativeVaultPath,
} from '../utils/pathUtils';
import { useLocaleStore } from './localeStore';
import {
  formatDailyNoteDate,
  parseDailyNoteDate,
  applyDailyNoteTemplateVariables,
} from '../utils/dailyNotesUtils';
import {
  getDefaultBookmarkTitle,
  isSameBookmarkTarget,
  loadVaultBookmarks,
  normalizeSearchBookmarkQuery,
  persistVaultBookmarks,
  pruneBookmarksOnDelete,
  readVaultBookmarksFromLocalStorage,
  remapBookmarksOnRename,
  resolveBookmarkFullPath,
} from '../utils/bookmarksUtils';
import {
  FORBIDDEN_FILENAME_CHARS_RE,
  getAvailableUntitledName,
  normalizeFileNameInput,
  validateFileName as validateFileNameCentral,
  validateVaultRelativePath,
  type FileNameValidationResult,
  type ValidateFileNameOptions,
} from '../utils/fileNameValidation';

const triggerAutoSync = (vaultPath?: string | null, vaultName?: string | null) => {
  if (vaultPath) {
    useSyncStore.getState().notifyVaultChanged(vaultPath, vaultName || undefined);
  }
};

function findTreeItemByPath(items: FileItem[], targetPath: string): FileItem | null {
  const normTarget = normalizePath(targetPath).toLowerCase();
  for (const item of items) {
    if (normalizePath(item.path).toLowerCase() === normTarget) {
      return item;
    }
    if (item.children?.length) {
      const found = findTreeItemByPath(item.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function buildMovedFilePairs(
  fileTree: FileItem[],
  oldPath: string,
  newPath: string
): MovedFilePair[] {
  const item = findTreeItemByPath(fileTree, oldPath);
  if (item?.isDir) {
    const pairs: MovedFilePair[] = [];
    const walkChildren = (nodes: FileItem[]) => {
      for (const node of nodes) {
        if (node.isDir) {
          if (node.children?.length) walkChildren(node.children);
        } else {
          const remapped = remapPathPrefix(node.path, oldPath, newPath);
          if (remapped) pairs.push({ oldPath: node.path, newPath: remapped });
        }
      }
    };
    walkChildren(item.children || []);
    return pairs;
  }
  return [{ oldPath, newPath: normalizePath(newPath) }];
}

function findFileInTreeByPath(items: FileItem[], targetPath: string): string | null {
  for (const item of items) {
    if (!item.isDir && isSamePath(item.path, targetPath)) {
      return item.path;
    }
    if (item.children?.length) {
      const found = findFileInTreeByPath(item.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/** Collects lowercased direct child names inside `targetDir`, normalizing Windows/Unix slashes. */
function collectExistingNamesInDir(fileTree: FileItem[], targetDir: string): Set<string> {
  const normTargetDir = normalizePath(targetDir).toLowerCase();
  const existingNames = new Set<string>();
  const walk = (items: FileItem[]) => {
    for (const item of items) {
      const normItem = normalizePath(item.path);
      const slashIdx = normItem.lastIndexOf('/');
      const itemParent = slashIdx !== -1 ? normItem.substring(0, slashIdx).toLowerCase() : '';
      if (itemParent === normTargetDir) {
        existingNames.add(item.name.toLowerCase());
      }
      if (item.children?.length) walk(item.children);
    }
  };
  walk(fileTree);
  return existingNames;
}

/**
 * Crea un archivo `.base` con nombre único dentro de `targetDir`.
 * El nombre se elige contra el árbol (comparación normalizada, válida en Windows) y,
 * si aun así ya existe en disco (árbol desactualizado), se reintenta con el siguiente número.
 */
async function createBaseOnDisk(
  fileTree: FileItem[],
  targetDir: string
): Promise<{ path: string; name: string; fileName: string }> {
  const normTargetDir = normalizePath(targetDir);
  const existingNames = collectExistingNamesInDir(fileTree, normTargetDir);
  const untitled = t('common.untitled');
  const MAX_ATTEMPTS = 200;

  let counter = 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++, counter++) {
    const { fullName: fileName, baseName: name } =
      counter === 0
        ? getAvailableUntitledName(untitled, existingNames, '.base')
        : { fullName: `${untitled} ${counter}.base`, baseName: `${untitled} ${counter}` };
    if (existingNames.has(fileName.toLowerCase())) continue;

    const fullPath = `${normTargetDir}/${fileName}`.replace(/\/+/g, '/');
    try {
      await invoke('create_file', { filePath: fullPath });
    } catch (err) {
      // "El archivo ya existe": el árbol estaba desactualizado, probar el siguiente nombre
      lastError = err;
      existingNames.add(fileName.toLowerCase());
      continue;
    }
    await invoke('write_file', {
      filePath: fullPath,
      content: serializeBaseConfig(defaultBaseConfig(name)),
    });
    return { path: fullPath, name, fileName };
  }
  throw lastError ?? new Error('No se pudo crear la base');
}

function isPathOrDescendant(candidate: string | null | undefined, targetPrefix: string): boolean {
  if (!candidate || !targetPrefix) return false;
  if (isSamePath(candidate, targetPrefix)) return true;
  const normCandidate = normalizePath(candidate).toLowerCase();
  const normPrefix = normalizePath(targetPrefix).toLowerCase();
  return normCandidate.startsWith(`${normPrefix}/`);
}

function remapPathPrefix(targetPath: string, oldPrefix: string, newPrefix: string): string | null {
  if (isSamePath(targetPath, oldPrefix)) return normalizePath(newPrefix);
  const normTarget = normalizePath(targetPath);
  const normOld = normalizePath(oldPrefix);
  const normNew = normalizePath(newPrefix);
  if (normTarget.toLowerCase().startsWith(`${normOld.toLowerCase()}/`)) {
    return `${normNew}${normTarget.slice(normOld.length)}`;
  }
  return null;
}

function dispatchFileRenamedEvent(oldPath: string, newPath: string): void {
  const normNew = normalizePath(newPath);
  const fileName = normNew.substring(normNew.lastIndexOf('/') + 1);
  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  const detail: FileRenamedDetail = {
    oldPath,
    newPath,
    newFileName: fileName,
    newBaseName: baseName,
  };
  window.dispatchEvent(new CustomEvent<FileRenamedDetail>(FILE_RENAMED_EVENT, { detail }));
}

function buildPrefixRenamePatch(
  oldPrefix: string,
  newPrefix: string,
  fileTree: FileItem[],
  activeFile: string | null,
  notesContentMap: Record<string, string>
): {
  notesContentMap: Record<string, string>;
  activeFile?: string;
  activeFileName?: string;
} {
  const renamedPaths = new Map<string, string>();
  const recordIfMatch = (candidate: string) => {
    const remapped = remapPathPrefix(candidate, oldPrefix, newPrefix);
    if (remapped) {
      const key = normalizePath(candidate).toLowerCase();
      if (!renamedPaths.has(key)) renamedPaths.set(key, candidate);
    }
  };

  const walkFiles = (items: FileItem[]) => {
    for (const item of items) {
      if (!item.isDir) recordIfMatch(item.path);
      if (item.children?.length) walkFiles(item.children);
    }
  };
  walkFiles(fileTree);
  for (const notePath of Object.keys(notesContentMap)) recordIfMatch(notePath);
  if (activeFile) recordIfMatch(activeFile);

  for (const originalPath of renamedPaths.values()) {
    const remapped = remapPathPrefix(originalPath, oldPrefix, newPrefix);
    if (remapped) dispatchFileRenamedEvent(originalPath, remapped);
  }

  const updatedMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(notesContentMap)) {
    const remapped = remapPathPrefix(k, oldPrefix, newPrefix);
    updatedMap[remapped ?? k] = v;
  }

  const remappedActive = activeFile ? remapPathPrefix(activeFile, oldPrefix, newPrefix) : null;
  if (remappedActive) {
    const fileName = remappedActive.substring(remappedActive.lastIndexOf('/') + 1);
    return {
      notesContentMap: updatedMap,
      activeFile: remappedActive,
      activeFileName: fileName,
    };
  }
  return { notesContentMap: updatedMap };
}

function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write errors
  }
}

/** Recursively collects all non-directory files from a vault `FileItem[]` tree. */
export function flattenVaultFiles(items: FileItem[]): FileItem[] {
  const result: FileItem[] = [];
  const walk = (nodes: FileItem[]) => {
    for (const item of nodes) {
      if (!item.isDir) {
        result.push(item);
      }
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(items);
  return result;
}

const ATTACHMENT_TARGET_EXT_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|mp4|webm|ogv|mp3|wav|ogg|m4a|pdf)$/i;

/**
 * Extracts deduplicated internal `[[Target]]` wikilink targets across vault notes
 * that do not correspond to any existing file in `files`.
 */
export function extractUnresolvedWikilinks(
  notesContentMap: Record<string, string>,
  files: FileItem[],
  vaultPath: string | null,
  activeFile?: string | null,
  activeContent?: string
): string[] {
  const existingKeys = new Set<string>();
  const cleanVault = vaultPath ? normalizePath(vaultPath) : '';

  for (const file of files) {
    if (file.isDir) continue;
    const lowerName = file.name.toLowerCase();
    existingKeys.add(lowerName);
    existingKeys.add(lowerName.replace(/\.(md|markdown)$/i, ''));

    const rel = cleanVault
      ? getRelativeVaultPath(file.path, cleanVault)
      : normalizePath(file.path);
    const lowerRel = rel.toLowerCase();
    existingKeys.add(lowerRel);
    existingKeys.add(lowerRel.replace(/\.(md|markdown)$/i, ''));
  }

  const contentsByPath = new Map<string, string>();
  for (const [notePath, noteContent] of Object.entries(notesContentMap)) {
    contentsByPath.set(normalizePath(notePath), noteContent);
  }
  if (activeFile && activeContent !== undefined) {
    const normActive = normalizePath(activeFile);
    let matchedKey: string | null = null;
    for (const k of contentsByPath.keys()) {
      if (isSamePath(k, normActive)) {
        matchedKey = k;
        break;
      }
    }
    contentsByPath.set(matchedKey || normActive, activeContent);
  }

  const unresolved: string[] = [];
  const seenTargets = new Set<string>();
  const wikiRegex = /(?<!!)\[\[([^\]|#\r\n]+)(?:#[^\]|\r\n]*)?(?:\|[^\]\r\n]*)?\]\]/g;

  for (const content of contentsByPath.values()) {
    if (!content) continue;
    const sanitized = content.replace(/```[\s\S]*?```/g, '');
    wikiRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wikiRegex.exec(sanitized)) !== null) {
      const rawTarget = match[1].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
      if (!rawTarget) continue;
      if (/^https?:\/\//i.test(rawTarget)) continue;
      if (ATTACHMENT_TARGET_EXT_RE.test(rawTarget)) continue;

      const normalizedKey = rawTarget.replace(/\.(md|markdown)$/i, '').toLowerCase();
      if (!normalizedKey) continue;
      if (existingKeys.has(normalizedKey) || existingKeys.has(rawTarget.toLowerCase())) {
        continue;
      }

      if (!seenTargets.has(normalizedKey)) {
        seenTargets.add(normalizedKey);
        unresolved.push(rawTarget.replace(/\.(md|markdown)$/i, ''));
      }
    }
  }

  return unresolved.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function resolveDailyNoteTarget(
  vaultRoot: string,
  folderSetting: string,
  formatSetting: string,
  date: Date,
  locale: string
): { baseDir: string; fullPath: string; noteTitle: string } {
  const cleanRoot = normalizePath(vaultRoot).replace(/\/+$/, '');
  const cleanFolder = normalizePath(folderSetting).trim().replace(/^\/+|\/+$/g, '');
  const baseDir = cleanFolder ? `${cleanRoot}/${cleanFolder}` : cleanRoot;
  const formatted = formatDailyNoteDate(date, formatSetting || 'YYYY-MM-DD', locale)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const relPath = formatted.toLowerCase().endsWith('.md') ? formatted : `${formatted}.md`;
  const fullPath = `${baseDir}/${relPath}`.replace(/\/+/g, '/');
  const noteTitle = (formatted.split('/').pop() || formatted).replace(/\.md$/i, '');
  return { baseDir, fullPath, noteTitle };
}

async function readDailyNoteTemplateRaw(
  vaultRoot: string,
  templateSetting: string,
  fileTree: FileItem[],
  notesContentMap: Record<string, string>
): Promise<string> {
  const clean = normalizePath(templateSetting).trim().replace(/^\/+/, '');
  if (!clean) return '';

  const relWithExt = clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`;
  const expectedPath = `${normalizePath(vaultRoot).replace(/\/+$/, '')}/${relWithExt}`;
  const treeMatch = findFileInTreeByPath(fileTree, expectedPath);
  const candidatePath = treeMatch || expectedPath;

  for (const [k, v] of Object.entries(notesContentMap)) {
    if (isSamePath(k, candidatePath)) return v;
  }

  try {
    return await invoke<string>('read_file', { filePath: candidatePath });
  } catch (err) {
    console.warn('Could not read daily note template:', candidatePath, err);
    useNoticeStore.getState().showNotice(t('dailyNotes.notices.templateReadFailed'), 3000, 'error');
    return '';
  }
}

function collectExistingDailyNotes(
  items: FileItem[],
  baseDir: string,
  formatSetting: string
): Array<{ path: string; date: Date }> {
  const normBase = normalizePath(baseDir).replace(/\/+$/, '');
  const prefix = `${normBase}/`.toLowerCase();
  const results: Array<{ path: string; date: Date }> = [];

  const walk = (nodes: FileItem[]) => {
    for (const item of nodes) {
      if (item.isDir) {
        if (item.children?.length) walk(item.children);
        continue;
      }
      if (!item.name.toLowerCase().endsWith('.md')) continue;
      const normItem = normalizePath(item.path);
      if (!normItem.toLowerCase().startsWith(prefix)) continue;
      const relWithoutExt = normItem.slice(prefix.length).replace(/\.md$/i, '');
      if (relWithoutExt.split('/').some((seg) => seg.startsWith('.'))) continue;
      const parsed = parseDailyNoteDate(relWithoutExt, formatSetting);
      if (parsed) {
        results.push({ path: item.path, date: parsed });
      }
    }
  };

  walk(items);
  results.sort((a, b) => a.date.getTime() - b.date.getTime());
  return results;
}

const notifyLinksUpdated = (plan: LinkScanResult) => {
  const key =
    plan.totalLinks === 1
      ? plan.totalFiles === 1
        ? 'fileTree.notices.linkUpdatedInFile'
        : 'fileTree.notices.linkUpdatedInFiles'
      : plan.totalFiles === 1
      ? 'fileTree.notices.linksUpdatedInFile'
      : 'fileTree.notices.linksUpdatedInFiles';
  useNoticeStore
    .getState()
    .showNotice(t(key, { links: plan.totalLinks, files: plan.totalFiles }), 3000, 'success');
};

// Prohibited OS characters matching Obsidian `app.asar` (`s0e` / `Cc`): * " \ / < > : | ?
export const ILLEGAL_FILENAME_CHARS = FORBIDDEN_FILENAME_CHARS_RE;

export const validateFileName = (
  name: string,
  options?: ValidateFileNameOptions
): FileNameValidationResult => validateFileNameCentral(name, options);

export function sortFileTree(items: FileItem[], order: SortOrder): FileItem[] {
  const sorted = [...items].map((item) => {
    if (item.children) {
      return {
        ...item,
        children: sortFileTree(item.children, order),
      };
    }
    return item;
  });

  sorted.sort((a, b) => {
    // Folders always first
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }

    switch (order) {
      case 'name-asc':
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'mtime-desc':
        return (b.mtime || 0) - (a.mtime || 0);
      case 'mtime-asc':
        return (a.mtime || 0) - (b.mtime || 0);
      case 'ctime-desc':
        return (b.mtime || 0) - (a.mtime || 0);
      case 'ctime-asc':
        return (a.mtime || 0) - (b.mtime || 0);
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true });
    }
  });

  return sorted;
}

export interface RecentVault {
  name: string;
  path: string;
}

interface VaultState {
  activeVault: string | null;
  vaultName: string | null;
  recentVaults: RecentVault[];
  activeFile: string | null;
  activeFileName: string | null;
  fileContent: string;
  fileTree: FileItem[];
  files: FileItem[];
  isDirty: boolean;
  isLoading: boolean;
  loadingMessage: string;
  notesContentMap: Record<string, string>; // path -> content for graph & backlinks
  embeddedBacklinksOverrides: Record<string, boolean>; // normalized note path -> per-pane embedded backlinks visibility
  autoFocusTitle: boolean;
  shouldSelectTitleOnOpen: boolean;
  pendingRenamePrompt: {
    oldPath: string;
    newPath: string;
    plan: LinkScanResult;
  } | null;

  // Recent Vaults Actions
  addRecentVault: (name: string, path: string) => void;
  removeRecentVault: (path: string) => void;
  updateRecentVault: (oldPath: string, newPath: string, newName?: string) => void;

  // Bookmarks
  bookmarks: BookmarkItem[];
  toggleBookmark: (item: {
    type: 'file' | 'folder' | 'search';
    path: string;
    title?: string;
    query?: string;
  }) => void;
  removeBookmark: (path: string, type?: BookmarkItem['type']) => void;
  isBookmarked: (path: string, type?: BookmarkItem['type']) => boolean;
  remapVaultBookmarks: (oldPath: string, newPath: string) => void;
  pruneVaultBookmarks: (deletedPath: string) => void;

  // Sorting
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;

  // Auto-reveal
  autoReveal: boolean;
  setAutoReveal: (reveal: boolean) => void;
  setLoadingMessage: (msg: string) => void;

  // Actions
  setVault: (vaultPath: string, options?: { isStartupRestore?: boolean }) => Promise<void>;
  refreshTree: () => Promise<void>;
  selectFile: (filePath: string) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  updateContent: (content: string) => void;
  updateNoteContent: (filePath: string, content: string) => Promise<void>;
  saveCurrentFile: () => Promise<void>;
  createNote: (parentPath: string, name: string) => Promise<string>;
  createUntitledNote: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createUntitledCanvas: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createUntitledBase: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createBaseFile: (parentPath?: string) => Promise<{ path: string; name: string; fileName: string }>;
  openDailyNote: () => Promise<string>;
  openTodayDailyNote: () => Promise<string>;
  openAdjacentDailyNote: (direction: 'prev' | 'next') => Promise<string>;
  createUntitledFolder: (parentPath?: string) => Promise<string>;
  moveItem: (sourcePath: string, targetFolderPath: string) => Promise<void>;
  duplicateNote: (filePath: string) => Promise<string>;
    renameNoteWithLinkRefactor: (
      oldPath: string,
      newTitle: string
    ) => Promise<{ success: boolean; error?: string; warning?: string; newPath?: string; pendingPrompt?: boolean }>;
  resolvePendingRename: (mode: 'always' | 'once' | 'skip') => Promise<void>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  renameItem: (oldPath: string, newPath: string) => Promise<void>;
  openOrCreateWikilink: (noteName: string) => Promise<string>;
  getUnresolvedLinks: () => string[];
  loadAllNotesContent: () => Promise<void>;
  rebuildVaultCache: () => Promise<void>;
  closeActiveFile: () => Promise<void>;
  toggleEmbeddedBacklinksForNote: (filePath: string, defaultVal: boolean) => void;
  clearEmbeddedBacklinksOverrides: () => void;
  setAutoFocusTitle: (focus: boolean) => void;
  setShouldSelectTitleOnOpen: (focus: boolean) => void;
}

export function isNativeVaultFile(filePath: string): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    lower.endsWith('.canvas') ||
    lower.endsWith('.base') ||
    isImagePath(filePath)
  );
}

export const VAULT_WELCOME_OPENED_EVENT = 'urano:vault-welcome-opened';
export const VAULT_ITEM_DELETED_EVENT = 'urano:vault-item-deleted';
export const URANO_INITIALIZED_VAULTS_KEY = 'urano_initialized_vaults';

function getNormalizedVaultRegistryKey(vaultPath: string): string {
  return normalizePath(vaultPath).replace(/\/+$/, '').toLowerCase();
}

function isVaultMarkedInLocalStorage(vaultPath: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(URANO_INITIALIZED_VAULTS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    const key = getNormalizedVaultRegistryKey(vaultPath);
    return parsed.some(
      (entry) => typeof entry === 'string' && getNormalizedVaultRegistryKey(entry) === key
    );
  } catch {
    return false;
  }
}

function markVaultInLocalStorage(vaultPath: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = getNormalizedVaultRegistryKey(vaultPath);
    if (!key) return;
    const raw = localStorage.getItem(URANO_INITIALIZED_VAULTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list: string[] = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
    if (!list.some((entry) => getNormalizedVaultRegistryKey(entry) === key)) {
      list.push(key);
      localStorage.setItem(URANO_INITIALIZED_VAULTS_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore storage quota / SSR errors
  }
}

function resolveVaultConfigFolderName(configDir?: string): string {
  const trimmed = (configDir || '.urano').trim();
  if (!trimmed) return '.urano';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function hasVaultDocumentItems(items: FileItem[]): boolean {
  return items.some((item) => !item.isDir && /\.(md|markdown|canvas|base)$/i.test(item.name));
}

async function readVaultWelcomeStatus(
  vaultPath: string,
  configDir: string
): Promise<{ welcomeCreated: boolean; hasDocuments: boolean }> {
  const localMarked = isVaultMarkedInLocalStorage(vaultPath);
  try {
    const status = await invoke<{ welcomeCreated?: boolean; hasDocuments?: boolean }>(
      'get_vault_welcome_status',
      { vaultPath, configDir }
    );
    return {
      welcomeCreated: Boolean(localMarked || status?.welcomeCreated),
      hasDocuments: Boolean(status?.hasDocuments),
    };
  } catch {
    // Fallback for test environments where only read_file is mocked
    const cleanRoot = normalizePath(vaultPath).replace(/\/+$/, '');
    const cfgName = resolveVaultConfigFolderName(configDir);
    let diskMarked = false;
    try {
      const rawCfg = await invoke<string>('read_file', {
        filePath: `${cleanRoot}/${cfgName}/config.json`,
      });
      const parsed = JSON.parse(rawCfg);
      if (parsed && parsed.welcomeCreated === true) {
        diskMarked = true;
      }
    } catch {}
    if (!diskMarked) {
      try {
        await invoke<string>('read_file', {
          filePath: `${cleanRoot}/${cfgName}/settings.json`,
        });
        diskMarked = true;
      } catch {}
    }
    return {
      welcomeCreated: Boolean(localMarked || diskMarked),
      hasDocuments: false,
    };
  }
}

async function persistVaultWelcomeCreated(vaultPath: string, configDir: string): Promise<void> {
  markVaultInLocalStorage(vaultPath);
  try {
    await invoke('mark_vault_welcome_created', { vaultPath, configDir });
  } catch {
    // Fallback for test environments where only read_file / write_file are mocked
    const cleanRoot = normalizePath(vaultPath).replace(/\/+$/, '');
    const cfgName = resolveVaultConfigFolderName(configDir);
    const cfgPath = `${cleanRoot}/${cfgName}/config.json`;
    let existingObj: Record<string, unknown> = {};
    try {
      const raw = await invoke<string>('read_file', { filePath: cfgPath });
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existingObj = parsed as Record<string, unknown>;
      }
    } catch {}
    existingObj.welcomeCreated = true;
    await invoke('write_file', {
      filePath: cfgPath,
      content: JSON.stringify(existingObj, null, 2),
    }).catch(() => {});
  }
}

let selectFileRequestId = 0;

async function flushDirtyFileToDisk(
  filePath: string,
  content: string,
  activeVault: string | null,
  vaultName: string | null
): Promise<void> {
  if (!filePath || !filePath.trim() || isImagePath(filePath)) return;
  try {
    await invoke('write_file', { filePath, content });
    useSettingsStore.getState().recordSnapshot(filePath, content);
    triggerAutoSync(activeVault, vaultName);
  } catch (err) {
    console.error('Error al guardar cambios pendientes:', err);
  }
}

function getInitialRecentVaults(): RecentVault[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem('urano_recent_vaults');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter(
          (v): v is RecentVault =>
            Boolean(v && typeof v === 'object' && typeof v.path === 'string' && typeof v.name === 'string')
        );
        if (valid.length > 0) return valid;
      }
    }
    const lastVault = localStorage.getItem('urano_last_vault');
    if (lastVault) {
      const parts = lastVault.replace(/\\/g, '/').split('/');
      const name = parts[parts.length - 1] || 'Vault';
      const initial = [{ name, path: lastVault }];
      localStorage.setItem('urano_recent_vaults', JSON.stringify(initial));
      return initial;
    }
  } catch (e) {
    console.error('Error reading recent vaults:', e);
  }
  return [];
}

function getInitialVaultInfo(): { activeVault: string | null; vaultName: string | null } {
  try {
    if (typeof localStorage === 'undefined') return { activeVault: null, vaultName: null };
    const lastVault = localStorage.getItem('urano_last_vault');
    if (lastVault) {
      const parts = lastVault.replace(/\\/g, '/').split('/');
      const vaultName = parts[parts.length - 1] || 'Vault';
      return { activeVault: lastVault, vaultName };
    }
  } catch (e) {
    console.error('Error getting initial vault info:', e);
  }
  return { activeVault: null, vaultName: null };
}

const initialVaultInfo = getInitialVaultInfo();

export const useVaultStore = create<VaultState>((set, get) => ({
  activeVault: initialVaultInfo.activeVault,
  vaultName: initialVaultInfo.vaultName,
  recentVaults: getInitialRecentVaults(),
  activeFile: null,
  activeFileName: null,
  fileContent: '',
  fileTree: [],
  files: [],
  isDirty: false,
  isLoading: false,
  loadingMessage: '',
  notesContentMap: {},
  embeddedBacklinksOverrides: {},
  autoFocusTitle: false,
  shouldSelectTitleOnOpen: false,
  pendingRenamePrompt: null,

  resolvePendingRename: async (mode: 'always' | 'once' | 'skip') => {
    const { pendingRenamePrompt } = get();
    set({ pendingRenamePrompt: null });
    if (!pendingRenamePrompt) return;
    const { oldPath, newPath, plan } = pendingRenamePrompt;
    try {
      if (mode === 'skip') {
        await executeFileRenameOnly(oldPath, newPath);
        return;
      }
      if (mode === 'always') {
        useSettingsStore.getState().setSetting('alwaysUpdateLinks', true);
        setAlwaysUpdateLinksPref(true);
      }
      await executeLinkRefactor(plan, oldPath, newPath);
      notifyLinksUpdated(plan);
    } catch (err) {
      console.error('Error resolviendo renombrado:', err);
    }
  },

  addRecentVault: (name: string, path: string) => {
    const { recentVaults } = get();
    const filtered = recentVaults.filter((v) => !isSamePath(v.path, path));
    const updated = [{ name, path }, ...filtered];
    localStorage.setItem('urano_recent_vaults', JSON.stringify(updated));
    set({ recentVaults: updated });
  },

  removeRecentVault: (path: string) => {
    const { recentVaults } = get();
    const updated = recentVaults.filter((v) => !isSamePath(v.path, path));
    localStorage.setItem('urano_recent_vaults', JSON.stringify(updated));
    set({ recentVaults: updated });
  },

  updateRecentVault: (oldPath: string, newPath: string, newName?: string) => {
    const { recentVaults, activeVault, bookmarks } = get();
    const updated = recentVaults.map((v) => {
      if (isSamePath(v.path, oldPath)) {
        return {
          name: newName || v.name,
          path: newPath,
        };
      }
      return v;
    });
    safeSetLocalStorage('urano_recent_vaults', JSON.stringify(updated));
    if (activeVault && isSamePath(activeVault, oldPath)) {
      const remapped = remapBookmarksOnRename(bookmarks, oldPath, newPath);
      const configDir = useSettingsStore.getState().settings.configFolderOverride;
      void persistVaultBookmarks(newPath, remapped.bookmarks, configDir);
      set({ recentVaults: updated, bookmarks: remapped.bookmarks });
      return;
    }
    set({ recentVaults: updated });
  },

  // Bookmarks (isolated per vault in `<configDir>/bookmarks.json` + per-vault localStorage mirror)
  bookmarks: readVaultBookmarksFromLocalStorage(initialVaultInfo.activeVault),
  toggleBookmark: (item) => {
    const { bookmarks, activeVault } = get();
    if (!activeVault) return;
    const cleanQuery =
      item.type === 'search' ? normalizeSearchBookmarkQuery(item.query ?? item.path) : undefined;
    if (item.type === 'search' && !cleanQuery) return;
    const resolvedPath = resolveBookmarkFullPath(item.path, item.type, activeVault, cleanQuery);
    if (!resolvedPath) return;

    const target = { type: item.type, path: resolvedPath, query: cleanQuery };
    const exists = bookmarks.some((b) => isSameBookmarkTarget(b, target));
    let updated: BookmarkItem[];
    if (exists) {
      updated = bookmarks.filter((b) => !isSameBookmarkTarget(b, target));
    } else {
      const title =
        item.title && item.title.trim()
          ? item.title.trim()
          : getDefaultBookmarkTitle(resolvedPath, item.type, cleanQuery);
      updated = [
        ...bookmarks,
        {
          id: `${item.type}-${resolvedPath}-${Date.now()}`,
          type: item.type,
          path: resolvedPath,
          title,
          ...(cleanQuery !== undefined ? { query: cleanQuery } : {}),
          createdAt: Date.now(),
        },
      ];
    }
    const configDir = useSettingsStore.getState().settings.configFolderOverride;
    void persistVaultBookmarks(activeVault, updated, configDir);
    set({ bookmarks: updated });
  },
  removeBookmark: (path, type) => {
    const { bookmarks, activeVault } = get();
    if (!activeVault) return;
    const resolvedPath = type
      ? resolveBookmarkFullPath(path, type, activeVault)
      : path.startsWith('search:')
      ? `search:${normalizeSearchBookmarkQuery(path)}`
      : normalizePath(path);
    const updated = bookmarks.filter(
      (b) => !isSameBookmarkTarget(b, { type, path: resolvedPath })
    );
    if (updated.length === bookmarks.length) return;
    const configDir = useSettingsStore.getState().settings.configFolderOverride;
    void persistVaultBookmarks(activeVault, updated, configDir);
    set({ bookmarks: updated });
  },
  isBookmarked: (path, type) => {
    const { bookmarks, activeVault } = get();
    if (!activeVault || !path) return false;
    const resolvedPath = type
      ? resolveBookmarkFullPath(path, type, activeVault)
      : path.startsWith('search:')
      ? `search:${normalizeSearchBookmarkQuery(path)}`
      : normalizePath(path);
    return bookmarks.some((b) => isSameBookmarkTarget(b, { type, path: resolvedPath }));
  },
  remapVaultBookmarks: (oldPath, newPath) => {
    const { bookmarks, activeVault } = get();
    if (!activeVault || !bookmarks.length) return;
    const res = remapBookmarksOnRename(bookmarks, oldPath, newPath);
    if (!res.changed) return;
    const configDir = useSettingsStore.getState().settings.configFolderOverride;
    void persistVaultBookmarks(activeVault, res.bookmarks, configDir);
    set({ bookmarks: res.bookmarks });
  },
  pruneVaultBookmarks: (deletedPath) => {
    const { bookmarks, activeVault } = get();
    if (!activeVault || !bookmarks.length) return;
    const res = pruneBookmarksOnDelete(bookmarks, deletedPath);
    if (!res.changed) return;
    const configDir = useSettingsStore.getState().settings.configFolderOverride;
    void persistVaultBookmarks(activeVault, res.bookmarks, configDir);
    set({ bookmarks: res.bookmarks });
  },

  // Sorting
  sortOrder: (safeGetLocalStorage('urano_sort_order') as SortOrder) || 'name-asc',
  setSortOrder: (order: SortOrder) => {
    safeSetLocalStorage('urano_sort_order', order);
    const { fileTree } = get();
    set({ sortOrder: order, fileTree: sortFileTree(fileTree, order) });
  },

  // Auto-reveal
  autoReveal: safeGetLocalStorage('urano_auto_reveal') !== 'false',
  setAutoReveal: (reveal: boolean) => {
    safeSetLocalStorage('urano_auto_reveal', String(reveal));
    set({ autoReveal: reveal });
  },

  setAutoFocusTitle: (focus: boolean) => set({ autoFocusTitle: focus }),
  setShouldSelectTitleOnOpen: (focus: boolean) => set({ shouldSelectTitleOnOpen: focus }),
  setLoadingMessage: (msg: string) => set({ loadingMessage: msg }),

  setVault: async (vaultPath: string, options?: { isStartupRestore?: boolean }) => {
    try {
      const prevState = get();
      if (prevState.isDirty && prevState.activeFile) {
        await flushDirtyFileToDisk(
          prevState.activeFile,
          prevState.fileContent,
          prevState.activeVault,
          prevState.vaultName
        );
      }
      selectFileRequestId++;
      if (!prevState.activeVault || !isSamePath(prevState.activeVault, vaultPath)) {
        clearImageBlobUrlCache();
      }

      set({ isLoading: true, loadingMessage: 'Cargando bóveda...' });
      const settings = useSettingsStore.getState().settings;
      const detectAll = settings.detectAllFileExtensions;
      const configDir = settings.configFolderOverride || '.urano';

      // Inspect welcome-note initialization state BEFORE open_vault creates the config directory
      const preWelcomeStatus = await readVaultWelcomeStatus(vaultPath, configDir);

      let tree = await invoke<FileItem[]>('open_vault', { vaultPath, detectAll, configDir });
      let allTree = detectAll
        ? tree
        : await invoke<FileItem[]>('list_vault_files', {
            vaultPath,
            detectAll: true,
            configDir,
          }).catch(() => tree);
      let allFiles = flattenVaultFiles(allTree);

      const parts = vaultPath.replace(/\\/g, '/').split('/');
      const vaultName = parts[parts.length - 1] || t('vault.defaultVaultName');
      const hasDocuments = preWelcomeStatus.hasDocuments || hasVaultDocumentItems(allFiles);
      const shouldCreateWelcome =
        !options?.isStartupRestore && !preWelcomeStatus.welcomeCreated && !hasDocuments;

      const vaultBookmarks = await loadVaultBookmarks(vaultPath, configDir);
      safeSetLocalStorage('urano_last_vault', vaultPath);

      if (shouldCreateWelcome) {
        const activeLang = normalizeLanguageCode(
          useLocaleStore.getState().language ||
            useSettingsStore.getState().settings.language ||
            getLanguageCode() ||
            'en'
        );
        if (getLanguageCode() !== activeLang) {
          await setLanguage(activeLang);
        }

        const welcomeFileName = t('vault.welcome.fileName');
        const welcomeContent = t('vault.welcome.content');
        const cleanVaultRoot = normalizePath(vaultPath).replace(/\/+$/, '');
        const welcomePath = `${cleanVaultRoot}/${welcomeFileName}`;

        await invoke('write_file', { filePath: welcomePath, content: welcomeContent });
        await persistVaultWelcomeCreated(vaultPath, configDir);

        tree = await invoke<FileItem[]>('list_vault_files', { vaultPath, detectAll, configDir });
        allTree = detectAll
          ? tree
          : await invoke<FileItem[]>('list_vault_files', {
              vaultPath,
              detectAll: true,
              configDir,
            }).catch(() => tree);
        allFiles = flattenVaultFiles(allTree);

        set({
          activeVault: vaultPath,
          vaultName,
          fileTree: sortFileTree(tree, get().sortOrder),
          files: allFiles,
          bookmarks: vaultBookmarks,
          notesContentMap: { [welcomePath]: welcomeContent },
          activeFile: null,
          activeFileName: null,
          fileContent: '',
          isDirty: false,
          autoFocusTitle: false,
          shouldSelectTitleOnOpen: false,
          isLoading: false,
          loadingMessage: '',
        });

        get().addRecentVault(vaultName, vaultPath);
        void get().loadAllNotesContent();
        triggerAutoSync(vaultPath, vaultName);

        await get().openFile(welcomePath);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(VAULT_WELCOME_OPENED_EVENT, {
              detail: { vaultPath, filePath: welcomePath },
            })
          );
        }
        return;
      }

      // Persist initialization lock so existing vaults or restored vaults never create phantom welcome notes later
      await persistVaultWelcomeCreated(vaultPath, configDir);

      set({
        activeVault: vaultPath,
        vaultName,
        fileTree: sortFileTree(tree, get().sortOrder),
        files: allFiles,
        bookmarks: vaultBookmarks,
        activeFile: null,
        activeFileName: null,
        fileContent: '',
        isDirty: false,
        isLoading: false,
        loadingMessage: '',
      });

      get().addRecentVault(vaultName, vaultPath);
      get().loadAllNotesContent();
      triggerAutoSync(vaultPath, vaultName);

      // Restore file based on Settings → Files and links → "Default file to open"
      const defaultToOpen = useSettingsStore.getState().settings.defaultFileToOpen;
      if (defaultToOpen === 'daily-note') {
        await get()
          .openDailyNote()
          .catch((e) => console.warn('Error opening daily note:', e));
      } else if (defaultToOpen === 'last-opened') {
        const normKey = normalizePath(vaultPath);
        const lastFile =
          localStorage.getItem(`urano_last_file_${normKey}`) ||
          localStorage.getItem(`urano_last_file_${vaultPath}`);
        if (lastFile && lastFile !== 'null') {
          const resolved = resolveFilePathInVault(lastFile, tree, vaultPath);
          const existsInTree = (items: FileItem[], p: string): boolean => {
            return items.some((item) => {
              if (!item.isDir && isSamePath(item.path, p)) return true;
              return item.children ? existsInTree(item.children, p) : false;
            });
          };
          if (resolved && existsInTree(tree, resolved)) {
            await get()
              .selectFile(resolved)
              .catch(() => {});
          } else {
            try {
              localStorage.removeItem(`urano_last_file_${normKey}`);
              localStorage.removeItem(`urano_last_file_${vaultPath}`);
            } catch {}
          }
        }
      }
    } catch (err) {
      set({ isLoading: false, loadingMessage: '' });
      console.error('Error al abrir bóveda:', err);
      throw err;
    }
  },

  refreshTree: async () => {
    const { activeVault, sortOrder } = get();
    if (!activeVault) return;
    try {
      const settings = useSettingsStore.getState().settings;
      const detectAll = settings.detectAllFileExtensions;
      const configDir = settings.configFolderOverride || '.urano';
      const tree = await invoke<FileItem[]>('list_vault_files', { vaultPath: activeVault, detectAll, configDir });
      const allTree = detectAll
        ? tree
        : await invoke<FileItem[]>('list_vault_files', {
            vaultPath: activeVault,
            detectAll: true,
            configDir,
          }).catch(() => tree);
      set({
        fileTree: sortFileTree(tree, sortOrder),
        files: flattenVaultFiles(allTree),
      });
      get().loadAllNotesContent();
    } catch (err) {
      console.error('Error al refrescar árbol:', err);
    }
  },

  selectFile: async (filePath: string) => {
    const { activeFile, isDirty, saveCurrentFile, fileTree, activeVault } = get();
    if (!filePath) return;

    const resolvedPath = resolveFilePathInVault(filePath, fileTree, activeVault);
    const targetPath = resolvedPath || filePath;

    if (activeFile && isSamePath(activeFile, targetPath)) {
      if (get().fileContent !== '' || isDirty) {
        return;
      }
    }

    // Check if the file is natively supported in Urano's editor/viewers
    if (!isNativeVaultFile(targetPath)) {
      try {
        await invoke('open_file_in_default_app', { filePath: targetPath });
      } catch (err) {
        console.warn('Error al abrir con la aplicación del sistema:', err);
      }
      return;
    }

    if (isDirty && activeFile) {
      await saveCurrentFile();
    }

    const isSameActive = Boolean(activeFile && isSamePath(activeFile, targetPath));
    const reqId = ++selectFileRequestId;
    const parts = targetPath.replace(/\\/g, '/').split('/');
    const activeFileName = parts[parts.length - 1] || t('vault.defaultNoteName');

    // Update activeFile immediately and synchronously to prevent any tab/editor ping-pong or mismatch,
    // clearing stale content from the previous note before the new read completes.
    set({
      activeFile: targetPath,
      activeFileName,
      ...(isSameActive ? {} : { fileContent: '', isDirty: false }),
      isLoading: true,
    });

    if (activeVault) {
      try {
        const normVault = normalizePath(activeVault);
        localStorage.setItem(`urano_last_file_${normVault}`, targetPath);
      } catch {}
    }

    try {
      const isImg = isImagePath(targetPath);
      const content = isImg ? '' : await invoke<string>('read_file', { filePath: targetPath });

      if (reqId !== selectFileRequestId) return;

      set({
        fileContent: content,
        isDirty: false,
        isLoading: false,
        loadingMessage: '',
      });
      if (!isImg) {
        useSettingsStore.getState().recordSnapshot(targetPath, content);
      }
    } catch (err) {
      if (reqId === selectFileRequestId) {
        set({ fileContent: '', isDirty: false, isLoading: false });
      }
      console.error('Error al leer archivo:', err);
    }
  },

  openFile: async (filePath: string) => {
    return get().selectFile(filePath);
  },

  closeActiveFile: async () => {
    const { activeFile, fileContent, isDirty, activeVault, vaultName } = get();
    selectFileRequestId++;

    set({
      activeFile: null,
      activeFileName: null,
      fileContent: '',
      isDirty: false,
    });
    if (activeVault) {
      try {
        const normVault = normalizePath(activeVault);
        localStorage.removeItem(`urano_last_file_${normVault}`);
        localStorage.removeItem(`urano_last_file_${activeVault}`);
      } catch {}
    }

    if (isDirty && activeFile) {
      await flushDirtyFileToDisk(activeFile, fileContent, activeVault, vaultName);
    }
  },

  updateContent: (content: string) => {
    const { activeFile, notesContentMap } = get();
    set({
      fileContent: content,
      isDirty: true,
      notesContentMap: activeFile
        ? { ...notesContentMap, [activeFile]: content }
        : notesContentMap,
    });
  },

  /**
   * Actualiza el contenido de una nota concreta del Vault y lo persiste en disco.
   * Se usa, entre otros, por los nodos de nota del Canvas (edición en vivo).
   */
  updateNoteContent: async (filePath: string, content: string) => {
    if (!filePath) return;
    const { activeFile, fileContent, notesContentMap } = get();
    const isActive = isSamePath(activeFile, filePath);
    set({
      notesContentMap: { ...notesContentMap, [filePath]: content },
      fileContent: isActive ? content : fileContent,
      isDirty: isActive ? true : get().isDirty,
    });
    try {
      await invoke('write_file', { filePath, content });
      useSettingsStore.getState().recordSnapshot(filePath, content);
    } catch (err) {
      console.error('Error al guardar la nota editada desde el Canvas:', err);
    }
  },

  saveCurrentFile: async () => {
    const { activeFile, fileContent } = get();
    if (!activeFile || !activeFile.trim() || isImagePath(activeFile)) return;
    const savingPath = activeFile;
    const savingContent = fileContent;
    try {
      await invoke('write_file', { filePath: savingPath, content: savingContent });
      useSettingsStore.getState().recordSnapshot(savingPath, savingContent);
      const latest = get();
      if (
        latest.activeFile &&
        isSamePath(latest.activeFile, savingPath) &&
        latest.fileContent === savingContent
      ) {
        set({ isDirty: false });
      }
      get().loadAllNotesContent();
      triggerAutoSync(get().activeVault, get().vaultName);
    } catch (err) {
      console.error('Error al guardar archivo:', err);
    }
  },

  createNote: async (parentPath: string, name: string): Promise<string> => {
    const { activeVault, activeFile, fileTree } = get();
    const rawTrimmed = (name ?? '').replace(/\\/g, '/').trim().replace(/^\/+/, '');

    let targetDir = normalizePath(parentPath);
    if (
      activeVault &&
      (!targetDir || isSamePath(targetDir, activeVault)) &&
      !rawTrimmed.includes('/')
    ) {
      targetDir = normalizePath(resolveNewFileDir(activeVault, activeFile));
    }

    const validation = validateVaultRelativePath(rawTrimmed, {
      baseDir: targetDir,
      defaultExtension: '.md',
      existingItems: fileTree,
    });

    if (!validation.valid) {
      useNoticeStore
        .getState()
        .showNotice(validation.error || t('editor.notices.invalidFileName'), 4000, 'error');
      return '';
    }

    if (validation.warning) {
      useNoticeStore.getState().showNotice(validation.warning, 4000, 'warning');
    }

    const normVault = activeVault ? normalizePath(activeVault) : '';
    if (validation.parentDir && (!normVault || !isSamePath(validation.parentDir, normVault))) {
      try {
        await invoke('create_folder', { folderPath: validation.parentDir });
      } catch {}
    }

    const fullPath = validation.fullPath;
    try {
      await invoke('create_file', { filePath: fullPath });
    } catch (err: any) {
      useNoticeStore
        .getState()
        .showNotice(err?.toString() || t('editor.notices.invalidFileName'), 4000, 'error');
      return '';
    }
    await get().refreshTree();
    await get().selectFile(fullPath);
    triggerAutoSync(get().activeVault, get().vaultName);
    return fullPath;
  },

  // Urano native prompt-free creation with auto-increment resolution
  createUntitledNote: async (parentPath?: string): Promise<{ path: string; name: string }> => {
    const { activeVault, fileTree, refreshTree, selectFile, activeFile } = get();
    if (!activeVault) return { path: '', name: '' };

    let targetDir = parentPath;
    if (!targetDir || targetDir === activeVault) {
      targetDir = resolveNewFileDir(activeVault, activeFile);
    }

    const normTargetDir = normalizePath(targetDir);
    if (normTargetDir.toLowerCase() !== normalizePath(activeVault).toLowerCase()) {
      try {
        await invoke('create_folder', { folderPath: normTargetDir });
      } catch {}
    }

    // Collect all existing names in targetDir (case-insensitive)
    const existingNames = collectExistingNamesInDir(fileTree, normTargetDir);
    const untitled = t('common.untitled');
    const { fullName: candidateName, baseName: cleanUntitledName } = getAvailableUntitledName(
      untitled,
      existingNames,
      '.md'
    );

    const fullPath = `${normTargetDir}/${candidateName}`.replace(/\/+/g, '/');
    const initialContent = '';

    await invoke('create_file', { filePath: fullPath });
    if (initialContent) {
      await invoke('write_file', { filePath: fullPath, content: initialContent });
    }

    await refreshTree();
    await selectFile(fullPath);
    set({ autoFocusTitle: true, shouldSelectTitleOnOpen: true });
    triggerAutoSync(get().activeVault, get().vaultName);

    return { path: fullPath, name: cleanUntitledName };
  },

  // Urano Canvas creation (.canvas JSON format)
  createUntitledCanvas: async (parentPath?: string): Promise<{ path: string; name: string }> => {
    const { activeVault, fileTree, refreshTree, selectFile, activeFile } = get();
    if (!activeVault) return { path: '', name: '' };

    let targetDir = parentPath;
    if (!targetDir || targetDir === activeVault) {
      targetDir = resolveNewCanvasDir(activeVault, activeFile);
    }
    if (!targetDir) return { path: '', name: '' };

    const normTargetDir = normalizePath(targetDir);
    if (normTargetDir.toLowerCase() !== normalizePath(activeVault).toLowerCase()) {
      try {
        await invoke('create_folder', { folderPath: normTargetDir });
      } catch {}
    }

    const existingNames = collectExistingNamesInDir(fileTree, normTargetDir);
    const untitled = t('common.untitled');
    const { fullName: candidateName, baseName: cleanUntitledName } = getAvailableUntitledName(
      untitled,
      existingNames,
      '.canvas'
    );

    const fullPath = `${normTargetDir}/${candidateName}`.replace(/\/+/g, '/');
    const initialCanvas = JSON.stringify(
      {
        nodes: [],
        edges: [],
      },
      null,
      2
    );

    await invoke('create_file', { filePath: fullPath });
    await invoke('write_file', { filePath: fullPath, content: initialCanvas });

    await refreshTree();
    await selectFile(fullPath);
    set({ autoFocusTitle: true, shouldSelectTitleOnOpen: true });

    return { path: fullPath, name: cleanUntitledName };
  },

  // Urano Base creation (.base format)
  createUntitledBase: async (parentPath?: string): Promise<{ path: string; name: string }> => {
    const { activeVault, refreshTree, selectFile } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return { path: '', name: '' };

    const created = await createBaseOnDisk(get().fileTree, targetDir);
    await refreshTree();
    await selectFile(created.path);
    set({ autoFocusTitle: true, shouldSelectTitleOnOpen: true });

    return { path: created.path, name: created.name };
  },

  // Create .base file without changing active note (for inline embed)
  createBaseFile: async (parentPath?: string): Promise<{ path: string; name: string; fileName: string }> => {
    const { activeVault, refreshTree } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return { path: '', name: '', fileName: '' };

    const created = await createBaseOnDisk(get().fileTree, targetDir);
    await refreshTree();
    return created;
  },

  // Open or create today's daily note respecting dailyNotesFormat, dailyNotesFolder, and template
  openTodayDailyNote: async (): Promise<string> => {
    const { activeVault, fileTree, notesContentMap, refreshTree, selectFile, vaultName } = get();
    if (!activeVault) return '';

    const settings = useSettingsStore.getState().settings;
    const language = useLocaleStore.getState().language;
    const now = new Date();
    const { fullPath, noteTitle } = resolveDailyNoteTarget(
      activeVault,
      settings.dailyNotesFolder,
      settings.dailyNotesFormat,
      now,
      language
    );

    const existingInTree = findFileInTreeByPath(fileTree, fullPath);
    if (existingInTree) {
      await selectFile(existingInTree);
      return existingInTree;
    }

    // Double-check on disk in case the tree hasn't refreshed after external changes
    const existsOnDisk = await invoke<string>('read_file', { filePath: fullPath })
      .then(() => true)
      .catch(() => false);
    if (existsOnDisk) {
      await refreshTree();
      await selectFile(fullPath);
      return fullPath;
    }

    // Validate generated daily note relative path before creating folders/files
    const cleanRoot = normalizePath(activeVault).replace(/\/+$/, '');
    const relDailyPath = fullPath.toLowerCase().startsWith(`${cleanRoot.toLowerCase()}/`)
      ? fullPath.slice(cleanRoot.length + 1)
      : fullPath;
    const dailyValidation = validateVaultRelativePath(relDailyPath, {
      baseDir: cleanRoot,
      defaultExtension: '.md',
      existingItems: fileTree,
      allowExistingTarget: true,
    });
    if (!dailyValidation.valid) {
      useNoticeStore
        .getState()
        .showNotice(dailyValidation.error || t('editor.notices.invalidFileName'), 4000, 'error');
      return '';
    }
    if (dailyValidation.warning) {
      useNoticeStore.getState().showNotice(dailyValidation.warning, 4000, 'warning');
    }

    // Create intermediate subfolders automatically (e.g. dailyNotesFolder or slashes in format like YYYY/MM/DD)
    const parentDir = dailyValidation.parentDir;
    if (parentDir && parentDir !== cleanRoot) {
      await invoke('create_folder', { folderPath: parentDir }).catch(() => {});
    }

    let initialContent = '';
    if (settings.dailyNotesTemplatePath && settings.dailyNotesTemplatePath.trim()) {
      const rawTemplate = await readDailyNoteTemplateRaw(
        activeVault,
        settings.dailyNotesTemplatePath,
        fileTree,
        notesContentMap
      );
      initialContent = applyDailyNoteTemplateVariables(
        rawTemplate,
        now,
        noteTitle,
        language,
        settings.templatesDateFormat || 'YYYY-MM-DD',
        settings.templatesTimeFormat || 'HH:mm'
      );
    }

    await invoke('create_file', { filePath: fullPath });
    if (initialContent) {
      await invoke('write_file', { filePath: fullPath, content: initialContent });
    }

    set((state) => ({
      notesContentMap: {
        ...state.notesContentMap,
        [fullPath]: initialContent,
      },
    }));

    await refreshTree();
    await selectFile(fullPath);
    triggerAutoSync(activeVault, vaultName);
    return fullPath;
  },

  openDailyNote: async (): Promise<string> => get().openTodayDailyNote(),

  // Navigate to the nearest existing previous or next daily note
  openAdjacentDailyNote: async (direction: 'prev' | 'next'): Promise<string> => {
    const { activeVault, activeFile, fileTree, selectFile } = get();
    if (!activeVault) return '';

    const settings = useSettingsStore.getState().settings;
    const cleanRoot = normalizePath(activeVault).replace(/\/+$/, '');
    const cleanFolder = normalizePath(settings.dailyNotesFolder).trim().replace(/^\/+|\/+$/g, '');
    const baseDir = cleanFolder ? `${cleanRoot}/${cleanFolder}` : cleanRoot;
    const formatStr = settings.dailyNotesFormat || 'YYYY-MM-DD';

    const dailyNotes = collectExistingDailyNotes(fileTree, baseDir, formatStr);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let refTime = today.getTime();

    if (activeFile) {
      const currentMatch = dailyNotes.find((n) => isSamePath(n.path, activeFile));
      if (currentMatch) {
        refTime = currentMatch.date.getTime();
      }
    }

    let target: { path: string; date: Date } | undefined;
    if (direction === 'prev') {
      for (let i = dailyNotes.length - 1; i >= 0; i--) {
        if (dailyNotes[i].date.getTime() < refTime) {
          target = dailyNotes[i];
          break;
        }
      }
    } else {
      target = dailyNotes.find((n) => n.date.getTime() > refTime);
    }

    if (target) {
      await selectFile(target.path);
      return target.path;
    }

    useNoticeStore
      .getState()
      .showNotice(
        t(direction === 'prev' ? 'dailyNotes.notices.noPrevious' : 'dailyNotes.notices.noNext'),
        2500,
        'info'
      );
    return '';
  },

  // Move item (drag and drop into folder or Move File menu action)
  moveItem: async (sourcePath: string, targetFolderPath: string) => {
    const normSource = normalizePath(sourcePath);
    const normTargetDir = normalizePath(targetFolderPath);
    const fileName = normSource.substring(normSource.lastIndexOf('/') + 1);
    const newPath = `${normTargetDir}/${fileName}`.replace(/\/+/g, '/');
    if (isSamePath(normSource, newPath)) return;

    const { fileTree, activeFile, notesContentMap, activeVault, vaultName } = get();
    const collision = findTreeItemByPath(fileTree, newPath);
    if (collision && normalizePath(collision.path).toLowerCase() === newPath.toLowerCase()) {
      throw new Error(t('vault.errors.nameExists'));
    }

    const movedPairs = buildMovedFilePairs(fileTree, sourcePath, newPath);
    const alwaysUpdate = useSettingsStore.getState().settings.alwaysUpdateLinks;
    const scanResult =
      activeVault && alwaysUpdate && movedPairs.length > 0
        ? await scanFolderLinkRefactor(activeVault, movedPairs, (fp) =>
            remapPathPrefix(fp, sourcePath, newPath)
          )
        : null;

    await invoke('rename_item', { oldPath: sourcePath, newPath });
    for (const pair of movedPairs) {
      renameImageInCache(pair.oldPath, pair.newPath);
    }

    set(buildPrefixRenamePatch(sourcePath, newPath, fileTree, activeFile, notesContentMap));
    get().remapVaultBookmarks(sourcePath, newPath);

    if (scanResult && scanResult.changes.length > 0) {
      await applyLinkChanges(scanResult.changes, movedPairs);
      notifyLinksUpdated(scanResult);
    }

    await get().refreshTree();
    triggerAutoSync(activeVault, vaultName);
  },

  // Urano prompt-free folder creation
  createUntitledFolder: async (parentPath?: string): Promise<string> => {
    const { activeVault, fileTree, refreshTree } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return '';

    const normTargetDir = normalizePath(targetDir);
    const existingNames = collectExistingNamesInDir(fileTree, normTargetDir);

    const untitledFolder = t('vault.untitledFolder');
    const { fullName: candidateName } = getAvailableUntitledName(untitledFolder, existingNames);

    const fullPath = `${normTargetDir}/${candidateName}`.replace(/\/+/g, '/');
    await invoke('create_folder', { folderPath: fullPath });
    await refreshTree();
    return fullPath;
  },

  // Duplicate a note
  duplicateNote: async (filePath: string): Promise<string> => {
    const { fileTree, refreshTree, selectFile } = get();
    const normFilePath = normalizePath(filePath);
    const lastSlash = normFilePath.lastIndexOf('/');
    const parentDir = lastSlash !== -1 ? normFilePath.substring(0, lastSlash) : '';
    const fileName = lastSlash !== -1 ? normFilePath.substring(lastSlash + 1) : normFilePath;
    const dotIdx = fileName.lastIndexOf('.');
    const ext = dotIdx > 0 ? fileName.substring(dotIdx) : '.md';
    const baseName = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;

    const existingNames = collectExistingNamesInDir(fileTree, parentDir);

    let candidate = `${baseName} 1${ext}`;
    let counter = 2;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `${baseName} ${counter}${ext}`;
      counter++;
    }

    const newPath = (parentDir ? `${parentDir}/${candidate}` : candidate).replace(/\/+/g, '/');
    const content = await invoke<string>('read_file', { filePath });

    await invoke('create_file', { filePath: newPath });
    await invoke('write_file', { filePath: newPath, content });
    await refreshTree();
    await selectFile(newPath);

    return newPath;
  },

  // Renames a note and automatically updates all [[Wikilinks]] referencing it in all other notes
  renameNoteWithLinkRefactor: async (
    oldPath: string,
    newTitle: string
  ): Promise<{ success: boolean; error?: string; warning?: string; newPath?: string; pendingPrompt?: boolean }> => {
    if (!oldPath || !oldPath.trim()) {
      return { success: false, error: 'No active file' };
    }
    const { activeVault, fileTree } = get();

    const normOldPath = normalizePath(oldPath);
    const lastSlash = normOldPath.lastIndexOf('/');
    const parentDir = lastSlash !== -1 ? normOldPath.substring(0, lastSlash) : '';
    const oldFileName = lastSlash !== -1 ? normOldPath.substring(lastSlash + 1) : normOldPath;
    const lastDot = oldFileName.lastIndexOf('.');
    const ext = lastDot > 0 ? oldFileName.substring(lastDot) : '.md';

    const cleanedInput = normalizeFileNameInput(newTitle);
    const rawBaseTitle =
      ext &&
      cleanedInput.length > ext.length &&
      cleanedInput.toLowerCase().endsWith(ext.toLowerCase())
        ? cleanedInput.slice(0, -ext.length)
        : cleanedInput;

    const validation = validateFileNameCentral(rawBaseTitle, {
      extension: ext,
      currentPath: oldPath,
      parentDir,
      existingItems: fileTree,
    });

    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const newFileName = validation.fullFileName;
    const newPath = (parentDir ? `${parentDir}/${newFileName}` : newFileName).replace(/\/+/g, '/');

    // Exact same file name (including casing) -> no-op
    if (oldFileName === newFileName) {
      return { success: true, newPath: oldPath };
    }

    if (validation.warning) {
      useNoticeStore.getState().showNotice(validation.warning, 4000, 'warning');
    }

    try {
      const scanResult = await scanAffectedLinks(activeVault || '', oldPath, newPath);
      const alwaysUpdate = useSettingsStore.getState().settings.alwaysUpdateLinks;

      if (scanResult.totalLinks === 0) {
        await executeFileRenameOnly(oldPath, newPath);
        return { success: true, newPath, warning: validation.warning };
      }

      if (alwaysUpdate) {
        await executeLinkRefactor(scanResult, oldPath, newPath);
        notifyLinksUpdated(scanResult);
        return { success: true, newPath, warning: validation.warning };
      } else {
        set({ pendingRenamePrompt: { oldPath, newPath, plan: scanResult } });
        return { success: true, newPath, pendingPrompt: true, warning: validation.warning };
      }
    } catch (err: any) {
      console.error('Error durante el renombrado:', err);
      return { success: false, error: err?.toString() || t('vault.errors.renameFailed') };
    }
  },

  createFolder: async (parentPath: string, name: string) => {
    const validation = validateVaultRelativePath(name, {
      baseDir: parentPath,
      defaultExtension: '',
      knownExtensionsRe: /^$/,
      existingItems: get().fileTree,
    });
    if (!validation.valid) {
      useNoticeStore
        .getState()
        .showNotice(validation.error || t('fileTree.notices.invalidName'), 4000, 'error');
      throw new Error(validation.error || t('fileTree.notices.invalidName'));
    }
    if (validation.warning) {
      useNoticeStore.getState().showNotice(validation.warning, 4000, 'warning');
    }
    await invoke('create_folder', { folderPath: validation.fullPath });
    await get().refreshTree();
    triggerAutoSync(get().activeVault, get().vaultName);
  },

  deleteItem: async (path: string) => {
    const { activeVault, activeFile, refreshTree, notesContentMap, fileTree } = get();
    const settings = useSettingsStore.getState().settings;
    const trashOption =
      settings.trashOption ||
      (settings.deletedFilesDestination === 'trash'
        ? 'local'
        : settings.deletedFilesDestination === 'permanent'
        ? 'none'
        : 'system');
    const deleteAttachmentsMode = settings.deleteAttachmentsWithFile || 'never';

    const removeSinglePath = async (targetPath: string) => {
      if (trashOption === 'system') {
        try {
          await invoke('move_to_system_trash', { path: targetPath });
        } catch (sysErr) {
          console.warn('move_to_system_trash falló, usando delete_item:', sysErr);
          await invoke('delete_item', { path: targetPath });
        }
      } else if (trashOption === 'local' && activeVault) {
        try {
          const parts = targetPath.replace(/\\/g, '/').split('/');
          const fileName = parts[parts.length - 1];
          const trashDir = `${activeVault}/.trash`.replace(/\/+/g, '/');
          try {
            await invoke('create_folder', { folderPath: trashDir });
          } catch {}

          let targetTrashPath = `${trashDir}/${fileName}`.replace(/\/+/g, '/');
          const now = Date.now();
          try {
            await invoke('rename_item', { oldPath: targetPath, newPath: targetTrashPath });
          } catch {
            const dotIdx = fileName.lastIndexOf('.');
            const base = dotIdx !== -1 ? fileName.substring(0, dotIdx) : fileName;
            const ext = dotIdx !== -1 ? fileName.substring(dotIdx) : '';
            targetTrashPath = `${trashDir}/${base} ${now}${ext}`.replace(/\/+/g, '/');
            await invoke('rename_item', { oldPath: targetPath, newPath: targetTrashPath });
          }
        } catch (trashErr) {
          console.warn('Failed to move to .trash, falling back to delete_item:', trashErr);
          await invoke('delete_item', { path: targetPath });
        }
      } else {
        await invoke('delete_item', { path: targetPath });
      }
    };

    // If deleting a markdown note and deleteAttachmentsWithFile is enabled (ask / always)
    if ((path.endsWith('.md') || path.endsWith('.markdown')) && deleteAttachmentsMode !== 'never') {
      try {
        const noteContent =
          notesContentMap[path] ||
          (await invoke<string>('read_file', { filePath: path }).catch(() => ''));
        if (noteContent) {
          // Collect all attachment references
          const targets = new Set<string>();
          const wikiRegex = /!\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
          let m: RegExpExecArray | null;
          while ((m = wikiRegex.exec(noteContent)) !== null) {
            targets.add(m[1].trim());
          }
          const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
          while ((m = mdRegex.exec(noteContent)) !== null) {
            if (!m[1].startsWith('http://') && !m[1].startsWith('https://')) {
              targets.add(decodeURIComponent(m[1].trim()));
            }
          }

          if (targets.size > 0) {
            // Find physical files
            const allFiles: FileItem[] = [];
            const collect = (items: FileItem[]) => {
              for (const it of items) {
                if (!it.isDir) allFiles.push(it);
                if (it.children) collect(it.children);
              }
            };
            collect(fileTree);

            const unlinkedAttachments: string[] = [];
            for (const target of targets) {
              const cleanTarget = target.replace(/\\/g, '/');
              const targetName = cleanTarget.split('/').pop()?.toLowerCase();
              const found = allFiles.find((f) => {
                const p = f.path.replace(/\\/g, '/');
                return (
                  p.toLowerCase().endsWith(cleanTarget.toLowerCase()) ||
                  f.name.toLowerCase() === targetName
                );
              });
              if (found && isImagePath(found.path)) {
                // Check if used in other notes
                const attName = found.name;
                const nameWithoutExt = attName.substring(0, attName.lastIndexOf('.'));
                const isUsedElsewhere = Object.entries(notesContentMap).some(
                  ([otherNotePath, content]) => {
                    if (isSamePath(otherNotePath, path)) return false;
                    return (
                      content.includes(attName) ||
                      (nameWithoutExt && content.includes(nameWithoutExt))
                    );
                  }
                );
                if (!isUsedElsewhere) {
                  unlinkedAttachments.push(found.path);
                }
              }
            }

            if (unlinkedAttachments.length > 0) {
              let shouldDelete = deleteAttachmentsMode === 'always';
              if (deleteAttachmentsMode === 'ask') {
                shouldDelete = window.confirm(
                  t('vault.confirmDeleteUnlinkedAttachments', { count: unlinkedAttachments.length })
                );
              }
              if (shouldDelete) {
                for (const att of unlinkedAttachments) {
                  await removeSinglePath(att);
                  get().pruneVaultBookmarks(att);
                }
              }
            }
          }
        }
      } catch (attErr) {
        console.warn('Error checking unlinked attachments:', attErr);
      }
    }

    // Delete the main item
    await removeSinglePath(path);
    get().pruneVaultBookmarks(path);

    const updatedMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(get().notesContentMap)) {
      if (!isPathOrDescendant(k, path)) {
        updatedMap[k] = v;
      }
    }

    const activeDeleted = isPathOrDescendant(activeFile, path);
    if (activeVault) {
      try {
        const normVault = normalizePath(activeVault);
        const lastSaved =
          localStorage.getItem(`urano_last_file_${normVault}`) ||
          localStorage.getItem(`urano_last_file_${activeVault}`);
        if (lastSaved && isPathOrDescendant(lastSaved, path)) {
          localStorage.removeItem(`urano_last_file_${normVault}`);
          localStorage.removeItem(`urano_last_file_${activeVault}`);
        }
      } catch {}
    }

    set({
      notesContentMap: updatedMap,
      ...(activeDeleted
        ? { activeFile: null, activeFileName: null, fileContent: '', isDirty: false }
        : {}),
    });
    await refreshTree();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VAULT_ITEM_DELETED_EVENT, { detail: { path } }));
    }
    triggerAutoSync(get().activeVault, get().vaultName);
  },

  renameItem: async (oldPath: string, newPath: string) => {
    const { fileTree, activeFile, notesContentMap, activeVault, vaultName } = get();
    const movedPairs = buildMovedFilePairs(fileTree, oldPath, newPath);
    const alwaysUpdate = useSettingsStore.getState().settings.alwaysUpdateLinks;
    const scanResult =
      activeVault && alwaysUpdate && movedPairs.length > 0
        ? await scanFolderLinkRefactor(activeVault, movedPairs, (fp) =>
            remapPathPrefix(fp, oldPath, newPath)
          )
        : null;

    await invoke('rename_item', { oldPath, newPath });
    for (const pair of movedPairs) {
      renameImageInCache(pair.oldPath, pair.newPath);
    }

    set(buildPrefixRenamePatch(oldPath, newPath, fileTree, activeFile, notesContentMap));
    get().remapVaultBookmarks(oldPath, newPath);

    if (scanResult && scanResult.changes.length > 0) {
      await applyLinkChanges(scanResult.changes, movedPairs);
      notifyLinksUpdated(scanResult);
    }

    await get().refreshTree();
    triggerAutoSync(activeVault, vaultName);
  },

  openOrCreateWikilink: async (noteName: string): Promise<string> => {
    const { activeVault, fileTree, selectFile, createNote } = get();
    if (!activeVault || !noteName || !noteName.trim()) return '';

    const { targetPath, isExternalUrl } = parseLinkTargetParts(noteName);
    if (!targetPath || isExternalUrl) return '';

    const existingPath = resolveVaultLinkTarget(noteName, fileTree, activeVault);
    if (existingPath) {
      await selectFile(existingPath);
      return existingPath;
    }

    const normVault = normalizePath(activeVault);
    let relTarget = targetPath;
    if (relTarget.toLowerCase().startsWith(`${normVault.toLowerCase()}/`)) {
      relTarget = relTarget.slice(normVault.length + 1);
    }
    relTarget = relTarget.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
    if (!relTarget || /^[a-zA-Z]:[/\\]?$/.test(relTarget)) return '';

    const fileName = /\.(md|markdown|canvas|base)$/i.test(relTarget)
      ? relTarget
      : `${relTarget}.md`;
    return createNote(activeVault, fileName);
  },

  getUnresolvedLinks: () => {
    const { notesContentMap, files, fileTree, activeVault, activeFile, fileContent } = get();
    const sourceFiles = files.length > 0 ? files : flattenVaultFiles(fileTree);
    return extractUnresolvedWikilinks(
      notesContentMap,
      sourceFiles,
      activeVault,
      activeFile,
      fileContent
    );
  },

  loadAllNotesContent: async () => {
    const { activeVault } = get();
    if (!activeVault) return;
    try {
      const map = await invoke<Record<string, string>>('get_vault_notes_content', {
        vaultPath: activeVault,
      });
      set({ notesContentMap: map || {} });
    } catch (err) {
      console.warn('No se pudo cargar contenido de notas:', err);
    }
  },

  rebuildVaultCache: async () => {
    const { activeVault, refreshTree } = get();
    if (!activeVault) return;
    try {
      // 1. Limpiar caché en memoria de notas, enlaces, backlinks y metadatos
      set({ notesContentMap: {} });
      // 2. Re-escanear todos los archivos de la bóveda desde el backend de Rust
      await refreshTree();
      // 3. Volver a indexar el contenido de todas las notas en el mapa en memoria
      const map = await invoke<Record<string, string>>('get_vault_notes_content', {
        vaultPath: activeVault,
      });
      set({ notesContentMap: map || {} });
      // 4. Emitir evento para cualquier componente que observe cambios en el caché
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('urano:rebuild-cache'));
      }
    } catch (err) {
      console.error('Error al reconstruir caché de la bóveda:', err);
      throw err;
    }
  },

  toggleEmbeddedBacklinksForNote: (filePath: string, defaultVal: boolean) => {
    if (!filePath) return;
    const norm = normalizePath(filePath);
    const currentOverrides = get().embeddedBacklinksOverrides;
    const currentVal = norm in currentOverrides ? currentOverrides[norm] : defaultVal;
    set({
      embeddedBacklinksOverrides: {
        ...currentOverrides,
        [norm]: !currentVal,
      },
    });
  },

  clearEmbeddedBacklinksOverrides: () => {
    set({ embeddedBacklinksOverrides: {} });
  },
}));
