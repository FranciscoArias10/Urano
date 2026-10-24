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
  LayoutGrid,
} from 'lucide-react';
import { FileItem, SortOrder } from '../../types';
import { useVaultStore, validateFileName } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import {
  getStorageAdapter,
  getImageFormatTag,
} from '../../services/storageAdapter';
import { copyImageBlobToClipboard } from '../../editor/imageExtension';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { useNoticeStore } from '../common/Notice';
import { Tooltip } from '../common/Tooltip';
import { UpdateLinksModal } from '../common/UpdateLinksModal';
import {
  scanAffectedLinks,
  executeLinkRefactor,
  executeFileRenameOnly,
  getAlwaysUpdateLinksPref,
  setAlwaysUpdateLinksPref,
  LinkScanResult,
} from '../../services/linkRefactorService';

/**
 * Extracts the base name (without extension) and extension for any file.
 * Folders return { baseName: fileName, extension: '' }.
 */
export function getBaseNameAndExt(fileName: string, isDir: boolean): { baseName: string; extension: string } {
  if (isDir) {
    return { baseName: fileName, extension: '' };
  }
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot > 0) {
    return {
      baseName: fileName.substring(0, lastDot),
      extension: fileName.substring(lastDot),
    };
  }
  return { baseName: fileName, extension: '' };
}

// Context to coordinate folder expansion and newly created items for inline rename
interface FileTreeContextValue {
  collapsedMap: Record<string, boolean>;
  setFolderOpen: (path: string, isOpen: boolean) => void;
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
  onOpenInNewTab?: (filePath: string) => void;
  requestFileRename: (oldPath: string, finalName: string, isDir: boolean) => Promise<void>;
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
    createUntitledCanvas,
    createUntitledFolder,
    activeVault,
    fileTree,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();
  const t = useT();

  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null);

  const [pendingRename, setPendingRename] = useState<{
    plan: LinkScanResult;
    oldPath: string;
    newPath: string;
  } | null>(null);

  const requestFileRename = async (oldPath: string, finalName: string, isDir: boolean) => {
    const normOld = oldPath.replace(/\\/g, '/');
    const parentDir = normOld.substring(0, normOld.lastIndexOf('/'));
    const newPath = `${parentDir}/${finalName}`.replace(/\/+/g, '/');

    if (normOld === newPath) {
      return;
    }

    // Sibling collision (case-insensitive, like Obsidian on case-insensitive filesystems)
    const target = newPath.toLowerCase();
    const collides = (items: FileItem[]): boolean =>
      items.some((f) => {
        const p = f.path.replace(/\\/g, '/');
        if (p.toLowerCase() === target && p !== normOld) return true;
        return f.children ? collides(f.children) : false;
      });
    if (collides(fileTree)) {
      showNotice(t('fileTree.notices.nameExists'), 3000, 'error');
      return;
    }

    if (isDir) {
      try {
        await useVaultStore.getState().renameItem(oldPath, newPath);
      } catch (err: any) {
        showNotice(err?.toString() || t('fileTree.notices.renameFolderError'), 3000, 'error');
      }
      return;
    }

    try {
      const scanResult = await scanAffectedLinks(activeVault || '', oldPath, newPath);

      if (scanResult.totalLinks === 0) {
        await executeFileRenameOnly(oldPath, newPath);
        return;
      }

      const pref = getAlwaysUpdateLinksPref();
      if (pref === 'always') {
        await executeLinkRefactor(scanResult, oldPath, newPath);
        notifyLinksUpdated(scanResult);
      } else if (pref === 'never') {
        await executeFileRenameOnly(oldPath, newPath);
      } else {
        // 'prompt' -> Obsidian 1:1 "Update links" modal decides
        setPendingRename({ plan: scanResult, oldPath, newPath });
      }
    } catch (err: any) {
      console.error('Error during rename:', err);
      showNotice(err?.toString() || t('fileTree.notices.renameFileError'), 3000, 'error');
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
    showNotice(t(key, { links: plan.totalLinks, files: plan.totalFiles }), 3000, 'success');
  };

  /** Resolves the pending "Update links" modal. */
  const resolvePendingRename = async (mode: 'always' | 'once' | 'skip') => {
    const pr = pendingRename;
    setPendingRename(null);
    if (!pr) return;
    try {
      if (mode === 'skip') {
        await executeFileRenameOnly(pr.oldPath, pr.newPath);
        return;
      }
      if (mode === 'always') {
        setAlwaysUpdateLinksPref('always');
        // Keep Settings → Files and links → "Automatically update internal links" in sync
        useSettingsStore.getState().setSetting('alwaysUpdateLinks', 'always');
      }
      await executeLinkRefactor(pr.plan, pr.oldPath, pr.newPath);
      notifyLinksUpdated(pr.plan);
    } catch (err: any) {
      console.error('Error during rename:', err);
      showNotice(err?.toString() || t('fileTree.notices.renameFileError'), 3000, 'error');
    }
  };

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
      if (onOpenInNewTab) {
        onOpenInNewTab(path);
      } else {
        selectFile(path);
      }
    }
  };

  const handleCreateNewCanvas = async () => {
    const { path } = await createUntitledCanvas();
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

  // Sort Options Menu (labels resolved at render so they follow the active language)
  const sortOptions: { label: string; order: SortOrder }[] = [
    { label: t('fileTree.sort.nameAsc'), order: 'name-asc' },
    { label: t('fileTree.sort.nameDesc'), order: 'name-desc' },
    { label: t('fileTree.sort.mtimeDesc'), order: 'mtime-desc' },
    { label: t('fileTree.sort.mtimeAsc'), order: 'mtime-asc' },
    { label: t('fileTree.sort.ctimeDesc'), order: 'ctime-desc' },
    { label: t('fileTree.sort.ctimeAsc'), order: 'ctime-asc' },
  ];

  const sortMenuItems: MenuItemData[] = sortOptions.map((opt) => ({
    title: opt.label,
    icon: sortOrder === opt.order ? <Check size={13} className="text-orange-500" /> : <span className="w-3.5" />,
    action: () => setSortOrder(opt.order),
  }));

  const rootMenuItems: MenuItemData[] = [
    {
      title: t('fileTree.newNote'),
      icon: <SquarePen size={14} />,
      action: handleCreateNewNote,
    },
    {
      title: t('fileTree.newCanvas'),
      icon: <LayoutGrid size={14} />,
      action: handleCreateNewCanvas,
    },
    {
      title: t('fileTree.newFolder'),
      icon: <FolderPlus size={14} />,
      action: handleCreateNewFolder,
    },
  ];

  return (
    <FileTreeContext.Provider
      value={{
        collapsedMap,
        setFolderOpen,
        renamingPath,
        setRenamingPath,
        onOpenInNewTab,
        requestFileRename,
      }}
    >
      <div className="flex flex-col select-none h-full">
        {/* Only top level renders the 5-button File Explorer Toolbar */}
        {depth === 0 && (
          <div className="flex items-center justify-end px-3 py-1.5 border-b border-obsidian-border text-stone-400 gap-1 bg-[#181818]/60">
            {/* 1. New note */}
            <Tooltip content={t('fileTree.newNote')} position="bottom">
              <button
                onClick={handleCreateNewNote}
                className="p-1 hover:text-orange-400 hover:bg-white/5 rounded transition-colors"
              >
                <SquarePen size={14} />
              </button>
            </Tooltip>

            {/* 2. New folder */}
            <Tooltip content={t('fileTree.newFolder')} position="bottom">
              <button
                onClick={handleCreateNewFolder}
                className="p-1 hover:text-white hover:bg-white/5 rounded transition-colors"
              >
                <FolderPlus size={14} />
              </button>
            </Tooltip>

            {/* 3. Change sort order */}
            <Tooltip content={t('fileTree.changeSortOrder')} position="bottom">
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
              content={autoReveal ? t('fileTree.disableAutoReveal') : t('fileTree.enableAutoReveal')}
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
            <Tooltip content={t('fileTree.expandCollapseAll')} position="bottom">
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
        <div
          className="flex flex-col flex-1 overflow-y-auto pt-1 pb-4"
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              setRootContextMenu({ x: e.clientX, y: e.clientY });
            }
          }}
        >
          {items.map((item) => (
            <FileTreeItem key={item.path} item={item} depth={depth} />
          ))}
        </div>

        {/* Root Context Menu Modal */}
        {rootContextMenu && (
          <ObsidianMenu
            x={rootContextMenu.x}
            y={rootContextMenu.y}
            items={rootMenuItems}
            onClose={() => setRootContextMenu(null)}
          />
        )}

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

      {/* Obsidian 1:1 "Update links" Modal */}
      {pendingRename && (
        <UpdateLinksModal
          isOpen={true}
          totalLinks={pendingRename.plan.totalLinks}
          totalFiles={pendingRename.plan.totalFiles}
          onAlwaysUpdate={() => resolvePendingRename('always')}
          onJustOnce={() => resolvePendingRename('once')}
          onDoNotUpdate={() => resolvePendingRename('skip')}
        />
      )}
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
    createUntitledCanvas,
    createUntitledFolder,
    duplicateNote,
    deleteItem,
    moveItem,
    isBookmarked,
    toggleBookmark,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();
  const t = useT();

  const isClosed = ctx ? Boolean(ctx.collapsedMap[item.path]) : false;
  const isOpen = !isClosed;

  const isRenaming = ctx?.renamingPath === item.path;
  const { baseName: initialBaseName } = getBaseNameAndExt(item.name, item.isDir);
  const [renameValue, setRenameValue] = useState(initialBaseName);

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
    const { baseName } = getBaseNameAndExt(item.name, item.isDir);
    setRenameValue(baseName);
  }, [item.name, item.isDir]);

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
      showNotice(validation.error || t('fileTree.notices.invalidName'), 3000, 'error');
      ctx?.setRenamingPath(null);
      return;
    }

    ctx?.setRenamingPath(null);

    const { baseName: currentBaseName, extension: currentExt } = getBaseNameAndExt(item.name, item.isDir);
    if (trimmed && trimmed !== currentBaseName) {
      const finalName = currentExt ? `${trimmed}${currentExt}` : trimmed;
      await ctx?.requestFileRename(item.path, finalName, item.isDir);
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
          title: t('fileTree.newNote'),
          icon: <SquarePen size={14} />,
          action: async () => {
            const { path } = await createUntitledNote(item.path);
            ctx?.setFolderOpen(item.path, true);
            if (path) {
              if (ctx?.onOpenInNewTab) {
                ctx.onOpenInNewTab(path);
              } else {
                selectFile(path);
              }
            }
          },
        },
        {
          title: t('fileTree.newCanvas'),
          icon: <LayoutGrid size={14} />,
          action: async () => {
            const { path } = await createUntitledCanvas(item.path);
            ctx?.setFolderOpen(item.path, true);
            if (path) ctx?.setRenamingPath(path);
          },
        },
        {
          title: t('fileTree.newFolder'),
          icon: <FolderPlus size={14} />,
          action: async () => {
            const path = await createUntitledFolder(item.path);
            ctx?.setFolderOpen(item.path, true);
            if (path) ctx?.setRenamingPath(path);
          },
        },
        {
          title: bookmarked ? t('fileTree.contextMenu.removeBookmark') : t('fileTree.contextMenu.addBookmark'),
          icon: <Bookmark size={14} className={bookmarked ? 'fill-orange-500 text-orange-500' : ''} />,
          action: () => {
            toggleBookmark({ type: 'folder', path: item.path, title: item.name });
            showNotice(
              bookmarked ? t('fileTree.notices.bookmarkRemoved') : t('fileTree.notices.bookmarkAdded'),
              2000,
              'info'
            );
          },
        },
        { type: 'separator' },
        {
          title: t('fileTree.contextMenu.rename'),
          shortcut: 'F2',
          icon: <Edit2 size={14} />,
          action: () => ctx?.setRenamingPath(item.path),
        },
        {
          title: t('fileTree.contextMenu.deleteFolder'),
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: async () => {
            // Settings → Files and links → "Confirm file deletion"
            if (
              useSettingsStore.getState().settings.confirmFileDeletion &&
              !window.confirm(t('fileTree.confirmDelete', { name: item.name }))
            ) {
              return;
            }
            await deleteItem(item.path);
          },
        }
      );
    } else {
      const imageTag = getImageFormatTag(item.name);
      if (imageTag) {
        items.push({
          title: t('fileTree.contextMenu.copyImage'),
          icon: <Copy size={14} />,
          action: async () => {
            try {
              const blob = await getStorageAdapter().readBinary(item.path);
              await copyImageBlobToClipboard(blob);
              showNotice(t('fileTree.notices.imageCopied'), 2000, 'success');
            } catch (err) {
              console.error('Error copying image:', err);
              showNotice(t('fileTree.notices.imageCopyError'), 2500, 'error');
            }
          },
        });
      }
      items.push(
        {
          title: t('fileTree.contextMenu.openInNewTab'),
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
          title: bookmarked ? t('fileTree.contextMenu.removeBookmark') : t('fileTree.contextMenu.addBookmark'),
          icon: <Bookmark size={14} className={bookmarked ? 'fill-orange-500 text-orange-500' : ''} />,
          action: () => {
            toggleBookmark({
              type: 'file',
              path: item.path,
              title: item.name.replace(/\.(md|canvas|base)$/i, ''),
            });
            showNotice(
              bookmarked ? t('fileTree.notices.bookmarkRemoved') : t('fileTree.notices.bookmarkAdded'),
              2000,
              'info'
            );
          },
        },
        {
          title: t('fileTree.contextMenu.makeCopy'),
          icon: <Copy size={14} />,
          action: async () => {
            const newPath = await duplicateNote(item.path);
            showNotice(t('fileTree.notices.noteDuplicated'), 2000, 'success');
            ctx?.setRenamingPath(newPath);
          },
        },
        { type: 'separator' },
        {
          title: t('fileTree.contextMenu.rename'),
          shortcut: 'F2',
          icon: <Edit2 size={14} />,
          action: () => ctx?.setRenamingPath(item.path),
        },
        {
          title: t('fileTree.contextMenu.deleteFile'),
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: async () => {
            // Settings → Files and links → "Confirm file deletion"
            if (
              useSettingsStore.getState().settings.confirmFileDeletion &&
              !window.confirm(t('fileTree.confirmDelete', { name: item.name }))
            ) {
              return;
            }
            await deleteItem(item.path);
          },
        }
      );
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Determine Tag (.canvas -> CANVAS, .base -> BASE, or image format tag)
  const isCanvas = item.name.toLowerCase().endsWith('.canvas');
  const isBase = item.name.toLowerCase().endsWith('.base');
  const imageTag = getImageFormatTag(item.name);
  const displayName = item.isDir
    ? item.name
    : imageTag
    ? item.name
    : item.name.replace(/\.(md|canvas|base)$/i, '');

  return (
    <div className="flex flex-col">
      <div
        ref={itemRef}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', item.path);
          e.dataTransfer.setData('application/x-urano-path', item.path);
          e.dataTransfer.effectAllowed = 'copyMove';
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

          // Handle dropped files from OS
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            for (const f of files) {
              const fullPath = `${item.path}/${f.name}`.replace(/\/+/g, '/');
              await getStorageAdapter().writeBinary(fullPath, f);
            }
            ctx?.setFolderOpen(item.path, true);
            await useVaultStore.getState().refreshTree();
            showNotice(t('fileTree.notices.filesSaved', { count: files.length }), 2000, 'success');
            return;
          }

          const sourcePath = e.dataTransfer.getData('text/plain');
          if (sourcePath && sourcePath !== item.path) {
            await moveItem(sourcePath, item.path);
            ctx?.setFolderOpen(item.path, true);
            showNotice(t('fileTree.notices.itemMoved'), 2000, 'success');
          }
        }}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`group flex items-center justify-between pr-2.5 py-1 text-xs cursor-pointer transition-colors relative outline-none ${
          isDragTarget ? 'bg-orange-500/20 ring-1 ring-orange-500' : ''
        } ${
          isSelected
            ? 'bg-[#363636] text-white font-medium rounded-md'
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
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRenameSubmit()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenameValue(initialBaseName);
                    ctx?.setRenamingPath(null);
                  }
                }}
                className="w-full bg-[#161616] text-white px-1.5 py-0.5 rounded outline-none border border-orange-500"
              />
            </form>
          ) : (
            <span className="truncate text-stone-300 group-hover:text-white">
              {displayName}
            </span>
          )}
        </div>

        {/* Badges for CANVAS, BASE, and IMAGES (stay visible while renaming, like Obsidian) */}
        {(isCanvas || isBase || imageTag) && (
          <div className="flex items-center shrink-0">
            {isCanvas && <span className="nav-file-tag">CANVAS</span>}
            {isBase && <span className="nav-file-tag">BASE</span>}
            {imageTag && <span className="nav-file-tag">{imageTag}</span>}
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
