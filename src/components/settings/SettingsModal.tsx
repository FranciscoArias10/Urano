import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useSettingsStore, useT } from '../../stores/settingsStore';
import type { CommandItem } from '../palette/CommandPalette';
import {
  useSettingTabs,
  SettingTabDef,
  SettingGroupDef,
  SettingItemDef,
  SettingsSection,
} from './settingsTabs';
import { SettingGroup, SettingItem, SearchClearButton } from './SettingControls';
import './settingsStyles.css';

/* ----------------------------------------------------------------------------
 * Obsidian 1.14.4 Settings modal (`.modal.mod-settings.mod-sidebar-layout`)
 * rebuilt for Urano. DOM/class structure follows the REA extraction of
 * obsidian.asar/app.js (class `doe` = SettingsModal) — see settingsStyles.css.
 * ------------------------------------------------------------------------- */

export interface SettingsModalProps {
  commands?: CommandItem[];
  onOpenHelp?: () => void;
  onOpenLocalesFolder?: () => void;
  onOpenSyncLogs?: () => void;
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function itemSearchText(item: SettingItemDef): string {
  const desc = typeof item.desc === 'string' ? item.desc : item.descText ?? '';
  return normalize(`${item.name} ${desc} ${(item.aliases ?? []).join(' ')}`);
}

/** Wraps every case-insensitive occurrence of `query` in a highlight span. */
function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const q = normalize(query);
  const haystack = normalize(text);
  if (haystack.length !== text.length) return text; // accents shifted offsets: skip highlight
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = haystack.indexOf(q, i);
  let key = 0;
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <span className="setting-search-highlight" key={key++}>
        {text.slice(idx, idx + q.length)}
      </span>
    );
    i = idx + q.length;
    idx = haystack.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

interface SearchMatch {
  tab: SettingTabDef;
  groups: SettingGroupDef[];
  count: number;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  commands,
  onOpenHelp,
  onOpenSyncLogs,
  onOpenLocalesFolder,
}) => {
  const t = useT();
  const isOpen = useSettingsStore((s) => s.isOpen);
  const activeTabId = useSettingsStore((s) => s.activeTabId);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const closeSettings = useSettingsStore((s) => s.closeSettings);

  const tabs = useSettingTabs({ commands, onOpenHelp, onOpenSyncLogs, onOpenLocalesFolder });

  const [query, setQuery] = useState('');
  const [groupScrolled, setGroupScrolled] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const navContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const visibleTabs = useMemo(() => tabs.filter((tab) => !tab.hidden), [tabs]);
  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0];

  // Fall back to General when the active tab disappears (core plugin turned off).
  useEffect(() => {
    if (isOpen && activeTab && activeTab.id !== activeTabId) setActiveTab(activeTab.id);
  }, [isOpen, activeTab, activeTabId, setActiveTab]);

  // Reset search + focus the search box when opening (Obsidian: hasInitialInputFocus on desktop).
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  // Escape closes, Mod+F focuses search (Obsidian `modalEl` keydown handler).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSettings();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, closeSettings]);

  // Scroll content to top when switching tabs.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeTab?.id, query]);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  const searchMatches = useMemo<SearchMatch[]>(() => {
    if (!isSearching) return [];
    const q = normalize(trimmedQuery);
    const results: SearchMatch[] = [];
    for (const tab of visibleTabs) {
      const tabNameMatch = normalize(tab.name).includes(q);
      const groups: SettingGroupDef[] = [];
      let count = 0;
      for (const group of tab.groups) {
        const items = tabNameMatch
          ? group.items
          : group.items.filter((item) => itemSearchText(item).includes(q));
        if (items.length) {
          groups.push({ ...group, items });
          count += items.length;
        }
      }
      if (groups.length) results.push({ tab, groups, count });
    }
    return results;
  }, [isSearching, trimmedQuery, visibleTabs]);

  if (!isOpen || !activeTab) return null;

  const sections: { id: SettingsSection; title: string }[] = [
    { id: 'options', title: t('sidebar.options') },
    { id: 'core-plugins', title: t('sidebar.corePlugins') },
  ];

  const focusNavItem = (delta: number, current: HTMLElement) => {
    const items = Array.from(
      navContainerRef.current?.querySelectorAll<HTMLElement>('.vertical-tab-nav-item') ?? []
    );
    const idx = items.indexOf(current);
    const next = items[(idx + delta + items.length) % items.length];
    next?.focus();
  };

  const renderNavItem = (tab: SettingTabDef, badge?: number, onActivate?: () => void) => (
    <div
      key={tab.id}
      className={`vertical-tab-nav-item tappable${tab.id === activeTab.id ? ' is-active' : ''}`}
      data-setting-id={tab.id}
      tabIndex={0}
      role="tab"
      aria-selected={tab.id === activeTab.id}
      onClick={() => {
        setActiveTab(tab.id);
        onActivate?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          e.preventDefault();
          setActiveTab(tab.id);
          onActivate?.();
        } else if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault();
          focusNavItem(1, e.currentTarget);
        } else if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault();
          focusNavItem(-1, e.currentTarget);
        } else if (e.key === '/') {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      <div className="vertical-tab-nav-item-icon">{tab.icon}</div>
      <div className="vertical-tab-nav-item-title">{highlight(tab.name, trimmedQuery)}</div>
      {badge !== undefined && <span className="vertical-tab-nav-item-count">{badge}</span>}
      <div className="vertical-tab-nav-item-chevron" />
    </div>
  );

  const renderItem = (item: SettingItemDef) => (
    <SettingItem
      key={item.id}
      id={`setting-${item.id}`}
      name={highlight(item.name, trimmedQuery)}
      desc={typeof item.desc === 'string' ? highlight(item.desc, trimmedQuery) : item.desc}
      icon={item.icon}
      vertical={item.vertical}
    >
      {item.control}
    </SettingItem>
  );

  const renderGroup = (group: SettingGroupDef, keyPrefix = '') => (
    <SettingGroup
      key={`${keyPrefix}${group.id}`}
      id={`${keyPrefix}${group.id}`}
      heading={group.heading}
      headingControl={group.headingControl}
      className={group.className}
    >
      {group.items.map(renderItem)}
    </SettingGroup>
  );

  const scrollToSearchGroup = (tabId: string) => {
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-search-tab="${tabId}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="urano-settings-root modal-container mod-dim" role="presentation">
      <div className="modal-bg" onClick={closeSettings} />

      <div
        className="modal mod-settings mod-sidebar-layout"
        role="dialog"
        aria-modal="true"
        aria-label={t('modal.title')}
      >
        {/* × — .modal-header-button.mod-raised.clickable-icon */}
        <button
          type="button"
          className="modal-header-button mod-raised clickable-icon"
          aria-label={t('modal.close')}
          title={`${t('modal.close')} (Esc)`}
          onClick={closeSettings}
        >
          <X size={16} strokeWidth={2} />
        </button>

        <div className="modal-header">
          <div className="modal-title" />
        </div>

        <div className="modal-content vertical-tabs-container">
          {/* ---------------- Sidebar ---------------- */}
          <div className="vertical-tab-header" tabIndex={-1}>
            <div className="setting-search-container">
              <div className="search-input-container mod-raised">
                <span className="search-input-icon">
                  <Search size={14} strokeWidth={2} />
                </span>
                <input
                  ref={searchRef}
                  type="search"
                  enterKeyHint="search"
                  spellCheck={false}
                  placeholder={t('sidebar.searchPlaceholder')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
                      e.preventDefault();
                      navContainerRef.current
                        ?.querySelector<HTMLElement>('.vertical-tab-nav-item')
                        ?.focus();
                    }
                  }}
                />
                {query && <SearchClearButton label={t('modal.close')} onClick={() => setQuery('')} />}
              </div>
            </div>

            {isSearching ? (
              <div className="setting-search-results" ref={navContainerRef}>
                {searchMatches.length === 0 && (
                  <div className="setting-search-empty">{t('search.noResults')}</div>
                )}
                {searchMatches.map((m) =>
                  renderNavItem(m.tab, m.count, () => scrollToSearchGroup(m.tab.id))
                )}
              </div>
            ) : (
              <div
                ref={navContainerRef}
                className={`vertical-tab-header-group-container${groupScrolled ? ' is-scrolled' : ''}`}
                onScroll={(e) => setGroupScrolled(e.currentTarget.scrollTop > 0)}
              >
                {sections.map((section) => {
                  const sectionTabs = visibleTabs.filter((tab) => tab.section === section.id);
                  if (!sectionTabs.length) return null;
                  return (
                    <div className="vertical-tab-header-group" key={section.id}>
                      <div className="vertical-tab-header-group-title">{section.title}</div>
                      <div
                        className="vertical-tab-header-group-items"
                        data-section={section.id}
                        role="tablist"
                      >
                        {sectionTabs.map((tab) => renderNavItem(tab))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---------------- Content ---------------- */}
          <div className="vertical-tab-content-container" tabIndex={-1}>
            <div className="vertical-tab-content" ref={contentRef} key={isSearching ? '__search' : activeTab.id}>
              <div className="vertical-tab-content-inner">
                {isSearching ? (
                  searchMatches.length === 0 ? (
                    <div className="setting-empty-state">{t('search.noResults')}</div>
                  ) : (
                    searchMatches.map((m) => (
                      <div className="setting-search-result-group" key={m.tab.id} data-search-tab={m.tab.id}>
                        <div className="setting-search-result-group-title">
                          <span className="vertical-tab-nav-item-icon">{m.tab.icon}</span>
                          {highlight(m.tab.name, trimmedQuery)}
                        </div>
                        {m.groups.map((g) => renderGroup(g, `${m.tab.id}-`))}
                      </div>
                    ))
                  )
                ) : (
                  activeTab.groups.map((g) => renderGroup(g))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
