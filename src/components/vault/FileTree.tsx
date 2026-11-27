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
  Merge,
} from 'lucide-react';
import { FileItem, SortOrder } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';
import {
  normalizeFileNameInput,
  stripInlineTitleNewlines,
  validateFileName,
} from '../../utils/fileNameValidation';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import {
  getStorageAdapter,
  getImageFormatTag,
} from '../../services/storageAdapter';
import { copyImageBlobToClipboard } from '../../editor/imageExtension';
import { UranoMenu, MenuItemData } from '../common/UranoMenu';
import { useNoticeStore } from '../common/Notice';
import { Tooltip } from '../common/Tooltip';
import { isSamePath, normalizePath } from '../../utils/pathUtils';
import { URANO_REVEAL_FOLDER_EVENT } from '../../utils/bookmarksUtils';

function toCollapsedKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

export function canMoveToFolder(sourcePath: string, targetFolderPath: string): boolean {
  const normSrc = normalizePath(sourcePath);
  const normDst = normalizePath(targetFolderPath);
  if (!normSrc || !normDst) return false;
  const lowerSrc = normSrc.toLowerCase();
  const lowerDst = normDst.toLowerCase();
  if (lowerSrc === lowerDst) return false;
  // Prevent moving a folder into itself or any of its descendants
  if (lowerDst.startsWith(`${lowerSrc}/`)) return false;
  // Prevent no-op move into the same parent folder
  const lastSlash = lowerSrc.lastIndexOf('/');
  const srcParent = lastSlash !== -1 ? lowerSrc.substring(0, lastSlash) : '';
  if (srcParent === lowerDst) return false;
  return true;
}

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
  revealedPath: string | null;
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
  onOpenInNewTab?: (filePath: string) => void;
  onOpenFile?: (filePath: string) => void;
  requestFileRename: (oldPath: string, finalName: string, isDir: boolean) => Promise<void>;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

interface FileTreeProps {
  items: FileItem[];
  depth?: number;
  onOpenInNewTab?: (filePath: string) => void;
  onOpenFile?: (filePath: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ items, depth = 0, onOpenInNewTab, onOpenFile }) => {
  const {
    activeVault,
    sortOrder,
    setSortOrder,
    autoReveal,
    setAutoReveal,
    createUntitledNote,
    createUntitledCanvas,
    createUntitledFolder,
    moveItem,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();
  const t = useT();

  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [revealedPath, setRevealedPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [isRootDragTarget, setIsRootDragTarget] = useState(false);

  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestFileRename = async (oldPath: string, finalName: string, isDir: boolean) => {
    const normOld = normalizePath(oldPath);
    const lastSlash = normOld.lastIndexOf('/');
    const parentDir = lastSlash !== -1 ? normOld.substring(0, lastSlash) : '';
    const newPath = (parentDir ? `${parentDir}/${finalName}` : finalName).replace(/\/+/g, '/');

    if (normOld === newPath) {
      return;
    }

    if (isDir) {
      const folderValidation = validateFileName(finalName, {
        currentPath: oldPath,
        parentDir,
        existingItems: useVaultStore.getState().fileTree,
      });
      if (!folderValidation.valid) {
        showNotice(folderValidation.error || t('fileTree.notices.nameExists'), 4000, 'error');
        return;
      }
      if (folderValidation.warning) {
        showNotice(folderValidation.warning, 4000, 'warning');
      }
      try {
        await useVaultStore.getState().renameItem(oldPath, newPath);
      } catch (err: any) {
        showNotice(err?.toString() || t('fileTree.notices.renameFolderError'), 4000, 'error');
      }
      return;
    }

    try {
      const res = await useVaultStore.getState().renameNoteWithLinkRefactor(oldPath, finalName);
      if (!res.success) {
        showNotice(res.error || t('fileTree.notices.renameFileError'), 4000, 'error');
      }
    } catch (err: any) {
      console.error('Error during rename:', err);
      showNotice(err?.toString() || t('fileTree.notices.renameFileError'), 4000, 'error');
    }
  };

  const setFolderOpen = (path: string, isOpen: boolean) => {
    const key = toCollapsedKey(path);
    if (!key) return;
    setCollapsedMap((prev) => ({
      ...prev,
      [key]: !isOpen,
    }));
  };

  useEffect(() => {
    if (depth !== 0) return;

    const applyReveal = (rawTargetPath?: string | null) => {
      if (!rawTargetPath) return;
      const normTarget = normalizePath(rawTargetPath);
      const lowerTarget = normTarget.toLowerCase();
      if (!lowerTarget) return;

      setCollapsedMap((prev) => {
        const next = { ...prev };
        const expandMatchingDirs = (list: FileItem[]) => {
          for (const it of list) {
            if (it.isDir) {
              const lowerDir = toCollapsedKey(it.path);
              if (lowerDir === lowerTarget || lowerTarget.startsWith(`${lowerDir}/`)) {
                next[lowerDir] = false;
              }
              if (it.children?.length) {
                expandMatchingDirs(it.children);
              }
            }
          }
        };
        expandMatchingDirs(useVaultStore.getState().fileTree);
        return next;
      });

      setRevealedPath(normTarget);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = setTimeout(() => {
        setRevealedPath(null);
      }, 2200);
    };

    const pending = (window as any).__uranoPendingRevealFolder as string | undefined;
    if (pending) {
      delete (window as any).__uranoPendingRevealFolder;
      applyReveal(pending);
    }

    const onRevealEvent = (e: Event) => {
      const detailPath = (e as CustomEvent<{ path?: string }>).detail?.path;
      delete (window as any).__uranoPendingRevealFolder;
      applyReveal(detailPath);
    };

    const onStartRenameEvent = (e: Event) => {
      const detailPath = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!detailPath) return;
      applyReveal(detailPath);
      setRenamingPath(detailPath);
    };

    window.addEventListener(URANO_REVEAL_FOLDER_EVENT, onRevealEvent);
    window.addEventListener('urano:start-rename', onStartRenameEvent);
    return () => {
      window.removeEventListener(URANO_REVEAL_FOLDER_EVENT, onRevealEvent);
      window.removeEventListener('urano:start-rename', onStartRenameEvent);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, [depth]);

  // Check if any folder is open
  const areAllCollapsed = () => {
    const checkDir = (list: FileItem[]): boolean => {
      for (const it of list) {
        if (it.isDir) {
          const isClosed = Boolean(collapsedMap[toCollapsedKey(it.path)]);
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
          newMap[toCollapsedKey(it.path)] = allCollapsed ? false : true;
          if (it.children) traverse(it.children);
        }
      }
    };
    traverse(items);
    setCollapsedMap(newMap);
  };

  const handleCreateNewNote = async () => {
    await createUntitledNote();
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
        revealedPath,
        renamingPath,
        setRenamingPath,
        onOpenInNewTab,
        onOpenFile,
        requestFileRename,
      }}
    >
      <div className="flex flex-col select-none h-full">
        {/* Only top level renders the 5-button File Explorer Toolbar */}
        {depth === 0 && (
          <div className="nav-buttons-container flex items-center justify-center px-3 py-1.5 border-b border-urano-border text-urano-muted gap-[4px] bg-urano-sidebar">
            {/* 1. New note */}
            <Tooltip content={t('fileTree.newNote')} position="bottom">
              <button
                onClick={handleCreateNewNote}
                className="clickable-icon nav-action-button"
                aria-label={t('fileTree.newNote')}
              >
                <SquarePen size={14} />
              </button>
            </Tooltip>

            {/* 2. New folder */}
            <Tooltip content={t('fileTree.newFolder')} position="bottom">
              <button
                onClick={handleCreateNewFolder}
                className="clickable-icon nav-action-button"
                aria-label={t('fileTree.newFolder')}
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
                className={`clickable-icon nav-action-button ${sortMenu ? 'is-active' : ''}`}
                aria-label={t('fileTree.changeSortOrder')}
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
                className={`clickable-icon nav-action-button ${autoReveal ? 'is-active' : ''}`}
                aria-label={autoReveal ? t('fileTree.disableAutoReveal') : t('fileTree.enableAutoReveal')}
              >
                <ScanLine size={14} />
              </button>
            </Tooltip>

            {/* 5. Collapse / Expand all */}
            <Tooltip content={t('fileTree.expandCollapseAll')} position="bottom">
              <button
                onClick={handleToggleExpandAll}
                className="clickable-icon nav-action-button"
                aria-label={t('fileTree.expandCollapseAll')}
              >
                <ChevronsUpDown size={14} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* Tree Items List */}
        <div
          className={`flex flex-col flex-1 overflow-y-auto pt-1 pb-4 transition-colors ${
            isRootDragTarget ? 'bg-orange-500/10 ring-1 ring-inset ring-orange-500/60 rounded-md' : ''
          }`}
          onDragOver={(e) => {
            if (depth === 0 && activeVault) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setIsRootDragTarget(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsRootDragTarget(false);
            }
          }}
          onDrop={async (e) => {
            if (depth !== 0 || !activeVault) return;
            e.preventDefault();
            setIsRootDragTarget(false);

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              const droppedFiles = Array.from(e.dataTransfer.files);
              try {
                let savedCount = 0;
                const currentTree = useVaultStore.getState().fileTree;
                for (const f of droppedFiles) {
                  const check = validateFileName(f.name, {
                    parentDir: activeVault,
                    existingItems: currentTree,
                  });
                  if (!check.valid) {
                    showNotice(
                      check.error || t('fileTree.notices.invalidName'),
                      4000,
                      'error'
                    );
                    continue;
                  }
                  const fullPath = `${normalizePath(activeVault)}/${check.fullFileName}`.replace(
                    /\/+/g,
                    '/'
                  );
                  await getStorageAdapter().writeBinary(fullPath, f);
                  savedCount++;
                }
                if (savedCount > 0) {
                  await useVaultStore.getState().refreshTree();
                  showNotice(
                    t('fileTree.notices.filesSaved', { count: savedCount }),
                    2000,
                    'success'
                  );
                }
              } catch (err: any) {
                console.error('Error saving dropped files to vault root:', err);
                showNotice(
                  err?.toString() || t('fileTree.notices.renameFileError'),
                  3000,
                  'error'
                );
              }
              return;
            }

            const sourcePath = e.dataTransfer.getData('application/x-urano-path');
            if (sourcePath && canMoveToFolder(sourcePath, activeVault)) {
              try {
                await moveItem(sourcePath, activeVault);
                showNotice(t('fileTree.notices.itemMoved'), 2000, 'success');
              } catch (err: any) {
                console.error('Error moving item to vault root:', err);
                showNotice(
                  err?.toString() || t('fileTree.notices.renameFileError'),
                  3000,
                  'error'
                );
              }
            }
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              setRootContextMenu({ x: e.clientX, y: e.clientY });
            }
          }}
        >
          {items.map((item) => (
            <FileTreeItem key={normalizePath(item.path)} item={item} depth={depth} />
          ))}
        </div>

        {/* Root Context Menu Modal */}
        {rootContextMenu && (
          <UranoMenu
            x={rootContextMenu.x}
            y={rootContextMenu.y}
            items={rootMenuItems}
            onClose={() => setRootContextMenu(null)}
          />
        )}

        {/* Sort Menu Modal */}
        {sortMenu && (
          <UranoMenu
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
    createUntitledCanvas,
    createUntitledFolder,
    duplicateNote,
    deleteItem,
    moveItem,
    isBookmarked,
    toggleBookmark,
  } = useVaultStore();

  const { showNotice, upsertNotice, removeNotice } = useNoticeStore();
  const t = useT();
  const isSubmittingRenameRef = useRef(false);
  const FILETREE_RENAME_NOTICE_ID = 'filetree-rename-validation';

  const isClosed = ctx ? Boolean(ctx.collapsedMap[toCollapsedKey(item.path)]) : false;
  const isOpen = !isClosed;

  const isRenaming = ctx?.renamingPath ? isSamePath(ctx.renamingPath, item.path) : false;
  const { baseName: initialBaseName } = getBaseNameAndExt(item.name, item.isDir);
  const [renameValue, setRenameValue] = useState(initialBaseName);

  const [isDragTarget, setIsDragTarget] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  const isSelected = !item.isDir && Boolean(activeFile) && isSamePath(item.path, activeFile);
  const isRevealed =
    Boolean(ctx?.revealedPath) &&
    toCollapsedKey(ctx!.revealedPath!) === toCollapsedKey(item.path);

  useEffect(() => {
    if (isRevealed && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      itemRef.current.focus({ preventScroll: true });
    }
  }, [isRevealed]);

  // Auto-reveal: expand parents and scroll into view when active
  useEffect(() => {
    if (!autoReveal || !activeFile) return;

    if (item.isDir) {
      const normItem = normalizePath(item.path).toLowerCase();
      const normActive = normalizePath(activeFile).toLowerCase();
      if (normActive.startsWith(`${normItem}/`)) {
        ctx?.setFolderOpen(item.path, true);
      }
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
      if (ctx?.onOpenFile) {
        ctx.onOpenFile(item.path);
      } else {
        selectFile(item.path);
      }
    }
  };

  const handleRenameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = stripInlineTitleNewlines(e.target.value);
    setRenameValue(nextVal);
    const { extension: currentExt } = getBaseNameAndExt(item.name, item.isDir);
    const live = validateFileName(nextVal, {
      allowEmpty: true,
      extension: currentExt,
      currentPath: item.path,
      existingItems: useVaultStore.getState().fileTree,
    });
    if (!live.valid && live.error) {
      upsertNotice(FILETREE_RENAME_NOTICE_ID, live.error, 4000, 'error');
    } else if (live.warning) {
      upsertNotice(FILETREE_RENAME_NOTICE_ID, live.warning, 4000, 'warning');
    } else {
      removeNotice(FILETREE_RENAME_NOTICE_ID);
    }
  };

  const handleRenameSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isRenaming || isSubmittingRenameRef.current) return;

    isSubmittingRenameRef.current = true;
    try {
      const trimmed = normalizeFileNameInput(renameValue);
      // Si el usuario deja el nombre vacío al renombrar, revertir silenciosamente al nombre anterior
      if (!trimmed) {
        removeNotice(FILETREE_RENAME_NOTICE_ID);
        setRenameValue(initialBaseName);
        ctx?.setRenamingPath(null);
        return;
      }

      const { baseName: currentBaseName, extension: currentExt } = getBaseNameAndExt(
        item.name,
        item.isDir
      );
      if (trimmed === currentBaseName) {
        removeNotice(FILETREE_RENAME_NOTICE_ID);
        setRenameValue(initialBaseName);
        ctx?.setRenamingPath(null);
        return;
      }

      const validation = validateFileName(trimmed, {
        extension: currentExt,
        currentPath: item.path,
        existingItems: useVaultStore.getState().fileTree,
      });
      if (!validation.valid) {
        upsertNotice(
          FILETREE_RENAME_NOTICE_ID,
          validation.error || t('fileTree.notices.invalidName'),
          4000,
          'error'
        );
        setRenameValue(initialBaseName);
        ctx?.setRenamingPath(null);
        return;
      }

      if (!validation.warning) {
        removeNotice(FILETREE_RENAME_NOTICE_ID);
      }

      ctx?.setRenamingPath(null);
      await ctx?.requestFileRename(item.path, validation.fullFileName, item.isDir);
    } finally {
      isSubmittingRenameRef.current = false;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const itemBookmarkType = item.isDir ? 'folder' : 'file';
    const bookmarksPluginEnabled = useSettingsStore.getState().settings.corePlugins.bookmarks;
    const bookmarked = isBookmarked(item.path, itemBookmarkType);
    const items: MenuItemData[] = [];

    if (item.isDir) {
      items.push(
        {
          title: t('fileTree.newNote'),
          icon: <SquarePen size={14} />,
          action: async () => {
            await createUntitledNote(item.path);
            ctx?.setFolderOpen(item.path, true);
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
        ...(bookmarksPluginEnabled
          ? [
              {
                title: bookmarked
                  ? t('fileTree.contextMenu.removeBookmark')
                  : t('fileTree.contextMenu.addBookmark'),
                icon: (
                  <Bookmark
                    size={14}
                    className={bookmarked ? 'fill-orange-500 text-orange-500' : ''}
                  />
                ),
                action: () => {
                  toggleBookmark({ type: 'folder', path: item.path, title: item.name });
                  showNotice(
                    bookmarked
                      ? t('fileTree.notices.bookmarkRemoved')
                      : t('fileTree.notices.bookmarkAdded'),
                    2000,
                    'info'
                  );
                },
              },
            ]
          : []),
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
        ...(bookmarksPluginEnabled
          ? [
              {
                title: bookmarked
                  ? t('fileTree.contextMenu.removeBookmark')
                  : t('fileTree.contextMenu.addBookmark'),
                icon: (
                  <Bookmark
                    size={14}
                    className={bookmarked ? 'fill-orange-500 text-orange-500' : ''}
                  />
                ),
                action: () => {
                  toggleBookmark({
                    type: 'file',
                    path: item.path,
                    title: item.name.replace(/\.(md|markdown|canvas|base)$/i, '') || item.name,
                  });
                  showNotice(
                    bookmarked
                      ? t('fileTree.notices.bookmarkRemoved')
                      : t('fileTree.notices.bookmarkAdded'),
                    2000,
                    'info'
                  );
                },
              },
            ]
          : []),
        {
          title: t('fileTree.contextMenu.makeCopy'),
          icon: <Copy size={14} />,
          action: async () => {
            const newPath = await duplicateNote(item.path);
            showNotice(t('fileTree.notices.noteDuplicated'), 2000, 'success');
            ctx?.setRenamingPath(newPath);
          },
        },
        ...(item.name.toLowerCase().endsWith('.md') &&
        useSettingsStore.getState().settings.corePlugins['note-composer']
          ? [
              {
                title: t('fileTree.contextMenu.mergeFile'),
                icon: <Merge size={14} />,
                action: () => {
                  window.dispatchEvent(
                    new CustomEvent('urano-note-composer-merge', {
                      detail: { sourcePath: item.path },
                    })
                  );
                },
              },
            ]
          : []),
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
  const isPreviewableNote = !item.isDir && item.name.toLowerCase().endsWith('.md');
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
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'F2' && !isRenaming) {
            e.preventDefault();
            e.stopPropagation();
            ctx?.setRenamingPath(item.path);
          }
        }}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', item.path);
          e.dataTransfer.setData('application/x-urano-path', item.path);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onDragOver={(e) => {
          if (item.isDir) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setIsDragTarget(true);
          }
        }}
        onDragLeave={() => setIsDragTarget(false)}
        onDrop={async (e) => {
          if (!item.isDir) return;
          e.preventDefault();
          e.stopPropagation();
          setIsDragTarget(false);

          // Handle dropped files from OS
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            try {
              let savedCount = 0;
              const currentTree = useVaultStore.getState().fileTree;
              for (const f of files) {
                const check = validateFileName(f.name, {
                  parentDir: item.path,
                  existingItems: currentTree,
                });
                if (!check.valid) {
                  showNotice(check.error || t('fileTree.notices.invalidName'), 4000, 'error');
                  continue;
                }
                const fullPath = `${normalizePath(item.path)}/${check.fullFileName}`.replace(
                  /\/+/g,
                  '/'
                );
                await getStorageAdapter().writeBinary(fullPath, f);
                savedCount++;
              }
              if (savedCount > 0) {
                ctx?.setFolderOpen(item.path, true);
                await useVaultStore.getState().refreshTree();
                showNotice(
                  t('fileTree.notices.filesSaved', { count: savedCount }),
                  2000,
                  'success'
                );
              }
            } catch (err: any) {
              console.error('Error saving dropped files to folder:', err);
              showNotice(err?.toString() || t('fileTree.notices.renameFileError'), 3000, 'error');
            }
            return;
          }

          const sourcePath = e.dataTransfer.getData('application/x-urano-path');
          if (sourcePath && canMoveToFolder(sourcePath, item.path)) {
            try {
              await moveItem(sourcePath, item.path);
              ctx?.setFolderOpen(item.path, true);
              showNotice(t('fileTree.notices.itemMoved'), 2000, 'success');
            } catch (err: any) {
              console.error('Error moving item into folder:', err);
              showNotice(err?.toString() || t('fileTree.notices.renameFileError'), 3000, 'error');
            }
          }
        }}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
        data-page-preview-context={isPreviewableNote ? 'fileExplorer' : undefined}
        data-page-preview-target={isPreviewableNote ? item.path : undefined}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={`group flex items-center justify-between pr-2.5 py-1 text-xs cursor-pointer transition-colors relative outline-none ${
          isDragTarget ? 'bg-orange-500/20 ring-1 ring-orange-500' : ''
        } ${
          isRevealed ? 'bg-orange-500/15 ring-1 ring-inset ring-orange-500/50 rounded-md' : ''
        } ${
          isSelected
            ? 'is-active bg-urano-active text-urano-text font-medium rounded-md'
            : 'text-urano-text hover:bg-urano-hover rounded-md'
        }`}
        aria-selected={isSelected ? 'true' : 'false'}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-1">
          {item.isDir ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                ctx?.setFolderOpen(item.path, !isOpen);
              }}
              className="text-urano-muted group-hover:text-urano-text w-3.5 flex justify-center shrink-0"
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
                onChange={handleRenameInputChange}
                onBlur={() => handleRenameSubmit()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    removeNotice(FILETREE_RENAME_NOTICE_ID);
                    setRenameValue(initialBaseName);
                    ctx?.setRenamingPath(null);
                  }
                }}
                className="w-full bg-urano-bg text-urano-text px-1.5 py-0.5 rounded outline-none border border-orange-500"
              />
            </form>
          ) : (
            <span className="truncate text-urano-text">
              {displayName}
            </span>
          )}
        </div>

        {/* Badges for CANVAS, BASE, and IMAGES (stay visible while renaming, like Urano) */}
        {(isCanvas || isBase || imageTag) && (
          <div className="flex items-center shrink-0">
            {isCanvas && <span className="nav-file-tag">CANVAS</span>}
            {isBase && <span className="nav-file-tag">BASE</span>}
            {imageTag && <span className="nav-file-tag">{imageTag}</span>}
          </div>
        )}
      </div>

      {/* Children files & folders with Urano vertical indentation line */}
      {item.isDir && isOpen && item.children && item.children.length > 0 && (
        <div className="nav-folder-children">
          {item.children.map((child) => (
            <FileTreeItem key={normalizePath(child.path)} item={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {/* Item Context Menu */}
      {contextMenu && (
        <UranoMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
