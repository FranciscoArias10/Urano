import React from 'react';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import {
  HardDrive,
  Cloud,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ArrowLeftRight,
  Sparkles,
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
  const { fileContent, activeFile, activeVault } = useVaultStore();
  const { status, isSyncing, isAuthenticated } = useSyncStore();

  const words = fileContent.trim() ? fileContent.trim().split(/\s+/).length : 0;
  const chars = fileContent.length;

  return (
    <footer className="h-6 bg-[#141210] border-t border-stone-800/80 flex items-center justify-between px-3 text-[11px] text-stone-400 select-none z-20">
      {/* Left: Storage & Sync Status */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenLogs}
          className="flex items-center gap-1.5 hover:text-stone-200 transition-colors"
          title="Ver registro de sincronización y telemetría"
        >
          {isAuthenticated ? (
            isSyncing ? (
              <>
                <RefreshCw size={11} className="text-sky-400 animate-spin" />
                <span className="text-sky-400 font-medium">Sincronizando con Drive...</span>
              </>
            ) : status === 'synced' ? (
              <>
                <CheckCircle2 size={12} className="text-emerald-400" />
                <span className="text-emerald-400 font-medium">Guardado en Drive</span>
              </>
            ) : status === 'error' ? (
              <>
                <AlertCircle size={12} className="text-amber-400" />
                <span className="text-amber-400 font-medium">Error de sincronización</span>
              </>
            ) : (
              <>
                <Cloud size={12} className="text-orange-400" />
                <span>Drive Conectado</span>
              </>
            )
          ) : (
            <>
              <HardDrive size={12} className="text-orange-500" />
              <span>Bóveda Local</span>
            </>
          )}
        </button>

        <span className="text-stone-700">•</span>

        {/* Backlinks counter pill */}
        <button
          onClick={onToggleBacklinks}
          className="flex items-center gap-1 hover:text-orange-400 transition-colors"
          title="Alternar panel de Backlinks y menciones"
        >
          <ArrowLeftRight size={11} className="text-orange-400" />
          <span>{backlinksCount} backlinks</span>
        </button>
      </div>

      {/* Right: Word & Character Count + Vault Name */}
      <div className="flex items-center gap-3">
        {activeFile ? (
          <div className="flex items-center gap-1.5 text-stone-400 font-mono text-[10px]">
            <span>{words} palabras</span>
            <span className="text-stone-700">•</span>
            <span>{chars} caracteres</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-stone-500 text-[10px]">
            <Sparkles size={11} className="text-orange-500/70" />
            <span>Urano Core</span>
          </div>
        )}

        {activeVault && (
          <>
            <span className="text-stone-700">•</span>
            <span className="max-w-[200px] truncate text-stone-500 text-[10px]" title={activeVault}>
              {activeVault.split('/').pop()}
            </span>
          </>
        )}
      </div>
    </footer>
  );
};
