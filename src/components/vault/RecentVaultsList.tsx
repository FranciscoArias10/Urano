import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { useT } from '../../stores/localeStore';
import { RecentVault } from '../../stores/vaultStore';
import { RecentVaultContextMenu } from './RecentVaultContextMenu';

export interface RecentVaultsListProps {
  vaults: RecentVault[];
  activeVault: string | null;
  onSelectVault: (path: string) => void;
  onShowInExplorer: (path: string) => void;
  onMoveVault: (path: string, name: string) => void;
  onRemoveFromList: (path: string) => void;
}

export const RecentVaultsList: React.FC<RecentVaultsListProps> = ({
  vaults,
  activeVault,
  onSelectVault,
  onShowInExplorer,
  onMoveVault,
  onRemoveFromList,
}) => {
  const t = useT();
  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const handleOpenMenu = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: Math.max(10, rect.right - 180),
    });
    setActiveMenuPath(path);
  };

  const activeVaultItem = vaults.find((v) => v.path === activeMenuPath);

  return (
    <aside className="w-[260px] bg-[#212121] border-r border-[#2c2c2c] p-3 flex flex-col shrink-0">
      <div className="text-[12px] font-semibold text-[#888888] uppercase tracking-wider px-2 py-1.5 mb-1">
        {t('vaultManager.recentVaults')}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-0.5 custom-scrollbar">
        {vaults.length === 0 ? (
          <div className="text-[12px] text-[#666666] italic px-2 py-4">
            {t('vaultManager.noRecentVaults')}
          </div>
        ) : (
          vaults.map((vault) => {
            const isActive = activeVault === vault.path;
            return (
              <div
                key={vault.path}
                onClick={() => onSelectVault(vault.path)}
                className={`group px-3 py-2.5 rounded-[6px] flex items-center justify-between cursor-pointer transition-colors ${
                  isActive ? 'bg-[#2b2b2b]' : 'hover:bg-[#282828]'
                }`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-[14px] font-medium text-[#e0e0e0] truncate group-hover:text-white">
                    {vault.name}
                  </span>
                  <span
                    className="text-[11.5px] text-[#888888] truncate max-w-[185px]"
                    title={vault.path}
                  >
                    {vault.path}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={(e) => handleOpenMenu(e, vault.path)}
                  className="p-1 rounded text-[#888888] hover:text-[#e0e0e0] hover:bg-[#333333] transition-colors shrink-0"
                  title={t('common.more')}
                >
                  <MoreVertical size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {activeMenuPath && menuPosition && activeVaultItem && (
        <RecentVaultContextMenu
          path={activeMenuPath}
          name={activeVaultItem.name}
          position={menuPosition}
          onClose={() => setActiveMenuPath(null)}
          onShowInExplorer={onShowInExplorer}
          onMoveVault={onMoveVault}
          onRemoveFromList={onRemoveFromList}
        />
      )}
    </aside>
  );
};
