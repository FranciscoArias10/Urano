import React, { useState, useEffect } from 'react';
import { X, Minus, Square, Copy } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { UranoLogo } from '../common/UranoLogo';
import { useT } from '../../stores/localeStore';
import { useVaultStore } from '../../stores/vaultStore';
import { RecentVaultsList } from './RecentVaultsList';
import { VaultActionsCard } from './VaultActionsCard';
import { CreateVaultForm } from './CreateVaultForm';

export interface VaultManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSync?: () => void;
}

export const VaultManagerModal: React.FC<VaultManagerModalProps> = ({
  isOpen,
  onClose,
  onOpenSync,
}) => {
  const t = useT();
  const {
    activeVault,
    recentVaults,
    setVault,
    removeRecentVault,
    updateRecentVault,
  } = useVaultStore();

  const [view, setView] = useState<'main' | 'create'>('main');
  const [isMaximized, setIsMaximized] = useState(false);

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

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      /* noop */
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    } catch {
      /* noop */
    }
  };

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
      className="fixed inset-0 bg-black/70 flex items-center justify-center select-none"
      style={{ zIndex: 350 }}
      onClick={onClose}
    >
      <div
        className="w-[800px] h-[580px] flex rounded-[10px] overflow-hidden border border-[#2a2a2a] bg-[#161616] shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
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
        <main className="flex-1 bg-[#161616] flex flex-col items-center justify-center p-8 px-11 relative">
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
              className="p-1.5 text-[#888888] hover:text-[#e0e0e0] hover:bg-[#262626] rounded transition-colors cursor-pointer"
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
              className="p-1.5 text-[#888888] hover:text-[#e0e0e0] hover:bg-[#262626] rounded transition-colors cursor-pointer"
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
              className="p-1.5 text-[#888888] hover:text-white hover:bg-[#e81123] rounded transition-colors cursor-pointer"
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
            <h1 className="text-[28px] font-bold text-white tracking-tight leading-none">
              {t('vaultManager.title')}
            </h1>
            <p className="text-[13px] text-[#888888] mt-1.5">
              {t('vaultManager.version')}
            </p>
          </div>

          {/* Action Card or Create Form */}
          {view === 'main' ? (
            <VaultActionsCard
              onCreateClick={() => setView('create')}
              onOpenFolderClick={handleOpenFolderAsVault}
              onSyncClick={() => {
                onClose();
                onOpenSync?.();
              }}
            />
          ) : (
            <div className="w-full max-w-[460px] bg-[#1e1e1e] border border-[#2a2a2a] rounded-[10px] px-5 py-1">
              <CreateVaultForm
                onBack={() => setView('main')}
                onSubmit={handleCreateVaultSubmit}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
