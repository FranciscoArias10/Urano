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
    <aside className="w-[260px] bg-obsidian-sidebar border-r border-obsidian-border p-3 flex flex-col shrink-0">
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-0.5 custom-scrollbar">
        {vaults.length === 0 ? (
          <div className="text-[12px] text-obsidian-faint italic px-2 py-4">
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
                  isActive ? 'bg-[var(--interactive-normal)]' : 'hover:bg-[var(--interactive-hover)]'
                }`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-[14px] font-medium text-obsidian-text truncate group-hover:text-obsidian-text">
                    {vault.name}
                  </span>
                  <span
                    className="text-[11.5px] text-obsidian-muted truncate max-w-[185px]"
                    title={vault.path}
                  >
                    {vault.path}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={(e) => handleOpenMenu(e, vault.path)}
                  className="p-1 rounded text-obsidian-muted hover:text-obsidian-text hover:bg-[var(--interactive-hover)] transition-colors shrink-0"
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
