import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { FileItem } from '../types';

interface VaultState {
  activeVault: string | null;
  vaultName: string | null;
  activeFile: string | null;
  activeFileName: string | null;
  fileContent: string;
  fileTree: FileItem[];
  isDirty: boolean;
  isLoading: boolean;
  notesContentMap: Record<string, string>; // path -> content for graph
  
  // Actions
  setVault: (vaultPath: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  selectFile: (filePath: string) => Promise<void>;
  updateContent: (content: string) => void;
  saveCurrentFile: () => Promise<void>;
  createNote: (parentPath: string, name: string) => Promise<string>;
  createFolder: (parentPath: string, name: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  renameItem: (oldPath: string, newPath: string) => Promise<void>;
  openOrCreateWikilink: (noteName: string) => Promise<void>;
  loadAllNotesContent: () => Promise<void>;
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

      // Load all notes content for graph
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
    
    // Auto-save previous file if modified
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

    // Helper to search recursively in fileTree
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
      // Create new note in vault root
      const newPath = await createNote(activeVault, `${noteName}.md`);
      const initialContent = `# ${noteName}\n\n`;
      await invoke('write_file', { filePath: newPath, content: initialContent });
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
