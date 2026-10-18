import React, { useState } from 'react';
import {
  FileText,
  GitFork,
  X,
  Plus,
  XCircle,
  ArrowRight,
  Copy,
  LayoutDashboard,
  LayoutList,
} from 'lucide-react';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';

export interface TabItem {
  id: string;
  type: 'note' | 'graph' | 'canvas' | 'base';
  filePath?: string;
  title: string;
  isDirty?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseTabsToRight?: (tabId: string) => void;
  onDuplicateTab?: (tabId: string) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onDuplicateTab,
  onNewTab,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, tab: TabItem) => {
    e.preventDefault();
    e.stopPropagation();

    const items: MenuItemData[] = [
      {
        title: 'Cerrar',
        shortcut: 'Ctrl+W',
        icon: <X size={14} />,
        action: () => onCloseTab(tab.id),
      },
      {
        title: 'Cerrar las demás pestañas',
        icon: <XCircle size={14} />,
        disabled: tabs.length <= 1,
        action: () => onCloseOtherTabs?.(tab.id),
      },
      {
        title: 'Cerrar pestañas a la derecha',
        icon: <ArrowRight size={14} />,
        disabled: tabs.findIndex((t) => t.id === tab.id) === tabs.length - 1,
        action: () => onCloseTabsToRight?.(tab.id),
      },
      { type: 'separator' },
      {
        title: 'Duplicar en nueva pestaña',
        icon: <Copy size={14} />,
        action: () => onDuplicateTab?.(tab.id),
      },
    ];

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div className="workspace-tab-header-container select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab)}
            className={`workspace-tab-header ${isActive ? 'is-active' : ''}`}
            title={tab.filePath || tab.title}
          >
            {tab.type === 'graph' ? (
              <GitFork size={13} className={isActive ? 'text-orange-500' : 'text-stone-400'} />
            ) : tab.type === 'canvas' ? (
              <LayoutDashboard size={13} className={isActive ? 'text-orange-500' : 'text-stone-400'} />
            ) : tab.type === 'base' ? (
              <LayoutList size={13} className={isActive ? 'text-orange-500' : 'text-stone-400'} />
            ) : (
              <FileText size={13} className={isActive ? 'text-orange-500' : 'text-stone-400'} />
            )}

            <span className="workspace-tab-header-title truncate max-w-[140px]">
              {tab.title}
            </span>

            {tab.isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"
                title="Cambios sin guardar"
              />
            )}

            <button
              className="workspace-tab-header-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title="Cerrar pestaña"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      {/* Add New Note Tab Button */}
      <button
        onClick={onNewTab}
        className="h-7 w-7 flex items-center justify-center text-stone-400 hover:text-orange-400 hover:bg-stone-800/60 rounded mb-0.5 ml-1 transition-colors"
        title="Nueva nota (Ctrl+N)"
      >
        <Plus size={14} />
      </button>

      {/* Obsidian Context Menu for Tabs */}
      {contextMenu && (
        <ObsidianMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
