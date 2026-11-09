import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Keyboard, X, PlusCircle, RotateCcw } from 'lucide-react';
import { useSettingsStore, useT } from '../../../stores/settingsStore';
import { useLocaleStore } from '../../../stores/localeStore';
import type { CommandItem } from '../../palette/CommandPalette';
import {
  HOTKEY_CATALOG,
  getActiveHotkeys,
  formatHotkeyFromEvent,
  HotkeyCommand,
} from '../../../services/hotkeyRegistry';

export interface HotkeysSettingsTabProps {
  commands?: CommandItem[];
}

type FilterPillType = 'all' | 'assigned' | 'custom' | 'unassigned';

export const HotkeysSettingsTab: React.FC<HotkeysSettingsTabProps> = ({ commands }) => {
  const t = useT();
  const currentLang = useLocaleStore((s) => s.locale) || useSettingsStore((s) => s.settings.language) || 'es';
  const isEs = currentLang.toLowerCase().startsWith('es');

  const customHotkeys = useSettingsStore((s) => s.settings.hotkeys || {});
  const setHotkey = useSettingsStore((s) => s.setHotkey);
  const removeHotkey = useSettingsStore((s) => s.removeHotkey);
  const resetHotkey = useSettingsStore((s) => s.resetHotkey);

  const [searchText, setSearchText] = useState('');
  const [activeFilterPill, setActiveFilterPill] = useState<FilterPillType>('all');
  const [activeHotkeyFilter, setActiveHotkeyFilter] = useState<string | null>(null);
  const [isRecordingFilterKey, setIsRecordingFilterKey] = useState(false);
  const [recordingCmdId, setRecordingCmdId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Combine static catalog with any dynamic commands passed from App
  const allCommands = useMemo(() => {
    const list: HotkeyCommand[] = [...HOTKEY_CATALOG];
    const knownIds = new Set(list.map((c) => c.id));

    if (commands && commands.length > 0) {
      for (const cmd of commands) {
        if (!knownIds.has(cmd.id)) {
          list.push({
            id: cmd.id,
            nameEs: cmd.name,
            nameEn: cmd.name,
            defaultHotkeys: cmd.shortcut ? [cmd.shortcut.replace(/\+/g, ' + ')] : [],
          });
          knownIds.add(cmd.id);
        }
      }
    }

    return list;
  }, [commands]);

  // Global key listener for recording hotkeys
  useEffect(() => {
    if (!recordingCmdId && !isRecordingFilterKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        if (recordingCmdId) setRecordingCmdId(null);
        if (isRecordingFilterKey) setIsRecordingFilterKey(false);
        return;
      }

      const combo = formatHotkeyFromEvent(e);
      if (!combo) return; // Still pressing modifier only

      if (recordingCmdId) {
        setHotkey(recordingCmdId, [combo]);
        setRecordingCmdId(null);
      } else if (isRecordingFilterKey) {
        setActiveHotkeyFilter(combo);
        setIsRecordingFilterKey(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [recordingCmdId, isRecordingFilterKey, setHotkey]);

  // Filter and sort commands
  const filteredCommands = useMemo(() => {
    return allCommands
      .filter((cmd) => {
        const assigned = getActiveHotkeys(cmd.id, customHotkeys);
        const hasAssigned = assigned.length > 0;
        const isCustom = cmd.id in customHotkeys;

        // 1. Filter pill check
        if (activeFilterPill === 'assigned' && !hasAssigned) return false;
        if (activeFilterPill === 'custom' && !isCustom) return false;
        if (activeFilterPill === 'unassigned' && hasAssigned) return false;

        // 2. Hotkey recording filter check
        if (activeHotkeyFilter) {
          const matches = assigned.some(
            (hk) =>
              hk.toLowerCase().replace(/\s+/g, '') ===
              activeHotkeyFilter.toLowerCase().replace(/\s+/g, '')
          );
          if (!matches) return false;
        }

        // 3. Text search check
        if (searchText.trim()) {
          const query = searchText.trim().toLowerCase();
          const name = (isEs ? cmd.nameEs : cmd.nameEn).toLowerCase();
          const id = cmd.id.toLowerCase();
          const hotkeysStr = assigned.join(' ').toLowerCase();
          if (!name.includes(query) && !id.includes(query) && !hotkeysStr.includes(query)) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const nameA = isEs ? a.nameEs : a.nameEn;
        const nameB = isEs ? b.nameEs : b.nameEn;
        return nameA.localeCompare(nameB, currentLang);
      });
  }, [allCommands, customHotkeys, activeFilterPill, activeHotkeyFilter, searchText, isEs, currentLang]);

  return (
    <div className="hotkeys-settings-container flex flex-col w-full">
      {/* Search Header and Filter Recording */}
      <div className="hotkey-search-container mb-4">
        <div className="hotkey-search-input-wrapper relative flex items-center w-full bg-urano-secondary rounded-lg border border-urano-border focus-within:border-urano-accent transition-colors">
          <Search size={15} className="absolute left-3 text-urano-muted pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            className="w-full bg-transparent py-2 pl-9 pr-24 text-sm text-urano-text placeholder:text-urano-muted focus:outline-none"
            placeholder={t('hotkeys.filterPlaceholder') || 'Filtrar...'}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />

          <div className="absolute right-2 flex items-center gap-1.5">
            {isRecordingFilterKey ? (
              <span
                className="setting-hotkey mod-active animate-pulse text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--interactive-accent)', color: '#ffffff' }}
              >
                {t('hotkeys.pressKey') || 'Presione las teclas...'}
              </span>
            ) : activeHotkeyFilter ? (
              <span
                className="setting-hotkey mod-active inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--interactive-accent)', color: '#ffffff' }}
              >
                <span>{activeHotkeyFilter}</span>
                <button
                  type="button"
                  className="clickable-icon p-0.5 hover:opacity-80 rounded-full"
                  title={t('hotkeys.clearFilter') || 'Limpiar filtro'}
                  onClick={() => setActiveHotkeyFilter(null)}
                >
                  <X size={12} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="clickable-icon p-1 text-urano-muted hover:text-urano-text transition-colors rounded"
                title={t('hotkeys.filterByHotkey') || 'Filtrar por tecla'}
                onClick={() => setIsRecordingFilterKey(true)}
              >
                <Keyboard size={16} />
              </button>
            )}

            {searchText && (
              <button
                type="button"
                className="clickable-icon p-1 text-urano-muted hover:text-urano-text transition-colors rounded"
                title={t('hotkeys.clearFilter') || 'Limpiar filtro'}
                onClick={() => setSearchText('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* 4 Filter Pills */}
        <div className="hotkey-filter-pills flex items-center gap-2 mt-3">
          {(
            [
              { id: 'all', label: t('hotkeys.filterAll') || 'Todos' },
              { id: 'assigned', label: t('hotkeys.filterAssigned') || 'Asignados' },
              { id: 'custom', label: t('hotkeys.filterCustom') || 'Asignados por mí' },
              { id: 'unassigned', label: t('hotkeys.filterUnassigned') || 'No asignados' },
            ] as const
          ).map((pill) => {
            const isActive = activeFilterPill === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                className={`hotkey-filter-pill transition-all ${isActive ? 'is-active' : ''}`}
                style={{
                  borderRadius: '999px',
                  fontSize: '12px',
                  padding: '4px 12px',
                  backgroundColor: isActive ? 'var(--interactive-accent)' : 'transparent',
                  color: isActive ? 'var(--text-on-accent, #ffffff)' : 'var(--text-muted)',
                  border: isActive ? '1px solid transparent' : '1px solid var(--background-modifier-border)',
                }}
                onClick={() => setActiveFilterPill(pill.id)}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Commands List Card */}
      <div className="setting-group border border-urano-border rounded-lg overflow-hidden bg-urano-bg">
        {filteredCommands.length === 0 ? (
          <div className="p-8 text-center text-sm text-urano-muted">
            {t('hotkeys.noMatchingCommands') || 'No se encontraron comandos coincidentes.'}
          </div>
        ) : (
          filteredCommands.map((cmd) => {
            const assigned = getActiveHotkeys(cmd.id, customHotkeys);
            const isCustom = cmd.id in customHotkeys;
            const isRecording = recordingCmdId === cmd.id;
            const displayName = isEs ? cmd.nameEs : cmd.nameEn;

            return (
              <div
                key={cmd.id}
                className="setting-item mod-hotkey flex items-center justify-between px-4 py-3 border-b border-urano-border last:border-b-0 hover:bg-urano-hover/30 transition-colors"
              >
                {/* Command Name */}
                <div className="setting-item-info flex-1 mr-4">
                  <div className="setting-item-name text-sm font-medium text-urano-text">
                    {displayName}
                  </div>
                </div>

                {/* Right Control */}
                <div className="setting-item-control flex items-center gap-2 shrink-0">
                  {isRecording ? (
                    <span
                      className="setting-hotkey mod-active animate-pulse text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ backgroundColor: 'var(--interactive-accent)', color: '#ffffff' }}
                    >
                      {t('hotkeys.pressKey') || 'Presione las teclas...'}
                    </span>
                  ) : assigned.length > 0 ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {assigned.map((hk, idx) => (
                        <span
                          key={idx}
                          className="setting-hotkey inline-flex items-center gap-1.5 text-xs text-urano-text px-2.5 py-1 rounded-full border border-urano-border/60"
                          style={{
                            backgroundColor: 'var(--background-secondary)',
                            borderRadius: '999px',
                            padding: '3px 10px',
                            fontSize: '12px',
                          }}
                        >
                          <span>{hk}</span>
                          <button
                            type="button"
                            className="clickable-icon p-0.5 text-urano-muted hover:text-red-400 transition-colors rounded-full"
                            title={t('hotkeys.removeHotkey') || 'Eliminar atajo'}
                            onClick={() => removeHotkey(cmd.id, hk)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span
                      className="setting-hotkey mod-empty text-xs px-2.5 py-1 rounded-full"
                      style={{
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--background-secondary)',
                        borderRadius: '999px',
                        padding: '3px 10px',
                        fontSize: '12px',
                      }}
                    >
                      {t('hotkeys.blank') || 'Vacío'}
                    </span>
                  )}

                  {/* Restore Default Button if modified */}
                  {isCustom && (
                    <button
                      type="button"
                      className="clickable-icon p-1 text-urano-muted hover:text-urano-text transition-colors rounded"
                      title={t('hotkeys.restoreDefault') || 'Restablecer al atajo original'}
                      onClick={() => resetHotkey(cmd.id)}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}

                  {/* Add / Assign Hotkey Button */}
                  <button
                    type="button"
                    className="setting-add-hotkey-button clickable-icon p-1 text-urano-muted hover:text-urano-text transition-colors rounded"
                    title={t('hotkeys.customize') || 'Personalizar atajo de teclado'}
                    onClick={() => setRecordingCmdId(cmd.id)}
                  >
                    <PlusCircle size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
