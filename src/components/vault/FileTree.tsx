import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FolderPlus,
  Trash2,
  Edit2,
  Copy,
  PlusCircle,
  SquarePen,
  ArrowUpNarrowWide,
  ScanLine,
  ChevronsUpDown,
  Bookmark,
  Check,
} from 'lucide-react';
import { FileItem, SortOrder } from '../../types';
import { useVaultStore, validateFileName } from '../../stores/vaultStore';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { useNoticeStore } from '../common/Notice';
import { Tooltip } from '../common/Tooltip';

// Context to coordinate folder expansion and newly created items for inline rename
interface FileTreeContextValue {
  collapsedMap: Record<string, boolean>;
  setFolderOpen: (path: string, isOpen: boolean) => void;
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
  onOpenInNewTab?: (filePath: string) => void;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

interface FileTreeProps {
  items: FileItem[];
  depth?: number;
  onOpenInNewTab?: (filePath: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ items, depth = 0, onOpenInNewTab }) => {
  const {
    sortOrder,
    setSortOrder,
    autoReveal,
    setAutoReveal,
    createUntitledNote,
    createUntitledFolder,
  } = useVaultStore();

  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);

  const setFolderOpen = (path: string, isOpen: boolean) => {
    setCollapsedMap((prev) => ({
      ...prev,
      [path]: !isOpen,
    }));
  };

  // Check if any folder is open
  const areAllCollapsed = () => {
    const checkDir = (list: FileItem[]): boolean => {
      for (const it of list) {
        if (it.isDir) {
          const isClosed = Boolean(collapsedMap[it.path]);
          if (!isClosed) return false;
          if (it.children && !checkDir(it.children)) return false;
        }
      }
      return true;
    };
    return checkDir(items);
  };

  const handleToggleExpandAll = () => {
    const allCollapsed = areAllCollapsed();
    const newMap: Record<string, boolean> = {};

    const traverse = (list: FileItem[]) => {
      for (const it of list) {
        if (it.isDir) {
          newMap[it.path] = allCollapsed ? false : true;
          if (it.children) traverse(it.children);
        }
      }
    };
    traverse(items);
    setCollapsedMap(newMap);
  };

  const handleCreateNewNote = async () => {
    const { path } = await createUntitledNote();
    if (path) {
      setRenamingPath(path);
    }
  };

  const handleCreateNewFolder = async () => {
    const path = await createUntitledFolder();
    if (path) {
      setRenamingPath(path);
    }
  };

  // Sort Options Menu
  const sortOptions: { label: string; order: SortOrder }[] = [
    { label: 'Nombre del archivo (A a la Z)', order: 'name-asc' },
    { label: 'Nombre del archivo (Z a la A)', order: 'name-desc' },
    { label: 'Tiempo de modificación (de más nuevo a más antiguo)', order: 'mtime-desc' },
    { label: 'Tiempo de modificación (de más antiguo a más nuevo)', order: 'mtime-asc' },
    { label: 'Fecha de creación (de más nuevo a más antiguo)', order: 'ctime-desc' },
    { label: 'Fecha de creación (de más antiguo a más nuevo)', order: 'ctime-asc' },
  ];

  const sortMenuItems: MenuItemData[] = sortOptions.map((opt) => ({
    title: opt.label,
    icon: sortOrder === opt.order ? <Check size={13} className="text-orange-500" /> : <span className="w-3.5" />,
    action: () => setSortOrder(opt.order),
  }));

  return (
    <FileTreeContext.Provider
      value={{
        collapsedMap,
        setFolderOpen,
        renamingPath,
        setRenamingPath,
        onOpenInNewTab,
      }}
    >
      <div className="flex flex-col select-none h-full">
        {/* Only top level renders the 5-button File Explorer Toolbar */}
        {depth === 0 && (
          <div className="flex items-center justify-end px-3 py-1.5 border-b border-obsidian-border text-stone-400 gap-1 bg-[#181818]/60">
            {/* 1. New note */}
            <Tooltip content="Nueva nota" position="bottom">
              <button
                onClick={handleCreateNewNote}
                className="p-1 hover:text-orange-400 hover:bg-white/5 rounded transition-colors"
              >
                <SquarePen size={14} />
              </button>
            </Tooltip>

            {/* 2. New folder */}
            <Tooltip content="Nueva carpeta" position="bottom">
              <button
                onClick={handleCreateNewFolder}
                className="p-1 hover:text-white hover:bg-white/5 rounded transition-colors"
              >
                <FolderPlus size={14} />
              </button>
            </Tooltip>

            {/* 3. Change sort order */}
            <Tooltip content="Cambiar orden" position="bottom">
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setSortMenu({ x: rect.left, y: rect.bottom + 4 });
                }}
                className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors ${
                  sortMenu ? 'text-orange-400 bg-white/5' : ''
                }`}
              >
                <ArrowUpNarrowWide size={14} />
              </button>
            </Tooltip>

            {/* 4. Auto-reveal current file toggle */}
            <Tooltip
              content={autoReveal ? 'Desactivar auto-revelar archivo actual' : 'Activar auto-revelar archivo actual'}
              position="bottom"
            >
              <button
                onClick={() => setAutoReveal(!autoReveal)}
                className={`p-1 rounded transition-colors ${
                  autoReveal
                    ? 'text-orange-400 bg-orange-500/15 border border-orange-500/30'
                    : 'text-stone-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <ScanLine size={14} />
              </button>
            </Tooltip>

            {/* 5. Collapse / Expand all */}
            <Tooltip content="Expandir / Colapsar todo" position="bottom">
              <button
                onClick={handleToggleExpandAll}
                className="p-1 hover:text-white hover:bg-white/5 rounded transition-colors"
              >
                <ChevronsUpDown size={14} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* Tree Items List */}
        <div className="flex flex-col flex-1 overflow-y-auto pt-1 pb-4">
          {items.map((item) => (
            <FileTreeItem key={item.path} item={item} depth={depth} />
          ))}
        </div>

        {/* Sort Menu Modal */}
        {sortMenu && (
          <ObsidianMenu
            x={sortMenu.x}
            y={sortMenu.y}
            items={sortMenuItems}
            onClose={() => setSortMenu(null)}
          />
        )}
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeItemProps {
  item: FileItem;
  depth: number;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ item, depth }) => {
  const ctx = useContext(FileTreeContext);
  const itemRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const {
    activeFile,
    autoReveal,
    selectFile,
    createUntitledNote,
    createUntitledFolder,
    duplicateNote,
    deleteItem,
    renameNoteWithLinkRefactor,
    moveItem,
    isBookmarked,
    toggleBookmark,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();

  const isClosed = ctx ? Boolean(ctx.collapsedMap[item.path]) : false;
  const isOpen = !isClosed;

  const isRenaming = ctx?.renamingPath === item.path;
  const [renameValue, setRenameValue] = useState(
    item.name.replace(/\.(md|canvas|base)$/i, '')
  );

  const [isDragTarget, setIsDragTarget] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  const isSelected = activeFile === item.path;

  // Auto-reveal: expand parents and scroll into view when active
  useEffect(() => {
    if (!autoReveal || !activeFile) return;

    if (item.isDir && activeFile.startsWith(`${item.path}/`)) {
      ctx?.setFolderOpen(item.path, true);
    }

    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeFile, autoReveal, isSelected]);

  // Keep renameValue in sync
  useEffect(() => {
    setRenameValue(item.name.replace(/\.(md|canvas|base)$/i, ''));
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
      ctx?.setFolderOpen(item.path, !isOpen);
    } else {
      selectFile(item.path);
    }
  };

  const handleRenameSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isRenaming) return;

    const trimmed = renameValue.trim();
    const validation = validateFileName(trimmed);
    if (!validation.valid) {
      showNotice(validation.error || 'Nombre inválido', 3000, 'error');
      ctx?.setRenamingPath(null);
      return;
    }

    ctx?.setRenamingPath(null);

    if (trimmed && trimmed !== item.name.replace(/\.(md|canvas|base)$/i, '')) {
      const res = await renameNoteWithLinkRefactor(item.path, trimmed);
      if (res.success) {
        showNotice('Renombrado con éxito', 2000, 'success');
      } else {
        showNotice(res.error || 'Error al renombrar', 3000, 'error');
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const bookmarked = isBookmarked(item.path);
    const items: MenuItemData[] = [];

    if (item.isDir) {
      items.push(
        {
          title: 'Nueva nota',
          icon: <SquarePen size={14} />,
          action: async () => {
            const { path } = await createUntitledNote(item.path);
            ctx?.setFolderOpen(item.path, true);
            if (path) ctx?.setRenamingPath(path);
          },
        },
        {
          title: 'Nueva carpeta',
          icon: <FolderPlus size={14} />,
          action: async () => {
            const path = await createUntitledFolder(item.path);
            ctx?.setFolderOpen(item.path, true);
            if (path) ctx?.setRenamingPath(path);
          },
        },
        {
          title: bookmarked ? 'Quitar de marcadores' : 'Añadir a marcadores',
          icon: <Bookmark size={14} className={bookmarked ? 'fill-orange-500 text-orange-500' : ''} />,
          action: () => {
            toggleBookmark({ type: 'folder', path: item.path, title: item.name });
            showNotice(bookmarked ? 'Marcador eliminado' : 'Añadido a marcadores', 2000, 'info');
          },
        },
        { type: 'separator' },
        {
          title: 'Cambiar nombre',
          shortcut: 'F2',
          icon: <Edit2 size={14} />,
          action: () => ctx?.setRenamingPath(item.path),
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
      items.push(
        {
          title: 'Abrir en una pestaña nueva',
          icon: <PlusCircle size={14} />,
          action: () => {
            if (ctx?.onOpenInNewTab) {
              ctx.onOpenInNewTab(item.path);
            } else {
              selectFile(item.path);
            }
          },
        },
        {
          title: bookmarked ? 'Quitar de marcadores' : 'Añadir a marcadores',
          icon: <Bookmark size={14} className={bookmarked ? 'fill-orange-500 text-orange-500' : ''} />,
          action: () => {
            toggleBookmark({
              type: 'file',
              path: item.path,
              title: item.name.replace(/\.(md|canvas|base)$/i, ''),
            });
            showNotice(bookmarked ? 'Marcador eliminado' : 'Añadido a marcadores', 2000, 'info');
          },
        },
        {
          title: 'Hacer una copia',
          icon: <Copy size={14} />,
          action: async () => {
            const newPath = await duplicateNote(item.path);
            showNotice('Nota duplicada', 2000, 'success');
            ctx?.setRenamingPath(newPath);
          },
        },
        { type: 'separator' },
        {
          title: 'Cambiar nombre',
          shortcut: 'F2',
          icon: <Edit2 size={14} />,
          action: () => ctx?.setRenamingPath(item.path),
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

  // Determine Tag (.canvas -> CANVAS, .base -> BASE)
  const isCanvas = item.name.toLowerCase().endsWith('.canvas');
  const isBase = item.name.toLowerCase().endsWith('.base');
  const displayName = item.isDir
    ? item.name
    : item.name.replace(/\.(md|canvas|base)$/i, '');

  return (
    <div className="flex flex-col">
      <div
        ref={itemRef}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', item.path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (item.isDir) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setIsDragTarget(true);
          }
        }}
        onDragLeave={() => setIsDragTarget(false)}
        onDrop={async (e) => {
          if (!item.isDir) return;
          e.preventDefault();
          setIsDragTarget(false);
          const sourcePath = e.dataTransfer.getData('text/plain');
          if (sourcePath && sourcePath !== item.path) {
            await moveItem(sourcePath, item.path);
            ctx?.setFolderOpen(item.path, true);
            showNotice('Elemento movido a la carpeta', 2000, 'success');
          }
        }}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`group flex items-center justify-between pr-2.5 py-1 text-xs cursor-pointer transition-colors relative outline-none ${
          isDragTarget ? 'bg-orange-500/20 ring-1 ring-orange-500' : ''
        } ${
          isSelected
            ? 'bg-orange-500/15 text-orange-400 font-medium rounded-r-md'
            : 'text-obsidian-text hover:bg-obsidian-hover rounded-md'
        }`}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-1">
          {item.isDir ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                ctx?.setFolderOpen(item.path, !isOpen);
              }}
              className="text-stone-500 group-hover:text-stone-300 w-3.5 flex justify-center shrink-0"
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : (
            <span className="w-3.5" />
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
                className="w-full bg-[#161616] text-white px-1.5 py-0.5 rounded outline-none border border-orange-500"
              />
            </form>
          ) : (
            <span className="truncate text-stone-300 group-hover:text-white">
              {displayName}
            </span>
          )}
        </div>

        {/* Badges for CANVAS and BASE */}
        {!isRenaming && (
          <div className="flex items-center shrink-0">
            {isCanvas && <span className="nav-file-tag">CANVAS</span>}
            {isBase && <span className="nav-file-tag">BASE</span>}
          </div>
        )}
      </div>

      {/* Children files & folders with Obsidian vertical indentation line */}
      {item.isDir && isOpen && item.children && item.children.length > 0 && (
        <div className="nav-folder-children">
          {item.children.map((child) => (
            <FileTreeItem key={child.path} item={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {/* Item Context Menu */}
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
