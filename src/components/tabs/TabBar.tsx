import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  ChevronDown,
  X,
  LayoutDashboard,
  LayoutList,
  GitFork,
  PanelRight,
  Pin,
  PinOff,
  Columns,
  Rows,
} from 'lucide-react';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { WindowControls } from '../layout/WindowControls';
import { useT } from '../../stores/localeStore';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

export interface TabItem {
  id: string;
  type: 'note' | 'graph' | 'canvas' | 'base' | 'image';
  filePath?: string;
  title: string;
  isDirty?: boolean;
  pinned?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs?: (tabId: string) => void;
  onCloseAllTabs?: () => void;
  onNewTab: () => void;
  onTogglePin?: (tabId: string) => void;
  onToggleRightSidebar?: () => void;
  rightSidebarVisible?: boolean;
  onSplitRight?: (tabId: string) => void;
  onSplitDown?: (tabId: string) => void;
}

/** Obsidian exposes the view type through the `data-type` attribute of the tab. */
const TAB_VIEW_TYPE: Record<TabItem['type'], string> = {
  note: 'markdown',
  canvas: 'canvas',
  base: 'bases',
  graph: 'graph',
  image: 'image',
};

/**
 * Obsidian only renders an icon for special views. Markdown notes keep a
 * clean title (the icon element is hidden through CSS, exactly like
 * `.workspace-tab-header[data-type="markdown"]`).
 */
const TAB_ICON: Partial<Record<TabItem['type'], React.ReactNode>> = {
  canvas: <LayoutDashboard size={14} />,
  base: <LayoutList size={14} />,
  graph: <GitFork size={14} />,
};

interface MenuState {
  x: number;
  y: number;
  items: MenuItemData[];
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onNewTab,
  onTogglePin,
  onToggleRightSidebar,
  rightSidebarVisible,
  onSplitRight,
  onSplitDown,
}) => {
  const t = useT();
  const [contextMenu, setContextMenu] = useState<MenuState | null>(null);
  const [tabListMenu, setTabListMenu] = useState<MenuState | null>(null);
  const tabListButtonRef = useRef<HTMLSpanElement>(null);

  const activeIndex = useMemo(
    () => tabs.findIndex((t) => t.id === activeTabId),
    [tabs, activeTabId]
  );

  /** Graph tabs resolve their label at render time so it follows the active language. */
  const tabLabel = (tab: TabItem) => (tab.type === 'graph' ? t('tabs.graphView') : tab.title);

  const closeMenus = useCallback(() => {
    setContextMenu(null);
    setTabListMenu(null);
  }, []);

  /* --------------------------------------------------------------- *
   * Right click menu of a single tab
   * --------------------------------------------------------------- */
  const handleTabContextMenu = (e: React.MouseEvent, tab: TabItem) => {
    e.preventDefault();
    e.stopPropagation();

    const items: MenuItemData[] = [
      {
        title: t('common.close'),
        icon: <X size={14} />,
        action: () => onCloseTab(tab.id),
      },
      {
        title: t('tabs.closeOthers'),
        icon: <X size={14} />,
        action: () => onCloseOtherTabs?.(tab.id),
      },
      {
        title: t('tabs.closeAll'),
        icon: <X size={14} />,
        action: () => onCloseAllTabs?.(),
      },
      { type: 'separator' },
      {
        title: tab.pinned ? t('tabs.unpin') : t('tabs.pin'),
        icon: tab.pinned ? <PinOff size={14} /> : <Pin size={14} />,
        action: () => onTogglePin?.(tab.id),
      },
      { type: 'separator' },
      {
        title: t('tabs.splitRight'),
        icon: <Columns size={14} />,
        action: () => onSplitRight?.(tab.id),
      },
      {
        title: t('tabs.splitDown'),
        icon: <Rows size={14} />,
        action: () => onSplitDown?.(tab.id),
      },
    ];

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  /* --------------------------------------------------------------- *
   * Chevron menu: every open tab + close actions
   * --------------------------------------------------------------- */
  const handleOpenTabListMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const items: MenuItemData[] = tabs.map((tab) => ({
      title: tabLabel(tab),
      icon: TAB_ICON[tab.type] ?? undefined,
      checked: tab.id === activeTabId,
      action: () => onSelectTab(tab.id),
    }));

    items.push({ type: 'separator' });
    items.push({
      title: t('tabs.closeOtherTabs'),
      icon: <X size={14} />,
      disabled: tabs.length < 2,
      action: () => onCloseOtherTabs?.(activeTabId),
    });
    items.push({
      title: t('tabs.closeAllTabs'),
      icon: <X size={14} />,
      disabled: tabs.length === 0,
      action: () => onCloseAllTabs?.(),
    });

    const rect = tabListButtonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left : e.clientX;
    const y = rect ? rect.bottom + 4 : e.clientY;
    setTabListMenu({ x, y, items });
  };

  /* Close the menus when clicking anywhere else */
  useEffect(() => {
    if (!contextMenu && !tabListMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.menu')) return;
      closeMenus();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenus();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, tabListMenu, closeMenus]);

  return (
    <div className="workspace">
      <div className="workspace-tabs mod-top mod-root">
        <div
          className="workspace-tab-header-container"
          data-tauri-drag-region
          onDoubleClick={async (e) => {
            if (
              e.target === e.currentTarget ||
              (e.target as HTMLElement).classList.contains('workspace-tab-header-spacer')
            ) {
              try {
                await getCurrentWindow().toggleMaximize();
              } catch {
                await invoke('toggle_maximize_window').catch(() => {});
              }
            }
          }}
        >
          {/* Tabs ------------------------------------------------------ */}
          <div className="workspace-tab-header-container-inner">
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const isBeforeActive = activeIndex > 0 && index === activeIndex - 1;
              const label = tabLabel(tab);

              return (
                <div
                  key={tab.id}
                  className={[
                    'workspace-tab-header',
                    'tappable',
                    isActive ? 'is-active' : '',
                    isBeforeActive ? 'is-before-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-type={TAB_VIEW_TYPE[tab.type]}
                  title={label}
                  onClick={() => onSelectTab(tab.id)}
                  onAuxClick={(e) => {
                    /* middle click closes the tab (Obsidian behaviour) */
                    if (e.button === 1) {
                      e.preventDefault();
                      onCloseTab(tab.id);
                    }
                  }}
                  onContextMenu={(e) => handleTabContextMenu(e, tab)}
                >
                  <div className="workspace-tab-header-inner">
                    <div className="workspace-tab-header-inner-icon">
                      {TAB_ICON[tab.type] ?? null}
                    </div>
                    <div className="workspace-tab-header-inner-title">{label}</div>
                    <div className="workspace-tab-header-status-container">
                      {tab.isDirty && (
                        <div
                          className="workspace-tab-header-status-icon mod-dirty"
                          title={t('tabs.unsavedChanges')}
                        />
                      )}
                      {tab.pinned && (
                        <div
                          className="workspace-tab-header-status-icon mod-pinned"
                          title={t('tabs.pinnedTab')}
                        >
                          <Pin size={12} />
                        </div>
                      )}
                    </div>
                    {!tab.pinned && (
                      <div
                        className="workspace-tab-header-inner-close-button"
                        title={t('tabs.closeTab')}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseTab(tab.id);
                        }}
                      >
                        <X size={14} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* New tab (+) ----------------------------------------------- */}
          <div className="workspace-tab-header-new-tab">
            <span
              className="clickable-icon"
              title={t('tabs.newTab')}
              aria-label={t('tabs.newTabLabel')}
              onClick={onNewTab}
            >
              <Plus size={16} />
            </span>
          </div>

          {/* Empty rail: drag region of the native window --------------- */}
          <div
            className="workspace-tab-header-spacer"
            data-tauri-drag-region
            title={t('tabs.dragToMoveWindow')}
            onDoubleClick={async () => {
              try {
                await getCurrentWindow().toggleMaximize();
              } catch {
                await invoke('toggle_maximize_window').catch(() => {});
              }
            }}
          />

          {/* Tab list dropdown ------------------------------------------ */}
          <div className="workspace-tab-header-tab-list">
            <span
              ref={tabListButtonRef}
              className="clickable-icon"
              title={t('tabs.tabList')}
              aria-label={t('tabs.tabList')}
              onClick={handleOpenTabListMenu}
              onContextMenu={handleOpenTabListMenu}
            >
              <ChevronDown size={16} />
            </span>
          </div>

          {/* Right sidebar toggle -------------------------------------- */}
          {onToggleRightSidebar && (
            <div
              className={`sidebar-toggle-button mod-right${
                rightSidebarVisible ? ' is-active' : ''
              }`}
              title={t('tabs.toggleRightSidebar')}
              aria-label={t('tabs.toggleRightSidebar')}
              onClick={onToggleRightSidebar}
            >
              <PanelRight size={16} />
            </div>
          )}

          {/* Native window controls ------------------------------------- */}
          <WindowControls />
        </div>
      </div>

      {/* Menus --------------------------------------------------------- */}
      {contextMenu && (
        <ObsidianMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeMenus}
        />
      )}
      {tabListMenu && (
        <ObsidianMenu
          x={tabListMenu.x}
          y={tabListMenu.y}
          items={tabListMenu.items}
          onClose={closeMenus}
        />
      )}
    </div>
  );
};
