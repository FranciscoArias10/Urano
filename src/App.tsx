import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from './stores/vaultStore';
import { useSyncStore } from './stores/syncStore';
import { TabBar, TabItem } from './components/tabs/TabBar';
import { ViewHeader, ViewMode } from './components/layout/ViewHeader';
import { FileTree } from './components/vault/FileTree';
import { Editor, getActiveEditorView } from './components/editor/Editor';
import { EditorErrorBoundary } from './components/editor/EditorErrorBoundary';
import { GraphView } from './components/graph/GraphView';
import { CanvasView } from './components/canvas/CanvasView';
import { BaseView } from './components/base/BaseView';
import { ImageView } from './components/image/ImageView';
import { isImagePath } from './services/storageAdapter';
import { FILE_RENAMED_EVENT, FileRenamedDetail } from './services/linkRefactorService';
import { TemplateModal } from './components/templates/TemplateModal';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { BookmarksPanel } from './components/bookmarks/BookmarksPanel';
import { Tooltip } from './components/common/Tooltip';
import { BacklinksPanel } from './components/backlinks/BacklinksPanel';
import { CommandPalette, CommandItem } from './components/palette/CommandPalette';
import { StatusBar } from './components/layout/StatusBar';
import { SyncConfigModal } from './components/sync/SyncConfigModal';
import { SyncLogsModal } from './components/sync/SyncLogsModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { useSettingsStore, URANO_ACCENT } from './stores/settingsStore';
import { useLocaleStore, LOCALES_DIR_RELATIVE, useT } from './stores/localeStore';
import { LocalAdapter, GoogleDriveAdapter, setStorageAdapter } from './services/storageAdapter';
import { UranoLogo } from './components/common/UranoLogo';
import { NoticeContainer, useNoticeStore } from './components/common/Notice';
import { VaultManagerModal } from './components/vault/VaultManagerModal';
import {
  FolderOpen,
  FilePlus,
  FolderPlus,
  RotateCw,
  Search,
  GitFork,
  Settings,
  PanelLeftClose,
  PanelLeft,
  ArrowLeftRight,
  RefreshCw,
  ChevronDown,
  HelpCircle,
  FileSearch,
  Grid2X2,
  Calendar,
  Copy,
  Terminal,
  LayoutList,
  Folder,
  Bookmark,
  Vault,
  Check,
} from 'lucide-react';

/** Stable, unique identifier for a workspace leaf (tab). */
let tabIdCounter = 0;
const makeTabId = () => {
  tabIdCounter += 1;
  return `tab_${Date.now()}_${tabIdCounter}`;
};

export const App: React.FC = () => {
  // Tabs State (Obsidian Workspace Leaf Tabs)
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

  // Per tab navigation history (Obsidian leaf history: historyStack + currentIndex)
  const [navHistory, setNavHistory] = useState<
    Record<string, { stack: string[]; index: number }>
  >({});

  // Live Preview / Reading View (Obsidian "Toggle reading view", Ctrl+E)
  const [viewMode, setViewMode] = useState<ViewMode>('live-preview');
  // Ctrl+E / header button: Reading View <-> the editing mode used before it
  const lastEditingModeRef = useRef<Exclude<ViewMode, 'reading'>>('live-preview');
  const toggleReadingView = () =>
    setViewMode((mode) => {
      if (mode === 'reading') return lastEditingModeRef.current;
      lastEditingModeRef.current = mode;
      return 'reading';
    });
  // Status bar pencil: Live Preview <-> Source Mode (raw Markdown)
  const toggleSourceMode = () =>
    setViewMode((mode) => (mode === 'source' ? 'live-preview' : 'source'));

  // When true the next activeFile change navigates the current tab instead of
  // opening a new one (Obsidian navigates the leaf in place).
  const reuseActiveTabRef = useRef(false);

  // Latest shortcut handlers (kept in a ref so the global listener never goes stale)
  const shortcutsRef = useRef<{
    back: () => void;
    forward: () => void;
    newTab: () => void;
    toggleViewMode: () => void;
  }>({
    back: () => {},
    forward: () => {},
    newTab: () => {},
    toggleViewMode: () => {},
  });

  // Left Sidebar State (Toggle + 3 Tabs: files, search, bookmarks)
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'search' | 'bookmarks'>('files');

  // UI Panels Toggles
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Command Palette & Quick Switcher
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<'commands' | 'files'>('commands');

  // Template Picker Modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const {
    activeVault,
    vaultName,
    recentVaults,
    activeFile,
    activeFileName,
    fileContent,
    fileTree,
    isDirty,
    notesContentMap,
    setVault,
    refreshTree,
    selectFile,
    updateContent,
    saveCurrentFile,
    createUntitledNote,
    createUntitledCanvas,
    createUntitledBase,
    openDailyNote,
    createUntitledFolder,
    openOrCreateWikilink,
    renameNoteWithLinkRefactor,
    moveItem,
    duplicateNote,
    deleteItem,
  } = useVaultStore();

  const { checkAuthStatus, triggerSync, isSyncing, setShowConfigModal } = useSyncStore();
  const { showNotice } = useNoticeStore();
  const t = useT();

  // Settings (Obsidian-style modal, Ctrl+, / ⚙) — persisted in localStorage + .urano/settings.json
  const settings = useSettingsStore((s) => s.settings);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const loadSettingsFromVault = useSettingsStore((s) => s.loadFromVault);
  const markStartupComplete = useSettingsStore((s) => s.markStartupComplete);
  const corePlugins = settings.corePlugins;

  // Vault Switcher popover & VaultManagerModal
  const [showVaultManager, setShowVaultManager] = useState(false);
  const [vaultSwitcherAnchor, setVaultSwitcherAnchor] = useState<{ top: number; left: number } | null>(null);
  const vaultSwitcherPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!vaultSwitcherAnchor) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        vaultSwitcherPopoverRef.current &&
        !vaultSwitcherPopoverRef.current.contains(e.target as Node)
      ) {
        setVaultSwitcherAnchor(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [vaultSwitcherAnchor]);

  // Startup time & sincronización inicial de idioma para el corrector nativo
  useEffect(() => {
    markStartupComplete();
    const currentLang = useLocaleStore.getState().locale || useSettingsStore.getState().language || 'en';
    invoke('set_spellcheck_language', {
      lang: currentLang,
      enabled: useSettingsStore.getState().settings.spellcheck,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load per-vault settings (.urano/settings.json) whenever the vault changes
  useEffect(() => {
    if (activeVault) loadSettingsFromVault(activeVault);
  }, [activeVault, loadSettingsFromVault]);

  // Community language packs (.urano/locales/*.json) of the active vault
  const loadVaultLocales = useLocaleStore((s) => s.loadVaultLocales);
  useEffect(() => {
    void loadVaultLocales(activeVault ?? null);
  }, [activeVault, loadVaultLocales]);

  // Settings → General → "Learn how to add a new language to Urano." → open the locales folder
  const handleOpenLocalesFolder = useCallback(async () => {
    if (!activeVault) {
      window.open('https://github.com/FranciscoArias10/Urano#idiomas', '_blank', 'noopener');
      return;
    }
    try {
      const dir = await invoke<string>('get_custom_locales_dir', { vaultPath: activeVault });
      await invoke('open_path', { path: dir });
    } catch (err) {
      console.warn('[Urano] No se pudo abrir la carpeta de idiomas:', err);
      showNotice(`${activeVault.replace(/[\\/]+$/, '')}/${LOCALES_DIR_RELATIVE}`, 4000, 'info');
    }
  }, [activeVault, showNotice]);

  // Storage adapter selected in Settings → Sync (Local / Google Drive)
  useEffect(() => {
    setStorageAdapter(settings.storageBackend === 'gdrive' ? new GoogleDriveAdapter() : new LocalAdapter());
  }, [settings.storageBackend]);

  // Apply Appearance / Editor settings to the document (CSS variables, zoom, theme)
  useEffect(() => {
    const root = document.documentElement;
    const accent = settings.accentColor || URANO_ACCENT;
    root.style.setProperty('--interactive-accent', accent);
    root.style.setProperty('--text-accent', accent);
    root.style.setProperty('--interactive-accent-hover', accent);
    root.style.setProperty('--background-modifier-border-hover', `${accent}59`);
    root.style.setProperty('--background-modifier-active-hover', `${accent}26`);
    root.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
    root.style.setProperty('--file-line-width', settings.readableLineLength ? '820px' : '100%');
    root.style.setProperty('--editor-tab-size', String(settings.tabSize));
    (root.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      settings.zoomLevel === 1 ? '' : String(settings.zoomLevel);
    // `lang` / `dir` del documento los gestiona el motor i18n (locales/i18n.ts)

    const applyTheme = () => {
      const prefersLight =
        settings.theme === 'light' ||
        (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
      document.body.classList.toggle('theme-light', prefersLight);
      document.body.classList.toggle('theme-dark', !prefersLight);
      root.classList.toggle('dark', !prefersLight);
    };
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [settings]);

  // On mount: restore previous vault and Google auth status
  useEffect(() => {
    checkAuthStatus();
    const lastVault = localStorage.getItem('urano_last_vault');
    if (lastVault) {
      setVault(lastVault).catch((e) => {
        console.warn('No se pudo restaurar la última bóveda:', e);
      });
    }
  }, []);

  // Keep tabs pointing at the new path when a file is renamed (sidebar inline rename,
  // editor title rename). Runs before the store re-points activeFile, so the tab sync
  // effect below updates the existing tab instead of opening a duplicate.
  useEffect(() => {
    const onRenamed = (e: Event) => {
      const detail = (e as CustomEvent<FileRenamedDetail>).detail;
      if (!detail) return;
      const { oldPath, newPath, newFileName, newBaseName } = detail;
      const title = isImagePath(newPath) ? newFileName : newBaseName;
      setTabs((prev) =>
        prev.map((t) => (t.filePath === oldPath ? { ...t, filePath: newPath, title } : t))
      );
    };
    window.addEventListener(FILE_RENAMED_EVENT, onRenamed);
    return () => window.removeEventListener(FILE_RENAMED_EVENT, onRenamed);
  }, []);

  // Registers a file in the history of a leaf (Obsidian leaf history)
  const recordVisit = useCallback((tabId: string, filePath: string) => {
    setNavHistory((prev) => {
      const current = prev[tabId];
      if (!current) {
        return { ...prev, [tabId]: { stack: [filePath], index: 0 } };
      }
      // Already visited: just move the cursor (Obsidian does not duplicate entries)
      const existingIndex = current.stack.indexOf(filePath);
      if (existingIndex !== -1) {
        if (existingIndex === current.index) return prev;
        return { ...prev, [tabId]: { ...current, index: existingIndex } };
      }
      const stack = current.stack.slice(0, current.index + 1);
      stack.push(filePath);
      return { ...prev, [tabId]: { stack, index: stack.length - 1 } };
    });
  }, []);

  // Synchronize tabs when activeFile changes
  useEffect(() => {
    if (!activeFile) return;

    const reuseActiveTab = reuseActiveTabRef.current;
    reuseActiveTabRef.current = false;

    let type: TabItem['type'] = 'note';
    let ext = '.md';
    if (activeFile.endsWith('.canvas')) {
      type = 'canvas';
      ext = '.canvas';
    } else if (activeFile.endsWith('.base')) {
      type = 'base';
      ext = '.base';
    } else if (isImagePath(activeFile)) {
      type = 'image';
      ext = '';
    }

    const fileName = activeFileName
      ? (ext ? activeFileName.replace(new RegExp(`\\${ext}$`, 'i'), '') : activeFileName)
      : t('common.untitled');

    // Which leaf hosts this file?
    const existing = tabs.find((t) => t.filePath === activeFile);
    const reusable =
      !existing && reuseActiveTab ? tabs.find((t) => t.id === activeTabId) : undefined;

    let nextTabs: TabItem[];
    let targetTabId: string;

    if (existing) {
      targetTabId = existing.id;
      nextTabs = tabs.map((t) =>
        t.id === existing.id ? { ...t, title: fileName, type, isDirty } : t
      );
    } else if (reusable) {
      // Obsidian navigates the leaf in place (wikilinks, quick switcher)
      targetTabId = reusable.id;
      nextTabs = tabs.map((t) =>
        t.id === reusable.id
          ? { ...t, filePath: activeFile, title: fileName, type, isDirty }
          : t
      );
    } else {
      targetTabId = makeTabId();
      nextTabs = [
        ...tabs,
        {
          id: targetTabId,
          type,
          filePath: activeFile,
          title: fileName,
          isDirty,
        },
      ];
    }

    setTabs(nextTabs);
    setActiveTabId(targetTabId);
    recordVisit(targetTabId, activeFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, activeFileName, isDirty]);

  // Navigates the active leaf to another file, reusing the current tab
  const navigateLeafTo = useCallback(
    (filePath: string) => {
      reuseActiveTabRef.current = true;
      selectFile(filePath);
    },
    [selectFile]
  );

  // Back / forward navigation (Alt+Left / Alt+Right)
  const handleNavigateBack = useCallback(() => {
    const history = navHistory[activeTabId];
    if (!history || history.index <= 0) return;
    const target = history.stack[history.index - 1];
    if (!target) return;
    navigateLeafTo(target);
  }, [navHistory, activeTabId, navigateLeafTo]);

  const handleNavigateForward = useCallback(() => {
    const history = navHistory[activeTabId];
    if (!history || history.index >= history.stack.length - 1) return;
    const target = history.stack[history.index + 1];
    if (!target) return;
    navigateLeafTo(target);
  }, [navHistory, activeTabId, navigateLeafTo]);

  const canGoBack = (navHistory[activeTabId]?.index ?? -1) > 0;
  const canGoForward =
    (() => {
      const history = navHistory[activeTabId];
      if (!history) return false;
      return history.index < history.stack.length - 1;
    })();

  // Keep the global shortcut listener up to date
  shortcutsRef.current = {
    back: handleNavigateBack,
    forward: handleNavigateForward,
    newTab: () => handleCreateUntitledNote(),
    toggleViewMode: toggleReadingView,
  };

  // Global Keyboard Shortcuts (Obsidian matching)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+P: Command Palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteMode('commands');
        setPaletteOpen(true);
      }
      // Ctrl+O: Quick Switcher (File Finder)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setPaletteMode('files');
        setPaletteOpen(true);
      }
      // Ctrl+G: Open Graph View
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        handleOpenGraphTab();
      }
      // Ctrl+N: New Untitled Note immediately
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateUntitledNote();
      }
      // Ctrl+T: New tab
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        shortcutsRef.current.newTab();
      }
      // Ctrl+E: Toggle reading view / live preview
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        shortcutsRef.current.toggleViewMode();
      }
      // Alt+Left / Alt+Right: leaf navigation history
      else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        shortcutsRef.current.back();
      }
      else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        shortcutsRef.current.forward();
      }
      // Ctrl+, : Open settings (Obsidian `app:open-settings`, hotkey Mod+,)
      else if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault();
        toggleSettings();
      }
      // Ctrl+B: Toggle Left Sidebar
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault();
        setShowLeftSidebar((prev) => !prev);
      }
      // Ctrl+Shift+B: Toggle Backlinks Panel
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && e.shiftKey) {
        e.preventDefault();
        setShowBacklinks((prev) => !prev);
      }
      // F5 or Ctrl+R: Reload window in Tauri
      else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        window.location.reload();
      }
    };

    const handleUranoSearch = () => {
      setShowLeftSidebar(true);
      setSidebarTab('search');
    };

    const handleUranoTemplates = () => {
      setShowTemplateModal(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('urano-search', handleUranoSearch);
    window.addEventListener('urano-open-templates', handleUranoTemplates);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('urano-search', handleUranoSearch);
      window.removeEventListener('urano-open-templates', handleUranoTemplates);
    };
  }, [activeVault]);

  // Folder open picker dialog
  const handleOpenFolderDialog = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('app.dialogs.selectVaultFolder'),
      });
      if (selected && typeof selected === 'string') {
        await setVault(selected);
      }
    } catch (err) {
      console.error('Error al abrir carpeta:', err);
    }
  };

  // Create untitled note immediately without prompt
  const handleCreateUntitledNote = async () => {
    if (!activeVault) return;
    const newNote = await createUntitledNote(activeVault);
    if (newNote?.path) {
      setActiveTabId(newNote.path);
    }
  };

  // Create canvas
  const handleCreateCanvas = async () => {
    if (!activeVault) return;
    const { path } = await createUntitledCanvas(activeVault);
    if (path) {
      setActiveTabId(path);
      showNotice(t('app.notices.canvasCreated'), 2500, 'info');
    }
  };

  // Create base
  const handleCreateBase = async () => {
    if (!activeVault) return;
    const { path } = await createUntitledBase(activeVault);
    if (path) {
      setActiveTabId(path);
      showNotice(t('app.notices.baseCreated'), 2500, 'info');
    }
  };

  // Open daily note
  const handleOpenDailyNote = async () => {
    if (!activeVault) return;
    const path = await openDailyNote();
    if (path) {
      setActiveTabId(path);
    }
  };

  // Insert template into note
  const handleInsertTemplate = async (templateContent: string) => {
    const view = getActiveEditorView();
    if (view && activeFile && !activeFile.endsWith('.canvas') && !activeFile.endsWith('.base')) {
      const tr = view.state.update({
        changes: {
          from: view.state.selection.main.from,
          to: view.state.selection.main.to,
          insert: templateContent,
        },
        selection: { anchor: view.state.selection.main.from + templateContent.length },
        userEvent: 'input.template',
      });
      view.dispatch(tr);
      view.focus();
      showNotice(t('app.notices.templateInserted'), 2500, 'info');
    } else {
      const newNote = await createUntitledNote(activeVault || undefined);
      if (newNote?.path) {
        updateContent(templateContent);
        await saveCurrentFile();
        showNotice(t('app.notices.noteCreatedWithTemplate'), 2500, 'info');
      }
    }
    setShowTemplateModal(false);
  };

  const handleCreateRootFolder = async () => {
    if (!activeVault) return;
    await createUntitledFolder(activeVault);
  };

  const handleVaultSwitcherClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setVaultSwitcherAnchor((prev) =>
      prev ? null : { top: rect.top, left: rect.left }
    );
  };

  const handleHelpClick = () => {
    showNotice(t('app.notices.shortcutsHelp'), 5000, 'info');
  };

  // Close other tabs
  const handleCloseOtherTabs = (tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === tabId));
    setActiveTabId(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.filePath) {
      selectFile(tab.filePath);
    }
  };

  // Close all tabs (Obsidian keeps pinned tabs open)
  const handleCloseAllTabs = () => {
    const remaining = tabs.filter((t) => t.pinned);
    setTabs(remaining);
    if (!remaining.some((t) => t.id === activeTabId)) {
      const next = remaining[remaining.length - 1];
      if (next) {
        setActiveTabId(next.id);
        if (next.filePath) selectFile(next.filePath);
      } else {
        setActiveTabId('');
      }
    }
  };

  // Pin / unpin a tab
  const handleTogglePin = (tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)));
  };

  // Split views are not available in Urano yet
  const handleSplitUnavailable = () => {
    showNotice(t('app.notices.splitUnavailable'), 2500, 'info');
  };

  /* --------------------------------------------------------------- *
   * View header actions (Obsidian "More options" menu)
   * --------------------------------------------------------------- */
  const handleRenameFile = async (newTitle: string) => {
    if (!activeFile) return;
    const result = await renameNoteWithLinkRefactor(activeFile, newTitle);
    if (!result.success) {
      showNotice(result.error || t('app.notices.renameFailed'), 3000, 'error');
    }
  };

  const handleMoveFile = async () => {
    if (!activeFile) return;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('app.dialogs.moveFileTo'),
        defaultPath: activeVault || undefined,
      });
      if (selected && typeof selected === 'string') {
        await moveItem(activeFile, selected);
        showNotice(t('app.notices.fileMoved'), 2000, 'success');
      }
    } catch (err) {
      console.error('Error al mover el archivo:', err);
    }
  };

  const handleDuplicateFile = async () => {
    if (!activeFile) return;
    try {
      const newPath = await duplicateNote(activeFile);
      if (newPath) showNotice(t('app.notices.copyCreated'), 2000, 'success');
    } catch (err) {
      console.error('Error al duplicar el archivo:', err);
    }
  };

  const handleCopyLink = async () => {
    if (!activeFileTitle) return;
    try {
      await navigator.clipboard.writeText(`[[${activeFileTitle}]]`);
      showNotice(t('app.notices.linkCopied'), 2000, 'success');
    } catch {
      showNotice(t('app.notices.linkCopyFailed'), 3000, 'error');
    }
  };

  const handleCopyPath = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile);
      showNotice(t('app.notices.pathCopied'), 2000, 'success');
    } catch {
      showNotice(t('app.notices.pathCopyFailed'), 3000, 'error');
    }
  };

  const handleDeleteFile = async () => {
    if (!activeFile) return;
    const name = activeFileName || activeFile;
    if (
      useSettingsStore.getState().settings.confirmFileDeletion &&
      !window.confirm(t('app.dialogs.confirmDelete', { name }))
    ) {
      return;
    }
    try {
      await deleteItem(activeFile);
      showNotice(t('app.notices.fileDeleted'), 2000, 'success');
    } catch (err) {
      console.error('Error al eliminar el archivo:', err);
    }
  };

  // Wikilinks navigate the current leaf in place (Obsidian behaviour)
  const handleWikilinkClick = (name: string) => {
    reuseActiveTabRef.current = true;
    openOrCreateWikilink(name);
  };

  // Open note in a new tab (or to the right)
  const handleOpenInNewTab = (filePathOrName: string) => {
    let targetPath = filePathOrName;
    if (
      !targetPath.endsWith('.md') &&
      !targetPath.endsWith('.canvas') &&
      !targetPath.endsWith('.base') &&
      !isImagePath(targetPath)
    ) {
      const findInTree = (items: typeof fileTree): string | null => {
        for (const item of items) {
          if (
            !item.isDir &&
            (item.name.toLowerCase() === filePathOrName.toLowerCase() ||
              item.name.replace(/\.(md|canvas|base)$/i, '').toLowerCase() ===
                filePathOrName.toLowerCase())
          ) {
            return item.path;
          }
          if (item.children) {
            const f = findInTree(item.children);
            if (f) return f;
          }
        }
        return null;
      };
      const found = findInTree(fileTree);
      targetPath =
        found || (activeVault ? `${activeVault}/${filePathOrName}.md` : `${filePathOrName}.md`);
    }

    let type: TabItem['type'] = 'note';
    let ext = '.md';
    if (targetPath.endsWith('.canvas')) {
      type = 'canvas';
      ext = '.canvas';
    } else if (targetPath.endsWith('.base')) {
      type = 'base';
      ext = '.base';
    } else if (isImagePath(targetPath)) {
      type = 'image';
      ext = '';
    }

    const title =
      targetPath.replace(/\\/g, '/').split('/').pop()?.replace(new RegExp(`\\${ext}$`, 'i'), '') ||
      t('common.untitled');
    const tabId = `${targetPath}_tab_${Date.now()}`;
    const newTab: TabItem = {
      id: tabId,
      type,
      filePath: targetPath,
      title,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    selectFile(targetPath);
  };

  // Open Graph View Tab
  const handleOpenGraphTab = () => {
    const graphTabId = 'workspace-graph-view';
    setTabs((prev) => {
      if (prev.some((t) => t.id === graphTabId)) return prev;
      // The label is resolved at render time from `type === 'graph'` (TabBar) so it follows the language
      return [...prev, { id: graphTabId, type: 'graph', title: t('tabs.graphView') }];
    });
    setActiveTabId(graphTabId);
  };

  // Tab Selection
  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.filePath) {
      selectFile(tab.filePath);
    }
  };

  // Close Tab
  const handleCloseTab = (tabId: string) => {
    const remaining = tabs.filter((t) => t.id !== tabId);
    setTabs(remaining);

    if (activeTabId === tabId) {
      if (remaining.length > 0) {
        const next = remaining[remaining.length - 1];
        setActiveTabId(next.id);
        if (next.filePath) {
          selectFile(next.filePath);
        }
      } else {
        setActiveTabId('');
      }
    }
  };

  // Clean title of the active note (file name without extension)
  const activeFileTitle = useMemo(() => {
    if (!activeFile) return '';
    const parts = activeFile.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1] || '';
    return fileName.replace(/\.(md|canvas|base)$/i, '') || fileName;
  }, [activeFile]);

  // Folder breadcrumb of the active note (relative to the vault root)
  const activeParentPath = useMemo(() => {
    if (!activeFile) return [];
    const normalized = activeFile.replace(/\\/g, '/');
    const relative =
      activeVault && normalized.startsWith(activeVault)
        ? normalized.slice(activeVault.length)
        : normalized;
    const parts = relative.split('/').filter(Boolean);
    parts.pop();
    return parts;
  }, [activeFile, activeVault]);

  // Compute backlinks count for the active file
  const backlinksCount = useMemo(() => {
    if (!activeFileName) return 0;
    const base = activeFileName.replace(/\.(md|canvas|base)$/i, '').toLowerCase();
    let count = 0;

    for (const [path, content] of Object.entries(notesContentMap)) {
      if (path === activeFile) continue;
      const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
      let m;
      while ((m = regex.exec(content)) !== null) {
        if (m[1].trim().toLowerCase() === base) {
          count++;
          break;
        }
      }
    }
    return count;
  }, [activeFile, activeFileName, notesContentMap]);

  // Registered commands for Command Palette (Ctrl+P) extracted from Obsidian
  const paletteCommands: CommandItem[] = [
    {
      id: 'file-explorer:new-note',
      name: t('commands.fileExplorer.newNote'),
      shortcut: 'Ctrl+N',
      icon: <FilePlus size={15} />,
      action: handleCreateUntitledNote,
    },
    {
      id: 'quick-switcher:open',
      name: t('commands.quickSwitcher.open'),
      shortcut: 'Ctrl+O',
      icon: <FileSearch size={15} />,
      action: () => {
        setPaletteMode('files');
        setPaletteOpen(true);
      },
    },
    {
      id: 'graph:open',
      name: t('commands.graph.open'),
      shortcut: 'Ctrl+G',
      icon: <GitFork size={15} />,
      action: handleOpenGraphTab,
    },
    {
      id: 'canvas:new',
      name: t('commands.canvas.new'),
      icon: <Grid2X2 size={15} />,
      action: handleCreateCanvas,
    },
    {
      id: 'daily-notes:today',
      name: t('commands.dailyNotes.today'),
      icon: <Calendar size={15} />,
      action: handleOpenDailyNote,
    },
    {
      id: 'templates:insert',
      name: t('commands.templates.insert'),
      icon: <Copy size={15} />,
      action: () => setShowTemplateModal(true),
    },
    {
      id: 'bases:new',
      name: t('commands.bases.new'),
      icon: <LayoutList size={15} />,
      action: handleCreateBase,
    },
    {
      id: 'workspace:toggle-left-sidebar',
      name: t('commands.workspace.toggleLeftSidebar'),
      shortcut: 'Ctrl+B',
      icon: <PanelLeft size={15} />,
      action: () => setShowLeftSidebar((prev) => !prev),
    },
    {
      id: 'workspace:toggle-backlinks',
      name: t('commands.workspace.toggleBacklinks'),
      shortcut: 'Ctrl+Shift+B',
      icon: <ArrowLeftRight size={15} />,
      action: () => setShowBacklinks((prev) => !prev),
    },
    {
      id: 'file-explorer:new-folder',
      name: t('commands.fileExplorer.newFolder'),
      icon: <FolderPlus size={15} />,
      action: handleCreateRootFolder,
    },
    {
      id: 'file-explorer:refresh',
      name: t('commands.fileExplorer.refresh'),
      icon: <RotateCw size={15} />,
      action: () => refreshTree(),
    },
    {
      id: 'sync:now',
      name: t('commands.sync.now'),
      icon: <RefreshCw size={15} />,
      action: () => {
        if (activeVault) triggerSync(activeVault);
      },
    },
    {
      id: 'app:open-vault',
      name: t('commands.app.openVault'),
      icon: <FolderOpen size={15} />,
      action: handleOpenFolderDialog,
    },
    {
      id: 'app:open-settings',
      name: t('commands.app.openSettings'),
      shortcut: 'Ctrl+,',
      icon: <Settings size={15} />,
      action: () => openSettings(),
    },
    {
      id: 'app:sync-config',
      name: t('commands.app.syncConfig'),
      icon: <Settings size={15} />,
      action: () => openSettings('sync'),
    },
  ].filter((cmd) => {
    // Commands owned by a disabled core plugin disappear (Obsidian behaviour)
    if (cmd.id.startsWith('canvas:')) return corePlugins.canvas;
    if (cmd.id.startsWith('daily-notes:')) return corePlugins['daily-notes'];
    if (cmd.id.startsWith('templates:')) return corePlugins.templates;
    if (cmd.id.startsWith('quick-switcher:')) return corePlugins.switcher;
    if (cmd.id.startsWith('sync:')) return corePlugins.sync;
    return true;
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-obsidian-bg text-obsidian-text overflow-hidden select-none">
      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ========================================================
            Obsidian Left Ribbon (.side-dock-ribbon)
            Section B: Los 7 Iconos en orden exacto con tooltips oscuros
            ======================================================== */}
        {settings.showRibbon && (
        <div className="side-dock-ribbon">
          {/* Logo at the top */}
          <div className="mb-2 p-1 flex items-center justify-center">
            <UranoLogo size={22} className="hover:scale-105 transition-transform" />
          </div>

          {/* Toggle sidebar button if sidebar is currently collapsed */}
          {!showLeftSidebar && (
            <Tooltip content={t('app.ribbon.showSidebar')} shortcut="Ctrl+B" position="right">
              <button
                onClick={() => setShowLeftSidebar(true)}
                className="side-dock-ribbon-action text-stone-400 hover:text-stone-200"
              >
                <PanelLeft size={18} />
              </button>
            </Tooltip>
          )}

          {/* 1. Open quick switcher (Ctrl+O) */}
          {corePlugins.switcher && (
          <Tooltip content={t('app.ribbon.openQuickSwitcher')} shortcut="Ctrl+O" position="right">
            <button
              onClick={() => {
                setPaletteMode('files');
                setPaletteOpen(true);
              }}
              className="side-dock-ribbon-action"
            >
              <FileSearch size={18} />
            </button>
          </Tooltip>
          )}

          {/* 2. Open graph view (Ctrl+G) */}
          <Tooltip content={t('app.ribbon.openGraphView')} shortcut="Ctrl+G" position="right">
            <button
              onClick={handleOpenGraphTab}
              className={`side-dock-ribbon-action ${activeTabId === 'workspace-graph-view' ? 'is-active' : ''}`}
            >
              <GitFork size={18} />
            </button>
          </Tooltip>

          {/* 3. Create new canvas */}
          {corePlugins.canvas && (
          <Tooltip content={t('app.ribbon.createNewCanvas')} position="right">
            <button
              onClick={handleCreateCanvas}
              className="side-dock-ribbon-action"
            >
              <Grid2X2 size={18} />
            </button>
          </Tooltip>
          )}

          {/* 4. Open today's daily note */}
          {corePlugins['daily-notes'] && (
          <Tooltip content={t('app.ribbon.openDailyNote')} position="right">
            <button
              onClick={handleOpenDailyNote}
              className="side-dock-ribbon-action"
            >
              <Calendar size={18} />
            </button>
          </Tooltip>
          )}

          {/* 5. Insert template */}
          {corePlugins.templates && (
          <Tooltip content={t('app.ribbon.insertTemplate')} position="right">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="side-dock-ribbon-action"
            >
              <Copy size={18} />
            </button>
          </Tooltip>
          )}

          {/* 6. Open command palette (Ctrl+P) */}
          {corePlugins['command-palette'] && (
          <Tooltip content={t('app.ribbon.openCommandPalette')} shortcut="Ctrl+P" position="right">
            <button
              onClick={() => {
                setPaletteMode('commands');
                setPaletteOpen(true);
              }}
              className="side-dock-ribbon-action"
            >
              <Terminal size={18} />
            </button>
          </Tooltip>
          )}

          {/* 7. Create new base */}
          <Tooltip content={t('app.ribbon.createNewBase')} position="right">
            <button
              onClick={handleCreateBase}
              className="side-dock-ribbon-action"
            >
              <LayoutList size={18} />
            </button>
          </Tooltip>

          <div className="flex-1" />

          {/* Google Drive Sync Trigger */}
          {corePlugins.sync && (
          <Tooltip content={t('app.ribbon.syncNow')} position="right">
            <button
              onClick={() => {
                if (activeVault) triggerSync(activeVault);
              }}
              className="side-dock-ribbon-action hover:text-sky-400"
            >
              <RefreshCw size={17} className={isSyncing ? 'animate-spin text-sky-400' : ''} />
            </button>
          </Tooltip>
          )}

          {/* Settings (Ctrl+,) at Bottom of Ribbon */}
          <Tooltip content={t('app.ribbon.settings')} shortcut="Ctrl+," position="right">
            <button
              onClick={() => openSettings()}
              className="side-dock-ribbon-action mb-1 text-stone-400 hover:text-stone-200"
            >
              <Settings size={18} />
            </button>
          </Tooltip>
        </div>
        )}

        {/* ========================================================
            Obsidian Left Collapsible Sidebar Dock
            Section A: Fila Superior del Panel Izquierdo (4 botones)
            ======================================================== */}
        {showLeftSidebar && (
          <aside className="w-64 bg-obsidian-sidebar border-r border-obsidian-border flex flex-col shrink-0">
            {/* A. Fila Superior del Panel Izquierdo (4 botones) */}
            <div className="h-10 px-2.5 border-b border-obsidian-border flex items-center justify-between bg-obsidian-sidebar shrink-0">
              {/* 1. Botón "Toggle Left Sidebar" */}
              <Tooltip content={t('app.ribbon.hideSidebar')} shortcut="Ctrl+B" position="bottom">
                <button
                  onClick={() => setShowLeftSidebar(false)}
                  className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
                >
                  <PanelLeftClose size={17} />
                </button>
              </Tooltip>

              {/* 2. Las 3 pestañas superiores del panel lateral */}
              <div className="flex items-center gap-1">
                {/* Archivos */}
                <Tooltip content={t('app.sidebar.files')} position="bottom">
                  <button
                    onClick={() => setSidebarTab('files')}
                    className={`p-1.5 rounded transition-colors ${
                      sidebarTab === 'files'
                        ? 'text-orange-500 bg-white/10'
                        : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                    }`}
                  >
                    <Folder size={17} />
                  </button>
                </Tooltip>

                {/* Buscar */}
                <Tooltip content={t('app.sidebar.search')} position="bottom">
                  <button
                    onClick={() => setSidebarTab('search')}
                    className={`p-1.5 rounded transition-colors ${
                      sidebarTab === 'search'
                        ? 'text-orange-500 bg-white/10'
                        : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                    }`}
                  >
                    <Search size={17} />
                  </button>
                </Tooltip>

                {/* Marcadores / Bookmarks */}
                <Tooltip content={t('app.sidebar.bookmarks')} position="bottom">
                  <button
                    onClick={() => setSidebarTab('bookmarks')}
                    className={`p-1.5 rounded transition-colors ${
                      sidebarTab === 'bookmarks'
                        ? 'text-orange-500 bg-white/10'
                        : 'text-stone-400 hover:text-stone-200 hover:bg-white/5'
                    }`}
                  >
                    <Bookmark size={17} />
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Panel View Content */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {sidebarTab === 'files' && (
                <div className="flex-1 overflow-y-auto">
                  <FileTree items={fileTree} onOpenInNewTab={handleOpenInNewTab} />
                </div>
              )}
              {sidebarTab === 'search' && (
                <div className="flex-1 overflow-hidden">
                  <GlobalSearchPanel />
                </div>
              )}
              {sidebarTab === 'bookmarks' && (
                <div className="flex-1 overflow-hidden">
                  <BookmarksPanel />
                </div>
              )}
            </div>

            {/* Obsidian Bottom Vault Switcher (⌄ prueba) & Action Icons (? y ⚙) */}
            <div className="p-2 border-t border-obsidian-border bg-obsidian-sidebar flex items-center justify-between text-xs text-stone-400 shrink-0">
              <button
                onClick={handleVaultSwitcherClick}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/5 hover:text-stone-200 text-stone-300 font-medium max-w-[145px] truncate transition-colors text-left"
                title={t('app.sidebar.vaultSwitcher')}
              >
                <ChevronDown size={14} className="text-orange-500 shrink-0" />
                <span className="truncate">{vaultName || t('app.vaultMenu.defaultVaultName')}</span>
              </button>

              <div className="flex items-center gap-0.5 text-stone-400">
                <button
                  onClick={handleHelpClick}
                  title={t('app.sidebar.help')}
                  className="p-1.5 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
                >
                  <HelpCircle size={15} />
                </button>
                <button
                  onClick={() => openSettings()}
                  title={t('app.sidebar.settingsTitle')}
                  aria-label={t('app.ribbon.settings')}
                  className="p-1.5 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
                >
                  <Settings size={15} />
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* ========================================================
            Center Main Workspace (Tabs + Editor / Graph / Canvas / Base)
            ======================================================== */}
        <main className="flex-1 flex flex-col overflow-hidden bg-obsidian-bg min-w-0">
          {/* Obsidian TabBar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onNewTab={handleCreateUntitledNote}
            onTogglePin={handleTogglePin}
            onToggleRightSidebar={() => setShowBacklinks((prev) => !prev)}
            rightSidebarVisible={showBacklinks}
            onSplitRight={handleSplitUnavailable}
            onSplitDown={handleSplitUnavailable}
          />

          {/* Obsidian View Header (second row) */}
          <ViewHeader
            title={activeFileTitle}
            parentPath={activeParentPath}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onNavigateBack={handleNavigateBack}
            onNavigateForward={handleNavigateForward}
            viewMode={viewMode}
            onToggleViewMode={toggleReadingView}
            onRename={handleRenameFile}
            onMoveFile={handleMoveFile}
            onDuplicateFile={handleDuplicateFile}
            onDeleteFile={handleDeleteFile}
            onCopyLink={handleCopyLink}
            onCopyPath={handleCopyPath}
            onSplitRight={handleSplitUnavailable}
            onSplitDown={handleSplitUnavailable}
          />

          {/* Tab Content Canvas */}
          <div className="flex-1 overflow-hidden relative">
            {activeTabId === 'workspace-graph-view' ? (
              <GraphView onSelectNote={(path: string) => selectFile(path)} />
            ) : activeFile?.endsWith('.canvas') ? (
              <CanvasView filePath={activeFile} />
            ) : activeFile?.endsWith('.base') ? (
              <BaseView filePath={activeFile} />
            ) : activeFile && isImagePath(activeFile) ? (
              <ImageView filePath={activeFile} />
            ) : activeFile ? (
              <EditorErrorBoundary noteName={activeFileName || t('common.untitled')}>
                <Editor
                  onWikilinkClick={handleWikilinkClick}
                  onOpenInNewTab={handleOpenInNewTab}
                  onOpenToRight={handleOpenInNewTab}
                  viewMode={viewMode}
                />
              </EditorErrorBoundary>
            ) : (
              <div className="flex-1 h-full flex flex-col items-center justify-center text-obsidian-muted p-8 text-center bg-obsidian-bg">
                <UranoLogo size={56} className="mb-4 opacity-80" />
                <h2 className="text-xl font-medium text-obsidian-text mb-2">{t('app.emptyState.title')}</h2>
                <p className="text-sm max-w-sm text-obsidian-muted mb-6">
                  {t('app.emptyState.description')}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCreateUntitledNote}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium shadow transition-colors"
                  >
                    <FilePlus size={14} />
                    <span>{t('app.emptyState.createNote')}</span>
                  </button>
                  <button
                    onClick={handleOpenFolderDialog}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors"
                  >
                    <FolderOpen size={14} />
                    <span>{t('app.emptyState.openFolder')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ========================================================
            Right Sidebar: Backlinks & Outgoing Links Panel
            ======================================================== */}
        {showBacklinks && (
          <BacklinksPanel
            activeFile={activeFile}
            activeFileName={activeFileName}
            fileContent={fileContent}
            notesContentMap={notesContentMap}
            onOpenNote={(pathOrName) => openOrCreateWikilink(pathOrName)}
            onClose={() => setShowBacklinks(false)}
          />
        )}
      </div>

      {/* ========================================================
          Obsidian Bottom Status Bar
          ======================================================== */}
      {settings.showStatusBar && (
        <StatusBar
          onToggleBacklinks={() => setShowBacklinks((prev) => !prev)}
          backlinksCount={backlinksCount}
          onOpenLogs={() => setShowLogs(true)}
          viewMode={viewMode}
          onToggleViewMode={toggleSourceMode}
        />
      )}

      {/* ========================================================
          Modals & Overlays
          ======================================================== */}
      {/* Command Palette & Quick Switcher (Ctrl+P / Ctrl+O) */}
      <CommandPalette
        isOpen={paletteOpen}
        mode={paletteMode}
        fileTree={fileTree}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onSelectFile={(path) => {
          reuseActiveTabRef.current = true;
          selectFile(path);
        }}
        onOpenInNewTab={handleOpenInNewTab}
      />

      {/* Template Selection Modal */}
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onInsert={handleInsertTemplate}
      />

      {/* Settings modal (Obsidian .modal.mod-settings) — Ctrl+, / ⚙ */}
      <SettingsModal
        commands={paletteCommands}
        onOpenHelp={handleHelpClick}
        onOpenSyncLogs={() => setShowLogs(true)}
        onOpenLocalesFolder={handleOpenLocalesFolder}
      />

      {/* Google Drive Sync Configuration Modal */}
      <SyncConfigModal />

      {/* Sync Logs & Telemetry Modal */}
      <SyncLogsModal
        isOpen={showLogs}
        onClose={() => setShowLogs(false)}
      />

      {/* Floating Dark Popover for Vault Switcher */}
      {vaultSwitcherAnchor && (
        <div
          ref={vaultSwitcherPopoverRef}
          style={{
            background: '#1e1e1e',
            border: '1px solid #333333',
            borderRadius: '8px',
            padding: '4px',
            minWidth: '190px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.65)',
            zIndex: 300,
            position: 'fixed',
            bottom: `${window.innerHeight - vaultSwitcherAnchor.top + 6}px`,
            left: `${vaultSwitcherAnchor.left}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {recentVaults.map((vault) => {
            const isActive = activeVault === vault.path;
            return (
              <button
                key={vault.path}
                type="button"
                onClick={async () => {
                  setVaultSwitcherAnchor(null);
                  if (vault.path !== activeVault) {
                    await setVault(vault.path);
                  }
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[5px] text-[13px] transition-colors cursor-pointer text-left ${
                  isActive
                    ? 'text-white bg-[#2b2b2b]'
                    : 'text-[#dcddde] hover:text-white hover:bg-[#282828]'
                }`}
              >
                <span className="truncate max-w-[150px]" title={vault.path}>
                  {vault.name}
                </span>
                {isActive && (
                  <Check size={15} className="text-[#e06c1b] shrink-0 ml-2" />
                )}
              </button>
            );
          })}

          <div style={{ borderTop: '1px solid #2e2e2e', margin: '4px 0' }} />

          <button
            type="button"
            onClick={() => {
              setVaultSwitcherAnchor(null);
              setShowVaultManager(true);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[5px] text-[13px] text-[#dcddde] hover:text-white hover:bg-[#2b2b2b] transition-colors cursor-pointer text-left"
          >
            <Vault size={16} className="text-[#888888] shrink-0" />
            <span>{t('vaultMenu.manageVaults')}</span>
          </button>
        </div>
      )}

      {/* Vault Manager Modal (Obsidian Starter 1:1) */}
      <VaultManagerModal
        isOpen={showVaultManager}
        onClose={() => setShowVaultManager(false)}
        onOpenSync={() => setShowConfigModal(true)}
      />

      {/* Obsidian Floating Notices */}
      <NoticeContainer />
    </div>
  );
};
