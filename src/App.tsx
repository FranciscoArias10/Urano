import React, { useEffect, useState, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from './stores/vaultStore';
import { useSyncStore } from './stores/syncStore';
import { TabBar, TabItem } from './components/tabs/TabBar';
import { FileTree } from './components/vault/FileTree';
import { Editor, getActiveEditorView } from './components/editor/Editor';
import { EditorErrorBoundary } from './components/editor/EditorErrorBoundary';
import { GraphView } from './components/graph/GraphView';
import { CanvasView } from './components/canvas/CanvasView';
import { BaseView } from './components/base/BaseView';
import { TemplateModal } from './components/templates/TemplateModal';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { BookmarksPanel } from './components/bookmarks/BookmarksPanel';
import { Tooltip } from './components/common/Tooltip';
import { BacklinksPanel } from './components/backlinks/BacklinksPanel';
import { CommandPalette, CommandItem } from './components/palette/CommandPalette';
import { StatusBar } from './components/layout/StatusBar';
import { SyncConfigModal } from './components/sync/SyncConfigModal';
import { SyncLogsModal } from './components/sync/SyncLogsModal';
import { UranoLogo } from './components/common/UranoLogo';
import { NoticeContainer, useNoticeStore } from './components/common/Notice';
import { ObsidianMenu, MenuItemData } from './components/common/ObsidianMenu';
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
  HardDrive,
  Cloud,
  FileSearch,
  Grid2X2,
  Calendar,
  Copy,
  Terminal,
  LayoutList,
  Folder,
  Bookmark,
} from 'lucide-react';

export const App: React.FC = () => {
  // Tabs State (Obsidian Workspace Leaf Tabs)
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

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
  } = useVaultStore();

  const { checkAuthStatus, triggerSync, isSyncing, setShowConfigModal } = useSyncStore();
  const { showNotice } = useNoticeStore();

  const [vaultMenu, setVaultMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

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

  // Synchronize tabs when activeFile changes
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
    }

    const fileName = activeFileName
      ? activeFileName.replace(new RegExp(`\\${ext}$`, 'i'), '')
      : 'Archivo';

    setTabs((prev) => {
      const existingIdx = prev.findIndex((t) => t.filePath === activeFile);
      if (existingIdx !== -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          title: fileName,
          type,
          isDirty,
        };
        return updated;
      } else {
        const newTab: TabItem = {
          id: activeFile,
          type,
          filePath: activeFile,
          title: fileName,
          isDirty,
        };
        return [...prev, newTab];
      }
    });

    setActiveTabId(activeFile);
  }, [activeFile, activeFileName, isDirty]);

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
        title: 'Seleccionar carpeta de bóveda para Urano',
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
      showNotice('Lienzo canvas creado', 2500, 'info');
    }
  };

  // Create base
  const handleCreateBase = async () => {
    if (!activeVault) return;
    const { path } = await createUntitledBase(activeVault);
    if (path) {
      setActiveTabId(path);
      showNotice('Base de datos creada', 2500, 'info');
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
      showNotice('Plantilla insertada correctamente', 2500, 'info');
    } else {
      const newNote = await createUntitledNote(activeVault || undefined);
      if (newNote?.path) {
        updateContent(templateContent);
        await saveCurrentFile();
        showNotice('Nueva nota creada con la plantilla', 2500, 'info');
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
    const items: MenuItemData[] = [
      {
        title: `Bóveda actual: ${vaultName || 'prueba'}`,
        disabled: true,
      },
      { type: 'separator' },
      {
        title: 'Bóveda Local',
        icon: <HardDrive size={14} className="text-orange-500" />,
        action: handleOpenFolderDialog,
      },
      {
        title: 'Google Drive',
        icon: <Cloud size={14} className="text-sky-400" />,
        action: () => setShowConfigModal(true),
      },
      { type: 'separator' },
      {
        title: 'Abrir otra carpeta de bóveda...',
        icon: <FolderOpen size={14} />,
        action: handleOpenFolderDialog,
      },
      {
        title: 'Registros de sincronización...',
        icon: <RefreshCw size={14} />,
        action: () => setShowLogs(true),
      },
    ];

    setVaultMenu({
      x: rect.left,
      y: Math.max(10, rect.top - 180),
      items,
    });
  };

  const handleHelpClick = () => {
    showNotice(
      'Atajos: Ctrl+N (Nota nueva) • Ctrl+O (Buscar) • Ctrl+P (Comandos) • Ctrl+B (Barra lateral) • Ctrl+G (Grafo)',
      5000,
      'info'
    );
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

  // Close tabs to right
  const handleCloseTabsToRight = (tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;
      const newTabs = prev.slice(0, idx + 1);
      if (!newTabs.some((t) => t.id === activeTabId)) {
        setActiveTabId(tabId);
        const tab = prev.find((t) => t.id === tabId);
        if (tab?.filePath) {
          selectFile(tab.filePath);
        }
      }
      return newTabs;
    });
  };

  // Duplicate tab
  const handleDuplicateTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const newTabId = `${tab.id}_dup_${Date.now()}`;
    const newTab: TabItem = {
      ...tab,
      id: newTabId,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
  };

  // Open note in a new tab (or to the right)
  const handleOpenInNewTab = (filePathOrName: string) => {
    let targetPath = filePathOrName;
    if (!targetPath.endsWith('.md') && !targetPath.endsWith('.canvas') && !targetPath.endsWith('.base')) {
      const findInTree = (items: typeof fileTree): string | null => {
        for (const item of items) {
          if (
            !item.isDir &&
            item.name.replace(/\.(md|canvas|base)$/i, '').toLowerCase() === filePathOrName.toLowerCase()
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
    }

    const title =
      targetPath.replace(/\\/g, '/').split('/').pop()?.replace(new RegExp(`\\${ext}$`, 'i'), '') || 'Nota';
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
      return [...prev, { id: graphTabId, type: 'graph', title: 'Vista Gráfica' }];
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
      name: 'Explorador de archivos: Crear nueva nota (sin título)',
      shortcut: 'Ctrl+N',
      icon: <FilePlus size={15} />,
      action: handleCreateUntitledNote,
    },
    {
      id: 'quick-switcher:open',
      name: 'Selector rápido: Buscar nota en la bóveda (Quick Switcher)',
      shortcut: 'Ctrl+O',
      icon: <FileSearch size={15} />,
      action: () => {
        setPaletteMode('files');
        setPaletteOpen(true);
      },
    },
    {
      id: 'graph:open',
      name: 'Vista gráfica: Abrir vista gráfica interactiva (Graph View)',
      shortcut: 'Ctrl+G',
      icon: <GitFork size={15} />,
      action: handleOpenGraphTab,
    },
    {
      id: 'canvas:new',
      name: 'Canvas: Crear nuevo lienzo (.canvas)',
      icon: <Grid2X2 size={15} />,
      action: handleCreateCanvas,
    },
    {
      id: 'daily-notes:today',
      name: 'Notas diarias: Abrir nota de hoy',
      icon: <Calendar size={15} />,
      action: handleOpenDailyNote,
    },
    {
      id: 'templates:insert',
      name: 'Plantillas: Insertar plantilla',
      icon: <Copy size={15} />,
      action: () => setShowTemplateModal(true),
    },
    {
      id: 'bases:new',
      name: 'Bases: Crear nueva base de datos (.base)',
      icon: <LayoutList size={15} />,
      action: handleCreateBase,
    },
    {
      id: 'workspace:toggle-left-sidebar',
      name: 'Espacio de trabajo: Alternar barra lateral izquierda',
      shortcut: 'Ctrl+B',
      icon: <PanelLeft size={15} />,
      action: () => setShowLeftSidebar((prev) => !prev),
    },
    {
      id: 'workspace:toggle-backlinks',
      name: 'Espacio de trabajo: Alternar panel de Backlinks y menciones',
      shortcut: 'Ctrl+Shift+B',
      icon: <ArrowLeftRight size={15} />,
      action: () => setShowBacklinks((prev) => !prev),
    },
    {
      id: 'file-explorer:new-folder',
      name: 'Explorador de archivos: Nueva carpeta en la raíz',
      icon: <FolderPlus size={15} />,
      action: handleCreateRootFolder,
    },
    {
      id: 'file-explorer:refresh',
      name: 'Explorador de archivos: Recargar archivos de la bóveda',
      icon: <RotateCw size={15} />,
      action: () => refreshTree(),
    },
    {
      id: 'sync:now',
      name: 'Sincronización: Sincronizar ahora con Google Drive',
      icon: <RefreshCw size={15} />,
      action: () => {
        if (activeVault) triggerSync(activeVault);
      },
    },
    {
      id: 'app:open-vault',
      name: 'Bóveda: Abrir otra carpeta de bóveda...',
      icon: <FolderOpen size={15} />,
      action: handleOpenFolderDialog,
    },
    {
      id: 'app:sync-config',
      name: 'Ajustes: Configurar cuenta de Google Drive y sincronización',
      icon: <Settings size={15} />,
      action: () => setShowConfigModal(true),
    },
  ];

  return (
    <div className="flex flex-col h-screen w-screen bg-obsidian-bg text-obsidian-text overflow-hidden select-none">
      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ========================================================
            Obsidian Left Ribbon (.side-dock-ribbon)
            Section B: Los 7 Iconos en orden exacto con tooltips oscuros
            ======================================================== */}
        <div className="side-dock-ribbon">
          {/* Logo at the top */}
          <div className="mb-2 p-1 flex items-center justify-center">
            <UranoLogo size={22} className="hover:scale-105 transition-transform" />
          </div>

          {/* Toggle sidebar button if sidebar is currently collapsed */}
          {!showLeftSidebar && (
            <Tooltip content="Mostrar barra lateral" shortcut="Ctrl+B" position="right">
              <button
                onClick={() => setShowLeftSidebar(true)}
                className="side-dock-ribbon-action text-stone-400 hover:text-stone-200"
              >
                <PanelLeft size={18} />
              </button>
            </Tooltip>
          )}

          {/* 1. Open quick switcher (Ctrl+O) */}
          <Tooltip content="Open quick switcher" shortcut="Ctrl+O" position="right">
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

          {/* 2. Open graph view (Ctrl+G) */}
          <Tooltip content="Open graph view" shortcut="Ctrl+G" position="right">
            <button
              onClick={handleOpenGraphTab}
              className={`side-dock-ribbon-action ${activeTabId === 'workspace-graph-view' ? 'is-active' : ''}`}
            >
              <GitFork size={18} />
            </button>
          </Tooltip>

          {/* 3. Create new canvas */}
          <Tooltip content="Create new canvas" position="right">
            <button
              onClick={handleCreateCanvas}
              className="side-dock-ribbon-action"
            >
              <Grid2X2 size={18} />
            </button>
          </Tooltip>

          {/* 4. Open today's daily note */}
          <Tooltip content="Open today's daily note" position="right">
            <button
              onClick={handleOpenDailyNote}
              className="side-dock-ribbon-action"
            >
              <Calendar size={18} />
            </button>
          </Tooltip>

          {/* 5. Insert template */}
          <Tooltip content="Insert template" position="right">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="side-dock-ribbon-action"
            >
              <Copy size={18} />
            </button>
          </Tooltip>

          {/* 6. Open command palette (Ctrl+P) */}
          <Tooltip content="Open command palette" shortcut="Ctrl+P" position="right">
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

          {/* 7. Create new base */}
          <Tooltip content="Create new base" position="right">
            <button
              onClick={handleCreateBase}
              className="side-dock-ribbon-action"
            >
              <LayoutList size={18} />
            </button>
          </Tooltip>

          <div className="flex-1" />

          {/* Google Drive Sync Trigger */}
          <Tooltip content="Sincronizar ahora con Google Drive" position="right">
            <button
              onClick={() => {
                if (activeVault) triggerSync(activeVault);
              }}
              className="side-dock-ribbon-action hover:text-sky-400"
            >
              <RefreshCw size={17} className={isSyncing ? 'animate-spin text-sky-400' : ''} />
            </button>
          </Tooltip>

          {/* Settings / Google Auth Button at Bottom of Ribbon */}
          <Tooltip content="Configuración y Google Drive" position="right">
            <button
              onClick={() => setShowConfigModal(true)}
              className="side-dock-ribbon-action mb-1 text-stone-400 hover:text-stone-200"
            >
              <Settings size={18} />
            </button>
          </Tooltip>
        </div>

        {/* ========================================================
            Obsidian Left Collapsible Sidebar Dock
            Section A: Fila Superior del Panel Izquierdo (4 botones)
            ======================================================== */}
        {showLeftSidebar && (
          <aside className="w-64 bg-obsidian-sidebar border-r border-obsidian-border flex flex-col shrink-0">
            {/* A. Fila Superior del Panel Izquierdo (4 botones) */}
            <div className="h-10 px-2.5 border-b border-obsidian-border flex items-center justify-between bg-obsidian-sidebar shrink-0">
              {/* 1. Botón "Toggle Left Sidebar" */}
              <Tooltip content="Ocultar barra lateral" shortcut="Ctrl+B" position="bottom">
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
                <Tooltip content="Archivos" position="bottom">
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
                <Tooltip content="Buscar" position="bottom">
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
                <Tooltip content="Marcadores" position="bottom">
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
                title="Bóveda actual / Cambiar entre Local y Google Drive"
              >
                <ChevronDown size={14} className="text-orange-500 shrink-0" />
                <span className="truncate">{vaultName || 'prueba'}</span>
              </button>

              <div className="flex items-center gap-0.5 text-stone-400">
                <button
                  onClick={handleHelpClick}
                  title="Ayuda y atajos de teclado"
                  className="p-1.5 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
                >
                  <HelpCircle size={15} />
                </button>
                <button
                  onClick={() => setShowConfigModal(true)}
                  title="Ajustes y sincronización"
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
            onCloseTabsToRight={handleCloseTabsToRight}
            onDuplicateTab={handleDuplicateTab}
            onNewTab={handleCreateUntitledNote}
          />

          {/* Tab Content Canvas */}
          <div className="flex-1 overflow-hidden relative">
            {activeTabId === 'workspace-graph-view' ? (
              <GraphView onSelectNote={(path: string) => selectFile(path)} />
            ) : activeFile?.endsWith('.canvas') ? (
              <CanvasView filePath={activeFile} />
            ) : activeFile?.endsWith('.base') ? (
              <BaseView filePath={activeFile} />
            ) : activeFile ? (
              <EditorErrorBoundary noteName={activeFileName || 'Nota'}>
                <Editor
                  onWikilinkClick={(name) => openOrCreateWikilink(name)}
                  onOpenInNewTab={handleOpenInNewTab}
                  onOpenToRight={handleOpenInNewTab}
                />
              </EditorErrorBoundary>
            ) : (
              <div className="flex-1 h-full flex flex-col items-center justify-center text-obsidian-muted p-8 text-center bg-obsidian-bg">
                <UranoLogo size={56} className="mb-4 opacity-80" />
                <h2 className="text-xl font-medium text-obsidian-text mb-2">Bóveda de Urano</h2>
                <p className="text-sm max-w-sm text-obsidian-muted mb-6">
                  Crea una nueva nota (Ctrl+N) o presiona Ctrl+O para abrir una nota existente.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCreateUntitledNote}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium shadow transition-colors"
                  >
                    <FilePlus size={14} />
                    <span>Crear nueva nota</span>
                  </button>
                  <button
                    onClick={handleOpenFolderDialog}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors"
                  >
                    <FolderOpen size={14} />
                    <span>Abrir otra carpeta</span>
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
      <StatusBar
        onToggleBacklinks={() => setShowBacklinks((prev) => !prev)}
        backlinksCount={backlinksCount}
        onOpenLogs={() => setShowLogs(true)}
      />

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
        onSelectFile={(path) => selectFile(path)}
        onOpenInNewTab={handleOpenInNewTab}
      />

      {/* Template Selection Modal */}
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onInsert={handleInsertTemplate}
      />

      {/* Google Drive Sync Configuration Modal */}
      <SyncConfigModal />

      {/* Sync Logs & Telemetry Modal */}
      <SyncLogsModal
        isOpen={showLogs}
        onClose={() => setShowLogs(false)}
      />

      {/* Obsidian Vault Switcher Menu */}
      {vaultMenu && (
        <ObsidianMenu
          x={vaultMenu.x}
          y={vaultMenu.y}
          items={vaultMenu.items}
          onClose={() => setVaultMenu(null)}
        />
      )}

      {/* Obsidian Floating Notices */}
      <NoticeContainer />
    </div>
  );
};
