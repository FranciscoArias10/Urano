import React from 'react';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import {
  HardDrive,
  Cloud,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface StatusBarProps {
  onToggleBacklinks?: () => void;
  backlinksCount?: number;
  onOpenLogs?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  onToggleBacklinks,
  backlinksCount = 0,
  onOpenLogs,
}) => {
  const { fileContent } = useVaultStore();
  const { status, isSyncing, isAuthenticated } = useSyncStore();

  const words = fileContent.trim() ? fileContent.trim().split(/\s+/).length : 0;
  const chars = fileContent.length;

  return (
    <footer className="h-6 bg-obsidian-sidebar border-t border-obsidian-border flex items-center justify-between px-3 text-[11px] text-stone-400 select-none z-20">
      {/* Left: Spacer */}
      <div className="flex items-center gap-2" />

      {/* Right: Compact Status Pill (0 backlinks  55 palabras  497 caracteres + sync icon) */}
      <div className="flex items-center">
        <div className="flex items-center gap-2.5 bg-[#141414] hover:bg-[#1a1a1a] px-2.5 py-0.5 rounded-full border border-stone-800/80 text-[11px] text-stone-400 transition-colors">
          <button
            onClick={onToggleBacklinks}
            className="hover:text-orange-400 transition-colors cursor-pointer"
            title="Alternar panel de Backlinks"
          >
            {backlinksCount} backlinks
          </button>

          <span className="text-stone-700 select-none">•</span>

          <span className="font-mono text-[10px] text-stone-300">{words} palabras</span>

          <span className="text-stone-700 select-none">•</span>

          <span className="font-mono text-[10px] text-stone-300">{chars} caracteres</span>

          <span className="text-stone-700 select-none">•</span>

          <button
            onClick={onOpenLogs}
            className="flex items-center hover:opacity-80 transition-opacity cursor-pointer"
            title={
              isAuthenticated
                ? isSyncing
                  ? 'Sincronizando con Google Drive...'
                  : status === 'synced'
                  ? 'Sincronizado con Google Drive'
                  : status === 'error'
                  ? 'Error de sincronización con Google Drive'
                  : 'Google Drive conectado'
                : 'Bóveda local (sin sincronizar)'
            }
          >
            {isAuthenticated ? (
              isSyncing ? (
                <RefreshCw size={11} className="text-sky-400 animate-spin" />
              ) : status === 'synced' ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : status === 'error' ? (
                <AlertCircle size={12} className="text-amber-400" />
              ) : (
                <Cloud size={12} className="text-orange-400" />
              )
            ) : (
              <HardDrive size={12} className="text-stone-500 hover:text-orange-400" />
            )}
          </button>
        </div>
      </div>
    </footer>
  );
};
