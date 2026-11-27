import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Search, X, Plus, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import {
  useSettingsStore,
  useT,
  type PagePreviewContextKey,
} from '../../stores/settingsStore';
import { useLocaleStore } from '../../stores/localeStore';
import { HOTKEY_CATALOG } from '../../services/hotkeyRegistry';
import type { CommandItem } from '../palette/CommandPalette';
import {
  useSettingTabs,
  SettingTabDef,
  SettingGroupDef,
  SettingItemDef,
  SettingsSection,
} from './settingsTabs';
import { SettingGroup, SettingItem, SearchClearButton, Toggle } from './SettingControls';
import { useVaultStore } from '../../stores/vaultStore';
import { CssSnippetsModal } from './appearance/CssSnippetsModal';
import { CommunityThemesModal } from './appearance/CommunityThemesModal';
import { FontPickerModal, FontTarget } from './appearance/FontPickerModal';
import { RibbonConfigModal } from './interface/RibbonConfigModal';
import { ExcludedFilesModal } from './ExcludedFilesModal';
import { FileRecoveryModal } from '../recovery/FileRecoveryModal';
import { useNoticeStore } from '../common/Notice';
import { HotkeysSettingsTab } from './hotkeys/HotkeysSettingsTab';
import { CorePluginsSettingsTab } from './plugins/CorePluginsSettingsTab';
import './settingsStyles.css';

/* ----------------------------------------------------------------------------
 * Urano 1.14.4 Settings modal (`.modal.mod-settings.mod-sidebar-layout`)
 * rebuilt for Urano. DOM/class structure follows the REA extraction of
 * urano.asar/app.js (class `doe` = SettingsModal) — see settingsStyles.css.
 * ------------------------------------------------------------------------- */

export interface SettingsModalProps {
  standalone?: boolean;
  commands?: CommandItem[];
  onOpenHelp?: () => void;
  onOpenLocalesFolder?: () => void;
  onOpenSyncLogs?: () => void;
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PAGE_PREVIEW_CONTEXT_KEYS: PagePreviewContextKey[] = [
  'search',
  'preview',
  'editor',
  'tabHeader',
  'fileExplorer',
  'properties',
  'bookmarks',
  'outline',
  'bases',
  'graph',
];

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
  standalone = false,
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

  const { activeVault } = useVaultStore();
  const vaultPath = useSettingsStore((s) => s.vaultPath) || activeVault || '';

  const [query, setQuery] = useState('');
  const [groupScrolled, setGroupScrolled] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [showCommunityThemesModal, setShowCommunityThemesModal] = useState(false);
  const [fontPickerState, setFontPickerState] = useState<{
    isOpen: boolean;
    target: FontTarget;
  }>({
    isOpen: false,
    target: 'interfaceFontFamily',
  });
  const [showRibbonModal, setShowRibbonModal] = useState(false);
  const [showExcludedFilesModal, setShowExcludedFilesModal] = useState(false);
  const [showPinCommandModal, setShowPinCommandModal] = useState(false);
  const [showFileRecoveryModal, setShowFileRecoveryModal] = useState(false);
  const [showClearRecoveryConfirm, setShowClearRecoveryConfirm] = useState(false);
  const [pinModalQuery, setPinModalQuery] = useState('');
  const [pinModalSelectedIndex, setPinModalSelectedIndex] = useState(0);
  const [draggedPinnedIdx, setDraggedPinnedIdx] = useState<number | null>(null);
  const [pagePreviewFilter, setPagePreviewFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const navContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinModalInputRef = useRef<HTMLInputElement>(null);
  const pagePreviewFilterInputRef = useRef<HTMLInputElement>(null);

  const pinnedCommands = useSettingsStore((s) => s.settings.pinnedCommands) || [];
  const pinCommand = useSettingsStore((s) => s.pinCommand);
  const unpinCommand = useSettingsStore((s) => s.unpinCommand);
  const movePinnedCommand = useSettingsStore((s) => s.movePinnedCommand);
  const clearAllSnapshots = useSettingsStore((s) => s.clearAllSnapshots);
  const pagePreviewRequireCtrl = useSettingsStore(
    (s) => s.settings.pagePreviewRequireCtrl
  );
  const setPagePreviewRequireCtrl = useSettingsStore(
    (s) => s.setPagePreviewRequireCtrl
  );
  const quickSwitcherShowExistingOnly = useSettingsStore(
    (s) => s.settings.quickSwitcherShowExistingOnly
  );
  const quickSwitcherShowAttachments = useSettingsStore(
    (s) => s.settings.quickSwitcherShowAttachments
  );
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showNotice = useNoticeStore((s) => s.showNotice);
  const currentLang =
    useLocaleStore((s) => s.locale) || useSettingsStore((s) => s.settings.language) || 'es';
  const isEs = currentLang.toLowerCase().startsWith('es');

  const catalogCommands = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    if (commands && commands.length > 0) {
      for (const cmd of commands) {
        if (!byId.has(cmd.id)) {
          byId.set(cmd.id, { id: cmd.id, name: cmd.name });
        }
      }
    } else {
      for (const cmd of HOTKEY_CATALOG) {
        if (!byId.has(cmd.id)) {
          byId.set(cmd.id, { id: cmd.id, name: isEs ? cmd.nameEs : cmd.nameEn });
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, currentLang, { sensitivity: 'base' })
    );
  }, [commands, isEs, currentLang]);

  const commandNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const cmd of catalogCommands) {
      map.set(cmd.id, cmd.name);
    }
    return map;
  }, [catalogCommands]);

  const pinnedSet = useMemo(() => new Set(pinnedCommands), [pinnedCommands]);

  const availableCommandsToPin = useMemo(
    () => catalogCommands.filter((cmd) => !pinnedSet.has(cmd.id)),
    [catalogCommands, pinnedSet]
  );

  const filteredCommandsToPin = useMemo(() => {
    const q = normalize(pinModalQuery.trim());
    if (!q) return availableCommandsToPin;
    return availableCommandsToPin.filter(
      (cmd) => normalize(cmd.name).includes(q) || cmd.id.toLowerCase().includes(q)
    );
  }, [availableCommandsToPin, pinModalQuery]);

  const filteredPagePreviewContexts = useMemo(() => {
    const q = normalize(pagePreviewFilter.trim());
    if (!q) return PAGE_PREVIEW_CONTEXT_KEYS;
    return PAGE_PREVIEW_CONTEXT_KEYS.filter((contextKey) =>
      normalize(t(`pagePreview.${contextKey}`)).includes(q)
    );
  }, [pagePreviewFilter, t]);

  useEffect(() => {
    if (!showPinCommandModal) return;
    setPinModalQuery('');
    setPinModalSelectedIndex(0);
    const id = window.setTimeout(() => pinModalInputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [showPinCommandModal]);

  // Close handler: closes native window if in standalone mode, otherwise closes integrated modal
  const handleClose = useCallback(() => {
    if (standalone) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().close())
        .catch(() => window.close());
    } else {
      closeSettings();
    }
  }, [standalone, closeSettings]);

  // Read initial tab from URL params if standalone
  useEffect(() => {
    if (standalone && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab) {
        setActiveTab(tab);
      }
    }
  }, [standalone, setActiveTab]);

  // Listen for tab switch events from Tauri backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        listen<string>('urano:set-settings-tab', (event) => {
          if (event.payload) {
            setActiveTab(event.payload);
          }
        }).then((fn) => {
          unlisten = fn;
        });
      })
      .catch(() => {});
    return () => {
      if (unlisten) unlisten();
    };
  }, [setActiveTab]);

  useEffect(() => {
    const handler = () => setShowSnippetsModal(true);
    window.addEventListener('urano:open-css-snippets', handler);
    return () => window.removeEventListener('urano:open-css-snippets', handler);
  }, []);

  useEffect(() => {
    const handler = () => setShowCommunityThemesModal(true);
    window.addEventListener('urano:open-community-themes', handler);
    return () => window.removeEventListener('urano:open-community-themes', handler);
  }, []);

  useEffect(() => {
    const handler = () => setShowRibbonModal(true);
    window.addEventListener('urano:open-ribbon-config', handler);
    return () => window.removeEventListener('urano:open-ribbon-config', handler);
  }, []);

  useEffect(() => {
    const handler = () => setShowExcludedFilesModal(true);
    window.addEventListener('urano:open-excluded-files', handler);
    return () => window.removeEventListener('urano:open-excluded-files', handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ target: FontTarget }>;
      setFontPickerState({
        isOpen: true,
        target: customEvent.detail?.target || 'interfaceFontFamily',
      });
    };
    window.addEventListener('urano:open-font-picker', handler);
    return () => window.removeEventListener('urano:open-font-picker', handler);
  }, []);

  useEffect(() => {
    if (!isOpen && !standalone) return;
    const onOpenRecovery = () => setShowFileRecoveryModal(true);
    const onConfirmClear = () => setShowClearRecoveryConfirm(true);
    window.addEventListener('urano:open-file-recovery', onOpenRecovery);
    window.addEventListener('urano:confirm-clear-file-recovery', onConfirmClear);
    return () => {
      window.removeEventListener('urano:open-file-recovery', onOpenRecovery);
      window.removeEventListener('urano:confirm-clear-file-recovery', onConfirmClear);
    };
  }, [isOpen, standalone]);

  const visibleTabs = useMemo(() => tabs.filter((tab) => !tab.hidden), [tabs]);
  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0];

  // Fall back to General when the active tab disappears (core plugin turned off).
  useEffect(() => {
    if ((isOpen || standalone) && activeTab && activeTab.id !== activeTabId) setActiveTab(activeTab.id);
  }, [isOpen, standalone, activeTab, activeTabId, setActiveTab]);

  // Reset search + focus the search box when opening (Urano: hasInitialInputFocus on desktop).
  useEffect(() => {
    if (!isOpen && !standalone) return;
    setQuery('');
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [isOpen, standalone]);

  // Escape closes top-most selector first, otherwise closes Settings; Mod+F focuses search.
  useEffect(() => {
    if (!isOpen && !standalone) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showClearRecoveryConfirm) {
          setShowClearRecoveryConfirm(false);
          return;
        }
        if (showFileRecoveryModal) {
          setShowFileRecoveryModal(false);
          return;
        }
        if (showPinCommandModal) {
          setShowPinCommandModal(false);
          return;
        }
        handleClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (showPinCommandModal) {
          pinModalInputRef.current?.focus();
          pinModalInputRef.current?.select();
          return;
        }
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    isOpen,
    standalone,
    showClearRecoveryConfirm,
    showFileRecoveryModal,
    showPinCommandModal,
    handleClose,
  ]);

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

  if ((!isOpen && !standalone) || !activeTab) return null;

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
      className={item.className}
      onClick={item.onClick}
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
    <div
      className={`urano-settings-root modal-container mod-dim${standalone ? ' mod-standalone-window' : ''}`}
      role="presentation"
    >
      <div className="modal-bg" onClick={handleClose} />

      <div
        className="modal mod-settings mod-sidebar-layout"
        role="dialog"
        aria-modal="true"
        aria-label={t('modal.title')}
      >
        {/* × — .modal-header-button.mod-raised.clickable-icon (only in integrated modal) */}
        {!standalone && (
          <button
            type="button"
            className="modal-header-button mod-raised clickable-icon"
            aria-label={t('modal.close')}
            title={`${t('modal.close')} (Esc)`}
            onClick={handleClose}
          >
            <X size={16} strokeWidth={2} />
          </button>
        )}

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
                  const orderedTabs =
                    section.id === 'core-plugins'
                      ? [...sectionTabs].sort((a, b) =>
                          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                        )
                      : sectionTabs;
                  return (
                    <div className="vertical-tab-header-group" key={section.id}>
                      <div className="vertical-tab-header-group-title">{section.title}</div>
                      <div
                        className="vertical-tab-header-group-items"
                        data-section={section.id}
                        role="tablist"
                      >
                        {orderedTabs.map((tab) => renderNavItem(tab))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ---------------- Content ---------------- */}
          <div className="vertical-tab-content-container" tabIndex={-1}>
            <div
              className="vertical-tab-content"
              ref={contentRef}
              key={isSearching ? '__search' : activeTab.id}
              data-tab-id={isSearching ? '__search' : activeTab.id}
            >
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
                ) : activeTab.id === 'hotkeys' ? (
                  <HotkeysSettingsTab commands={commands} />
                ) : activeTab.id === 'core-plugins' ? (
                  <CorePluginsSettingsTab />
                ) : activeTab.id === 'command-palette' ? (
                  <div className="command-palette-settings-tab">
                    <div className="setting-item-heading command-palette-pinned-heading">
                      <div className="setting-item-name command-palette-pinned-heading-title">
                        {t('commandPalette.pinned')}
                      </div>
                      <button
                        type="button"
                        className="clickable-icon"
                        title={t('commandPalette.pinCommand')}
                        aria-label={t('commandPalette.pinCommand')}
                        onClick={() => setShowPinCommandModal(true)}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <div className="setting-group">
                      <div className="setting-items">
                        {pinnedCommands.length === 0 ? (
                          <div className="setting-item command-palette-empty-item">
                            <div className="setting-item-info">
                              <div className="command-palette-empty-text">
                                {t('commandPalette.noCommandsFound')}
                              </div>
                            </div>
                          </div>
                        ) : (
                          pinnedCommands.map((cmdId, idx) => {
                            const label = commandNameById.get(cmdId) ?? cmdId;
                            return (
                              <div
                                key={cmdId}
                                className={`setting-item command-palette-pinned-item${
                                  draggedPinnedIdx === idx ? ' is-dragging' : ''
                                }`}
                                draggable
                                onDragStart={(e) => {
                                  setDraggedPinnedIdx(idx);
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', String(idx));
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'move';
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedPinnedIdx !== null && draggedPinnedIdx !== idx) {
                                    movePinnedCommand(draggedPinnedIdx, idx);
                                  }
                                  setDraggedPinnedIdx(null);
                                }}
                                onDragEnd={() => setDraggedPinnedIdx(null)}
                              >
                                <div className="setting-item-info command-palette-pinned-info">
                                  <span className="command-palette-drag-handle" aria-hidden="true">
                                    <GripVertical size={14} />
                                  </span>
                                  <div className="setting-item-name">{label}</div>
                                </div>
                                <div className="setting-item-control command-palette-pinned-controls">
                                  <button
                                    type="button"
                                    className="clickable-icon"
                                    disabled={idx === 0}
                                    title={t('commandPalette.moveUp')}
                                    aria-label={t('commandPalette.moveUp')}
                                    onClick={() => movePinnedCommand(idx, idx - 1)}
                                  >
                                    <ArrowUp size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="clickable-icon"
                                    disabled={idx === pinnedCommands.length - 1}
                                    title={t('commandPalette.moveDown')}
                                    aria-label={t('commandPalette.moveDown')}
                                    onClick={() => movePinnedCommand(idx, idx + 1)}
                                  >
                                    <ArrowDown size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="clickable-icon"
                                    title={t('commandPalette.unpin')}
                                    aria-label={t('commandPalette.unpin')}
                                    onClick={() => unpinCommand(cmdId)}
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : activeTab.id === 'page-preview' ? (
                  <div className="page-preview-settings-tab">
                    <div className="setting-item setting-item-heading page-preview-settings-heading">
                      <div className="setting-item-info">
                        <div className="setting-item-name">{t('pagePreview.heading')}</div>
                      </div>
                    </div>
                    <div className="setting-group">
                      <div className="setting-items">
                        <div className="setting-item page-preview-filter-row">
                          <div className="search-input-container page-preview-filter-input-wrap">
                            <span className="search-input-icon">
                              <Search size={15} strokeWidth={2} />
                            </span>
                            <input
                              ref={pagePreviewFilterInputRef}
                              type="text"
                              spellCheck={false}
                              placeholder={t('pagePreview.filterPlaceholder')}
                              value={pagePreviewFilter}
                              onChange={(e) => setPagePreviewFilter(e.target.value)}
                            />
                            {pagePreviewFilter && (
                              <SearchClearButton
                                label={t('modal.close')}
                                onClick={() => {
                                  setPagePreviewFilter('');
                                  pagePreviewFilterInputRef.current?.focus();
                                }}
                              />
                            )}
                          </div>
                        </div>
                        {filteredPagePreviewContexts.length === 0 ? (
                          <div className="setting-item page-preview-empty-row">
                            <div className="setting-item-info">
                              <div className="setting-item-description">
                                {t('pagePreview.noResults')}
                              </div>
                            </div>
                          </div>
                        ) : (
                          filteredPagePreviewContexts.map((contextKey) => {
                            const label = t(`pagePreview.${contextKey}`);
                            return (
                              <div
                                key={contextKey}
                                className="setting-item mod-toggle"
                                data-page-preview-setting={contextKey}
                              >
                                <div className="setting-item-info">
                                  <div className="setting-item-name">{label}</div>
                                </div>
                                <div className="setting-item-control">
                                  <Toggle
                                    value={Boolean(pagePreviewRequireCtrl?.[contextKey])}
                                    onChange={(val) => setPagePreviewRequireCtrl(contextKey, val)}
                                    ariaLabel={label}
                                  />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : activeTab.id === 'switcher' ? (
                  <SettingGroup id="switcher-options">
                    <SettingItem
                      id="setting-switcher-existing"
                      name={t('quickSwitcher.showExisting')}
                      desc={t('quickSwitcher.showExistingDesc')}
                    >
                      <Toggle
                        value={quickSwitcherShowExistingOnly}
                        onChange={(val) => setSetting('quickSwitcherShowExistingOnly', val)}
                        ariaLabel={t('quickSwitcher.showExisting')}
                      />
                    </SettingItem>
                    <SettingItem
                      id="setting-switcher-attachments"
                      name={t('quickSwitcher.showAttachments')}
                      desc={t('quickSwitcher.showAttachmentsDesc')}
                    >
                      <Toggle
                        value={quickSwitcherShowAttachments}
                        onChange={(val) => setSetting('quickSwitcherShowAttachments', val)}
                        ariaLabel={t('quickSwitcher.showAttachments')}
                      />
                    </SettingItem>
                  </SettingGroup>
                ) : (
                  activeTab.groups.map((g) => renderGroup(g))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showSnippetsModal && (
        <CssSnippetsModal
          vaultPath={vaultPath}
          isOpen={showSnippetsModal}
          onClose={() => setShowSnippetsModal(false)}
        />
      )}

      {showCommunityThemesModal && (
        <CommunityThemesModal
          vaultPath={vaultPath}
          isOpen={showCommunityThemesModal}
          onClose={() => setShowCommunityThemesModal(false)}
        />
      )}

      {fontPickerState.isOpen && (
        <FontPickerModal
          isOpen={fontPickerState.isOpen}
          target={fontPickerState.target}
          onClose={() => setFontPickerState((s) => ({ ...s, isOpen: false }))}
        />
      )}

      {showRibbonModal && (
        <RibbonConfigModal
          isOpen={showRibbonModal}
          onClose={() => setShowRibbonModal(false)}
        />
      )}

      {showExcludedFilesModal && (
        <ExcludedFilesModal
          isOpen={showExcludedFilesModal}
          onClose={() => setShowExcludedFilesModal(false)}
        />
      )}

      <FileRecoveryModal
        isOpen={showFileRecoveryModal}
        onClose={() => setShowFileRecoveryModal(false)}
      />

      {showClearRecoveryConfirm && (
        <div
          className="file-recovery-modal-backdrop"
          role="presentation"
          onClick={() => setShowClearRecoveryConfirm(false)}
        >
          <div
            className="file-recovery-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('fileRecovery.clearConfirmTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="file-recovery-confirm-title">
              {t('fileRecovery.clearConfirmTitle')}
            </div>
            <p className="file-recovery-confirm-message">
              {t('fileRecovery.clearConfirmMessage')}
            </p>
            <div className="file-recovery-confirm-actions">
              <button
                type="button"
                className="mod-cta-secondary"
                onClick={() => setShowClearRecoveryConfirm(false)}
              >
                {t('fileRecovery.clearConfirmCancel')}
              </button>
              <button
                type="button"
                className="mod-warning"
                onClick={() => {
                  clearAllSnapshots();
                  setShowClearRecoveryConfirm(false);
                  showNotice(t('fileRecovery.clearedNotice'), 2500, 'success');
                }}
              >
                {t('fileRecovery.clearConfirmAccept')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPinCommandModal && (
        <div
          className="command-palette-pin-modal-backdrop"
          role="presentation"
          onClick={() => setShowPinCommandModal(false)}
        >
          <div
            className="command-palette-pin-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('commandPalette.pinCommand')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="command-palette-pin-modal-input-row">
              <Search size={15} className="command-palette-pin-modal-search-icon" />
              <input
                ref={pinModalInputRef}
                type="text"
                autoFocus
                className="command-palette-pin-modal-input"
                placeholder={t('commandPalette.selectCommandPlaceholder')}
                value={pinModalQuery}
                onChange={(e) => {
                  setPinModalQuery(e.target.value);
                  setPinModalSelectedIndex(0);
                }}
                onKeyDown={(e) => {
                  const len = filteredCommandsToPin.length;
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowPinCommandModal(false);
                    return;
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (len > 0) {
                      const nextIdx = (pinModalSelectedIndex + 1) % len;
                      setPinModalSelectedIndex(nextIdx);
                      const targetEl = e.currentTarget
                        .closest('.command-palette-pin-modal')
                        ?.querySelector<HTMLElement>(`[data-pin-index="${nextIdx}"]`);
                      targetEl?.scrollIntoView({ block: 'nearest' });
                    }
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (len > 0) {
                      const nextIdx = (pinModalSelectedIndex - 1 + len) % len;
                      setPinModalSelectedIndex(nextIdx);
                      const targetEl = e.currentTarget
                        .closest('.command-palette-pin-modal')
                        ?.querySelector<HTMLElement>(`[data-pin-index="${nextIdx}"]`);
                      targetEl?.scrollIntoView({ block: 'nearest' });
                    }
                    return;
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const safeIdx = Math.min(pinModalSelectedIndex, Math.max(0, len - 1));
                    const picked = filteredCommandsToPin[safeIdx];
                    if (picked) {
                      pinCommand(picked.id);
                      setShowPinCommandModal(false);
                    }
                  }
                }}
              />
              {pinModalQuery && (
                <SearchClearButton
                  label={t('modal.close')}
                  onClick={() => {
                    setPinModalQuery('');
                    setPinModalSelectedIndex(0);
                    pinModalInputRef.current?.focus();
                  }}
                />
              )}
            </div>
            <div className="command-palette-pin-modal-list" role="listbox">
              {filteredCommandsToPin.length === 0 ? (
                <div className="command-palette-pin-modal-empty">
                  {t('commandPalette.noCommandsFound')}
                </div>
              ) : (
                filteredCommandsToPin.map((cmd, idx) => {
                  const safeSelected = Math.min(
                    pinModalSelectedIndex,
                    filteredCommandsToPin.length - 1
                  );
                  const isSelected = idx === safeSelected;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-pin-index={idx}
                      className={`command-palette-pin-modal-item${
                        isSelected ? ' is-selected' : ''
                      }`}
                      onMouseEnter={() => setPinModalSelectedIndex(idx)}
                      onClick={() => {
                        pinCommand(cmd.id);
                        setShowPinCommandModal(false);
                      }}
                    >
                      <span className="command-palette-pin-modal-item-name">{cmd.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
