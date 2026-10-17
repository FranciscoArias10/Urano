import React, { useState } from 'react';
import {
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  FolderPlus,
  Trash2,
  Edit2,
} from 'lucide-react';
import { FileItem } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';

interface FileTreeProps {
  items: FileItem[];
  depth?: number;
}

export const FileTree: React.FC<FileTreeProps> = ({ items, depth = 0 }) => {
  return (
    <div className="flex flex-col select-none">
      {items.map((item) => (
        <FileTreeItem key={item.path} item={item} depth={depth} />
      ))}
    </div>
  );
};

interface FileTreeItemProps {
  item: FileItem;
  depth: number;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ item, depth }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(item.name.replace(/\.md$/i, ''));

  const {
    activeFile,
    selectFile,
    createNote,
    createFolder,
    deleteItem,
    renameItem,
  } = useVaultStore();

  const isSelected = activeFile === item.path;

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.isDir) {
      setIsOpen(!isOpen);
    } else {
      selectFile(item.path);
    }
  };

  const handleCreateNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newItemName.trim()) {
      await createNote(item.path, newItemName.trim());
      setNewItemName('');
      setIsCreatingNote(false);
      setIsOpen(true);
    }
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newItemName.trim()) {
      await createFolder(item.path, newItemName.trim());
      setNewItemName('');
      setIsCreatingFolder(false);
      setIsOpen(true);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (renameValue.trim() && renameValue !== item.name) {
      const parent = item.path.substring(0, item.path.lastIndexOf('/'));
      const newName = item.isDir ? renameValue.trim() : `${renameValue.trim()}.md`;
      const newPath = `${parent}/${newName}`;
      await renameItem(item.path, newPath);
      setIsRenaming(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar "${item.name}"?`)) {
      await deleteItem(item.path);
    }
  };

  const displayName = item.isDir ? item.name : item.name.replace(/\.md$/i, '');

  return (
    <div className="flex flex-col">
      <div
        onClick={handleSelect}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`group flex items-center justify-between pr-2 py-1 text-xs cursor-pointer rounded-md transition-colors relative ${
          isSelected
            ? 'bg-orange-500/20 text-orange-200 font-medium'
            : 'text-obsidian-text hover:bg-obsidian-hover'
        }`}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-1">
          {item.isDir ? (
            <>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(!isOpen);
                }}
                className="text-obsidian-muted hover:text-white"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
              {isOpen ? (
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-3.5" />
              <FileText className="w-3.5 h-3.5 text-orange-400/90 shrink-0" />
            </>
          )}

          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} onClick={(e) => e.stopPropagation()} className="flex-1">
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => setIsRenaming(false)}
                className="w-full bg-obsidian-active text-white px-1.5 py-0.5 rounded outline-none border border-orange-500"
              />
            </form>
          ) : (
            <span className="truncate">{displayName}</span>
          )}
        </div>

        {/* Hover quick actions */}
        <div
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-obsidian-muted"
          onClick={(e) => e.stopPropagation()}
        >
          {item.isDir && (
            <>
              <button
                onClick={() => {
                  setIsCreatingNote(true);
                  setIsCreatingFolder(false);
                }}
                title="Nueva nota aquí"
                className="hover:text-orange-300 p-0.5"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setIsCreatingFolder(true);
                  setIsCreatingNote(false);
                }}
                title="Nueva carpeta aquí"
                className="hover:text-amber-300 p-0.5"
              >
                <FolderPlus className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            onClick={() => setIsRenaming(true)}
            title="Renombrar"
            className="hover:text-blue-300 p-0.5"
          >
            <Edit2 className="w-3 h-3" />
          </button>
          <button
            onClick={handleDelete}
            title="Eliminar"
            className="hover:text-red-400 p-0.5"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Inline item creation forms */}
      {isCreatingNote && (
        <form
          onSubmit={handleCreateNoteSubmit}
          style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
          className="py-1 pr-2"
        >
          <input
            autoFocus
            type="text"
            placeholder="Nombre de la nota..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onBlur={() => setIsCreatingNote(false)}
            className="w-full bg-obsidian-active text-xs text-white px-2 py-1 rounded outline-none border border-orange-500"
          />
        </form>
      )}

      {isCreatingFolder && (
        <form
          onSubmit={handleCreateFolderSubmit}
          style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
          className="py-1 pr-2"
        >
          <input
            autoFocus
            type="text"
            placeholder="Nombre de carpeta..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onBlur={() => setIsCreatingFolder(false)}
            className="w-full bg-obsidian-active text-xs text-white px-2 py-1 rounded outline-none border border-amber-500"
          />
        </form>
      )}

      {/* Children files & folders */}
      {item.isDir && isOpen && item.children && item.children.length > 0 && (
        <FileTree items={item.children} depth={depth + 1} />
      )}
    </div>
  );
};
