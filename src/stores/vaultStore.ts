import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { FileItem, SortOrder, BookmarkItem } from '../types';
import { isImagePath } from '../services/storageAdapter';
import { useSettingsStore, resolveNewFileDir } from './settingsStore';
import { useSyncStore } from './syncStore';
import { useNoticeStore } from '../components/common/Notice';
import { t } from '../locales/i18n';
import {
  scanAffectedLinks,
  executeLinkRefactor,
  executeFileRenameOnly,
  LinkScanResult,
  setAlwaysUpdateLinksPref,
} from '../services/linkRefactorService';
import { normalizePath, isSamePath, resolveFilePathInVault } from '../utils/pathUtils';

const triggerAutoSync = (vaultPath?: string | null, vaultName?: string | null) => {
  if (vaultPath) {
    useSyncStore.getState().notifyVaultChanged(vaultPath, vaultName || undefined);
  }
};

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

// Prohibited characters matching Urano specification: \ / : * ? " < > | # ^ [ ]
export const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/;

export const validateFileName = (name: string): { valid: boolean; error?: string } => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: t('vault.errors.nameEmpty') };
  }
  if (ILLEGAL_FILENAME_CHARS.test(trimmed)) {
    return {
      valid: false,
      error: t('vault.errors.nameInvalidChars'),
    };
  }
  return { valid: true };
};

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
  isDirty: boolean;
  isLoading: boolean;
  notesContentMap: Record<string, string>; // path -> content for graph & backlinks
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
  toggleBookmark: (item: { type: 'file' | 'folder' | 'search'; path: string; title: string; query?: string }) => void;
  removeBookmark: (path: string) => void;
  isBookmarked: (path: string) => boolean;

  // Sorting
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;

  // Auto-reveal
  autoReveal: boolean;
  setAutoReveal: (reveal: boolean) => void;

  // Actions
  setVault: (vaultPath: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  selectFile: (filePath: string) => Promise<void>;
  updateContent: (content: string) => void;
  updateNoteContent: (filePath: string, content: string) => Promise<void>;
  saveCurrentFile: () => Promise<void>;
  createNote: (parentPath: string, name: string) => Promise<string>;
  createUntitledNote: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createUntitledCanvas: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createUntitledBase: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createBaseFile: (parentPath?: string) => Promise<{ path: string; name: string; fileName: string }>;
  openDailyNote: () => Promise<string>;
  createUntitledFolder: (parentPath?: string) => Promise<string>;
  moveItem: (sourcePath: string, targetFolderPath: string) => Promise<void>;
  duplicateNote: (filePath: string) => Promise<string>;
  renameNoteWithLinkRefactor: (
    oldPath: string,
    newTitle: string
  ) => Promise<{ success: boolean; error?: string; newPath?: string; pendingPrompt?: boolean }>;
  resolvePendingRename: (mode: 'always' | 'once' | 'skip') => Promise<void>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  renameItem: (oldPath: string, newPath: string) => Promise<void>;
  openOrCreateWikilink: (noteName: string) => Promise<void>;
  loadAllNotesContent: () => Promise<void>;
  rebuildVaultCache: () => Promise<void>;
  setAutoFocusTitle: (focus: boolean) => void;
  setShouldSelectTitleOnOpen: (focus: boolean) => void;
}

function getInitialRecentVaults(): RecentVault[] {
  try {
    const raw = localStorage.getItem('urano_recent_vaults');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Error reading recent vaults:', e);
  }
  const lastVault = localStorage.getItem('urano_last_vault');
  if (lastVault) {
    const parts = lastVault.replace(/\\/g, '/').split('/');
    const name = parts[parts.length - 1] || 'Vault';
    const initial = [{ name, path: lastVault }];
    localStorage.setItem('urano_recent_vaults', JSON.stringify(initial));
    return initial;
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
  isDirty: false,
  isLoading: false,
  notesContentMap: {},
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
    const filtered = recentVaults.filter((v) => v.path !== path);
    const updated = [{ name, path }, ...filtered];
    localStorage.setItem('urano_recent_vaults', JSON.stringify(updated));
    set({ recentVaults: updated });
  },

  removeRecentVault: (path: string) => {
    const { recentVaults } = get();
    const updated = recentVaults.filter((v) => v.path !== path);
    localStorage.setItem('urano_recent_vaults', JSON.stringify(updated));
    set({ recentVaults: updated });
  },

  updateRecentVault: (oldPath: string, newPath: string, newName?: string) => {
    const { recentVaults } = get();
    const updated = recentVaults.map((v) => {
      if (v.path === oldPath) {
        return {
          name: newName || v.name,
          path: newPath,
        };
      }
      return v;
    });
    localStorage.setItem('urano_recent_vaults', JSON.stringify(updated));
    set({ recentVaults: updated });
  },

  // Bookmarks
  bookmarks: JSON.parse(localStorage.getItem('urano_bookmarks') || '[]'),
  toggleBookmark: (item) => {
    const { bookmarks } = get();
    const exists = bookmarks.some((b) => b.path === item.path);
    let updated: BookmarkItem[];
    if (exists) {
      updated = bookmarks.filter((b) => b.path !== item.path);
    } else {
      updated = [
        ...bookmarks,
        { ...item, id: `${item.type}-${item.path}-${Date.now()}`, createdAt: Date.now() },
      ];
    }
    localStorage.setItem('urano_bookmarks', JSON.stringify(updated));
    set({ bookmarks: updated });
  },
  removeBookmark: (path) => {
    const { bookmarks } = get();
    const updated = bookmarks.filter((b) => b.path !== path);
    localStorage.setItem('urano_bookmarks', JSON.stringify(updated));
    set({ bookmarks: updated });
  },
  isBookmarked: (path) => {
    return get().bookmarks.some((b) => b.path === path);
  },

  // Sorting
  sortOrder: (localStorage.getItem('urano_sort_order') as SortOrder) || 'name-asc',
  setSortOrder: (order: SortOrder) => {
    localStorage.setItem('urano_sort_order', order);
    const { fileTree } = get();
    set({ sortOrder: order, fileTree: sortFileTree(fileTree, order) });
  },

  // Auto-reveal
  autoReveal: localStorage.getItem('urano_auto_reveal') !== 'false',
  setAutoReveal: (reveal: boolean) => {
    localStorage.setItem('urano_auto_reveal', String(reveal));
    set({ autoReveal: reveal });
  },

  setAutoFocusTitle: (focus: boolean) => set({ autoFocusTitle: focus }),
  setShouldSelectTitleOnOpen: (focus: boolean) => set({ shouldSelectTitleOnOpen: focus }),

  setVault: async (vaultPath: string) => {
    try {
      set({ isLoading: true });
      const settings = useSettingsStore.getState().settings;
      const detectAll = settings.detectAllFileExtensions;
      const configDir = settings.configFolderOverride || '.urano';
      const tree = await invoke<FileItem[]>('open_vault', { vaultPath, detectAll, configDir });
      const parts = vaultPath.replace(/\\/g, '/').split('/');
      const vaultName = parts[parts.length - 1] || t('vault.defaultVaultName');

      localStorage.setItem('urano_last_vault', vaultPath);

      set({
        activeVault: vaultPath,
        vaultName,
        fileTree: sortFileTree(tree, get().sortOrder),
        activeFile: null,
        activeFileName: null,
        fileContent: '',
        isDirty: false,
        isLoading: false,
      });

      get().addRecentVault(vaultName, vaultPath);
      get().loadAllNotesContent();
      triggerAutoSync(vaultPath, vaultName);

      // Restore file based on Settings → Files and links → "Default file to open"
      const defaultToOpen = useSettingsStore.getState().settings.defaultFileToOpen;
      if (defaultToOpen === 'daily-note') {
        get().openDailyNote().catch((e) => console.warn('Error opening daily note:', e));
      } else if (defaultToOpen === 'last-opened') {
        const normKey = normalizePath(vaultPath);
        const lastFile =
          localStorage.getItem(`urano_last_file_${normKey}`) ||
          localStorage.getItem(`urano_last_file_${vaultPath}`);
        if (lastFile) {
          const resolved = resolveFilePathInVault(lastFile, tree, vaultPath);
          get().selectFile(resolved || lastFile).catch(() => {});
        }
      }
    } catch (err) {
      set({ isLoading: false });
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
      set({ fileTree: sortFileTree(tree, sortOrder) });
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
    const isNative =
      targetPath.endsWith('.md') ||
      targetPath.endsWith('.markdown') ||
      targetPath.endsWith('.canvas') ||
      targetPath.endsWith('.base') ||
      isImagePath(targetPath);

    if (!isNative) {
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

    try {
      set({ isLoading: true });
      const isImg = isImagePath(targetPath);
      const content = isImg ? '' : await invoke<string>('read_file', { filePath: targetPath });
      const parts = targetPath.replace(/\\/g, '/').split('/');
      const activeFileName = parts[parts.length - 1] || t('vault.defaultNoteName');

      set({
        activeFile: targetPath,
        activeFileName,
        fileContent: content,
        isDirty: false,
        isLoading: false,
      });

      if (activeVault) {
        try {
          const normVault = normalizePath(activeVault);
          localStorage.setItem(`urano_last_file_${normVault}`, targetPath);
        } catch {}
      }
    } catch (err) {
      set({ isLoading: false });
      console.error('Error al leer archivo:', err);
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
    } catch (err) {
      console.error('Error al guardar la nota editada desde el Canvas:', err);
    }
  },

  saveCurrentFile: async () => {
    const { activeFile, fileContent } = get();
    if (!activeFile || isImagePath(activeFile)) return;
    try {
      await invoke('write_file', { filePath: activeFile, content: fileContent });
      set({ isDirty: false });
      get().loadAllNotesContent();
      triggerAutoSync(get().activeVault, get().vaultName);
    } catch (err) {
      console.error('Error al guardar archivo:', err);
    }
  },

  createNote: async (parentPath: string, name: string): Promise<string> => {
    const { activeVault, activeFile } = get();
    let targetDir = parentPath;
    if (activeVault && (!targetDir || targetDir === activeVault)) {
      targetDir = resolveNewFileDir(activeVault, activeFile);
    }
    if (activeVault && targetDir && targetDir !== activeVault) {
      try {
        await invoke('create_folder', { folderPath: targetDir });
      } catch {}
    }
    const cleanName = name.endsWith('.md') ? name : `${name}.md`;
    const fullPath = `${targetDir}/${cleanName}`.replace(/\/+/g, '/');
    await invoke('create_file', { filePath: fullPath });
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

    if (targetDir !== activeVault) {
      try {
        await invoke('create_folder', { folderPath: targetDir });
      } catch {}
    }

    // Collect all existing names in targetDir
    const existingNames = new Set<string>();
    const collectInDir = (items: FileItem[]) => {
      for (const item of items) {
        if (item.path.startsWith(targetDir)) {
          existingNames.add(item.name.toLowerCase());
        }
        if (item.children) collectInDir(item.children);
      }
    };
    collectInDir(fileTree);

    const untitled = t('common.untitled');
    let candidateName = `${untitled}.md`;
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `${untitled} ${counter}.md`;
      counter++;
    }

    const fullPath = `${targetDir}/${candidateName}`.replace(/\/+/g, '/');
    const initialContent = '';

    await invoke('create_file', { filePath: fullPath });
    if (initialContent) {
      await invoke('write_file', { filePath: fullPath, content: initialContent });
    }

    await refreshTree();
    await selectFile(fullPath);
    set({ autoFocusTitle: true, shouldSelectTitleOnOpen: true });
    triggerAutoSync(get().activeVault, get().vaultName);

    return { path: fullPath, name: candidateName.replace(/\.md$/, '') };
  },

  // Urano Canvas creation (.canvas JSON format)
  createUntitledCanvas: async (parentPath?: string): Promise<{ path: string; name: string }> => {
    const { activeVault, fileTree, refreshTree, selectFile } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return { path: '', name: '' };

    const existingNames = new Set<string>();
    const collectInDir = (items: FileItem[]) => {
      for (const item of items) {
        if (item.path.startsWith(targetDir)) {
          existingNames.add(item.name.toLowerCase());
        }
        if (item.children) collectInDir(item.children);
      }
    };
    collectInDir(fileTree);

    const untitled = t('common.untitled');
    let candidateName = `${untitled}.canvas`;
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `${untitled} ${counter}.canvas`;
      counter++;
    }

    const fullPath = `${targetDir}/${candidateName}`.replace(/\/+/g, '/');
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

    return { path: fullPath, name: candidateName.replace(/\.canvas$/, '') };
  },

  // Urano Base creation (.base format)
  createUntitledBase: async (parentPath?: string): Promise<{ path: string; name: string }> => {
    const { activeVault, fileTree, refreshTree, selectFile } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return { path: '', name: '' };

    const existingNames = new Set<string>();
    const collectInDir = (items: FileItem[]) => {
      for (const item of items) {
        if (item.path.startsWith(targetDir)) {
          existingNames.add(item.name.toLowerCase());
        }
        if (item.children) collectInDir(item.children);
      }
    };
    collectInDir(fileTree);

    const untitled = t('common.untitled');
    let candidateName = `${untitled}.base`;
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `${untitled} ${counter}.base`;
      counter++;
    }

    const fullPath = `${targetDir}/${candidateName}`.replace(/\/+/g, '/');
    const initialBase = JSON.stringify(
      {
        title: candidateName.replace(/\.base$/, ''),
        filters: [],
        sort: [{ field: 'name', order: 'asc' }],
        columns: ['name', 'folder', 'tags', 'mtime', 'size'],
      },
      null,
      2
    );

    await invoke('create_file', { filePath: fullPath });
    await invoke('write_file', { filePath: fullPath, content: initialBase });

    await refreshTree();
    await selectFile(fullPath);
    set({ autoFocusTitle: true, shouldSelectTitleOnOpen: true });

    return { path: fullPath, name: candidateName.replace(/\.base$/, '') };
  },

  // Create .base file without changing active note (for inline embed)
  createBaseFile: async (parentPath?: string): Promise<{ path: string; name: string; fileName: string }> => {
    const { activeVault, fileTree, refreshTree } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return { path: '', name: '', fileName: '' };

    const existingNames = new Set<string>();
    const collectInDir = (items: FileItem[]) => {
      for (const item of items) {
        if (item.path.startsWith(targetDir)) {
          existingNames.add(item.name.toLowerCase());
        }
        if (item.children) collectInDir(item.children);
      }
    };
    collectInDir(fileTree);

    const untitled = t('common.untitled');
    let candidateName = `${untitled}.base`;
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `${untitled} ${counter}.base`;
      counter++;
    }

    const fullPath = `${targetDir}/${candidateName}`.replace(/\/+/g, '/');
    const initialBase = JSON.stringify(
      {
        title: candidateName.replace(/\.base$/, ''),
        filters: [],
        sort: [{ field: 'name', order: 'asc' }],
        columns: ['name', 'folder', 'tags', 'mtime', 'size'],
      },
      null,
      2
    );

    await invoke('create_file', { filePath: fullPath });
    await invoke('write_file', { filePath: fullPath, content: initialBase });
    await refreshTree();

    return {
      path: fullPath,
      name: candidateName.replace(/\.base$/, ''),
      fileName: candidateName,
    };
  },

  // Open or create today's daily note (YYYY-MM-DD.md)
  openDailyNote: async (): Promise<string> => {
    const { activeVault, fileTree, refreshTree, selectFile } = get();
    if (!activeVault) return '';

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const targetFileName = `${dateStr}.md`;

    // Search anywhere in vault
    const findFile = (items: FileItem[]): string | null => {
      for (const item of items) {
        if (!item.isDir && (item.name === targetFileName || item.name === `${dateStr}.markdown`)) {
          return item.path;
        }
        if (item.children) {
          const res = findFile(item.children);
          if (res) return res;
        }
      }
      return null;
    };

    const existingPath = findFile(fileTree);
    if (existingPath) {
      await selectFile(existingPath);
      return existingPath;
    }

    // Create daily note in the folder configured in Settings → Daily notes (vault root by default)
    const dailyFolder = useSettingsStore
      .getState()
      .settings.dailyNotesFolder.trim()
      .replace(/^[\\/]+|[\\/]+$/g, '');
    const fullPath = `${activeVault}/${dailyFolder ? `${dailyFolder}/` : ''}${targetFileName}`.replace(/\/+/g, '/');
    const initialContent = t('vault.dailyNoteBody', { date: dateStr });
    await invoke('create_file', { filePath: fullPath });
    await invoke('write_file', { filePath: fullPath, content: initialContent });

    await refreshTree();
    await selectFile(fullPath);
    return fullPath;
  },

  // Move item (drag and drop into folder)
  moveItem: async (sourcePath: string, targetFolderPath: string) => {
    const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
    const newPath = `${targetFolderPath}/${fileName}`.replace(/\/+/g, '/');
    if (sourcePath === newPath) return;

    await invoke('rename_item', { oldPath: sourcePath, newPath });
    const { activeFile } = get();
    if (isSamePath(activeFile, sourcePath)) {
      set({ activeFile: newPath, activeFileName: fileName });
    }
    await get().refreshTree();
  },

  // Urano prompt-free folder creation
  createUntitledFolder: async (parentPath?: string): Promise<string> => {
    const { activeVault, fileTree, refreshTree } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return '';

    const existingNames = new Set<string>();
    const collectInDir = (items: FileItem[]) => {
      for (const item of items) {
        if (item.path.startsWith(targetDir)) {
          existingNames.add(item.name.toLowerCase());
        }
        if (item.children) collectInDir(item.children);
      }
    };
    collectInDir(fileTree);

    const untitledFolder = t('vault.untitledFolder');
    let candidateName = untitledFolder;
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `${untitledFolder} ${counter}`;
      counter++;
    }

    const fullPath = `${targetDir}/${candidateName}`.replace(/\/+/g, '/');
    await invoke('create_folder', { folderPath: fullPath });
    await refreshTree();
    return fullPath;
  },

  // Duplicate a note
  duplicateNote: async (filePath: string): Promise<string> => {
    const { fileTree, refreshTree, selectFile } = get();
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
    const baseName = fileName.replace(/\.md$/i, '');

    const existingNames = new Set<string>();
    const collectNames = (items: FileItem[]) => {
      for (const item of items) {
        if (item.path.startsWith(parentDir)) {
          existingNames.add(item.name.toLowerCase());
        }
        if (item.children) collectNames(item.children);
      }
    };
    collectNames(fileTree);

    let candidate = `${baseName} 1.md`;
    let counter = 2;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `${baseName} ${counter}.md`;
      counter++;
    }

    const newPath = `${parentDir}/${candidate}`.replace(/\/+/g, '/');
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
  ): Promise<{ success: boolean; error?: string; newPath?: string; pendingPrompt?: boolean }> => {
    const { activeVault, fileTree } = get();

    const validation = validateFileName(newTitle);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const cleanTitle = newTitle.trim();
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const oldFileName = oldPath.substring(oldPath.lastIndexOf('/') + 1);
    const lastDot = oldFileName.lastIndexOf('.');
    const ext = lastDot > 0 ? oldFileName.substring(lastDot) : '.md';
    const oldBaseName = lastDot > 0 ? oldFileName.substring(0, lastDot) : oldFileName;
    const newFileName = cleanTitle.toLowerCase().endsWith(ext.toLowerCase())
      ? cleanTitle
      : `${cleanTitle}${ext}`;
    const newPath = `${parentDir}/${newFileName}`.replace(/\/+/g, '/');

    // If name didn't change
    if (oldBaseName.toLowerCase() === cleanTitle.toLowerCase() && oldFileName === newFileName) {
      return { success: true, newPath: oldPath };
    }

    // Check collision with another file in the same folder
    const fileExists = fileTree.some((item) => {
      if (item.path.toLowerCase() === newPath.toLowerCase() && item.path !== oldPath) {
        return true;
      }
      return false;
    });

    if (fileExists) {
      return { success: false, error: t('vault.errors.nameExists') };
    }

    try {
      const scanResult = await scanAffectedLinks(activeVault || '', oldPath, newPath);
      const alwaysUpdate = useSettingsStore.getState().settings.alwaysUpdateLinks;

      if (scanResult.totalLinks === 0) {
        await executeFileRenameOnly(oldPath, newPath);
        return { success: true, newPath };
      }

      if (alwaysUpdate) {
        await executeLinkRefactor(scanResult, oldPath, newPath);
        notifyLinksUpdated(scanResult);
        return { success: true, newPath };
      } else {
        set({ pendingRenamePrompt: { oldPath, newPath, plan: scanResult } });
        return { success: true, newPath, pendingPrompt: true };
      }
    } catch (err: any) {
      console.error('Error durante el renombrado:', err);
      return { success: false, error: err?.toString() || t('vault.errors.renameFailed') };
    }
  },

  createFolder: async (parentPath: string, name: string) => {
    const fullPath = `${parentPath}/${name}`.replace(/\/+/g, '/');
    await invoke('create_folder', { folderPath: fullPath });
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

    if (isSamePath(activeFile, path)) {
      set({ activeFile: null, activeFileName: null, fileContent: '', isDirty: false });
    }
    await refreshTree();
    triggerAutoSync(get().activeVault, get().vaultName);
  },

  renameItem: async (oldPath: string, newPath: string) => {
    await invoke('rename_item', { oldPath, newPath });
    const { activeFile } = get();
    if (isSamePath(activeFile, oldPath)) {
      const parts = newPath.replace(/\\/g, '/').split('/');
      set({ activeFile: newPath, activeFileName: parts[parts.length - 1] });
    }
    await get().refreshTree();
    triggerAutoSync(get().activeVault, get().vaultName);
  },

  openOrCreateWikilink: async (noteName: string) => {
    const { activeVault, fileTree, selectFile, createNote } = get();
    if (!activeVault) return;

    const findNote = (items: FileItem[]): string | null => {
      for (const item of items) {
        if (!item.isDir) {
          const nameWithoutExt = item.name.replace(/\.(md|canvas|base)$/i, '');
          if (
            nameWithoutExt.toLowerCase() === noteName.toLowerCase() ||
            item.name.toLowerCase() === noteName.toLowerCase()
          ) {
            return item.path;
          }
        } else if (item.children) {
          const found = findNote(item.children);
          if (found) return found;
        }
      }
      return null;
    };

    const existingPath = findNote(fileTree);
    if (existingPath) {
      await selectFile(existingPath);
    } else {
      const isBase = noteName.toLowerCase().endsWith('.base');
      const isCanvas = noteName.toLowerCase().endsWith('.canvas');
      const fileName = isBase || isCanvas || noteName.toLowerCase().endsWith('.md')
        ? noteName
        : `${noteName}.md`;
      const newPath = await createNote(activeVault, fileName);
      await selectFile(newPath);
    }
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
}));
