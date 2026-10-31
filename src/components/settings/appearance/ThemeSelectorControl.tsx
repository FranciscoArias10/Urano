import React, { useEffect, useState, useCallback } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, useT } from '../../../stores/settingsStore';
import { themeService } from '../../../services/themeService';
import type { InstalledTheme } from '../../../types/theme';
import { Dropdown, SettingButton } from '../SettingControls';

interface ThemeSelectorControlProps {
  vaultPath: string;
  onOpenManage: () => void;
  refreshTrigger?: number;
}

export const ThemeSelectorControl: React.FC<ThemeSelectorControlProps> = ({
  vaultPath,
  onOpenManage,
  refreshTrigger = 0,
}) => {
  const t = useT();
  const cssTheme = useSettingsStore((s) => s.settings.cssTheme);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const [themes, setThemes] = useState<InstalledTheme[]>([]);

  const loadThemes = useCallback(async () => {
    if (!vaultPath) {
      setThemes([]);
      return;
    }
    const list = await themeService.listThemes(vaultPath);
    setThemes(list);
  }, [vaultPath]);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes, refreshTrigger]);

  const handleOpenFolder = async () => {
    if (!vaultPath) return;
    try {
      await invoke('open_themes_folder', { vaultPath });
    } catch (e) {
      console.warn('Could not open themes folder:', e);
    }
  };

  const handleSelectTheme = (name: string) => {
    setSetting('cssTheme', name);
    void themeService.applyThemeByName(vaultPath, name);
  };

  const options = [
    { value: '', label: t('appearance.defaultTheme') },
    ...themes.map((th) => ({ value: th.name, label: th.name })),
  ];

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="extra-setting-button clickable-icon flex items-center justify-center p-1.5 text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors"
        aria-label={t('appearance.openThemesFolder')}
        title={t('appearance.openThemesFolder')}
        onClick={handleOpenFolder}
      >
        <FolderOpen size={16} />
      </button>

      <Dropdown<string>
        value={cssTheme}
        ariaLabel={t('appearance.themes')}
        options={options}
        onChange={handleSelectTheme}
      />

      <SettingButton onClick={onOpenManage}>
        {t('appearance.manageThemes')}
      </SettingButton>
    </div>
  );
};

interface InstalledThemesListProps {
  vaultPath: string;
  onThemeChanged?: () => void;
  refreshTrigger?: number;
}

export const InstalledThemesList: React.FC<InstalledThemesListProps> = ({
  vaultPath,
  onThemeChanged,
  refreshTrigger = 0,
}) => {
  const t = useT();
  const cssTheme = useSettingsStore((s) => s.settings.cssTheme);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const [themes, setThemes] = useState<InstalledTheme[]>([]);

  const loadThemes = useCallback(async () => {
    if (!vaultPath) {
      setThemes([]);
      return;
    }
    const list = await themeService.listThemes(vaultPath);
    setThemes(list);
  }, [vaultPath]);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes, refreshTrigger]);

  const handleUninstall = async (name: string) => {
    if (!vaultPath) return;
    try {
      await invoke('uninstall_theme', { vaultPath, themeName: name });
      if (cssTheme === name) {
        setSetting('cssTheme', '');
        void themeService.applyThemeByName(vaultPath, '');
      }
      await loadThemes();
      onThemeChanged?.();
    } catch (e) {
      console.warn(`Could not uninstall theme ${name}:`, e);
    }
  };

  if (themes.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 mt-2 w-full">
      {themes.map((th) => (
        <div
          key={th.name}
          className="flex items-center justify-between p-2.5 rounded-[6px] bg-obsidian-sidebar border border-obsidian-border"
        >
          <div className="flex flex-col gap-0.5">
            <div className="text-[13px] font-medium text-obsidian-text flex items-center gap-2">
              <span>{th.name}</span>
              {th.version && (
                <span className="text-[11px] px-1.5 py-0.2 rounded bg-[var(--interactive-normal)] text-obsidian-muted">
                  v{th.version}
                </span>
              )}
            </div>
            {th.author && (
              <div className="text-[12px] text-obsidian-muted">
                {t('appearance.byAuthor', { author: th.author })}
              </div>
            )}
          </div>
          <button
            type="button"
            className="p-1.5 text-obsidian-muted hover:text-[#ef4444] transition-colors rounded hover:bg-[var(--interactive-hover)]"
            title={t('appearance.uninstallTheme')}
            onClick={() => void handleUninstall(th.name)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

export const InstalledThemesRow: React.FC<{ vaultPath: string; refreshTrigger?: number }> = ({
  vaultPath,
  refreshTrigger = 0,
}) => {
  const t = useT();
  const [themes, setThemes] = useState<InstalledTheme[]>([]);
  const cssTheme = useSettingsStore((s) => s.settings.cssTheme);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const loadThemes = useCallback(async () => {
    if (!vaultPath) {
      setThemes([]);
      return;
    }
    const list = await themeService.listThemes(vaultPath);
    setThemes(list);
  }, [vaultPath]);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes, refreshTrigger]);

  const handleUninstall = async (name: string) => {
    if (!vaultPath) return;
    try {
      await invoke('uninstall_theme', { vaultPath, themeName: name });
      if (cssTheme === name) {
        setSetting('cssTheme', '');
        void themeService.applyThemeByName(vaultPath, '');
      }
      await loadThemes();
    } catch (e) {
      console.warn(`Could not uninstall theme ${name}:`, e);
    }
  };

  const count = themes.length;
  const descText =
    count === 0
      ? t('appearance.installedThemesCountZero')
      : count === 1
      ? t('appearance.installedThemesCountOne')
      : t('appearance.installedThemesCount', { count });

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="text-[12px] text-obsidian-muted">{descText}</div>
      {themes.length > 0 && (
        <div className="flex flex-col gap-2 w-full mt-1">
          {themes.map((th) => (
            <div
              key={th.name}
              className="flex items-center justify-between p-2.5 rounded-[6px] bg-[var(--interactive-normal)] border border-obsidian-border"
            >
              <div className="flex flex-col gap-0.5">
                <div className="text-[13px] font-medium text-obsidian-text flex items-center gap-2">
                  <span>{th.name}</span>
                  {th.version && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--interactive-normal)] text-obsidian-muted">
                      v{th.version}
                    </span>
                  )}
                </div>
                {th.author && (
                  <div className="text-[12px] text-obsidian-muted">
                    {t('appearance.byAuthor', { author: th.author })}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="p-1.5 text-obsidian-muted hover:text-[#ef4444] transition-colors rounded hover:bg-[var(--interactive-hover)] cursor-pointer"
                title={t('appearance.uninstallTheme')}
                onClick={() => void handleUninstall(th.name)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
