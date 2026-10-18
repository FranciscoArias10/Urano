import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { FileItem } from '../types';

// Prohibited characters matching Obsidian specification: \ / : * ? " < > | # ^ [ ]
export const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/;

export const validateFileName = (name: string): { valid: boolean; error?: string } => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: 'El nombre de archivo no puede estar vacío.' };
  }
  if (ILLEGAL_FILENAME_CHARS.test(trimmed)) {
    return {
      valid: false,
      error: 'El nombre de archivo no puede contener ninguno de los siguientes caracteres: * " \\ / < > : | ? # ^ [ ]',
    };
  }
  return { valid: true };
};

interface VaultState {
  activeVault: string | null;
  vaultName: string | null;
  activeFile: string | null;
  activeFileName: string | null;
  fileContent: string;
  fileTree: FileItem[];
  isDirty: boolean;
  isLoading: boolean;
  notesContentMap: Record<string, string>; // path -> content for graph & backlinks
  autoFocusTitle: boolean;

  // Actions
  setVault: (vaultPath: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  selectFile: (filePath: string) => Promise<void>;
  updateContent: (content: string) => void;
  saveCurrentFile: () => Promise<void>;
  createNote: (parentPath: string, name: string) => Promise<string>;
  createUntitledNote: (parentPath?: string) => Promise<{ path: string; name: string }>;
  createUntitledFolder: (parentPath?: string) => Promise<string>;
  duplicateNote: (filePath: string) => Promise<string>;
  renameNoteWithLinkRefactor: (
    oldPath: string,
    newTitle: string
  ) => Promise<{ success: boolean; error?: string; newPath?: string }>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  renameItem: (oldPath: string, newPath: string) => Promise<void>;
  openOrCreateWikilink: (noteName: string) => Promise<void>;
  loadAllNotesContent: () => Promise<void>;
  setAutoFocusTitle: (focus: boolean) => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  activeVault: null,
  vaultName: null,
  activeFile: null,
  activeFileName: null,
  fileContent: '',
  fileTree: [],
  isDirty: false,
  isLoading: false,
  notesContentMap: {},
  autoFocusTitle: false,

  setAutoFocusTitle: (focus: boolean) => set({ autoFocusTitle: focus }),

  setVault: async (vaultPath: string) => {
    try {
      set({ isLoading: true });
      const tree = await invoke<FileItem[]>('open_vault', { vaultPath });
      const parts = vaultPath.replace(/\\/g, '/').split('/');
      const vaultName = parts[parts.length - 1] || 'Bóveda';

      localStorage.setItem('urano_last_vault', vaultPath);

      set({
        activeVault: vaultPath,
        vaultName,
        fileTree: tree,
        activeFile: null,
        activeFileName: null,
        fileContent: '',
        isDirty: false,
        isLoading: false,
      });

      get().loadAllNotesContent();
    } catch (err) {
      set({ isLoading: false });
      console.error('Error al abrir bóveda:', err);
      throw err;
    }
  },

  refreshTree: async () => {
    const { activeVault } = get();
    if (!activeVault) return;
    try {
      const tree = await invoke<FileItem[]>('list_vault_files', { vaultPath: activeVault });
      set({ fileTree: tree });
      get().loadAllNotesContent();
    } catch (err) {
      console.error('Error al refrescar árbol:', err);
    }
  },

  selectFile: async (filePath: string) => {
    const { activeFile, isDirty, saveCurrentFile } = get();
    if (activeFile === filePath) return;

    if (isDirty && activeFile) {
      await saveCurrentFile();
    }

    try {
      set({ isLoading: true });
      const content = await invoke<string>('read_file', { filePath });
      const parts = filePath.replace(/\\/g, '/').split('/');
      const activeFileName = parts[parts.length - 1] || 'Nota';

      set({
        activeFile: filePath,
        activeFileName,
        fileContent: content,
        isDirty: false,
        isLoading: false,
      });
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

  saveCurrentFile: async () => {
    const { activeFile, fileContent } = get();
    if (!activeFile) return;
    try {
      await invoke('write_file', { filePath: activeFile, content: fileContent });
      set({ isDirty: false });
      get().loadAllNotesContent();
    } catch (err) {
      console.error('Error al guardar archivo:', err);
    }
  },

  createNote: async (parentPath: string, name: string): Promise<string> => {
    const cleanName = name.endsWith('.md') ? name : `${name}.md`;
    const fullPath = `${parentPath}/${cleanName}`.replace(/\/+/g, '/');
    await invoke('create_file', { filePath: fullPath });
    await get().refreshTree();
    await get().selectFile(fullPath);
    return fullPath;
  },

  // Obsidian native prompt-free creation with auto-increment resolution
  createUntitledNote: async (parentPath?: string): Promise<{ path: string; name: string }> => {
    const { activeVault, fileTree, refreshTree, selectFile } = get();
    const targetDir = parentPath || activeVault;
    if (!targetDir) return { path: '', name: '' };

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

    let candidateName = 'Sin título.md';
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `Sin título ${counter}.md`;
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
    set({ autoFocusTitle: true });

    return { path: fullPath, name: candidateName.replace(/\.md$/, '') };
  },

  // Obsidian prompt-free folder creation
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

    let candidateName = 'Carpeta sin título';
    let counter = 1;
    while (existingNames.has(candidateName.toLowerCase())) {
      candidateName = `Carpeta sin título ${counter}`;
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
  ): Promise<{ success: boolean; error?: string; newPath?: string }> => {
    const { activeFile, fileTree, notesContentMap, refreshTree } = get();

    const validation = validateFileName(newTitle);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const cleanTitle = newTitle.trim();
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const oldFileName = oldPath.substring(oldPath.lastIndexOf('/') + 1);
    const oldBaseName = oldFileName.replace(/\.md$/i, '');
    const newFileName = `${cleanTitle}.md`;
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
      return { success: false, error: 'Ya existe un archivo o carpeta con ese nombre.' };
    }

    try {
      // 1. Rename the physical file
      await invoke('rename_item', { oldPath, newPath });

      // 2. Refactor wikilinks across all notes in the vault
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wikiRegex = new RegExp('\\[\\[' + escapeRegExp(oldBaseName) + '([\\|\\]#])', 'g');

      const updatedMap = { ...notesContentMap };
      let refactoredCount = 0;

      for (const [notePath, content] of Object.entries(notesContentMap)) {
        if (notePath === oldPath) continue;

        if (wikiRegex.test(content)) {
          const newContent = content.replace(wikiRegex, '[[' + cleanTitle + '$1');
          updatedMap[notePath] = newContent;
          try {
            await invoke('write_file', { filePath: notePath, content: newContent });
            refactoredCount++;
          } catch (writeErr) {
            console.warn(`Error al actualizar enlace en ${notePath}:`, writeErr);
          }
        }
      }

      // 3. Update activeFile reference if renamed note was open
      if (activeFile === oldPath) {
        set({
          activeFile: newPath,
          activeFileName: newFileName,
        });
      }

      // Update in-memory content map key
      if (updatedMap[oldPath]) {
        updatedMap[newPath] = updatedMap[oldPath];
        delete updatedMap[oldPath];
      }

      set({ notesContentMap: updatedMap });
      await refreshTree();

      return { success: true, newPath };
    } catch (err: any) {
      console.error('Error durante el renombrado:', err);
      return { success: false, error: err?.toString() || 'Error al renombrar archivo.' };
    }
  },

  createFolder: async (parentPath: string, name: string) => {
    const fullPath = `${parentPath}/${name}`.replace(/\/+/g, '/');
    await invoke('create_folder', { folderPath: fullPath });
    await get().refreshTree();
  },

  deleteItem: async (path: string) => {
    await invoke('delete_item', { path });
    const { activeFile } = get();
    if (activeFile === path) {
      set({ activeFile: null, activeFileName: null, fileContent: '', isDirty: false });
    }
    await get().refreshTree();
  },

  renameItem: async (oldPath: string, newPath: string) => {
    await invoke('rename_item', { oldPath, newPath });
    const { activeFile } = get();
    if (activeFile === oldPath) {
      const parts = newPath.replace(/\\/g, '/').split('/');
      set({ activeFile: newPath, activeFileName: parts[parts.length - 1] });
    }
    await get().refreshTree();
  },

  openOrCreateWikilink: async (noteName: string) => {
    const { activeVault, fileTree, selectFile, createNote } = get();
    if (!activeVault) return;

    const findNote = (items: FileItem[]): string | null => {
      for (const item of items) {
        if (!item.isDir) {
          const baseName = item.name.replace(/\.md$/i, '');
          if (baseName.toLowerCase() === noteName.toLowerCase()) {
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
      const newPath = await createNote(activeVault, `${noteName}.md`);
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
      set({ notesContentMap: map });
    } catch (err) {
      console.warn('No se pudo cargar contenido de notas:', err);
    }
  },
}));
