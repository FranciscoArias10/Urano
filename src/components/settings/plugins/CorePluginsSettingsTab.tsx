import React, { useMemo, useState } from 'react';
import { PlusCircle, Search, Settings as SettingsIcon } from 'lucide-react';
import {
  CORE_PLUGIN_IDS,
  CorePluginId,
  useSettingsStore,
  useT,
} from '../../../stores/settingsStore';
import { useLocaleStore } from '../../../stores/localeStore';
import { SearchClearButton, SettingGroup, Toggle } from '../SettingControls';
import { CORE_PLUGIN_META } from '../settingsTabs';

const normalizeSearch = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export const CorePluginsSettingsTab: React.FC = () => {
  const t = useT();
  const language = useLocaleStore((s) => s.language) || 'es';
  const corePlugins = useSettingsStore((s) => s.settings.corePlugins);
  const toggleCorePlugin = useSettingsStore((s) => s.toggleCorePlugin);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const openHotkeysForPlugin = useSettingsStore((s) => s.openHotkeysForPlugin);

  const [filterQuery, setFilterQuery] = useState('');

  const sortedPlugins = useMemo(() => {
    return [...CORE_PLUGIN_IDS]
      .map((id: CorePluginId) => {
        const meta = CORE_PLUGIN_META[id];
        return {
          id,
          meta,
          name: t(meta.nameKey),
          desc: t(meta.descKey),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, language, { sensitivity: 'base' }));
  }, [t, language]);

  const filteredPlugins = useMemo(() => {
    const q = normalizeSearch(filterQuery.trim());
    if (!q) return sortedPlugins;
    return sortedPlugins.filter(
      (plugin) =>
        normalizeSearch(plugin.name).includes(q) ||
        normalizeSearch(plugin.desc).includes(q)
    );
  }, [sortedPlugins, filterQuery]);

  return (
    <div className="core-plugins-settings-tab">
      <div className="core-plugins-search-row setting-group-search">
        <div className="search-input-container">
          <span className="search-input-icon">
            <Search size={14} strokeWidth={2} />
          </span>
          <input
            type="search"
            enterKeyHint="search"
            spellCheck={false}
            placeholder={t('corePlugins.filterPlaceholder')}
            aria-label={t('corePlugins.filterPlaceholder')}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          {filterQuery && (
            <SearchClearButton
              label={t('modal.close')}
              onClick={() => setFilterQuery('')}
            />
          )}
        </div>
      </div>

      <SettingGroup
        id="core-plugins-list"
        className="mod-list"
      >
        {filteredPlugins.length === 0 ? (
          <div className="setting-empty-state">{t('corePlugins.noResults')}</div>
        ) : (
          filteredPlugins.map(({ id, meta, name, desc }) => {
            const isEnabled = Boolean(corePlugins[id]);
            return (
              <div
                key={id}
                id={`setting-plugin-${id}`}
                className="setting-item mod-toggle"
                data-setting-item
              >
                <div className="setting-item-info">
                  <div className="setting-item-name">{name}</div>
                  <div className="setting-item-description">{desc}</div>
                </div>
                <div className="setting-item-control">
                  {isEnabled && meta.hasHotkeys && (
                    <button
                      type="button"
                      className="clickable-icon extra-setting-button"
                      aria-label={t('corePlugins.hotkeys')}
                      title={t('corePlugins.hotkeys')}
                      onClick={() => openHotkeysForPlugin(`${name}:`)}
                    >
                      <PlusCircle size={16} strokeWidth={1.75} />
                    </button>
                  )}
                  {isEnabled && meta.hasSettings && meta.tabId && (
                    <button
                      type="button"
                      className="clickable-icon extra-setting-button"
                      aria-label={t('corePlugins.options')}
                      title={t('corePlugins.options')}
                      onClick={() => setActiveTab(meta.tabId!)}
                    >
                      <SettingsIcon size={16} strokeWidth={1.75} />
                    </button>
                  )}
                  <Toggle
                    value={isEnabled}
                    onChange={() => toggleCorePlugin(id)}
                    ariaLabel={name}
                  />
                </div>
              </div>
            );
          })
        )}
      </SettingGroup>
    </div>
  );
};

