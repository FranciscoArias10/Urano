import React, { useState, useEffect } from 'react';
import { X, Minus, Square, Copy, ArrowLeft, Cloud, RefreshCw, Loader2, Folder } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { UranoLogo } from '../common/UranoLogo';
import { useT } from '../../stores/localeStore';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import { RecentVaultsList } from './RecentVaultsList';
import { VaultActionsCard } from './VaultActionsCard';
import { CreateVaultForm } from './CreateVaultForm';

export interface VaultManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VaultManagerModal: React.FC<VaultManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const t = useT();
  const {
    activeVault,
    recentVaults,
    setVault,
    removeRecentVault,
    updateRecentVault,
  } = useVaultStore();

  const [view, setView] = useState<'main' | 'create' | 'remote-sync'>('main');
  const [downloadingVaultId, setDownloadingVaultId] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const {
    isAuthenticated,
    user,
    userEmail,
    remoteVaults,
    isLoadingVaults,
    loginWithGoogle,
    fetchRemoteVaults,
    downloadRemoteVault,
  } = useSyncStore();

  const handleSyncClick = async () => {
    if (!isAuthenticated) {
      const ok = await loginWithGoogle();
      if (ok) {
        await fetchRemoteVaults();
        setView('remote-sync');
      }
    } else {
      await fetchRemoteVaults();
      setView('remote-sync');
    }
  };

  const handleDownloadRemoteVault = async (remoteVault: { id: string; name: string }) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('vaultManager.remote.chooseFolder', { name: remoteVault.name }),
      });
      if (selected && typeof selected === 'string') {
        const destPath = `${selected.replace(/\/+$/, '')}/${remoteVault.name}`;
        setDownloadingVaultId(remoteVault.id);
        const success = await downloadRemoteVault(remoteVault.id, destPath);
        setDownloadingVaultId(null);
        if (success) {
          await setVault(destPath);
          onClose();
        }
      }
    } catch (err) {
      setDownloadingVaultId(null);
      console.error('Error al descargar bóveda remota:', err);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setView('main');
    }
  }, [isOpen]);

  // Window maximize detection
  useEffect(() => {
    try {
      const win = getCurrentWindow();
      win.isMaximized().then(setIsMaximized).catch(() => undefined);
      const unlisten = win.onResized(() => {
        win.isMaximized().then(setIsMaximized).catch(() => undefined);
      });
      return () => {
        unlisten.then((fn) => fn()).catch(() => undefined);
      };
    } catch {
      /* Not in Tauri */
    }
  }, []);

  if (!isOpen) return null;

  const handleOpenFolderAsVault = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('vaultManager.options.openFolder'),
      });
      if (selected && typeof selected === 'string') {
        await setVault(selected);
        onClose();
      }
    } catch (err) {
      console.error('Error opening folder as vault:', err);
    }
  };

  const handleCreateVaultSubmit = async (vaultName: string, location: string) => {
    const fullPath = `${location.replace(/\/+$/, '')}/${vaultName}`;
    await invoke('create_folder', { folderPath: fullPath });
    await setVault(fullPath);
    onClose();
  };

  const handleShowInExplorer = async (path: string) => {
    try {
      await invoke('open_path', { path });
    } catch (err) {
      console.error('Error opening path in explorer:', err);
    }
  };

  const handleMoveVault = async (path: string, name: string) => {
    try {
      const selectedParent = await open({
        directory: true,
        multiple: false,
        title: t('vaultManager.dialogs.moveDest'),
      });
      if (selectedParent && typeof selectedParent === 'string') {
        const newPath = `${selectedParent.replace(/\/+$/, '')}/${name}`;
        await invoke('rename_item', { oldPath: path, newPath });
        updateRecentVault(path, newPath, name);
        if (activeVault === path) {
          await setVault(newPath);
        }
      }
    } catch (err) {
      console.error('Error moving vault:', err);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--background-modifier-cover)] flex items-center justify-center select-none"
      style={{ zIndex: 350 }}
      onClick={onClose}
    >
      <div
        className="w-[800px] h-[580px] flex rounded-[10px] overflow-hidden border border-obsidian-border bg-obsidian-sidebar shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top titlebar drag region */}
        <div
          className="absolute top-0 left-0 right-0 h-10 z-0"
          data-tauri-drag-region
          onDoubleClick={async () => {
            try {
              await getCurrentWindow().toggleMaximize();
            } catch {
              await invoke('toggle_maximize_window').catch(() => {});
            }
          }}
        />
        {/* Left Column: Recent Vaults List */}
        <RecentVaultsList
          vaults={recentVaults}
          activeVault={activeVault}
          onSelectVault={(path) => {
            setVault(path);
            onClose();
          }}
          onShowInExplorer={handleShowInExplorer}
          onMoveVault={handleMoveVault}
          onRemoveFromList={(path) => removeRecentVault(path)}
        />

        {/* Right Column: Brand Header + Actions */}
        <main className="flex-1 bg-obsidian-sidebar flex flex-col items-center justify-center p-8 px-11 relative">
          {/* Window controls in top right */}
          <div className="absolute top-3 right-3.5 flex items-center gap-1.5 z-10">
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await getCurrentWindow().minimize();
                } catch {
                  await invoke('minimize_window').catch(() => {});
                }
              }}
              className="p-1.5 text-obsidian-muted hover:text-obsidian-text hover:bg-[var(--interactive-hover)] rounded transition-colors cursor-pointer"
              title={t('window.minimize')}
            >
              <Minus size={14} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await getCurrentWindow().toggleMaximize();
                  setIsMaximized(await getCurrentWindow().isMaximized());
                } catch {
                  await invoke('toggle_maximize_window').catch(() => {});
                  setIsMaximized((prev) => !prev);
                }
              }}
              className="p-1.5 text-obsidian-muted hover:text-obsidian-text hover:bg-[var(--interactive-hover)] rounded transition-colors cursor-pointer"
              title={isMaximized ? t('window.restore') : t('window.maximize')}
            >
              {isMaximized ? (
                <Copy size={12} strokeWidth={1.6} />
              ) : (
                <Square size={12} strokeWidth={1.6} />
              )}
            </button>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await getCurrentWindow().close();
                } catch {
                  await invoke('close_window').catch(() => {});
                }
              }}
              className="p-1.5 text-obsidian-muted hover:text-obsidian-text hover:bg-[#e81123] rounded transition-colors cursor-pointer"
              title={t('common.close')}
            >
              <X size={15} strokeWidth={1.6} />
            </button>
          </div>

          {/* Central Brand Header */}
          <div className="flex flex-col items-center mb-7">
            <div className="w-[84px] h-[84px] mb-3 flex items-center justify-center">
              <UranoLogo size={84} />
            </div>
            <h1 className="text-[28px] font-bold text-obsidian-text tracking-tight leading-none">
              {t('vaultManager.title')}
            </h1>
            <p className="text-[13px] text-obsidian-muted mt-1.5">
              {t('vaultManager.version')}
            </p>
          </div>

          {/* Action Card, Create Form, or Remote Sync Browser */}
          {view === 'main' ? (
            <VaultActionsCard
              onCreateClick={() => setView('create')}
              onOpenFolderClick={handleOpenFolderAsVault}
              onSyncClick={handleSyncClick}
            />
          ) : view === 'create' ? (
            <div className="w-full max-w-[460px] bg-obsidian-bg border border-obsidian-border rounded-[10px] px-5 py-1">
              <CreateVaultForm
                onBack={() => setView('main')}
                onSubmit={handleCreateVaultSubmit}
              />
            </div>
          ) : (
            <div className="w-full max-w-[480px] bg-obsidian-bg border border-obsidian-border rounded-[10px] p-5 flex flex-col">
              {/* Header with Back button and user info */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-obsidian-border">
                <button
                  type="button"
                  onClick={() => setView('main')}
                  className="flex items-center gap-1.5 text-xs text-obsidian-muted hover:text-obsidian-text transition-colors cursor-pointer"
                >
                  <ArrowLeft size={14} />
                  <span>{t('vaultManager.createForm.back')}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-obsidian-muted truncate max-w-[200px]">
                    {userEmail || user?.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchRemoteVaults()}
                    disabled={isLoadingVaults}
                    className="p-1 text-obsidian-muted hover:text-obsidian-text transition-colors cursor-pointer disabled:opacity-50"
                    title={t('common.refresh')}
                  >
                    <RefreshCw size={13} className={isLoadingVaults ? 'animate-spin text-orange-400' : ''} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[14px] font-semibold text-obsidian-text">
                  {t('vaultManager.remote.title')}
                </h2>
              </div>

              {/* Vaults List */}
              <div className="max-h-[240px] overflow-y-auto flex flex-col gap-2 pr-1">
                {isLoadingVaults ? (
                  <div className="py-10 flex flex-col items-center justify-center gap-2 text-obsidian-muted">
                    <Loader2 size={24} className="animate-spin text-orange-400" />
                    <span className="text-xs">
                      {t('vaultManager.remote.loading')}
                    </span>
                  </div>
                ) : remoteVaults.length === 0 ? (
                  <div className="py-8 text-center text-xs text-obsidian-muted flex flex-col items-center gap-2">
                    <Cloud size={28} className="text-obsidian-faint" />
                    <p>
                      {t('vaultManager.remote.empty')}
                    </p>
                    <button
                      type="button"
                      onClick={() => setView('create')}
                      className="mt-2 text-xs text-orange-400 hover:underline cursor-pointer"
                    >
                      {t('vaultManager.options.createVault')}
                    </button>
                  </div>
                ) : (
                  remoteVaults.map((rv) => (
                    <div
                      key={rv.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-obsidian-border bg-obsidian-sidebar hover:border-orange-500/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded bg-obsidian-bg text-orange-400 shrink-0">
                          <Folder size={18} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13px] font-medium text-obsidian-text truncate">
                            {rv.name}
                          </span>
                          {rv.modified_time && (
                            <span className="text-[11px] text-obsidian-muted">
                              {t('vaultManager.remote.modified', {
                                time: new Date(rv.modified_time).toLocaleString([], {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                }),
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={downloadingVaultId === rv.id}
                        onClick={() => handleDownloadRemoteVault(rv)}
                        className="bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] border border-obsidian-border text-obsidian-text font-medium text-xs rounded px-3 py-1.5 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {downloadingVaultId === rv.id ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            <span>{t('vaultManager.remote.downloading')}</span>
                          </>
                        ) : (
                          <span>{t('vaultManager.options.buttonConnect')}</span>
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
