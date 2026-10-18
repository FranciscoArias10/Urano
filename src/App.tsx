import React, { useEffect, useState, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from './stores/vaultStore';
import { useSyncStore } from './stores/syncStore';
import { TabBar, TabItem } from './components/tabs/TabBar';
import { FileTree } from './components/vault/FileTree';
import { Editor } from './components/editor/Editor';
import { GraphView } from './components/graph/GraphView';
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
  Command,
  Settings,
  PanelLeftClose,
  PanelLeft,
  ArrowLeftRight,
  RefreshCw,
  ChevronDown,
  HelpCircle,
  HardDrive,
  Cloud,
} from 'lucide-react';

export const App: React.FC = () => {
  // Tabs State (Obsidian Workspace Leaf Tabs)
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

  // UI Panels Toggles
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Command Palette & Quick Switcher
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<'commands' | 'files'>('commands');

  // File tree search
  const [searchQuery, setSearchQuery] = useState('');

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
    createUntitledNote,
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

    const fileName = activeFileName ? activeFileName.replace(/\.md$/i, '') : 'Nota';

    setTabs((prev) => {
      const existingIdx = prev.findIndex((t) => t.filePath === activeFile);
      if (existingIdx !== -1) {
        // Update title and isDirty if changed
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          title: fileName,
          isDirty,
        };
        return updated;
      } else {
        // Add new tab
        const newTab: TabItem = {
          id: activeFile,
          type: 'note',
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    if (!targetPath.endsWith('.md')) {
      const findInTree = (items: typeof fileTree): string | null => {
        for (const item of items) {
          if (
            !item.isDir &&
            item.name.replace(/\.md$/i, '').toLowerCase() === filePathOrName.toLowerCase()
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

    const title =
      targetPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') || 'Nota';
    const tabId = `${targetPath}_tab_${Date.now()}`;
    const newTab: TabItem = {
      id: tabId,
      type: 'note',
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

  // Filter file tree by search query
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return fileTree;
    const q = searchQuery.toLowerCase();

    const filterItems = (items: typeof fileTree): typeof fileTree => {
      return items
        .map((item) => {
          if (item.isDir && item.children) {
            const children = filterItems(item.children);
            if (children.length > 0 || item.name.toLowerCase().includes(q)) {
              return { ...item, children };
            }
          } else if (item.name.toLowerCase().includes(q)) {
            return item;
          }
          return null;
        })
        .filter(Boolean) as typeof fileTree;
    };

    return filterItems(fileTree);
  }, [fileTree, searchQuery]);

  // Compute backlinks count for the active file
  const backlinksCount = useMemo(() => {
    if (!activeFileName) return 0;
    const base = activeFileName.replace(/\.md$/i, '').toLowerCase();
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

  // Registered commands for Command Palette (Ctrl+P)
  const paletteCommands: CommandItem[] = [
    {
      id: 'new-note',
      name: 'Crear nueva nota (sin título)',
      shortcut: 'Ctrl+N',
      icon: <FilePlus size={15} />,
      action: handleCreateUntitledNote,
    },
    {
      id: 'quick-switcher',
      name: 'Buscar nota en la bóveda (Quick Switcher)',
      shortcut: 'Ctrl+O',
      icon: <Search size={15} />,
      action: () => {
        setPaletteMode('files');
        setPaletteOpen(true);
      },
    },
    {
      id: 'graph-view',
      name: 'Abrir vista gráfica interactiva',
      shortcut: 'Ctrl+G',
      icon: <GitFork size={15} />,
      action: handleOpenGraphTab,
    },
    {
      id: 'toggle-sidebar',
      name: 'Alternar barra lateral izquierda',
      shortcut: 'Ctrl+B',
      icon: <PanelLeft size={15} />,
      action: () => setShowLeftSidebar((prev) => !prev),
    },
    {
      id: 'toggle-backlinks',
      name: 'Alternar panel de Backlinks y menciones',
      shortcut: 'Ctrl+Shift+B',
      icon: <ArrowLeftRight size={15} />,
      action: () => setShowBacklinks((prev) => !prev),
    },
    {
      id: 'sync-now',
      name: 'Sincronizar ahora con Google Drive',
      icon: <RefreshCw size={15} />,
      action: () => {
        if (activeVault) triggerSync(activeVault);
      },
    },
    {
      id: 'open-vault',
      name: 'Abrir otra carpeta de bóveda...',
      icon: <FolderOpen size={15} />,
      action: handleOpenFolderDialog,
    },
    {
      id: 'sync-config',
      name: 'Configurar cuenta de Google Drive y sincronización',
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
            ======================================================== */}
        <div className="side-dock-ribbon">
          {/* Logo at the top */}
          <div className="mb-2 p-1">
            <UranoLogo size={24} className="hover:scale-105 transition-transform" />
          </div>

          {/* Toggle Left Sidebar */}
          <button
            onClick={() => setShowLeftSidebar((prev) => !prev)}
            title={showLeftSidebar ? 'Ocultar barra lateral (Ctrl+B)' : 'Mostrar barra lateral (Ctrl+B)'}
            className={`side-dock-ribbon-action ${showLeftSidebar ? 'is-active' : ''}`}
          >
            {showLeftSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </button>

          {/* Quick Switcher (Ctrl+O) */}
          <button
            onClick={() => {
              setPaletteMode('files');
              setPaletteOpen(true);
            }}
            title="Buscar nota (Ctrl+O)"
            className="side-dock-ribbon-action"
          >
            <Search size={18} />
          </button>

          {/* Command Palette (Ctrl+P) */}
          <button
            onClick={() => {
              setPaletteMode('commands');
              setPaletteOpen(true);
            }}
            title="Paleta de comandos (Ctrl+P)"
            className="side-dock-ribbon-action"
          >
            <Command size={18} />
          </button>

          {/* Interactive Graph View (Ctrl+G) */}
          <button
            onClick={handleOpenGraphTab}
            title="Vista Gráfica (Ctrl+G)"
            className={`side-dock-ribbon-action ${activeTabId === 'workspace-graph-view' ? 'is-active' : ''}`}
          >
            <GitFork size={18} />
          </button>

          {/* New Untitled Note (Ctrl+N) */}
          <button
            onClick={handleCreateUntitledNote}
            title="Nueva nota (Ctrl+N)"
            className="side-dock-ribbon-action text-orange-400 hover:text-orange-300"
          >
            <FilePlus size={18} />
          </button>

          {/* Google Drive Sync Trigger */}
          <button
            onClick={() => {
              if (activeVault) triggerSync(activeVault);
            }}
            title={isSyncing ? 'Sincronizando con Google Drive...' : 'Sincronizar ahora con Google Drive'}
            className="side-dock-ribbon-action hover:text-sky-400"
          >
            <RefreshCw size={17} className={isSyncing ? 'animate-spin text-sky-400' : ''} />
          </button>

          <div className="flex-1" />

          {/* Settings / Google Auth Button at Bottom of Ribbon */}
          <button
            onClick={() => setShowConfigModal(true)}
            title="Configuración de Bóveda y Google Drive"
            className="side-dock-ribbon-action mb-1 text-stone-400 hover:text-stone-200"
          >
            <Settings size={18} />
          </button>
        </div>

        {/* ========================================================
            Obsidian Left Collapsible Sidebar (File Explorer)
            ======================================================== */}
        {showLeftSidebar && (
          <aside className="w-64 bg-obsidian-sidebar border-r border-obsidian-border flex flex-col shrink-0">
            {/* Vault Header & Actions */}
            <div className="px-3 py-2.5 border-b border-obsidian-border flex items-center justify-between">
              <div
                onClick={handleOpenFolderDialog}
                className="flex items-center gap-2 cursor-pointer hover:text-orange-400 transition-colors truncate"
                title="Haz clic para abrir otra bóveda"
              >
                <FolderOpen className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-200 truncate">
                  {vaultName || 'Bóveda'}
                </span>
              </div>

              <div className="flex items-center gap-1 text-obsidian-muted">
                <button
                  onClick={handleCreateUntitledNote}
                  title="Nueva nota (Ctrl+N)"
                  className="p-1 hover:text-orange-400 hover:bg-obsidian-hover rounded transition-colors"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleCreateRootFolder}
                  title="Nueva carpeta en la raíz"
                  className="p-1 hover:text-white hover:bg-obsidian-hover rounded transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => refreshTree()}
                  title="Recargar archivos"
                  className="p-1 hover:text-white hover:bg-obsidian-hover rounded transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Filter Search Input */}
            <div className="p-2 border-b border-obsidian-border">
              <div className="flex items-center gap-2 bg-[#161616] px-2.5 py-1.5 rounded-md border border-stone-800/80 text-xs text-obsidian-text">
                <Search className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                <input
                  type="text"
                  placeholder="Filtrar archivos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent outline-none placeholder:text-stone-500 text-xs"
                />
              </div>
            </div>

            {/* File Tree Component */}
            <div className="flex-1 overflow-y-auto p-2">
              <FileTree items={filteredTree} onOpenInNewTab={handleOpenInNewTab} />
            </div>

            {/* Obsidian Bottom Vault Switcher (⌄ prueba) & Action Icons (? y ⚙) */}
            <div className="p-2 border-t border-obsidian-border bg-obsidian-sidebar flex items-center justify-between text-xs text-stone-400">
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
            Center Main Workspace (Tabs + Editor / Graph Canvas)
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
            ) : activeFile ? (
              <Editor
                onWikilinkClick={(name) => openOrCreateWikilink(name)}
                onOpenInNewTab={handleOpenInNewTab}
                onOpenToRight={handleOpenInNewTab}
              />
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
