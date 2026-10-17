import React from 'react';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';

export const StatusBar: React.FC = () => {
  const { fileContent, activeFile, activeVault } = useVaultStore();
  const { status, isSyncing } = useSyncStore();

  const words = fileContent.trim() ? fileContent.trim().split(/\s+/).length : 0;
  const chars = fileContent.length;

  return (
    <footer className="h-6 bg-obsidian-sidebar border-t border-obsidian-border flex items-center justify-between px-3 text-[11px] text-obsidian-muted select-none">
      {/* Left: Active file stats */}
      <div className="flex items-center gap-4">
        {activeFile ? (
          <>
            <span>{words} palabras</span>
            <span>{chars} caracteres</span>
          </>
        ) : (
          <span>Urano Local-First</span>
        )}
      </div>

      {/* Right: Vault path & Cloud Status */}
      <div className="flex items-center gap-3">
        {activeVault && (
          <span className="max-w-[280px] truncate" title={activeVault}>
            {activeVault}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isSyncing
                ? 'bg-blue-400 animate-pulse'
                : status === 'synced'
                ? 'bg-emerald-400'
                : status === 'conflict'
                ? 'bg-amber-400'
                : status === 'error'
                ? 'bg-red-400'
                : 'bg-zinc-500'
            }`}
          />
          <span className="capitalize">{isSyncing ? 'Sincronizando' : status}</span>
        </div>
      </div>
    </footer>
  );
};
