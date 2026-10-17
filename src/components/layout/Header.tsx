import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import {
  FolderOpen,
  Cloud,
  CloudRain,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Network,
  Edit3,
  Settings,
  Activity,
} from 'lucide-react';

interface HeaderProps {
  currentView: 'editor' | 'graph';
  onToggleView: (view: 'editor' | 'graph') => void;
  onOpenLogs: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onToggleView, onOpenLogs }) => {
  const { activeVault, vaultName, setVault } = useVaultStore();
  const {
    status,
    isSyncing,
    triggerSync,
    setShowConfigModal,
    isAuthenticated,
    user,
    lastSynced,
  } = useSyncStore();

  const handleSelectVault = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Seleccionar carpeta de Bóveda para Urano',
      });

      if (selected && typeof selected === 'string') {
        await setVault(selected);
      }
    } catch (err) {
      console.error('Error al abrir selector de directorio:', err);
    }
  };

  const handleSyncClick = () => {
    if (activeVault) {
      triggerSync(activeVault);
    }
  };

  // Sync button status visuals
  const renderSyncIcon = () => {
    if (isSyncing) {
      return <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
    }
    switch (status) {
      case 'synced':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'conflict':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
      case 'error':
        return <CloudRain className="w-3.5 h-3.5 text-red-400" />;
      default:
        return <Cloud className="w-3.5 h-3.5 text-obsidian-muted" />;
    }
  };

  const renderSyncLabel = () => {
    if (isSyncing) return 'Sincronizando...';
    switch (status) {
      case 'synced':
        return lastSynced ? `Sincronizado (${lastSynced})` : 'Sincronizado';
      case 'conflict':
        return 'Conflicto resuelto';
      case 'error':
        return 'Error de sync';
      default:
        return 'Sincronizar ahora';
    }
  };

  return (
    <header className="h-11 bg-obsidian-sidebar border-b border-obsidian-border flex items-center justify-between px-3 select-none z-30">
      {/* Left: Brand & Vault Picker */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-bold text-sm tracking-wider text-white">
          <span className="w-2 h-2 rounded-full bg-purple-500 shadow-sm shadow-purple-500/50" />
          <span>URANO</span>
        </div>

        <div className="h-4 w-px bg-obsidian-border" />

        <button
          onClick={handleSelectVault}
          className="flex items-center gap-1.5 text-xs text-obsidian-text hover:text-white bg-obsidian-bg hover:bg-obsidian-hover border border-obsidian-border px-2.5 py-1 rounded-md transition-colors"
          title="Cambiar carpeta de bóveda local"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
          <span className="max-w-[140px] truncate font-medium">
            {vaultName || 'Abrir Bóveda...'}
          </span>
        </button>
      </div>

      {/* Center: View Switcher (Editor / Graph) */}
      <div className="flex items-center bg-obsidian-bg p-0.5 rounded-lg border border-obsidian-border text-xs">
        <button
          onClick={() => onToggleView('editor')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
            currentView === 'editor'
              ? 'bg-purple-600 text-white font-medium shadow-sm'
              : 'text-obsidian-muted hover:text-white'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Notas</span>
        </button>
        <button
          onClick={() => onToggleView('graph')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
            currentView === 'graph'
              ? 'bg-purple-600 text-white font-medium shadow-sm'
              : 'text-obsidian-muted hover:text-white'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          <span>Grafo</span>
        </button>
      </div>

      {/* Right: Sync Controls & Cloud Auth */}
      <div className="flex items-center gap-2">
        {/* Sync Button */}
        {activeVault && (
          <button
            onClick={handleSyncClick}
            disabled={isSyncing}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-all ${
              status === 'synced'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                : status === 'conflict'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : status === 'error'
                ? 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20'
                : 'bg-obsidian-bg border-obsidian-border text-obsidian-text hover:bg-obsidian-hover'
            }`}
            title="Sincronizar bóveda con Google Drive"
          >
            {renderSyncIcon()}
            <span className="hidden sm:inline font-medium">{renderSyncLabel()}</span>
          </button>
        )}

        {/* Sync Logs Trigger */}
        <button
          onClick={onOpenLogs}
          className="p-1.5 text-obsidian-muted hover:text-white hover:bg-obsidian-hover rounded-md transition-colors"
          title="Ver registro de actividad de sincronización"
        >
          <Activity className="w-4 h-4" />
        </button>

        {/* Google Drive Settings / Profile */}
        <button
          onClick={() => setShowConfigModal(true)}
          className="flex items-center gap-1.5 text-xs bg-obsidian-bg hover:bg-obsidian-hover border border-obsidian-border p-1 rounded-md transition-colors"
          title="Configuración de Google Drive"
        >
          {isAuthenticated && user?.picture ? (
            <img src={user.picture} alt={user.name} className="w-5 h-5 rounded-full" />
          ) : (
            <Settings className="w-4 h-4 text-obsidian-muted hover:text-white" />
          )}
        </button>
      </div>
    </header>
  );
};
