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
import {
  getRelativeVaultPath,
  getRelativeVaultFolderSegments,
  isSamePath,
  resolveFilePathInVault,
  normalizePath,
} from './utils/pathUtils';
import { FILE_RENAMED_EVENT, FileRenamedDetail } from './services/linkRefactorService';
import { TemplateModal } from './components/templates/TemplateModal';
import {
  NoteComposerModal,
  NoteComposerModalRequest,
} from './components/noteComposer/NoteComposerModal';
import { UpdateLinksModal } from './components/common/UpdateLinksModal';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { BookmarksPanel } from './components/bookmarks/BookmarksPanel';
import { Tooltip } from './components/common/Tooltip';
import { BacklinksPanel } from './components/backlinks/BacklinksPanel';
import { CommandPalette, CommandItem } from './components/palette/CommandPalette';
import { StatusBar } from './components/layout/StatusBar';
import { SyncConfigModal } from './components/sync/SyncConfigModal';
import { SyncLogsModal } from './components/sync/SyncLogsModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { SettingsWindow } from './components/settings/SettingsWindow';
import { useSettingsStore, URANO_ACCENT } from './stores/settingsStore';
import { applyBaseTheme } from './services/themeService';
import { useLocaleStore, LOCALES_DIR_RELATIVE, useT } from './stores/localeStore';
import { LocalAdapter, GoogleDriveAdapter, setStorageAdapter } from './services/storageAdapter';
import { UranoLogo } from './components/common/UranoLogo';
import { WindowControls } from './components/layout/WindowControls';
import { NoticeContainer, useNoticeStore } from './components/common/Notice';
import { VaultManagerModal } from './components/vault/VaultManagerModal';
import { isCommandTriggered } from './services/hotkeyRegistry';
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
  BookOpen,
  Code,
  SquarePen,
  Table,
  LayoutGrid,
  FolderInput,
  Merge,
} from 'lucide-react';

/** Stable, unique identifier for a workspace leaf (tab). */
let tabIdCounter = 0;
const makeTabId = () => {
  tabIdCounter += 1;
  return `tab_${Date.now()}_${tabIdCounter}`;
};

/** Background pull interval for Google Drive changes made on other devices. */
const BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const isSettingsWindow =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('window') === 'settings' ||
    window.location.hash.includes('window=settings'));

const MainApp: React.FC = () => {
  // Tabs State (Urano Workspace Leaf Tabs)
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId]
  );

  // Per tab navigation history (Urano leaf history: historyStack + currentIndex)
  const [navHistory, setNavHistory] = useState<
    Record<string, { stack: string[]; index: number }>
  >({});

  // Live Preview / Reading View (Urano "Toggle reading view", Ctrl+E)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const s = useSettingsStore.getState().settings;
    if (s.defaultViewMode === 'preview') return 'reading';
    return s.livePreview ? 'live-preview' : 'source';
  });
  // Ctrl+E / header button: Reading View <-> the editing mode used before it
  const lastEditingModeRef = useRef<Exclude<ViewMode, 'reading'>>(
    useSettingsStore.getState().settings.livePreview ? 'live-preview' : 'source'
  );
  const toggleReadingView = () => {
    const activeView = getActiveEditorView();
    if (activeView) {
      const liveDoc = activeView.state.doc.toString();
      useVaultStore.getState().updateContent(liveDoc);
    }
    setViewMode((mode) => {
      if (mode === 'reading') return lastEditingModeRef.current;
      lastEditingModeRef.current = mode;
      return 'reading';
    });
  };

  // Live Preview <-> Source Mode (raw Markdown)
  const toggleSourceMode = () =>
    setViewMode((mode) => (mode === 'source' ? 'live-preview' : 'source'));

  const handleChangeViewMode = (targetMode: ViewMode) => {
    const activeView = getActiveEditorView();
    if (activeView) {
      const liveDoc = activeView.state.doc.toString();
      useVaultStore.getState().updateContent(liveDoc);
    }
    if (targetMode !== 'reading') {
      lastEditingModeRef.current = targetMode;
    }
    setViewMode(targetMode);
  };

  // When true the next activeFile change navigates the current tab instead of
  // opening a new one (Urano navigates the leaf in place).
  const reuseActiveTabRef = useRef(false);

  // Latest shortcut handlers (kept in a ref so the global listener never goes stale)
  const shortcutsRef = useRef<{
    back: () => void;
    forward: () => void;
    newTab: () => void;
    closeTab: () => void;
    toggleViewMode: () => void;
    toggleSourceMode: () => void;
    openCommandPalette: () => void;
    openQuickSwitcher: () => void;
    openGraph: () => void;
    newNote: () => void;
    toggleSettings: () => void;
    toggleLeftSidebar: () => void;
    toggleBacklinks: () => void;
    openHelp: () => void;
    openSearch: () => void;
    openTemplates: () => void;
    reload: () => void;
  }>({
    back: () => {},
    forward: () => {},
    newTab: () => {},
    closeTab: () => {},
    toggleViewMode: () => {},
    toggleSourceMode: () => {},
    openCommandPalette: () => {},
    openQuickSwitcher: () => {},
    openGraph: () => {},
    newNote: () => {},
    toggleSettings: () => {},
    toggleLeftSidebar: () => {},
    toggleBacklinks: () => {},
    openHelp: () => {},
    openSearch: () => {},
    openTemplates: () => {},
    reload: () => {},
  });
  const paletteCommandsRef = useRef<CommandItem[]>([]);

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
    pendingRenamePrompt,
    resolvePendingRename,
    isLoading,
    closeActiveFile,
  } = useVaultStore();

  const { checkAuthStatus, triggerSync, isSyncing, notifyVaultChanged } = useSyncStore();
  const syncAuthenticated = useSyncStore((s) => s.isAuthenticated);
  const autoSyncEnabled = useSyncStore((s) => s.autoSyncEnabled);
  const syncOnline = useSyncStore((s) => s.isOnline);
  const { showNotice } = useNoticeStore();
  const t = useT();

  // Settings (Urano-style modal, Ctrl+, / ⚙) — persisted in localStorage + .urano/settings.json
  const settings = useSettingsStore((s) => s.settings);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const loadSettingsFromVault = useSettingsStore((s) => s.loadFromVault);
  const markStartupComplete = useSettingsStore((s) => s.markStartupComplete);
  const corePlugins = settings.corePlugins;

  // Vault Switcher popover & VaultManagerModal
  const [showVaultManager, setShowVaultManager] = useState(false);
  const [noteComposerRequest, setNoteComposerRequest] =
    useState<NoteComposerModalRequest | null>(null);
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
    root.style.setProperty('--file-line-width', settings.readableLineLength ? '700px' : '100%');
    root.style.setProperty('--editor-tab-size', String(settings.tabSize));
    const zoomFactor = (settings.zoomLevel || 100) / 100;
    (root.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      settings.zoomLevel === 100 ? '' : String(zoomFactor);
    document.body.style.zoom = settings.zoomLevel === 100 ? '' : String(zoomFactor);
    document.body.classList.toggle('is-translucent', Boolean(settings.translucentWindow));
    // `lang` / `dir` del documento los gestiona el motor i18n (locales/i18n.ts)
    applyBaseTheme(settings.theme);
  }, [settings]);

  // Window title computed 1:1 with Urano: "<active_note> - <vault_name> - Urano"
  const mainWindowTitle = useMemo(() => {
    const noteName = activeFileName ? activeFileName.replace(/\.(md|canvas|base)$/i, '') : '';
    const vaultPart = vaultName || (activeVault ? activeVault.split(/[\\/]/).pop() : '') || 'Urano';
    return noteName ? `${noteName} - ${vaultPart} - Urano` : `${vaultPart} - Urano`;
  }, [activeFileName, vaultName, activeVault]);

  // Synchronize document title and Tauri window title
  useEffect(() => {
    document.title = mainWindowTitle;
    try {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(mainWindowTitle))
        .catch(() => {});
    } catch {}
  }, [mainWindowTitle]);

  // Synchronize CSS body classes with frameStyle
  useEffect(() => {
    document.body.classList.toggle('is-frameless', settings.windowFrameStyle !== 'native');
    document.body.classList.toggle('is-hidden-frameless', settings.windowFrameStyle === 'hidden');
  }, [settings.windowFrameStyle]);

  // Synchronize window decorations with windowFrameStyle
  useEffect(() => {
    const isNative = settings.windowFrameStyle === 'native';
    invoke('set_window_decorations', { decorations: isNative }).catch(() => {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          getCurrentWindow().setDecorations(isNative).catch(() => {});
        })
        .catch(() => {});
    });
  }, [settings.windowFrameStyle]);

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

  // Google Drive auto-sync: as soon as the session, the open vault and the connection are all
  // ready (sign-in, restored session at startup, vault switch, back online) the vault is pushed
  // to `Urano Vaults/<vaultName>` immediately, then a periodic background pull brings in edits
  // made on other devices (Drive has no push channel). Local edits are pushed by `vaultStore`
  // → `notifyVaultChanged` (3 s debounce).
  useEffect(() => {
    if (!syncAuthenticated || !autoSyncEnabled || !syncOnline || !activeVault) return;
    void triggerSync(activeVault, vaultName ?? undefined);
    const interval = setInterval(
      () => notifyVaultChanged(activeVault, vaultName ?? undefined),
      BACKGROUND_SYNC_INTERVAL_MS
    );
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncAuthenticated, autoSyncEnabled, syncOnline, activeVault]);

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
        prev.map((t) => (isSamePath(t.filePath, oldPath) ? { ...t, filePath: newPath, title } : t))
      );
    };
    window.addEventListener(FILE_RENAMED_EVENT, onRenamed);
    return () => window.removeEventListener(FILE_RENAMED_EVENT, onRenamed);
  }, []);

  // Restore tabs from localStorage when vault is loaded
  useEffect(() => {
    if (!activeVault) return;
    try {
      const normKey = normalizePath(activeVault);
      const raw =
        localStorage.getItem(`urano_tabs_${normKey}`) ||
        localStorage.getItem(`urano_tabs_${activeVault}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTabs(parsed);
          const matchingTab = activeFile
            ? parsed.find((t: TabItem) => isSamePath(t.filePath, activeFile))
            : undefined;
          if (matchingTab) {
            setActiveTabId(matchingTab.id);
          } else {
            setActiveTabId(parsed[parsed.length - 1].id);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Error al restaurar pestañas desde localStorage:', e);
    }

    // Default to an empty in-memory tab if no tabs were saved
    const newTabId = makeTabId();
    setTabs([
      {
        id: newTabId,
        type: 'empty',
        title: t('tabs.newTabLabel') || 'Nueva pestaña',
      },
    ]);
    setActiveTabId(newTabId);
    closeActiveFile();
  }, [activeVault]);

  // Save tabs to localStorage per vault with normalized key
  useEffect(() => {
    if (!activeVault) return;
    try {
      const normKey = normalizePath(activeVault);
      if (tabs.length > 0) {
        localStorage.setItem(`urano_tabs_${normKey}`, JSON.stringify(tabs));
      } else {
        localStorage.removeItem(`urano_tabs_${normKey}`);
      }
    } catch {}
  }, [tabs, activeVault]);

  // Note Composer merge opener & global event listeners
  const openMergeModalForFile = useCallback((sourcePath: string) => {
    setNoteComposerRequest({
      mode: 'merge',
      fromPath: sourcePath,
      onMerged: (mergedFromPath, targetPath, targetTitle) => {
        setTabs((prev) => {
          const hasTargetTab = prev.some((tab) => isSamePath(tab.filePath, targetPath));
          if (hasTargetTab) {
            return prev.filter((tab) => !isSamePath(tab.filePath, mergedFromPath));
          }
          return prev.map((tab) =>
            isSamePath(tab.filePath, mergedFromPath)
              ? { ...tab, filePath: targetPath, title: targetTitle, isDirty: false }
              : tab
          );
        });
      },
    });
  }, []);

  useEffect(() => {
    const onOpenNoteComposer = (e: Event) => {
      const detail = (e as CustomEvent<NoteComposerModalRequest>).detail;
      if (detail) {
        setNoteComposerRequest(detail);
      }
    };
    const onMergeNoteComposer = (e: Event) => {
      const detail = (e as CustomEvent<{ sourcePath?: string }>).detail;
      const target = detail?.sourcePath || activeFile;
      if (target && target.toLowerCase().endsWith('.md')) {
        openMergeModalForFile(target);
      }
    };
    window.addEventListener('urano-note-composer-open', onOpenNoteComposer);
    window.addEventListener('urano-note-composer-merge', onMergeNoteComposer);
    return () => {
      window.removeEventListener('urano-note-composer-open', onOpenNoteComposer);
      window.removeEventListener('urano-note-composer-merge', onMergeNoteComposer);
    };
  }, [activeFile, openMergeModalForFile]);

  // Listen for refresh tree events (e.g. toggling detectAllFileExtensions)
  useEffect(() => {
    const onRefresh = () => {
      refreshTree().catch(() => {});
    };
    window.addEventListener('urano:refresh-tree', onRefresh);
    return () => window.removeEventListener('urano:refresh-tree', onRefresh);
  }, [refreshTree]);

  // Registers a file in the history of a leaf (Urano leaf history)
  const recordVisit = useCallback((tabId: string, filePath: string) => {
    setNavHistory((prev) => {
      const current = prev[tabId];
      if (!current) {
        return { ...prev, [tabId]: { stack: [filePath], index: 0 } };
      }
      // Already visited: just move the cursor (Urano does not duplicate entries)
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

  // Unidirectional direct file open & tab focus (event-driven, zero ping-pong)
  const handleOpenFile = useCallback(
    (filePath: string) => {
      if (!filePath) return;
      const resolved = resolveFilePathInVault(filePath, fileTree, activeVault) || filePath;

      // 1. If already open in an existing tab, focus it and open immediately
      const existing = tabs.find((t) => isSamePath(t.filePath, resolved));
      if (existing) {
        setActiveTabId(existing.id);
        if (!activeFile || !isSamePath(activeFile, resolved)) {
          selectFile(resolved);
        }
        recordVisit(existing.id, resolved);
        return;
      }

      // 2. Check if active tab is empty or marked for reuse
      const shouldReuse =
        reuseActiveTabRef.current ||
        (activeTab && (!activeTab.filePath || activeTab.type === 'empty'));
      reuseActiveTabRef.current = false;

      let type: TabItem['type'] = 'note';
      let ext = '.md';
      if (resolved.endsWith('.canvas')) {
        type = 'canvas';
        ext = '.canvas';
      } else if (resolved.endsWith('.base')) {
        type = 'base';
        ext = '.base';
      } else if (isImagePath(resolved)) {
        type = 'image';
        ext = '';
      }

      const rel = getRelativeVaultPath(resolved, activeVault || '');
      const parts = rel.split('/').filter(Boolean);
      const rawName = parts.pop() || '';
      const fileName = (ext ? rawName.replace(new RegExp(`\\${ext}$`, 'i'), '') : rawName) || t('common.untitled');

      if (shouldReuse && activeTab) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? { ...t, filePath: resolved, title: fileName, type, isDirty: false }
              : t
          )
        );
        setActiveTabId(activeTab.id);
        recordVisit(activeTab.id, resolved);
      } else {
        const newTabId = makeTabId();
        const newTab: TabItem = {
          id: newTabId,
          type,
          filePath: resolved,
          title: fileName,
          isDirty: false,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTabId);
        recordVisit(newTabId, resolved);
      }

      // 3. Immediately select/open file synchronously
      selectFile(resolved);
    },
    [tabs, activeTab, activeFile, fileTree, activeVault, t, recordVisit, selectFile]
  );

  // Synchronize tabs when activeFile changes externally (e.g. daily notes, external triggers)
  useEffect(() => {
    if (!activeFile) return;

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

    const relName = activeFile
      ? getRelativeVaultPath(activeFile, activeVault || '').split('/').pop()
      : undefined;
    const fileName =
      relName ||
      (activeFileName
        ? (ext ? activeFileName.replace(new RegExp(`\\${ext}$`, 'i'), '') : activeFileName)
        : t('common.untitled'));

    // Which leaf hosts this file?
    const existing = tabs.find((t) => isSamePath(t.filePath, activeFile));
    if (existing && existing.id === activeTabId) {
      if (existing.title === fileName && existing.isDirty === isDirty && existing.type === type) {
        return;
      }
    }

    const reuseActiveTab = reuseActiveTabRef.current;
    reuseActiveTabRef.current = false;

    const reusable =
      !existing && (reuseActiveTab || (activeTab && (!activeTab.filePath || activeTab.type === 'empty')))
        ? tabs.find((t) => t.id === activeTabId)
        : undefined;

    let nextTabs: TabItem[];
    let targetTabId: string;

    if (existing) {
      targetTabId = existing.id;
      nextTabs = tabs.map((t) =>
        t.id === existing.id ? { ...t, title: fileName, type, isDirty } : t
      );
    } else if (reusable) {
      // Urano navigates the leaf in place (wikilinks, quick switcher)
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
      handleOpenFile(filePath);
    },
    [handleOpenFile]
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

  // Global Keyboard Shortcuts (Urano matching)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      // If user is typing in an input/textarea and no modifiers are pressed (except function keys like F1-F12),
      // don't intercept normal typing keystrokes
      const hasModifiers = e.ctrlKey || e.metaKey || e.altKey;
      const isFunctionKey = /^F\d{1,2}$/.test(e.key);
      if (isInput && !hasModifiers && !isFunctionKey) {
        return;
      }

      const { hotkeys: rawHotkeys, corePlugins: activePlugins } = useSettingsStore.getState().settings;
      const customHotkeys = rawHotkeys || {};

      if (activePlugins['command-palette'] && isCommandTriggered(e, 'command-palette:open', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.openCommandPalette();
        return;
      }
      if (activePlugins.switcher && isCommandTriggered(e, 'quick-switcher:open', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.openQuickSwitcher();
        return;
      }
      if (activePlugins.graph && isCommandTriggered(e, 'graph:open', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.openGraph();
        return;
      }
      if (activePlugins['file-explorer'] && isCommandTriggered(e, 'file-explorer:new-note', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.newNote();
        return;
      }
      if (isCommandTriggered(e, 'workspace:new-tab', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.newTab();
        return;
      }
      if (isCommandTriggered(e, 'workspace:close-tab', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.closeTab();
        return;
      }
      if (isCommandTriggered(e, 'markdown:toggle-preview', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.toggleViewMode();
        return;
      }
      if (isCommandTriggered(e, 'editor:toggle-source', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.toggleSourceMode();
        return;
      }
      if (isCommandTriggered(e, 'app:go-back', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.back();
        return;
      }
      if (isCommandTriggered(e, 'app:go-forward', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.forward();
        return;
      }
      if (isCommandTriggered(e, 'app:open-settings', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.toggleSettings();
        return;
      }
      if (isCommandTriggered(e, 'app:open-help', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.openHelp();
        return;
      }
      if (isCommandTriggered(e, 'workspace:toggle-left-sidebar', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.toggleLeftSidebar();
        return;
      }
      if (activePlugins.backlink && isCommandTriggered(e, 'workspace:toggle-backlinks', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.toggleBacklinks();
        return;
      }
      if (activePlugins['global-search'] && isCommandTriggered(e, 'global-search:open', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.openSearch();
        return;
      }
      if (activePlugins.templates && isCommandTriggered(e, 'templates:insert', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.openTemplates();
        return;
      }
      if (isCommandTriggered(e, 'app:reload', customHotkeys)) {
        e.preventDefault();
        shortcutsRef.current.reload();
        return;
      }

      // Check remaining palette commands dynamically
      const matched = paletteCommandsRef.current.find((cmd) =>
        isCommandTriggered(e, cmd.id, customHotkeys)
      );
      if (matched && matched.action) {
        e.preventDefault();
        matched.action();
        return;
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
    if (!activeTab || !activeTab.filePath || activeTab.type === 'empty') {
      reuseActiveTabRef.current = true;
    }
    await createUntitledNote(activeVault);
  };

  // Create canvas
  const handleCreateCanvas = async () => {
    if (!activeVault) return;
    if (!activeTab || !activeTab.filePath || activeTab.type === 'empty') {
      reuseActiveTabRef.current = true;
    }
    const { path } = await createUntitledCanvas(activeVault);
    if (path) {
      showNotice(t('app.notices.canvasCreated'), 2500, 'info');
    }
  };

  // Create base
  const handleCreateBase = async () => {
    if (!activeVault) return;
    if (!activeTab || !activeTab.filePath || activeTab.type === 'empty') {
      reuseActiveTabRef.current = true;
    }
    const { path } = await createUntitledBase(activeVault);
    if (path) {
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
    if (tab?.filePath && tab.type !== 'empty') {
      selectFile(tab.filePath);
    } else {
      closeActiveFile();
    }
  };

  // Close all tabs (Urano keeps pinned tabs open)
  const handleCloseAllTabs = () => {
    const remaining = tabs.filter((t) => t.pinned);
    if (remaining.length === 0) {
      const newTabId = makeTabId();
      const emptyTab: TabItem = {
        id: newTabId,
        type: 'empty',
        title: t('tabs.newTabLabel') || 'Nueva pestaña',
      };
      setTabs([emptyTab]);
      setActiveTabId(newTabId);
      closeActiveFile();
      return;
    }

    setTabs(remaining);
    if (!remaining.some((t) => t.id === activeTabId)) {
      const next = remaining[remaining.length - 1];
      setActiveTabId(next.id);
      if (next.filePath && next.type !== 'empty') {
        selectFile(next.filePath);
      } else {
        closeActiveFile();
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
   * View header actions (Urano "More options" menu)
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

  // Wikilinks navigate the current leaf in place (Urano behaviour)
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

    const rel = getRelativeVaultPath(targetPath, activeVault || '');
    const title =
      rel.split('/').filter(Boolean).pop()?.replace(new RegExp(`\\${ext}$`, 'i'), '') ||
      t('common.untitled');
    const tabId = `${targetPath}_tab_${Date.now()}`;
    const newTab: TabItem = {
      id: tabId,
      type,
      filePath: targetPath,
      title,
    };
    setTabs((prev) => [...prev, newTab]);
    const alwaysFocus = useSettingsStore.getState().settings.alwaysFocusNewTabs;
    if (alwaysFocus) {
      setActiveTabId(tabId);
      selectFile(targetPath);
    }
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

  // Create New Tab (1:1 with Obsidian: empty leaf with "Nueva pestaña")
  const handleCreateNewTab = useCallback(() => {
    const newTabId = makeTabId();
    const emptyTab: TabItem = {
      id: newTabId,
      type: 'empty',
      title: t('tabs.newTabLabel') || 'Nueva pestaña',
    };
    setTabs((prev) => [...prev, emptyTab]);
    setActiveTabId(newTabId);
    closeActiveFile();
  }, [t, closeActiveFile]);

  // Tab Selection (event-driven, 1:1 with Obsidian)
  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.filePath && tab.type !== 'empty') {
      if (!activeFile || !isSamePath(activeFile, tab.filePath)) {
        selectFile(tab.filePath);
      }
    } else {
      closeActiveFile();
    }
  };

  // Close Tab
  const handleCloseTab = (tabId: string) => {
    let remaining = tabs.filter((t) => t.id !== tabId);

    // If no tabs remain, maintain Obsidian's 1:1 behavior: open a "Nueva pestaña"
    if (remaining.length === 0) {
      const newTabId = makeTabId();
      const emptyTab: TabItem = {
        id: newTabId,
        type: 'empty',
        title: t('tabs.newTabLabel') || 'Nueva pestaña',
      };
      setTabs([emptyTab]);
      setActiveTabId(newTabId);
      closeActiveFile();
      return;
    }

    setTabs(remaining);

    if (activeTabId === tabId) {
      const next = remaining[remaining.length - 1];
      setActiveTabId(next.id);
      if (next.filePath && next.type !== 'empty') {
        selectFile(next.filePath);
      } else {
        closeActiveFile();
      }
    }
  };

  // Clean title of the active note (file name without extension)
  const activeFileTitle = useMemo(() => {
    const target = activeFile || (activeTab?.type !== 'empty' ? activeTab?.filePath : null);
    if (!target) return t('tabs.newTabLabel') || 'Nueva pestaña';
    const rel = getRelativeVaultPath(target, activeVault || '');
    const parts = rel.split('/').filter(Boolean);
    const fileName = parts.pop() || '';
    return fileName.replace(/\.(md|canvas|base)$/i, '') || fileName;
  }, [activeFile, activeTab, activeVault, t]);

  // Folder breadcrumb of the active note (relative to the vault root)
  const activeParentPath = useMemo(() => {
    const target = activeFile || (activeTab?.type !== 'empty' ? activeTab?.filePath : null);
    if (!target) return [];
    return getRelativeVaultFolderSegments(target, activeVault || '');
  }, [activeFile, activeTab, activeVault]);

  // Compute backlinks count for the active file
  const backlinksCount = useMemo(() => {
    if (!activeFile) return 0;
    const targetName = activeFileName || (activeTab?.title ? `${activeTab.title}.md` : '');
    if (!targetName) return 0;
    const base = targetName.replace(/\.(md|canvas|base)$/i, '').toLowerCase();
    let count = 0;

    for (const [path, content] of Object.entries(notesContentMap)) {
      if (isSamePath(path, activeFile)) continue;
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
  }, [activeFile, activeFileName, activeTab, notesContentMap]);

  // Registered commands for Command Palette (Ctrl+P) extracted from Urano
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
      id: 'markdown:toggle-preview',
      name: t('commands.editor.toggleReadingView', { defaultValue: 'Markdown: Alternar vista de lectura' }),
      shortcut: 'Ctrl+E',
      icon: <BookOpen size={15} />,
      action: toggleReadingView,
    },
    {
      id: 'editor:toggle-source',
      name: t('commands.editor.toggleSourceMode', { defaultValue: 'Editor: Alternar código fuente / vista previa en vivo' }),
      icon: <Code size={15} />,
      action: toggleSourceMode,
    },
    {
      id: 'app:sync-config',
      name: t('commands.app.syncConfig'),
      icon: <Settings size={15} />,
      action: () => openSettings('sync'),
    },
    {
      id: 'note-composer:extract',
      name: t('commands.noteComposer.extract'),
      icon: <FolderInput size={15} />,
      action: () => window.dispatchEvent(new CustomEvent('urano-note-composer-extract-selection')),
    },
    {
      id: 'note-composer:extract-heading',
      name: t('commands.noteComposer.extractHeading'),
      icon: <FolderInput size={15} />,
      action: () => window.dispatchEvent(new CustomEvent('urano-note-composer-extract-heading')),
    },
    {
      id: 'note-composer:merge',
      name: t('commands.noteComposer.merge'),
      icon: <Merge size={15} />,
      action: () => {
        if (activeFile && activeFile.toLowerCase().endsWith('.md')) {
          openMergeModalForFile(activeFile);
        }
      },
    },
  ].filter((cmd) => {
    // Commands owned by a disabled core plugin disappear (Urano behaviour)
    if (cmd.id.startsWith('canvas:')) return corePlugins.canvas;
    if (cmd.id.startsWith('daily-notes:')) return corePlugins['daily-notes'];
    if (cmd.id.startsWith('templates:')) return corePlugins.templates;
    if (cmd.id.startsWith('quick-switcher:')) return corePlugins.switcher;
    if (cmd.id.startsWith('sync:')) return corePlugins.sync;
    if (cmd.id.startsWith('graph:')) return corePlugins.graph;
    if (cmd.id.startsWith('bases:')) return corePlugins.bases;
    if (cmd.id.startsWith('command-palette:')) return corePlugins['command-palette'];
    if (cmd.id.startsWith('file-explorer:')) return corePlugins['file-explorer'];
    if (cmd.id.startsWith('note-composer:')) return corePlugins['note-composer'];
    if (cmd.id === 'workspace:toggle-backlinks') return corePlugins.backlink;
    return true;
  });

  // Keep the global shortcut listener and palette commands up to date
  shortcutsRef.current = {
    back: handleNavigateBack,
    forward: handleNavigateForward,
    newTab: () => handleCreateNewTab(),
    closeTab: () => handleCloseTab(activeTabId),
    toggleViewMode: toggleReadingView,
    toggleSourceMode: toggleSourceMode,
    openCommandPalette: () => {
      setPaletteMode('commands');
      setPaletteOpen(true);
    },
    openQuickSwitcher: () => {
      setPaletteMode('files');
      setPaletteOpen(true);
    },
    openGraph: handleOpenGraphTab,
    newNote: handleCreateUntitledNote,
    toggleSettings: toggleSettings,
    toggleLeftSidebar: () => setShowLeftSidebar((prev) => !prev),
    toggleBacklinks: () => setShowBacklinks((prev) => !prev),
    openHelp: handleHelpClick,
    openSearch: () => {
      setShowLeftSidebar(true);
      setSidebarTab('search');
    },
    openTemplates: () => setShowTemplateModal(true),
    reload: () => window.location.reload(),
  };
  paletteCommandsRef.current = paletteCommands;

  const renderRibbonAction = (itemId: string) => {
    switch (itemId) {
      case 'switcher':
        return corePlugins.switcher ? (
          <Tooltip key="switcher" content={t('app.ribbon.openQuickSwitcher')} shortcut="Ctrl+O" position="right">
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
        ) : null;
      case 'graph':
        return corePlugins.graph ? (
          <Tooltip key="graph" content={t('app.ribbon.openGraphView')} shortcut="Ctrl+G" position="right">
            <button
              onClick={handleOpenGraphTab}
              className={`side-dock-ribbon-action ${activeTabId === 'workspace-graph-view' ? 'is-active' : ''}`}
            >
              <GitFork size={18} />
            </button>
          </Tooltip>
        ) : null;
      case 'canvas':
        return corePlugins.canvas ? (
          <Tooltip key="canvas" content={t('app.ribbon.createNewCanvas')} position="right">
            <button onClick={handleCreateCanvas} className="side-dock-ribbon-action">
              <Grid2X2 size={18} />
            </button>
          </Tooltip>
        ) : null;
      case 'daily-notes':
        return corePlugins['daily-notes'] ? (
          <Tooltip key="daily-notes" content={t('app.ribbon.openDailyNote')} position="right">
            <button onClick={handleOpenDailyNote} className="side-dock-ribbon-action">
              <Calendar size={18} />
            </button>
          </Tooltip>
        ) : null;
      case 'templates':
        return corePlugins.templates ? (
          <Tooltip key="templates" content={t('app.ribbon.insertTemplate')} position="right">
            <button onClick={() => setShowTemplateModal(true)} className="side-dock-ribbon-action">
              <Copy size={18} />
            </button>
          </Tooltip>
        ) : null;
      case 'command-palette':
        return corePlugins['command-palette'] ? (
          <Tooltip key="command-palette" content={t('app.ribbon.openCommandPalette')} shortcut="Ctrl+P" position="right">
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
        ) : null;
      case 'bases':
        return corePlugins.bases ? (
          <Tooltip key="bases" content={t('app.ribbon.createNewBase')} position="right">
            <button onClick={handleCreateBase} className="side-dock-ribbon-action">
              <LayoutList size={18} />
            </button>
          </Tooltip>
        ) : null;
      case 'sync':
        return corePlugins.sync ? (
          <Tooltip key="sync" content={t('app.ribbon.syncNow')} position="right">
            <button
              onClick={() => {
                if (activeVault) triggerSync(activeVault);
              }}
              className="side-dock-ribbon-action hover:text-sky-400"
            >
              <RefreshCw size={17} className={isSyncing ? 'animate-spin text-sky-400' : ''} />
            </button>
          </Tooltip>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-urano-bg text-urano-text overflow-hidden select-none">
      {/* Urano Custom Frame Titlebar (rendered in 'custom' / 'Marco de Urano' mode) */}
      {settings.windowFrameStyle === 'custom' && (
        <div
          className="titlebar"
          data-tauri-drag-region
          onDoubleClick={async () => {
            try {
              const { getCurrentWindow } = await import('@tauri-apps/api/window');
              await getCurrentWindow().toggleMaximize();
            } catch {
              await invoke('toggle_maximize_window').catch(() => {});
            }
          }}
        >
          <div className="titlebar-inner" data-tauri-drag-region>
            <div className="titlebar-text" data-tauri-drag-region>
              {mainWindowTitle}
            </div>
            <WindowControls />
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ========================================================
            Urano Left Ribbon (.side-dock-ribbon)
            Configurable dynamic actions with dark tooltips
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
                className="side-dock-ribbon-action text-urano-muted hover:text-urano-text"
              >
                <PanelLeft size={18} />
              </button>
            </Tooltip>
          )}

          {/* Dynamic Ribbon Items according to user configuration and order */}
          {(settings.ribbonItems || [])
            .filter((item) => item.visible)
            .map((item) => renderRibbonAction(item.id))}

          <div className="flex-1" />

          {/* Settings (Ctrl+,) at Bottom of Ribbon */}
          <Tooltip content={t('app.ribbon.settings')} shortcut="Ctrl+," position="right">
            <button
              onClick={() => openSettings()}
              className="side-dock-ribbon-action mb-1 text-urano-muted hover:text-urano-text"
            >
              <Settings size={18} />
            </button>
          </Tooltip>
        </div>
        )}

        {/* ========================================================
            Urano Left Collapsible Sidebar Dock
            Section A: Fila Superior del Panel Izquierdo (4 botones)
            ======================================================== */}
        {showLeftSidebar && (
          <aside className="w-64 bg-urano-sidebar border-r border-urano-border flex flex-col shrink-0">
            {/* A. Fila Superior del Panel Izquierdo (4 botones) */}
            <div className="h-10 px-2.5 border-b border-urano-border flex items-center justify-between bg-urano-sidebar shrink-0">
              {/* 1. Botón "Toggle Left Sidebar" */}
              <Tooltip content={t('app.ribbon.hideSidebar')} shortcut="Ctrl+B" position="bottom">
                <button
                  onClick={() => setShowLeftSidebar(false)}
                  className="clickable-icon nav-action-button p-1 rounded"
                  aria-label={t('app.ribbon.hideSidebar')}
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
                    className={`clickable-icon nav-action-button p-1 rounded ${
                      sidebarTab === 'files' ? 'is-active' : ''
                    }`}
                    aria-label={t('app.sidebar.files')}
                  >
                    <Folder size={17} />
                  </button>
                </Tooltip>

                {/* Buscar */}
                <Tooltip content={t('app.sidebar.search')} position="bottom">
                  <button
                    onClick={() => setSidebarTab('search')}
                    className={`clickable-icon nav-action-button p-1 rounded ${
                      sidebarTab === 'search' ? 'is-active' : ''
                    }`}
                    aria-label={t('app.sidebar.search')}
                  >
                    <Search size={17} />
                  </button>
                </Tooltip>

                {/* Marcadores / Bookmarks */}
                <Tooltip content={t('app.sidebar.bookmarks')} position="bottom">
                  <button
                    onClick={() => setSidebarTab('bookmarks')}
                    className={`clickable-icon nav-action-button p-1 rounded ${
                      sidebarTab === 'bookmarks' ? 'is-active' : ''
                    }`}
                    aria-label={t('app.sidebar.bookmarks')}
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
                  <FileTree items={fileTree} onOpenInNewTab={handleOpenInNewTab} onOpenFile={handleOpenFile} />
                </div>
              )}
              {sidebarTab === 'search' && (
                <div className="flex-1 overflow-hidden">
                  <GlobalSearchPanel onOpenFile={handleOpenFile} />
                </div>
              )}
              {sidebarTab === 'bookmarks' && (
                <div className="flex-1 overflow-hidden">
                  <BookmarksPanel onOpenFile={handleOpenFile} />
                </div>
              )}
            </div>

            {/* Urano Bottom Vault Switcher (⌄ prueba) & Action Icons (? y ⚙) */}
            <div className="p-2 border-t border-urano-border bg-urano-sidebar flex items-center justify-between text-xs text-urano-muted shrink-0">
              <button
                onClick={handleVaultSwitcherClick}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-urano-hover hover:text-urano-text text-urano-text font-medium max-w-[145px] truncate transition-colors text-left"
                title={t('app.sidebar.vaultSwitcher')}
              >
                <ChevronDown size={14} className="text-orange-500 shrink-0" />
                <span className="truncate">{vaultName || t('app.vaultMenu.defaultVaultName')}</span>
              </button>

              <div className="flex items-center gap-0.5 text-urano-muted">
                <button
                  onClick={handleHelpClick}
                  title={t('app.sidebar.help')}
                  className="p-1.5 hover:text-urano-text hover:bg-urano-hover rounded transition-colors"
                >
                  <HelpCircle size={15} />
                </button>
                <button
                  onClick={() => openSettings()}
                  title={t('app.sidebar.settingsTitle')}
                  aria-label={t('app.ribbon.settings')}
                  className="p-1.5 hover:text-urano-text hover:bg-urano-hover rounded transition-colors"
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
        <main className="flex-1 flex flex-col overflow-hidden bg-urano-bg min-w-0">
          {/* Urano TabBar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onNewTab={handleCreateNewTab}
            onTogglePin={handleTogglePin}
            onToggleRightSidebar={() => setShowBacklinks((prev) => !prev)}
            rightSidebarVisible={showBacklinks}
            onSplitRight={handleSplitUnavailable}
            onSplitDown={handleSplitUnavailable}
          />

          {/* Urano View Header (second row) */}
          {settings.showTabTitleBar && (
            <ViewHeader
              title={activeFileTitle}
              parentPath={activeParentPath}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onNavigateBack={handleNavigateBack}
              onNavigateForward={handleNavigateForward}
              viewMode={viewMode}
              onToggleViewMode={toggleReadingView}
              onChangeViewMode={handleChangeViewMode}
              onRename={handleRenameFile}
              onMoveFile={handleMoveFile}
              onDuplicateFile={handleDuplicateFile}
              onMergeFile={
                corePlugins['note-composer'] && activeFile?.toLowerCase().endsWith('.md')
                  ? () => openMergeModalForFile(activeFile)
                  : undefined
              }
              onDeleteFile={handleDeleteFile}
              onCopyLink={handleCopyLink}
              onCopyPath={handleCopyPath}
              onSplitRight={handleSplitUnavailable}
              onSplitDown={handleSplitUnavailable}
              hasActiveFile={Boolean(activeFile)}
            />
          )}

          {/* Tab Content Canvas */}
          <div className="flex-1 overflow-hidden relative">
            {activeTabId === 'workspace-graph-view' || activeTab?.type === 'graph' ? (
              <GraphView onSelectNote={handleOpenFile} />
            ) : activeFile?.endsWith('.canvas') || activeTab?.type === 'canvas' ? (
              <CanvasView filePath={activeFile || activeTab?.filePath || ''} />
            ) : activeFile?.endsWith('.base') || activeTab?.type === 'base' ? (
              <BaseView filePath={activeFile || activeTab?.filePath || ''} />
            ) : (activeFile && isImagePath(activeFile)) || activeTab?.type === 'image' ? (
              <ImageView filePath={activeFile || activeTab?.filePath || ''} />
            ) : activeFile ? (
              <EditorErrorBoundary noteName={activeFileName || t('common.untitled')}>
                <Editor
                  onWikilinkClick={handleWikilinkClick}
                  onOpenInNewTab={handleOpenInNewTab}
                  onOpenToRight={handleOpenInNewTab}
                  viewMode={viewMode}
                />
              </EditorErrorBoundary>
            ) : isLoading ? (
              <div className="flex-1 h-full flex flex-col items-center justify-center text-urano-muted p-8 text-center bg-urano-bg">
                <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm text-urano-muted">{t('common.loading') || 'Cargando...'}</p>
              </div>
            ) : (
              <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center bg-urano-bg select-none">
                <UranoLogo
                  size={68}
                  style={{ width: '68px', height: '68px', filter: 'drop-shadow(0 6px 16px rgba(249, 115, 22, 0.28))' }}
                />
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-normal)', marginTop: '12px' }}>
                  {t('app.emptyState.title')}
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '340px', textAlign: 'center', lineHeight: 1.5, marginTop: '6px', marginBottom: '24px' }}>
                  {t('app.emptyState.description')}
                </p>

                <div className="empty-state-action-list">
                  <button
                    type="button"
                    onClick={() => {
                      reuseActiveTabRef.current = true;
                      handleCreateUntitledNote();
                    }}
                    className="empty-state-action-btn"
                  >
                    <div className="empty-state-action-left">
                      <SquarePen size={16} />
                      <span>{t('app.emptyState.newNote')}</span>
                    </div>
                    <span className="empty-state-action-hotkey">Ctrl + N</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      reuseActiveTabRef.current = true;
                      handleCreateBase();
                    }}
                    className="empty-state-action-btn"
                  >
                    <div className="empty-state-action-left">
                      <Table size={16} />
                      <span>{t('app.emptyState.newBase')}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      reuseActiveTabRef.current = true;
                      handleCreateCanvas();
                    }}
                    className="empty-state-action-btn"
                  >
                    <div className="empty-state-action-left">
                      <LayoutGrid size={16} />
                      <span>{t('app.emptyState.newCanvas')}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaletteMode('files');
                      setPaletteOpen(true);
                    }}
                    className="empty-state-action-btn"
                  >
                    <div className="empty-state-action-left">
                      <Search size={16} />
                      <span>{t('app.emptyState.goToFile')}</span>
                    </div>
                    <span className="empty-state-action-hotkey">Ctrl + O</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ========================================================
            Right Sidebar: Backlinks & Outgoing Links Panel
            ======================================================== */}
        {showBacklinks && corePlugins.backlink && (
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
          Urano Bottom Status Bar
          ======================================================== */}
      {settings.showStatusBar && (
        <StatusBar
          onToggleBacklinks={() => setShowBacklinks((prev) => !prev)}
          backlinksCount={backlinksCount}
          onOpenLogs={() => setShowLogs(true)}
          viewMode={viewMode}
          onToggleViewMode={toggleReadingView}
          onChangeViewMode={handleChangeViewMode}
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
        onSelectFile={handleOpenFile}
        onOpenInNewTab={handleOpenInNewTab}
      />

      {/* Template Selection Modal */}
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onInsert={handleInsertTemplate}
      />

      {/* Note Composer Modal (extract selection/heading & merge notes) */}
      <NoteComposerModal
        request={noteComposerRequest}
        onClose={() => setNoteComposerRequest(null)}
      />

      {/* Settings modal (Urano .modal.mod-settings) — Ctrl+, / ⚙ */}
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

      {/* Floating popover for Vault Switcher (theme-aware) */}
      {vaultSwitcherAnchor && (
        <div
          ref={vaultSwitcherPopoverRef}
          style={{
            background: 'var(--background-primary)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '8px',
            padding: '4px',
            minWidth: '190px',
            boxShadow: '0 8px 24px var(--background-modifier-box-shadow)',
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
                    ? 'text-urano-text bg-[var(--interactive-normal)]'
                    : 'text-urano-text hover:text-urano-text hover:bg-[var(--interactive-hover)]'
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

          <div style={{ borderTop: '1px solid var(--background-modifier-border)', margin: '4px 0' }} />

          <button
            type="button"
            onClick={() => {
              setVaultSwitcherAnchor(null);
              setShowVaultManager(true);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[5px] text-[13px] text-urano-text hover:text-urano-text hover:bg-[var(--interactive-hover)] transition-colors cursor-pointer text-left"
          >
            <Vault size={16} className="text-urano-muted shrink-0" />
            <span>{t('app.vaultMenu.manageVaults')}</span>
          </button>
        </div>
      )}

      {/* Vault Manager Modal (Urano Starter 1:1) */}
      <VaultManagerModal
        isOpen={showVaultManager}
        onClose={() => setShowVaultManager(false)}
      />

      {/* Urano 1:1 "Update links" Modal */}
      {pendingRenamePrompt && (
        <UpdateLinksModal
          isOpen={true}
          totalLinks={pendingRenamePrompt.plan.totalLinks}
          totalFiles={pendingRenamePrompt.plan.totalFiles}
          onAlwaysUpdate={() => resolvePendingRename('always')}
          onJustOnce={() => resolvePendingRename('once')}
          onDoNotUpdate={() => resolvePendingRename('skip')}
        />
      )}

      {/* Urano Floating Notices */}
      <NoticeContainer />
    </div>
  );
};

export const App: React.FC = () => {
  if (isSettingsWindow) {
    return <SettingsWindow />;
  }
  return <MainApp />;
};
