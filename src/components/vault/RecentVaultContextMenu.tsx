import React, { useEffect, useRef } from 'react';
import { FolderOpen, FolderInput, Trash2 } from 'lucide-react';
import { useT } from '../../stores/localeStore';

export interface RecentVaultContextMenuProps {
  path: string;
  name: string;
  position: { top: number; left: number };
  onClose: () => void;
  onShowInExplorer: (path: string) => void;
  onMoveVault: (path: string, name: string) => void;
  onRemoveFromList: (path: string) => void;
}

export const RecentVaultContextMenu: React.FC<RecentVaultContextMenuProps> = ({
  path,
  name,
  position,
  onClose,
  onShowInExplorer,
  onMoveVault,
  onRemoveFromList,
}) => {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 400,
      }}
      className="bg-obsidian-bg border border-obsidian-border rounded-[8px] p-1 min-w-[190px] shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onClose();
          onShowInExplorer(path);
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-obsidian-text hover:text-obsidian-text hover:bg-[var(--interactive-hover)] rounded-[5px] text-left transition-colors cursor-pointer"
      >
        <FolderOpen size={14} className="text-obsidian-muted" />
        <span>{t('vaultManager.menu.showInExplorer')}</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose();
          onMoveVault(path, name);
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-obsidian-text hover:text-obsidian-text hover:bg-[var(--interactive-hover)] rounded-[5px] text-left transition-colors cursor-pointer"
      >
        <FolderInput size={14} className="text-obsidian-muted" />
        <span>{t('vaultManager.menu.moveVault')}</span>
      </button>

      <div className="border-t border-obsidian-border my-1" />

      <button
        type="button"
        onClick={() => {
          onClose();
          onRemoveFromList(path);
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-[5px] text-left transition-colors cursor-pointer"
      >
        <Trash2 size={14} />
        <span>{t('vaultManager.menu.removeFromList')}</span>
      </button>
    </div>
  );
};
