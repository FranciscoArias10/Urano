import React, { useState, useRef, useEffect } from 'react';
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
  Copy,
  Link,
  PlusCircle,
  FilePlus,
} from 'lucide-react';
import { FileItem } from '../../types';
import { useVaultStore, validateFileName } from '../../stores/vaultStore';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { useNoticeStore } from '../common/Notice';

interface FileTreeProps {
  items: FileItem[];
  depth?: number;
  onOpenInNewTab?: (filePath: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ items, depth = 0, onOpenInNewTab }) => {
  return (
    <div className="flex flex-col select-none">
      {items.map((item) => (
        <FileTreeItem
          key={item.path}
          item={item}
          depth={depth}
          onOpenInNewTab={onOpenInNewTab}
        />
      ))}
    </div>
  );
};

interface FileTreeItemProps {
  item: FileItem;
  depth: number;
  onOpenInNewTab?: (filePath: string) => void;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ item, depth, onOpenInNewTab }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(item.name.replace(/\.md$/i, ''));
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);

  const {
    activeFile,
    selectFile,
    createUntitledNote,
    createUntitledFolder,
    duplicateNote,
    deleteItem,
    renameItem,
    renameNoteWithLinkRefactor,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();

  const isSelected = activeFile === item.path;
  const displayName = item.isDir ? item.name : item.name.replace(/\.md$/i, '');

  // Keep renameValue in sync if item changes
  useEffect(() => {
    setRenameValue(item.name.replace(/\.md$/i, ''));
  }, [item.name]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.isDir) {
      setIsOpen(!isOpen);
    } else {
      selectFile(item.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items: MenuItemData[] = [];

    if (item.isDir) {
      // Folder Context Menu:
      // "Nueva nota" (creada dentro de esa carpeta)
      // "Nueva carpeta"
      // separador
      // "Cambiar nombre" (F2)
      // "Eliminar carpeta" (en rojo .is-warning)
      items.push(
        {
          title: 'Nueva nota',
          icon: <FilePlus size={14} />,
          action: async () => {
            await createUntitledNote(item.path);
            setIsOpen(true);
          },
        },
        {
          title: 'Nueva carpeta',
          icon: <FolderPlus size={14} />,
          action: async () => {
            await createUntitledFolder(item.path);
            setIsOpen(true);
          },
        },
        { type: 'separator' },
        {
          title: 'Cambiar nombre',
          shortcut: 'F2',
          icon: <Edit2 size={14} />,
          action: () => setIsRenaming(true),
        },
        {
          title: 'Eliminar carpeta',
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: async () => {
            await deleteItem(item.path);
          },
        }
      );
    } else {
      // Note (.md) Context Menu:
      // "Abrir en una pestaña nueva"
      // "Hacer una copia"
      // "Copiar enlace de Urano"
      // separador
      // "Cambiar nombre" (F2)
      // "Eliminar archivo" (en rojo .is-warning)
      items.push(
        {
          title: 'Abrir en una pestaña nueva',
          icon: <PlusCircle size={14} />,
          action: () => {
            if (onOpenInNewTab) {
              onOpenInNewTab(item.path);
            } else {
              selectFile(item.path);
            }
          },
        },
        {
          title: 'Hacer una copia',
          icon: <Copy size={14} />,
          action: async () => {
            await duplicateNote(item.path);
          },
        },
        {
          title: 'Copiar enlace de Urano',
          icon: <Link size={14} />,
          action: () => {
            navigator.clipboard.writeText(`[[${displayName}]]`);
            showNotice('Enlace copiado al portapapeles', 2500, 'success');
          },
        },
        { type: 'separator' },
        {
          title: 'Cambiar nombre',
          shortcut: 'F2',
          icon: <Edit2 size={14} />,
          action: () => setIsRenaming(true),
        },
        {
          title: 'Eliminar archivo',
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: async () => {
            await deleteItem(item.path);
          },
        }
      );
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const handleRenameSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = renameValue.trim();

    if (!trimmed || trimmed === displayName) {
      setRenameValue(displayName);
      setIsRenaming(false);
      return;
    }

    // Validate characters
    const validation = validateFileName(trimmed);
    if (!validation.valid) {
      showNotice(validation.error || 'Nombre de archivo inválido', 4000, 'error');
      setRenameValue(displayName);
      setIsRenaming(false);
      return;
    }

    if (item.isDir) {
      const parent = item.path.substring(0, item.path.lastIndexOf('/'));
      const newPath = `${parent}/${trimmed}`;
      await renameItem(item.path, newPath);
      setIsRenaming(false);
    } else {
      // Use link refactoring rename for notes!
      const result = await renameNoteWithLinkRefactor(item.path, trimmed);
      if (!result.success) {
        showNotice(result.error || 'Error al renombrar archivo', 4000, 'error');
        setRenameValue(displayName);
      }
      setIsRenaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      setIsRenaming(true);
    } else if (e.key === 'Escape' && isRenaming) {
      e.preventDefault();
      e.stopPropagation();
      setRenameValue(displayName);
      setIsRenaming(false);
    }
  };

  return (
    <div className="flex flex-col" onKeyDown={handleKeyDown} tabIndex={0}>
      <div
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`group flex items-center justify-between pr-2 py-1 text-xs cursor-pointer rounded-md transition-colors relative outline-none ${
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
            <form
              onSubmit={handleRenameSubmit}
              onClick={(e) => e.stopPropagation()}
              className="flex-1"
            >
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRenameSubmit()}
                className="w-full bg-[#1e1b18] text-white px-1.5 py-0.5 rounded outline-none border border-orange-500"
              />
            </form>
          ) : (
            <span className="truncate">{displayName}</span>
          )}
        </div>

        {/* Hover quick action buttons */}
        <div
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-obsidian-muted"
          onClick={(e) => e.stopPropagation()}
        >
          {item.isDir && (
            <>
              <button
                onClick={async () => {
                  await createUntitledNote(item.path);
                  setIsOpen(true);
                }}
                title="Nueva nota aquí"
                className="hover:text-orange-300 p-0.5"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={async () => {
                  await createUntitledFolder(item.path);
                  setIsOpen(true);
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
            title="Cambiar nombre (F2)"
            className="hover:text-blue-300 p-0.5"
          >
            <Edit2 className="w-3 h-3" />
          </button>
          <button
            onClick={async () => {
              await deleteItem(item.path);
            }}
            title="Eliminar"
            className="hover:text-red-400 p-0.5"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Children files & folders */}
      {item.isDir && isOpen && item.children && item.children.length > 0 && (
        <FileTree
          items={item.children}
          depth={depth + 1}
          onOpenInNewTab={onOpenInNewTab}
        />
      )}

      {/* Obsidian Context Menu for File Item */}
      {contextMenu && (
        <ObsidianMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
