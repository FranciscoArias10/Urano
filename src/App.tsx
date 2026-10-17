import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from './stores/vaultStore';
import { useSyncStore } from './stores/syncStore';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { FileTree } from './components/vault/FileTree';
import { Editor } from './components/editor/Editor';
import { GraphView } from './components/graph/GraphView';
import { SyncConfigModal } from './components/sync/SyncConfigModal';
import { SyncLogsModal } from './components/sync/SyncLogsModal';
import {
  FolderOpen,
  FilePlus,
  FolderPlus,
  RotateCw,
  Search,
  Sparkles,
  Shield,
  Zap,
} from 'lucide-react';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'editor' | 'graph'>('editor');
  const [showLogs, setShowLogs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const {
    activeVault,
    fileTree,
    setVault,
    refreshTree,
    createNote,
    createFolder,
    selectFile,
    openOrCreateWikilink,
  } = useVaultStore();

  const { checkAuthStatus } = useSyncStore();

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

  const handleCreateRootNote = async () => {
    if (!activeVault) return;
    const name = prompt('Nombre de la nueva nota:');
    if (name && name.trim()) {
      await createNote(activeVault, name.trim());
    }
  };

  const handleCreateRootFolder = async () => {
    if (!activeVault) return;
    const name = prompt('Nombre de la nueva carpeta:');
    if (name && name.trim()) {
      await createFolder(activeVault, name.trim());
    }
  };

  // Filter file tree by search query
  const filteredTree = React.useMemo(() => {
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

  return (
    <div className="flex flex-col h-screen w-screen bg-obsidian-bg text-obsidian-text overflow-hidden select-none">
      {/* Top Application Header */}
      <Header
        currentView={currentView}
        onToggleView={setCurrentView}
        onOpenLogs={() => setShowLogs(true)}
      />

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {activeVault ? (
          <>
            {/* Left Sidebar: Vault File Explorer */}
            <aside className="w-64 bg-obsidian-sidebar border-r border-obsidian-border flex flex-col shrink-0">
              {/* Explorer Toolbar */}
              <div className="px-3 py-2 border-b border-obsidian-border flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-obsidian-muted">
                  Bóveda
                </span>
                <div className="flex items-center gap-1 text-obsidian-muted">
                  <button
                    onClick={handleCreateRootNote}
                    title="Nueva nota en la raíz"
                    className="p-1 hover:text-white hover:bg-obsidian-hover rounded transition-colors"
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

              {/* Quick Search Input */}
              <div className="p-2 border-b border-obsidian-border">
                <div className="flex items-center gap-2 bg-obsidian-bg px-2.5 py-1.5 rounded-md border border-obsidian-border text-xs text-obsidian-text">
                  <Search className="w-3.5 h-3.5 text-obsidian-muted shrink-0" />
                  <input
                    type="text"
                    placeholder="Buscar notas..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent outline-none placeholder:text-obsidian-muted text-xs"
                  />
                </div>
              </div>

              {/* File Tree List */}
              <div className="flex-1 overflow-y-auto py-2">
                {filteredTree.length === 0 ? (
                  <div className="text-center text-obsidian-muted text-xs py-8 px-4">
                    {searchQuery ? 'No se encontraron notas' : 'Bóveda vacía. Crea tu primera nota.'}
                  </div>
                ) : (
                  <FileTree items={filteredTree} />
                )}
              </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-obsidian-bg">
              {currentView === 'editor' ? (
                <Editor onWikilinkClick={openOrCreateWikilink} />
              ) : (
                <GraphView
                  onSelectNote={(notePath) => {
                    selectFile(notePath);
                    setCurrentView('editor');
                  }}
                />
              )}
            </main>
          </>
        ) : (
          /* Empty / Welcome State when no vault is opened */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-obsidian-bg">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-xl shadow-purple-600/20 mb-6">
              <Sparkles className="w-8 h-8 text-white" />
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">Bienvenido a Urano</h1>
            <p className="text-sm text-obsidian-muted max-w-md mb-8">
              Tu espacio de notas Markdown <span className="text-purple-400 font-medium">Local-First</span> de alto rendimiento con sincronización directa en tu cuenta personal de Google Drive.
            </p>

            <button
              onClick={handleOpenFolderDialog}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm px-6 py-3 rounded-xl shadow-lg shadow-purple-600/30 transition-all hover:scale-105 active:scale-95"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Abrir o Crear Bóveda Local</span>
            </button>

            {/* Feature Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mt-12 text-left">
              <div className="p-4 rounded-xl bg-obsidian-sidebar border border-obsidian-border">
                <div className="flex items-center gap-2 text-purple-400 mb-1">
                  <Zap className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">Ultra Ligero</span>
                </div>
                <p className="text-[11px] text-obsidian-muted">
                  Construido sobre Tauri 2.0 y Rust. Consume solo ~40-80 MB de memoria RAM.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-obsidian-sidebar border border-obsidian-border">
                <div className="flex items-center gap-2 text-emerald-400 mb-1">
                  <Shield className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">100% Privado</span>
                </div>
                <p className="text-[11px] text-obsidian-muted">
                  Tus archivos son Markdown puro (.md) en tu disco. Sin servidores intermedios de terceros.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-obsidian-sidebar border border-obsidian-border">
                <div className="flex items-center gap-2 text-blue-400 mb-1">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-semibold text-xs text-white">Google Drive Sync</span>
                </div>
                <p className="text-[11px] text-obsidian-muted">
                  Sincronización diferencial con algoritmo 3-way y resolución de conflictos sin pérdida.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar />

      {/* Global Modals */}
      <SyncConfigModal />
      <SyncLogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} />
    </div>
  );
};
