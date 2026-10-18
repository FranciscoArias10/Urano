import React from 'react';
import { FileText, GitFork, X, Plus } from 'lucide-react';

export interface TabItem {
  id: string;
  type: 'note' | 'graph';
  filePath?: string;
  title: string;
  isDirty?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) => {
  return (
    <div className="workspace-tab-header-container select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`workspace-tab-header ${isActive ? 'is-active' : ''}`}
            title={tab.filePath || tab.title}
          >
            {tab.type === 'graph' ? (
              <GitFork size={13} className={isActive ? 'text-orange-500' : 'text-stone-400'} />
            ) : (
              <FileText size={13} className={isActive ? 'text-orange-500' : 'text-stone-400'} />
            )}

            <span className="workspace-tab-header-title">
              {tab.title}
            </span>

            {tab.isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" title="Cambios sin guardar" />
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
    </div>
  );
};
