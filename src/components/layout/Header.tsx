import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import { UranoLogo } from '../common/UranoLogo';
import { useT } from '../../stores/localeStore';
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
  const t = useT();
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
        title: t('header.selectVaultFolder'),
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
      return <RefreshCw className="w-3.5 h-3.5 text-orange-400 animate-spin" />;
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
    if (isSyncing) return t('header.syncing');
    switch (status) {
      case 'synced':
        return lastSynced ? t('header.syncedAt', { time: lastSynced }) : t('header.synced');
      case 'conflict':
        return t('header.conflictResolved');
      case 'error':
        return t('header.syncError');
      default:
        return t('header.syncNow');
    }
  };

  return (
    <header className="h-11 bg-obsidian-sidebar border-b border-obsidian-border flex items-center justify-between px-3 select-none z-30">
      {/* Left: Urano Logo & Vault Picker */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-sm tracking-wider text-white">
          <UranoLogo size={22} className="shrink-0 drop-shadow-[0_0_8px_rgba(234,88,12,0.4)]" />
          <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-orange-500 bg-clip-text text-transparent font-black tracking-widest">
            URANO
          </span>
        </div>

        <div className="h-4 w-px bg-obsidian-border" />

        <button
          onClick={handleSelectVault}
          className="flex items-center gap-1.5 text-xs text-obsidian-text hover:text-white bg-obsidian-bg hover:bg-obsidian-hover border border-obsidian-border px-2.5 py-1 rounded-md transition-colors"
          title={t('header.changeVaultFolder')}
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
          <span className="max-w-[140px] truncate font-medium">
            {vaultName || t('header.openVault')}
          </span>
        </button>
      </div>

      {/* Center: View Switcher (Editor / Graph) */}
      <div className="flex items-center bg-obsidian-bg p-0.5 rounded-lg border border-obsidian-border text-xs">
        <button
          onClick={() => onToggleView('editor')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
            currentView === 'editor'
              ? 'bg-orange-600 text-white font-medium shadow-sm shadow-orange-600/30'
              : 'text-obsidian-muted hover:text-white'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>{t('header.notes')}</span>
        </button>
        <button
          onClick={() => onToggleView('graph')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
            currentView === 'graph'
              ? 'bg-orange-600 text-white font-medium shadow-sm shadow-orange-600/30'
              : 'text-obsidian-muted hover:text-white'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          <span>{t('header.graph')}</span>
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
                : isSyncing
                ? 'bg-orange-500/10 border-orange-500/40 text-orange-300 animate-pulse'
                : 'bg-obsidian-bg border-obsidian-border text-obsidian-text hover:bg-obsidian-hover'
            }`}
            title={t('header.syncVault')}
          >
            {renderSyncIcon()}
            <span className="hidden sm:inline font-medium">{renderSyncLabel()}</span>
          </button>
        )}

        {/* Sync Logs Trigger */}
        <button
          onClick={onOpenLogs}
          className="p-1.5 text-obsidian-muted hover:text-white hover:bg-obsidian-hover rounded-md transition-colors"
          title={t('header.syncLogs')}
        >
          <Activity className="w-4 h-4" />
        </button>

        {/* Google Drive Settings / Profile */}
        <button
          onClick={() => setShowConfigModal(true)}
          className="flex items-center gap-1.5 text-xs bg-obsidian-bg hover:bg-obsidian-hover border border-obsidian-border p-1 rounded-md transition-colors"
          title={t('header.driveSettings')}
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
