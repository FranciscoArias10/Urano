import React, { useState, useMemo } from 'react';
import {
  CircleUser,
  Palette,
  Monitor,
  PenLine,
  FolderCog,
  Command,
  KeyRound,
  ToyBrick,
  Puzzle,
  LayoutGrid,
  Terminal,
  Calendar,
  History,
  Merge,
  ScanEye,
  FileSearch,
  RefreshCw,
  Files,
  Timer,
  RotateCcw,
  ChevronRight,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  useSettingsStore,
  useT,
  Translate,
  UranoSettings,
  CorePluginId,
  CORE_PLUGIN_IDS,
  URANO_ACCENT,
  ThemeMode,
  DefaultFileToOpen,
  NewFileLocation,
  AttachmentLocation,
  NewLinkFormat,
  DeleteAttachmentsWithFile,
  TrashOption,
  WindowFrameStyle,
} from '../../stores/settingsStore';
import { useSyncStore } from '../../stores/syncStore';
import { useLocaleStore } from '../../stores/localeStore';
import { LanguageDropdown } from './LanguageDropdown';
import { useVaultStore } from '../../stores/vaultStore';
import { useNoticeStore } from '../common/Notice';
import { themeService } from '../../services/themeService';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { ThemeSelectorControl, InstalledThemesRow } from './appearance/ThemeSelectorControl';
import type { CommandItem } from '../palette/CommandPalette';
import {
  Toggle,
  Dropdown,
  SettingButton,
  ExtraButton,
  SettingLink,
  TextInput,
  Slider,
  StatusPill,
  HotkeyPill,
} from './SettingControls';
import { VaultFolderInput } from './VaultFolderInput';
import {
  HOTKEY_CATALOG,
  getActiveHotkeys,
} from '../../services/hotkeyRegistry';

/* ----------------------------------------------------------------------------
 * Declarative tab definitions (mirrors Urano's `SettingTab.getSettingDefinitions`)
 * ------------------------------------------------------------------------- */

export interface SettingItemDef {
  id: string;
  name: string;
  desc?: React.ReactNode;
  /** Plain text used by the search index when `desc` is a React node. */
  descText?: string;
  icon?: React.ReactNode;
  control?: React.ReactNode;
  vertical?: boolean;
  className?: string;
  onClick?: () => void;
  /** Extra search terms (Urano `aliases`). */
  aliases?: string[];
}

export interface SettingGroupDef {
  id: string;
  heading?: string;
  headingControl?: React.ReactNode;
  className?: string;
  items: SettingItemDef[];
}

export type SettingsSection = 'options' | 'core-plugins';

export interface SettingTabDef {
  id: string;
  name: string;
  icon: React.ReactNode;
  section: SettingsSection;
  groups: SettingGroupDef[];
  /** Hidden from the sidebar (e.g. disabled core plugin) but still searchable=false. */
  hidden?: boolean;
}

export interface SettingTabsContext {
  commands?: CommandItem[];
  onOpenHelp?: () => void;
  onOpenSyncLogs?: () => void;
  /** "Learn how to add a new language to Urano." → abre `.urano/locales` (o la documentación). */
  onOpenLocalesFolder?: () => void;
}

export const URANO_VERSION = '1.14.5';
export const URANO_INSTALLER_VERSION = '1.14.4';
/** Documentación para añadir un idioma (cuando no hay bóveda abierta). */
export const LOCALES_DOCS_URL = 'https://github.com/FranciscoArias10/Urano#idiomas';

const ICON = 16;

/** Enlace con flecha entrante (`links-coming-in` de Obsidian) para "Enlaces entrantes". */
const LinksComingInIcon: React.FC<{ size?: number }> = ({ size = ICON }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8.70467 12C8.21657 11.6404 7.81269 11.1817 7.52044 10.6549C7.22819 10.1281 7.0544 9.54553 7.01086 8.94677C6.96732 8.348 7.05504 7.74701 7.26808 7.18456C7.48112 6.62212 7.81449 6.11138 8.24558 5.68697L10.7961 3.17516C11.5978 2.41258 12.6716 1.99062 13.7861 2.00016C14.9007 2.0097 15.9668 2.44997 16.755 3.22615C17.5431 4.00234 17.9902 5.05233 17.9998 6.14998C18.0095 7.24763 17.5811 8.30511 16.8067 9.09467L15.9014 10" />
    <path d="M11.2953 8C11.7834 8.35957 12.1873 8.81831 12.4796 9.34512C12.7718 9.87192 12.9456 10.4545 12.9891 11.0532C13.0327 11.652 12.945 12.253 12.7319 12.8154C12.5189 13.3779 12.1855 13.8886 11.7544 14.313L9.20392 16.8248C8.40221 17.5874 7.32844 18.0094 6.21389 17.9998C5.09933 17.9903 4.03318 17.55 3.24504 16.7738C2.4569 15.9977 2.00985 14.9477 2.00016 13.85C1.99047 12.7524 2.41893 11.6949 3.19326 10.9053L4.09859 10" />
    <path d="M17 21L14 18L17 15" />
    <path d="M21 18H14" />
  </svg>
);

export const CORE_PLUGIN_META: Record<
  CorePluginId,
  { tabId: string; nameKey: Parameters<Translate>[0]; descKey: Parameters<Translate>[0]; icon: React.ReactNode }
> = {
  backlinks: { tabId: 'backlinks', nameKey: 'tab.backlinks', descKey: 'plugin.backlinks.desc', icon: <LinksComingInIcon size={ICON} /> },
  canvas: { tabId: 'canvas', nameKey: 'tab.canvas', descKey: 'plugin.canvas.desc', icon: <LayoutGrid size={ICON} /> },
  'command-palette': { tabId: 'command-palette', nameKey: 'tab.commandPalette', descKey: 'plugin.commandPalette.desc', icon: <Terminal size={ICON} /> },
  'daily-notes': { tabId: 'daily-notes', nameKey: 'tab.dailyNotes', descKey: 'plugin.dailyNotes.desc', icon: <Calendar size={ICON} /> },
  'file-recovery': { tabId: 'file-recovery', nameKey: 'tab.fileRecovery', descKey: 'plugin.fileRecovery.desc', icon: <History size={ICON} /> },
  'note-composer': { tabId: 'note-composer', nameKey: 'tab.noteComposer', descKey: 'plugin.noteComposer.desc', icon: <Merge size={ICON} /> },
  'page-preview': { tabId: 'page-preview', nameKey: 'tab.pagePreview', descKey: 'plugin.pagePreview.desc', icon: <ScanEye size={ICON} /> },
  switcher: { tabId: 'switcher', nameKey: 'tab.quickSwitcher', descKey: 'plugin.quickSwitcher.desc', icon: <FileSearch size={ICON} /> },
  sync: { tabId: 'sync', nameKey: 'tab.sync', descKey: 'plugin.sync.desc', icon: <RefreshCw size={ICON} /> },
  templates: { tabId: 'templates', nameKey: 'tab.templates', descKey: 'plugin.templates.desc', icon: <Files size={ICON} /> },
};

/* --- Small stateful controls ------------------------------------------------ */

const CheckForUpdatesButton: React.FC<{ t: Translate }> = ({ t }) => {
  const [loading, setLoading] = useState(false);
  const { showNotice } = useNoticeStore();
  return (
    <SettingButton
      loading={loading}
      onClick={() => {
        setLoading(true);
        setTimeout(() => {
          setLoading(false);
          showNotice(t('general.upToDate'), 2500, 'info');
        }, 900);
      }}
    >
      {t('general.checkForUpdates')}
    </SettingButton>
  );
};

const RebuildVaultCacheButton: React.FC<{ t: Translate }> = ({ t }) => {
  const [loading, setLoading] = useState(false);
  const { showNotice } = useNoticeStore();
  return (
    <button
      type="button"
      className={`mod-button${loading ? ' mod-loading' : ''}`}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const { rebuildVaultCache } = useVaultStore.getState();
          await rebuildVaultCache();
          showNotice(t('files.reindexSuccess'), 3000, 'success');
        } catch (err) {
          console.error(err);
          showNotice(String(err), 3000, 'error');
        } finally {
          setLoading(false);
        }
      }}
    >
      {t('files.reindexButton')}
    </button>
  );
};

/* --- Hook building every tab -------------------------------------------------- */

export function useSettingTabs(ctx: SettingTabsContext = {}): SettingTabDef[] {
  const t = useT();
  const language = useLocaleStore((s) => s.language);
  const languages = useLocaleStore((s) => s.languages);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const languageAliases = useMemo(
    () => languages.flatMap((l) => [l.name.toLowerCase(), l.nativeName.toLowerCase()]),
    [languages]
  );
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const setCorePluginEnabled = useSettingsStore((s) => s.setCorePluginEnabled);
  const startupMs = useSettingsStore((s) => s.startupMs);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const { showNotice } = useNoticeStore();

  const sync = useSyncStore();
  const { activeVault } = useVaultStore();
  const vaultPath = useSettingsStore((s) => s.vaultPath) || activeVault || '';

  const set = <K extends keyof UranoSettings>(key: K) => (value: UranoSettings[K]) =>
    setSetting(key, value);

  /* ---------------- General ("about") ---------------- */
  const accountDesc = sync.isAuthenticated && sync.user
    ? t('general.yourAccountDesc', { name: sync.user.name, email: sync.user.email })
    : t('general.yourAccountDescNoLogin');

  const general: SettingTabDef = {
    id: 'general',
    name: t('tab.general'),
    icon: <CircleUserRound size={ICON} />,
    section: 'options',
    groups: [
      {
        id: 'general-app',
        items: [
          {
            id: 'version',
            name: t('general.version', { version: URANO_VERSION }),
            desc: (
              <>
                {t('general.installerVersion', { version: URANO_INSTALLER_VERSION })}
                <br />
                <SettingLink href="https://github.com/FranciscoArias10/Urano/releases">{t('general.readChangelog')}</SettingLink>
              </>
            ),
            descText: `${t('general.installerVersion', { version: URANO_INSTALLER_VERSION })} ${t('general.readChangelog')}`,
            control: <CheckForUpdatesButton t={t} />,
          },
          {
            id: 'auto-update',
            name: t('general.autoUpdate'),
            desc: t('general.autoUpdateDesc'),
            control: <Toggle value={settings.autoUpdate} onChange={set('autoUpdate')} ariaLabel={t('general.autoUpdate')} />,
          },
          {
            id: 'language',
            name: t('general.language'),
            desc: (
              <>
                {t('general.languageDesc')}
                <br />
                {ctx.onOpenLocalesFolder ? (
                  <SettingLink onClick={ctx.onOpenLocalesFolder}>{t('general.addLanguage')}</SettingLink>
                ) : (
                  <SettingLink href={LOCALES_DOCS_URL}>{t('general.addLanguage')}</SettingLink>
                )}
              </>
            ),
            descText: `${t('general.languageDesc')} ${t('general.addLanguage')}`,
            aliases: ['idioma', 'language', 'english', 'español', 'spanish', ...languageAliases],
            control: (
              <LanguageDropdown
                value={language}
                languages={languages}
                ariaLabel={t('general.language')}
                onChange={(code) => void setLanguage(code)}
              />
            ),
          },
          {
            id: 'help',
            name: t('general.help'),
            desc: t('general.helpDesc'),
            control: <SettingButton onClick={ctx.onOpenHelp}>{t('general.open')}</SettingButton>,
          },
        ],
      },
      {
        id: 'general-account',
        heading: t('general.account'),
        items: [
          {
            id: 'your-account',
            name: t('general.yourAccount'),
            desc: accountDesc,
            aliases: ['google', 'drive', 'login'],
            control: sync.isAuthenticated ? (
              <>
                <SettingButton onClick={() => sync.setShowConfigModal(true)}>{t('general.manage')}</SettingButton>
                <SettingButton onClick={() => sync.logout()}>{t('general.logOut')}</SettingButton>
              </>
            ) : (
              <>
                <SettingButton onClick={() => sync.loginWithGoogle()}>{t('general.logIn')}</SettingButton>
                <SettingButton
                  onClick={() => window.open('https://accounts.google.com/signup', '_blank', 'noopener')}
                >
                  {t('general.signUp')}
                </SettingButton>
              </>
            ),
          },
          {
            id: 'commercial-license',
            name: t('general.commercialLicense'),
            desc: (
              <>
                {t('general.commercialLicenseDesc')}{' '}
                <SettingLink href="https://github.com/FranciscoArias10/Urano/blob/master/LICENSE">{t('general.learnMore')}</SettingLink>
              </>
            ),
            descText: `${t('general.commercialLicenseDesc')} ${t('general.learnMore')}`,
            control: (
              <>
                <SettingButton onClick={() => showNotice('Urano is free and open: no license needed.', 3000, 'info')}>
                  {t('general.activate')}
                </SettingButton>
                <SettingButton onClick={() => window.open('https://github.com/FranciscoArias10/Urano', '_blank', 'noopener')}>
                  {t('general.purchase')}
                </SettingButton>
              </>
            ),
          },
        ],
      },
      {
        id: 'general-advanced',
        heading: t('general.advanced'),
        items: [
          {
            id: 'slow-startup',
            name: t('general.slowStartup'),
            desc: t('general.slowStartupDesc'),
            control: (
              <>
                <ExtraButton
                  icon={<Timer size={ICON} />}
                  tooltip={t('general.checkStartup')}
                  onClick={() =>
                    showNotice(
                      t('general.startupTime', { ms: startupMs ?? Math.round(performance.now()) }),
                      4000,
                      'info'
                    )
                  }
                />
                <Toggle value={settings.slowStartupCheck} onChange={set('slowStartupCheck')} ariaLabel={t('general.slowStartup')} />
              </>
            ),
          },
          {
            id: 'cli',
            name: t('general.cli'),
            desc: t('general.cliDesc'),
            control: <Toggle value={settings.cli} onChange={set('cli')} ariaLabel={t('general.cli')} />,
          },
          {
            id: 'hardware-acceleration',
            name: t('general.hwAccel'),
            desc: (
              <>
                {t('general.hwAccelDesc')}{' '}
                <span className="mod-warning">
                  {t('general.hwAccelWarning')}
                </span>
              </>
            ),
            descText: `${t('general.hwAccelDesc')} ${t('general.hwAccelWarning')}`,
            aliases: ['gpu'],
            control: (
              <Toggle
                value={settings.hardwareAcceleration}
                onChange={(v) => {
                  setSetting('hardwareAcceleration', v);
                  showNotice(t('general.relaunchNeeded'), 3000, 'info');
                }}
                ariaLabel={t('general.hwAccel')}
              />
            ),
          },
        ],
      },
    ],
  };

  /* ---------------- Appearance ---------------- */
  const appearance: SettingTabDef = {
    id: 'appearance',
    name: t('tab.appearance'),
    icon: <Palette size={ICON} />,
    section: 'options',
    groups: [
      {
        id: 'appearance-theme',
        items: [
          {
            id: 'base-theme',
            name: t('appearance.baseTheme'),
            desc: t('appearance.baseThemeDesc'),
            aliases: ['dark', 'light', 'theme', 'tema', 'oscuro', 'claro', 'sistema'],
            control: (
              <Dropdown<ThemeMode>
                value={settings.theme}
                ariaLabel={t('appearance.baseTheme')}
                options={[
                  { value: 'system', label: t('appearance.themeSystem') },
                  { value: 'light', label: t('appearance.themeLight') },
                  { value: 'dark', label: t('appearance.themeDark') },
                ]}
                onChange={(mode) => {
                  setSetting('theme', mode);
                  themeService.applyBaseTheme(mode);
                }}
              />
            ),
          },
          {
            id: 'accent-color',
            name: t('appearance.accent'),
            desc: t('appearance.accentDesc'),
            aliases: ['color', 'naranja', 'orange', 'accent'],
            control: (
              <div className="flex items-center gap-2">
                {settings.accentColor.toLowerCase() !== URANO_ACCENT.toLowerCase() && (
                  <button
                    type="button"
                    className="extra-setting-button clickable-icon flex items-center justify-center p-1 text-urano-muted hover:text-urano-text transition-colors"
                    aria-label={t('appearance.restoreDefault')}
                    title={t('appearance.restoreDefault')}
                    onClick={() => {
                      setSetting('accentColor', URANO_ACCENT);
                      themeService.applyAccent(URANO_ACCENT);
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <div
                  className="setting-item-color-swatch-container"
                  style={{ backgroundColor: settings.accentColor }}
                >
                  <input
                    type="color"
                    value={settings.accentColor}
                    aria-label={t('appearance.accent')}
                    onChange={(e) => {
                      const col = e.target.value;
                      setSetting('accentColor', col);
                      themeService.applyAccent(col);
                    }}
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'themes-row',
            name: t('appearance.themes'),
            desc: t('appearance.themesDesc'),
            aliases: ['themes', 'temas', 'theme', 'community'],
            control: (
              <ThemeSelectorControl
                vaultPath={vaultPath ?? ''}
                onOpenManage={() => {
                  window.dispatchEvent(new CustomEvent('urano:open-community-themes'));
                }}
              />
            ),
          },
          {
            id: 'installed-themes',
            name: t('appearance.installedThemes'),
            desc: '',
            vertical: true,
            control: <InstalledThemesRow vaultPath={vaultPath ?? ''} />,
          },
          {
            id: 'css-snippets',
            name: t('appearance.cssSnippets'),
            desc: t('appearance.cssSnippetsDesc'),
            aliases: ['snippets', 'css', 'fragmentos'],
            onClick: () => {
              window.dispatchEvent(new CustomEvent('urano:open-css-snippets'));
            },
            control: (
              <div
                className="flex items-center gap-1.5 text-xs text-urano-muted cursor-pointer"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('urano:open-css-snippets'));
                }}
              >
                <span>
                  {settings.enabledCssSnippets.length === 0
                    ? t('appearance.enabledCountZero')
                    : settings.enabledCssSnippets.length === 1
                    ? t('appearance.enabledCountOne')
                    : t('appearance.enabledCount', { count: settings.enabledCssSnippets.length })}
                </span>
                <ChevronRight size={16} />
              </div>
            ),
          },
        ],
      },
      {
        id: 'appearance-font',
        heading: t('appearance.fontHeading'),
        items: [
          {
            id: 'interface-font',
            name: t('appearance.interfaceFont'),
            desc: t('appearance.interfaceFontDesc'),
            aliases: ['font', 'interface', 'fuente', 'interfaz'],
            onClick: () => {
              window.dispatchEvent(
                new CustomEvent('urano:open-font-picker', {
                  detail: { target: 'interfaceFontFamily' },
                })
              );
            },
            control: (
              <div
                className="flex items-center gap-1.5 text-xs text-urano-muted cursor-pointer"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('urano:open-font-picker', {
                      detail: { target: 'interfaceFontFamily' },
                    })
                  );
                }}
              >
                {settings.interfaceFontFamily && (
                  <span className="text-urano-text font-medium">
                    {settings.interfaceFontFamily}
                  </span>
                )}
                <ChevronRight size={16} />
              </div>
            ),
          },
          {
            id: 'text-font',
            name: t('appearance.textFont'),
            desc: t('appearance.textFontDesc'),
            aliases: ['text', 'font', 'fuente', 'texto'],
            onClick: () => {
              window.dispatchEvent(
                new CustomEvent('urano:open-font-picker', {
                  detail: { target: 'textFontFamily' },
                })
              );
            },
            control: (
              <div
                className="flex items-center gap-1.5 text-xs text-urano-muted cursor-pointer"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('urano:open-font-picker', {
                      detail: { target: 'textFontFamily' },
                    })
                  );
                }}
              >
                {settings.textFontFamily && (
                  <span className="text-urano-text font-medium">
                    {settings.textFontFamily}
                  </span>
                )}
                <ChevronRight size={16} />
              </div>
            ),
          },
          {
            id: 'monospace-font',
            name: t('appearance.monospaceFont'),
            desc: t('appearance.monospaceFontDesc'),
            aliases: ['mono', 'monospace', 'code', 'codigo'],
            onClick: () => {
              window.dispatchEvent(
                new CustomEvent('urano:open-font-picker', {
                  detail: { target: 'monospaceFontFamily' },
                })
              );
            },
            control: (
              <div
                className="flex items-center gap-1.5 text-xs text-urano-muted cursor-pointer"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('urano:open-font-picker', {
                      detail: { target: 'monospaceFontFamily' },
                    })
                  );
                }}
              >
                {settings.monospaceFontFamily && (
                  <span className="text-urano-text font-medium">
                    {settings.monospaceFontFamily}
                  </span>
                )}
                <ChevronRight size={16} />
              </div>
            ),
          },
          {
            id: 'font-size',
            name: t('appearance.fontSize'),
            desc: t('appearance.fontSizeDesc'),
            aliases: ['size', 'tamano', 'px', 'font'],
            control: (
              <div className="flex items-center gap-2">
                {settings.baseFontSize !== 16 && (
                  <button
                    type="button"
                    className="extra-setting-button clickable-icon flex items-center justify-center p-1 text-urano-muted hover:text-urano-text transition-colors"
                    aria-label={t('appearance.restoreDefault')}
                    title={t('appearance.restoreDefault')}
                    onClick={() => {
                      setSetting('baseFontSize', 16);
                      setSetting('editorFontSize', 16);
                      themeService.applyFonts({
                        fontSize: 16,
                        interfaceFont: settings.interfaceFontFamily,
                        textFont: settings.textFontFamily,
                        monoFont: settings.monospaceFontFamily,
                      });
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <Slider
                  value={settings.baseFontSize}
                  min={10}
                  max={30}
                  step={1}
                  format={(v) => `${v}`}
                  onChange={(v) => {
                    setSetting('baseFontSize', v);
                    setSetting('editorFontSize', v);
                    themeService.applyFonts({
                      fontSize: v,
                      interfaceFont: settings.interfaceFontFamily,
                      textFont: settings.textFontFamily,
                      monoFont: settings.monospaceFontFamily,
                    });
                  }}
                  ariaLabel={t('appearance.fontSize')}
                />
              </div>
            ),
          },
          {
            id: 'font-size-action',
            name: t('appearance.fontSizeAction'),
            desc: t('appearance.fontSizeActionDesc'),
            aliases: ['wheel', 'ctrl', 'zoom', 'rueda', 'pellizcar'],
            control: (
              <Toggle
                value={settings.baseFontSizeAction}
                onChange={set('baseFontSizeAction')}
                ariaLabel={t('appearance.fontSizeAction')}
              />
            ),
          },
        ],
      },
      {
        id: 'appearance-advanced',
        heading: t('appearance.advancedHeading'),
        items: [
          {
            id: 'translucent-window',
            name: t('appearance.translucentWindow'),
            desc: t('appearance.translucentWindowDesc'),
            control: (
              <Toggle
                value={settings.translucentWindow}
                onChange={set('translucentWindow')}
                ariaLabel={t('appearance.translucentWindow')}
              />
            ),
          },
          {
            id: 'custom-icon',
            name: t('appearance.customIcon'),
            desc: (
              <div className="flex items-center gap-3">
                {settings.customIcon && (
                  <div className="w-8 h-8 rounded-md overflow-hidden bg-urano-sidebar border border-urano-border flex items-center justify-center p-0.5 shrink-0">
                    <img
                      src={
                        settings.customIcon.startsWith('http') ||
                        settings.customIcon.startsWith('data:')
                          ? settings.customIcon
                          : convertFileSrc(settings.customIcon)
                      }
                      alt="Icon"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}
                <span>{t('appearance.customIconDesc')}</span>
              </div>
            ),
            aliases: ['icon', 'icono', 'logo', 'app'],
            control: (
              <div className="flex items-center gap-2">
                {settings.customIcon && (
                  <button
                    type="button"
                    className="extra-setting-button clickable-icon flex items-center justify-center p-1 text-urano-muted hover:text-urano-text transition-colors"
                    aria-label={t('appearance.resetIcon')}
                    title={t('appearance.resetIcon')}
                    onClick={async () => {
                      setSetting('customIcon', null);
                      try {
                        await invoke('set_custom_window_icon', { iconPath: null });
                      } catch (err) {
                        console.warn('Error resetting window icon:', err);
                      }
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <SettingButton
                  onClick={async () => {
                    try {
                      const selected = await openFileDialog({
                        multiple: false,
                        directory: false,
                        title: t('appearance.customIcon'),
                        filters: [
                          {
                            name: 'Icon Image',
                            extensions: ['png', 'ico', 'svg', 'icns', 'webp'],
                          },
                        ],
                      });
                      if (selected && typeof selected === 'string') {
                        setSetting('customIcon', selected);
                        try {
                          await invoke('set_custom_window_icon', { iconPath: selected });
                        } catch (err) {
                          console.warn('Could not set custom window icon:', err);
                        }
                      }
                    } catch (err) {
                      console.error('Error selecting custom icon:', err);
                    }
                  }}
                >
                  {t('appearance.chooseIcon')}
                </SettingButton>
              </div>
            ),
          },
        ],
      },
    ],
  };

  /* ---------------- Interface ---------------- */
  const interfaceTab: SettingTabDef = {
    id: 'interface',
    name: t('tab.interface'),
    icon: <AppWindow size={ICON} />,
    section: 'options',
    groups: [
      /* Tarjeta 1 — Opciones Superiores (Sin Título de Sección Encima) */
      {
        id: 'interface-general',
        items: [
          {
            id: 'show-tab-title-bar',
            name: t('interface.showTabTitleBar'),
            desc: t('interface.showTabTitleBarDesc'),
            control: (
              <Toggle
                value={settings.showTabTitleBar}
                onChange={set('showTabTitleBar')}
                ariaLabel={t('interface.showTabTitleBar')}
              />
            ),
          },
          {
            id: 'show-ribbon',
            name: t('interface.showRibbon'),
            desc: t('interface.showRibbonDesc'),
            control: (
              <Toggle
                value={settings.showRibbon}
                onChange={set('showRibbon')}
                ariaLabel={t('interface.showRibbon')}
              />
            ),
          },
          {
            id: 'ribbon-config',
            name: t('interface.ribbonConfig'),
            desc: t('interface.ribbonConfigDesc'),
            className: 'mod-clickable',
            onClick: () => {
              window.dispatchEvent(new CustomEvent('urano:open-ribbon-config'));
            },
            control: (
              <ChevronRight size={18} className="text-muted" />
            ),
          },
        ],
      },
      /* Tarjeta 2 — Sección Avanzado */
      {
        id: 'interface-advanced',
        heading: t('interface.advancedHeading'),
        items: [
          {
            id: 'zoom-level',
            name: t('interface.zoomLevel'),
            desc: t('interface.zoomLevelDesc'),
            control: (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="extra-setting-button clickable-icon flex items-center justify-center p-1 text-urano-muted hover:text-urano-text transition-colors rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={t('interface.resetZoom')}
                  title={t('interface.resetZoom')}
                  disabled={settings.zoomLevel === 100}
                  onClick={() => setSetting('zoomLevel', 100)}
                >
                  <RotateCcw size={15} />
                </button>
                <Slider
                  min={70}
                  max={150}
                  step={5}
                  value={settings.zoomLevel}
                  onChange={(v) => setSetting('zoomLevel', v)}
                  format={(v) => `${v}%`}
                  ariaLabel={t('interface.zoomLevel')}
                />
              </div>
            ),
          },
          {
            id: 'native-menus',
            name: t('interface.nativeMenus'),
            desc: t('interface.nativeMenusDesc'),
            control: (
              <Toggle
                value={settings.nativeMenus}
                onChange={set('nativeMenus')}
                ariaLabel={t('interface.nativeMenus')}
              />
            ),
          },
          {
            id: 'window-frame-style',
            name: t('interface.windowFrameStyle'),
            desc: t('interface.windowFrameStyleDesc'),
            control: (
              <Dropdown<WindowFrameStyle>
                value={settings.windowFrameStyle}
                options={[
                  { value: 'hidden', label: t('interface.frameHidden') },
                  { value: 'custom', label: t('interface.frameUrano') },
                  { value: 'native', label: t('interface.frameNative') },
                ]}
                onChange={set('windowFrameStyle')}
                ariaLabel={t('interface.windowFrameStyle')}
              />
            ),
          },
          {
            id: 'open-settings-new-window',
            name: t('interface.openSettingsInNewWindow'),
            desc: t('interface.openSettingsInNewWindowDesc'),
            control: (
              <Toggle
                value={settings.openSettingsInNewWindow}
                onChange={(val) => {
                  setSetting('openSettingsInNewWindow', val);
                  if (val) {
                    const isStandalone =
                      typeof window !== 'undefined' &&
                      (new URLSearchParams(window.location.search).get('window') === 'settings' ||
                        window.location.hash.includes('window=settings'));
                    if (!isStandalone) {
                      useSettingsStore.getState().closeSettings();
                      const vaultPath = useVaultStore.getState().activeVault;
                      const vaultName =
                        useVaultStore.getState().vaultName ||
                        (vaultPath ? vaultPath.split(/[\\/]/).pop() : '') ||
                        'Urano';
                      invoke('open_settings_window', {
                        tabId: 'interface',
                        vaultName,
                        frameStyle: settings.windowFrameStyle,
                      }).catch(() => {});
                    }
                  }
                }}
                ariaLabel={t('interface.openSettingsInNewWindow')}
              />
            ),
          },
        ],
      },
    ],
  };

  /* ---------------- Editor (CodeMirror 6) ---------------- */
  const editor: SettingTabDef = {
    id: 'editor',
    name: t('tab.editor'),
    icon: <PenLine size={ICON} />,
    section: 'options',
    groups: [
      /* Tarjeta 1 — Opciones Predeterminadas de Vista y Modo (Sin Título de Sección) */
      {
        id: 'editor-views',
        items: [
          {
            id: 'default-view-mode',
            name: t('editor.defaultViewMode'),
            desc: t('editor.defaultViewModeDesc'),
            control: (
              <Dropdown<'source' | 'preview'>
                value={settings.defaultViewMode}
                ariaLabel={t('editor.defaultViewMode')}
                options={[
                  { value: 'source', label: t('editor.defaultViewModeEditing') },
                  { value: 'preview', label: t('editor.defaultViewModeReading') },
                ]}
                onChange={set('defaultViewMode')}
              />
            ),
          },
          {
            id: 'default-editing-mode',
            name: t('editor.defaultEditingMode'),
            desc: t('editor.defaultEditingModeDesc'),
            aliases: ['live-preview', 'source'],
            control: (
              <Dropdown
                value={settings.livePreview ? 'live-preview' : 'source'}
                ariaLabel={t('editor.defaultEditingMode')}
                options={[
                  { value: 'live-preview', label: t('editor.defaultEditingModeLivePreview') },
                  { value: 'source', label: t('editor.defaultEditingModeSource') },
                ]}
                onChange={(v) => setSetting('livePreview', v === 'live-preview')}
              />
            ),
          },
          {
            id: 'editor-status',
            name: t('editor.editorStatus'),
            desc: t('editor.editorStatusDesc'),
            control: (
              <Toggle
                value={settings.showEditorStatus}
                onChange={set('showEditorStatus')}
                ariaLabel={t('editor.editorStatus')}
              />
            ),
          },
        ],
      },
      /* Tarjeta 2 — Pantalla */
      {
        id: 'editor-display',
        heading: t('editor.display'),
        items: [
          {
            id: 'show-inline-title',
            name: t('editor.showInlineTitle'),
            desc: t('editor.showInlineTitleDesc'),
            control: (
              <Toggle
                value={settings.showInlineTitle}
                onChange={set('showInlineTitle')}
                ariaLabel={t('editor.showInlineTitle')}
              />
            ),
          },
          {
            id: 'readable-line-length',
            name: t('editor.readableLineLength'),
            desc: t('editor.readableLineLengthDesc'),
            control: (
              <Toggle
                value={settings.readableLineLength}
                onChange={set('readableLineLength')}
                ariaLabel={t('editor.readableLineLength')}
              />
            ),
          },
          {
            id: 'strict-line-breaks',
            name: t('editor.strictLineBreaks'),
            desc: t('editor.strictLineBreaksDesc'),
            control: (
              <Toggle
                value={settings.strictLineBreaks}
                onChange={set('strictLineBreaks')}
                ariaLabel={t('editor.strictLineBreaks')}
              />
            ),
          },
          {
            id: 'properties-in-document',
            name: t('editor.propertiesInDocument'),
            desc: t('editor.propertiesInDocumentDesc'),
            control: (
              <Dropdown<'visible' | 'hidden' | 'source'>
                value={settings.propertiesInDocument}
                ariaLabel={t('editor.propertiesInDocument')}
                options={[
                  { value: 'visible', label: t('editor.propertiesVisible') },
                  { value: 'hidden', label: t('editor.propertiesHidden') },
                  { value: 'source', label: t('editor.propertiesSource') },
                ]}
                onChange={set('propertiesInDocument')}
              />
            ),
          },
          {
            id: 'fold-heading',
            name: t('editor.foldHeading'),
            desc: t('editor.foldHeadingDesc'),
            aliases: ['encabezado', 'h1', 'h2', 'h3'],
            control: (
              <Toggle
                value={settings.foldHeading}
                onChange={set('foldHeading')}
                ariaLabel={t('editor.foldHeading')}
              />
            ),
          },
          {
            id: 'fold-indent',
            name: t('editor.foldIndent'),
            desc: t('editor.foldIndentDesc'),
            aliases: ['sangrado', 'listas'],
            control: (
              <Toggle
                value={settings.foldIndent}
                onChange={set('foldIndent')}
                ariaLabel={t('editor.foldIndent')}
              />
            ),
          },
          {
            id: 'show-line-numbers',
            name: t('editor.showLineNumbers'),
            desc: t('editor.showLineNumbersDesc'),
            aliases: ['gutter', 'números de línea', 'line numbers'],
            control: (
              <Toggle
                value={settings.showLineNumbers}
                onChange={set('showLineNumbers')}
                ariaLabel={t('editor.showLineNumbers')}
              />
            ),
          },
          {
            id: 'indent-guides',
            name: t('editor.indentGuides'),
            desc: t('editor.indentGuidesDesc'),
            aliases: ['guías', 'indentation guides', 'show-indentation-guides'],
            control: (
              <Toggle
                value={settings.showIndentationGuides}
                onChange={set('showIndentationGuides')}
                ariaLabel={t('editor.indentGuides')}
              />
            ),
          },
          {
            id: 'right-to-left',
            name: t('editor.rightToLeft'),
            desc: t('editor.rightToLeftDesc'),
            aliases: ['rtl', 'árabe', 'hebreo'],
            control: (
              <Toggle
                value={settings.rightToLeft}
                onChange={set('rightToLeft')}
                ariaLabel={t('editor.rightToLeft')}
              />
            ),
          },
        ],
      },
      /* Tarjeta 3 — Comportamiento */
      {
        id: 'editor-behavior',
        heading: t('editor.behavior'),
        items: [
          {
            id: 'spellcheck',
            name: t('editor.spellcheck'),
            desc: t('editor.spellcheckDesc'),
            aliases: ['ortografía', 'corrector'],
            control: (
              <Toggle
                value={settings.spellcheck}
                onChange={set('spellcheck')}
                ariaLabel={t('editor.spellcheck')}
              />
            ),
          },
          {
            id: 'auto-pair-brackets',
            name: t('editor.autoPairBrackets'),
            desc: t('editor.autoPairBracketsDesc'),
            aliases: ['corchetes', 'brackets', 'quotes'],
            control: (
              <Toggle
                value={settings.autoPairBrackets}
                onChange={set('autoPairBrackets')}
                ariaLabel={t('editor.autoPairBrackets')}
              />
            ),
          },
          {
            id: 'auto-pair-markdown',
            name: t('editor.autoPairMarkdown'),
            desc: t('editor.autoPairMarkdownDesc'),
            aliases: ['markdown', 'negrita', 'cursiva'],
            control: (
              <Toggle
                value={settings.autoPairMarkdown}
                onChange={set('autoPairMarkdown')}
                ariaLabel={t('editor.autoPairMarkdown')}
              />
            ),
          },
          {
            id: 'smart-indent-lists',
            name: t('editor.smartIndentLists'),
            desc: t('editor.smartIndentListsDesc'),
            aliases: ['sangrado inteligente', 'smart lists', 'smart-indent'],
            control: (
              <Toggle
                value={settings.smartIndentLists}
                onChange={set('smartIndentLists')}
                ariaLabel={t('editor.smartIndentLists')}
              />
            ),
          },
          {
            id: 'indent-using-tabs',
            name: t('editor.useTabs'),
            desc: t('editor.useTabsDesc', { tabSize: settings.tabSize }),
            aliases: ['tabulaciones', 'tabs', 'use-tabs', 'tab'],
            control: (
              <Toggle
                value={settings.indentUsingTabs}
                onChange={set('indentUsingTabs')}
                ariaLabel={t('editor.useTabs')}
              />
            ),
          },
          {
            id: 'tab-size',
            name: t('editor.tabSize'),
            desc: t('editor.tabSizeDesc'),
            aliases: ['tabulación', 'indent', 'tamaño'],
            control: (
              <div className="flex items-center gap-2">
                {settings.tabSize !== 4 && (
                  <button
                    type="button"
                    className="extra-setting-button clickable-icon flex items-center justify-center p-1 text-urano-muted hover:text-urano-text transition-colors"
                    aria-label={t('editor.restoreDefaultTabSize')}
                    title={t('editor.restoreDefaultTabSize')}
                    onClick={() => setSetting('tabSize', 4)}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
                <Slider
                  value={settings.tabSize}
                  min={2}
                  max={8}
                  step={1}
                  format={(v) => `${v}`}
                  onChange={(v) => setSetting('tabSize', v)}
                  ariaLabel={t('editor.tabSize')}
                />
              </div>
            ),
          },
          {
            id: 'auto-convert-html',
            name: t('editor.autoConvertHtml'),
            desc: t('editor.autoConvertHtmlDesc'),
            aliases: ['html', 'pegar', 'paste'],
            control: (
              <Toggle
                value={settings.autoConvertHtml}
                onChange={set('autoConvertHtml')}
                ariaLabel={t('editor.autoConvertHtml')}
              />
            ),
          },
          {
            id: 'vim-mode',
            name: t('editor.vimMode'),
            desc: t('editor.vimModeDesc'),
            aliases: ['vim', 'modal', 'keymap'],
            control: (
              <Toggle
                value={settings.vimMode}
                onChange={set('vimMode')}
                ariaLabel={t('editor.vimMode')}
              />
            ),
          },
        ],
      },
    ],
  };

  /* ---------------- Files and links ---------------- */
  const files: SettingTabDef = {
    id: 'file',
    name: t('tab.files'),
    icon: <Folder size={ICON} />,
    section: 'options',
    groups: [
      // Tarjeta 1 — Opciones Generales de Archivos (Sin Encabezado Superior, 1:1 con Urano)
      {
        id: 'files-general',
        items: [
          // Fila 1 — Archivo predeterminado al abrir
          {
            id: 'default-file-to-open',
            name: t('files.defaultFileToOpen'),
            desc: t('files.defaultFileToOpenDesc'),
            control: (
              <Dropdown<DefaultFileToOpen>
                value={settings.defaultFileToOpen}
                ariaLabel={t('files.defaultFileToOpen')}
                options={[
                  { value: 'last-opened', label: t('files.defaultFileToOpenOptions.lastOpened') },
                  { value: 'daily-note', label: t('files.defaultFileToOpenOptions.dailyNote') },
                  { value: 'none', label: t('files.defaultFileToOpenOptions.none') },
                ]}
                onChange={set('defaultFileToOpen')}
              />
            ),
          },
          // Fila 2 — Siempre fijar el foco en las pestañas nuevas
          {
            id: 'always-focus-new-tabs',
            name: t('files.alwaysFocusNewTabs'),
            desc: t('files.alwaysFocusNewTabsDesc'),
            control: (
              <Toggle
                value={settings.alwaysFocusNewTabs}
                onChange={set('alwaysFocusNewTabs')}
                ariaLabel={t('files.alwaysFocusNewTabs')}
              />
            ),
          },
          // Fila 3 — Ubicación por defecto para nuevas notas
          {
            id: 'new-file-location',
            name: t('files.newFileLocation'),
            desc: t('files.newFileLocationDesc'),
            control: (
              <Dropdown<NewFileLocation>
                value={settings.newFileLocation}
                ariaLabel={t('files.newFileLocation')}
                options={[
                  { value: 'root', label: t('files.newFileLocationOptions.root') },
                  { value: 'current', label: t('files.newFileLocationOptions.current') },
                  { value: 'folder', label: t('files.newFileLocationOptions.folder') },
                ]}
                onChange={set('newFileLocation')}
              />
            ),
          },
          ...(settings.newFileLocation === 'folder'
            ? [
                {
                  id: 'new-file-folder-path',
                  name: t('files.newFileFolderPath'),
                  desc: t('files.newFileFolderPathDesc'),
                  control: (
                    <TextInput
                      value={settings.newFileFolderPath}
                      placeholder={t('files.folderPlaceholder')}
                      onChange={set('newFileFolderPath')}
                      ariaLabel={t('files.newFileFolderPath')}
                    />
                  ),
                } as SettingItemDef,
              ]
            : []),
          // Fila 4 — Ubicación predeterminada para los archivos adjuntos nuevos
          {
            id: 'attachment-location',
            name: t('files.attachmentLocation'),
            desc: t('files.attachmentLocationDesc'),
            aliases: ['image', 'imagen', 'paste', 'pegar', 'adjunto'],
            control: (
              <Dropdown<AttachmentLocation>
                value={settings.attachmentLocation}
                ariaLabel={t('files.attachmentLocation')}
                options={[
                  { value: 'root', label: t('files.attachmentLocationOptions.root') },
                  { value: 'folder', label: t('files.attachmentLocationOptions.folder') },
                  { value: 'current', label: t('files.attachmentLocationOptions.current') },
                  { value: 'subfolder', label: t('files.attachmentLocationOptions.subfolder') },
                ]}
                onChange={set('attachmentLocation')}
              />
            ),
          },
          ...(settings.attachmentLocation === 'folder'
            ? [
                {
                  id: 'attachment-folder',
                  name: t('files.attachmentFolderPath'),
                  desc: t('files.attachmentFolderPathDesc'),
                  control: (
                    <TextInput
                      value={settings.attachmentFolderPath}
                      placeholder={t('files.attachmentDefaultPlaceholder')}
                      onChange={set('attachmentFolderPath')}
                      ariaLabel={t('files.attachmentFolderPath')}
                    />
                  ),
                } as SettingItemDef,
              ]
            : []),
          ...(settings.attachmentLocation === 'subfolder'
            ? [
                {
                  id: 'attachment-subfolder',
                  name: t('files.attachmentSubfolderPath'),
                  desc: t('files.attachmentSubfolderPathDesc'),
                  control: (
                    <TextInput
                      value={settings.attachmentSubfolderPath}
                      placeholder={t('files.attachmentDefaultPlaceholder')}
                      onChange={set('attachmentSubfolderPath')}
                      ariaLabel={t('files.attachmentSubfolderPath')}
                    />
                  ),
                } as SettingItemDef,
              ]
            : []),
        ],
      },

      // Sección "Enlaces" (Tarjeta 2 con Encabezado Enlaces, 1:1 con Urano)
      {
        id: 'files-links',
        heading: t('files.linksHeading'),
        items: [
          // Fila 1 — Nuevo formato de enlace
          {
            id: 'new-link-format',
            name: t('files.newLinkFormat'),
            desc: t('files.newLinkFormatDesc'),
            control: (
              <Dropdown<NewLinkFormat>
                value={settings.newLinkFormat}
                ariaLabel={t('files.newLinkFormat')}
                options={[
                  { value: 'shortest', label: t('files.newLinkFormatOptions.shortest') },
                  { value: 'relative', label: t('files.newLinkFormatOptions.relative') },
                  { value: 'absolute', label: t('files.newLinkFormatOptions.absolute') },
                ]}
                onChange={set('newLinkFormat')}
              />
            ),
          },
          // Fila 2 — Actualizar los enlaces internos automáticamente
          {
            id: 'always-update-links',
            name: t('files.alwaysUpdateLinks'),
            desc: t('files.alwaysUpdateLinksDesc'),
            aliases: ['rename', 'renombrar', 'wikilink'],
            control: (
              <Toggle
                value={settings.alwaysUpdateLinks}
                onChange={set('alwaysUpdateLinks')}
                ariaLabel={t('files.alwaysUpdateLinks')}
              />
            ),
          },
          // Fila 3 — Usar [[Wikilinks]]
          {
            id: 'use-wikilinks',
            name: t('files.useWikilinks'),
            desc: t('files.useWikilinksDesc'),
            aliases: ['wikilink', 'markdown', 'enlace'],
            control: (
              <Toggle
                value={settings.useWikilinks}
                onChange={set('useWikilinks')}
                ariaLabel={t('files.useWikilinks')}
              />
            ),
          },
          // Fila 4 — Mostrar todos los tipos de archivo
          {
            id: 'detect-all-file-extensions',
            name: t('files.detectAllFileExtensions'),
            desc: t('files.detectAllFileExtensionsDesc'),
            aliases: ['extension', 'extensiones', 'all', 'todos', 'unsupported', 'archivos'],
            control: (
              <Toggle
                value={settings.detectAllFileExtensions}
                onChange={set('detectAllFileExtensions')}
                ariaLabel={t('files.detectAllFileExtensions')}
              />
            ),
          },
        ],
      },

      // Tarjeta 3 — Sección Papelera (Tarjeta con Encabezado Papelera, 1:1 con Urano)
      {
        id: 'files-trash',
        heading: t('files.trashHeading'),
        items: [
          // Fila 1 — Confirmar antes de eliminar archivos
          {
            id: 'confirm-file-deletion',
            name: t('files.confirmFileDeletion'),
            desc: t('files.confirmFileDeletionDesc'),
            aliases: ['confirm', 'delete', 'eliminar', 'confirmar'],
            control: (
              <Toggle
                value={settings.confirmFileDeletion}
                onChange={set('confirmFileDeletion')}
                ariaLabel={t('files.confirmFileDeletion')}
              />
            ),
          },
          // Fila 2 — Eliminar adjuntos al eliminar archivos
          {
            id: 'delete-attachments-with-file',
            name: t('files.deleteAttachmentsWithFile'),
            desc: t('files.deleteAttachmentsWithFileDesc'),
            aliases: ['attachments', 'adjuntos', 'delete', 'eliminar', 'unlinked'],
            control: (
              <Dropdown<DeleteAttachmentsWithFile>
                value={settings.deleteAttachmentsWithFile}
                ariaLabel={t('files.deleteAttachmentsWithFile')}
                options={[
                  { value: 'ask', label: t('files.deleteAttachmentsOptions.ask') },
                  { value: 'always', label: t('files.deleteAttachmentsOptions.always') },
                  { value: 'never', label: t('files.deleteAttachmentsOptions.never') },
                ]}
                onChange={set('deleteAttachmentsWithFile')}
              />
            ),
          },
          // Fila 3 — Archivos eliminados
          {
            id: 'trash-option',
            name: t('files.trashOption'),
            desc: t('files.trashOptionDesc'),
            aliases: ['trash', 'papelera', 'reciclaje', 'delete', 'recycle'],
            control: (
              <Dropdown<TrashOption>
                value={settings.trashOption}
                ariaLabel={t('files.trashOption')}
                options={[
                  { value: 'system', label: t('files.trashOptionOptions.system') },
                  { value: 'local', label: t('files.trashOptionOptions.local') },
                  { value: 'none', label: t('files.trashOptionOptions.none') },
                ]}
                onChange={set('trashOption')}
              />
            ),
          },
        ],
      },

      // Tarjeta 4 — Sección Avanzado (Tarjeta con Encabezado Avanzado, 1:1 con Urano)
      {
        id: 'files-advanced',
        heading: t('files.advancedHeading'),
        items: [
          // Fila 1 — Archivos excluidos
          {
            id: 'excluded-files',
            name: t('files.excludedFiles'),
            desc: t('files.excludedFilesDesc'),
            aliases: ['ignore', 'exclude', 'excluir', 'filtros', 'filters'],
            className: 'mod-clickable',
            onClick: () => {
              window.dispatchEvent(new CustomEvent('urano:open-excluded-files'));
            },
            control: (
              <div
                className="clickable-icon flex items-center justify-center p-1 text-urano-muted hover:text-urano-text transition-colors cursor-pointer"
                aria-label={t('files.excludedFiles')}
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('urano:open-excluded-files'));
                }}
              >
                <ChevronRight size={18} />
              </div>
            ),
          },
          // Fila 2 — Anular la carpeta de configuración
          {
            id: 'override-config-folder',
            name: t('files.configFolderOverride'),
            desc: (
              <>
                <span>{t('files.configFolderOverrideDesc')}</span>
                <br />
                <span>{t('files.configFolderOverrideMustStartWithDot')}</span>
              </>
            ),
            aliases: ['config', 'configuration', 'configuración', 'override', 'carpeta'],
            control: (
              <input
                type="text"
                value={settings.configFolderOverride || ''}
                placeholder={t('files.configFolderPlaceholder')}
                aria-label={t('files.configFolderOverride')}
                onChange={(e) => setSetting('configFolderOverride', e.target.value)}
                onBlur={(e) => {
                  const trimmed = e.target.value.trim();
                  if (trimmed && !trimmed.startsWith('.')) {
                    setSetting('configFolderOverride', `.${trimmed}`);
                  }
                }}
                className="setting-override-config-input"
              />
            ),
          },
          // Fila 3 — Permitir URI callbacks
          {
            id: 'uri-callbacks',
            name: t('files.uriCallbacks'),
            desc: (
              <>
                <span>{t('files.uriCallbacksDesc')}&nbsp;</span>
                <a
                  className="setting-link"
                  href="https://github.com/FranciscoArias10/Urano#uri-callbacks"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {t('files.learnMore')}
                </a>
              </>
            ),
            aliases: ['uri', 'callback', 'x-callback-url', 'protocolo'],
            control: (
              <Toggle
                value={settings.allowUriCallbacks}
                onChange={set('allowUriCallbacks')}
                ariaLabel={t('files.uriCallbacks')}
              />
            ),
          },
          // Fila 4 — Reconstruir caché de la bóveda
          {
            id: 'reindex-vault',
            name: t('files.reindexVault'),
            desc: (
              <>
                <span className="mod-warning">
                  {t('files.reindexVaultDesc')}
                </span>
                <br />
                <a
                  className="setting-link"
                  href="https://github.com/FranciscoArias10/Urano#almacenamiento-de-datos"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {t('files.learnMore')}
                </a>
              </>
            ),
            aliases: ['reindex', 'reconstruir', 'cache', 'caché', 'metadata', 'index'],
            control: <RebuildVaultCacheButton t={t} />,
          },
        ],
      },
    ],
  };

  /* ---------------- Hotkeys ---------------- */
  const commandHotkeys = (ctx.commands ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    hotkey: c.shortcut,
  }));
  const hotkeysSetting = useSettingsStore.getState().settings.hotkeys;
  const isEs = (language || 'es').toLowerCase().startsWith('es');
  const catalogHotkeys = HOTKEY_CATALOG.map((c) => {
    const assigned = getActiveHotkeys(c.id, hotkeysSetting);
    return {
      id: c.id,
      name: isEs ? c.nameEs : c.nameEn,
      hotkey: assigned.join(', '),
    };
  });
  const allHotkeys = [
    ...catalogHotkeys,
    ...commandHotkeys.filter((c) => !catalogHotkeys.some((k) => k.id === c.id)),
  ];

  const hotkeys: SettingTabDef = {
    id: 'hotkeys',
    name: t('tab.hotkeys'),
    icon: <Command size={ICON} />,
    section: 'options',
    groups: [
      {
        id: 'hotkeys-list',
        className: 'mod-hotkeys',
        heading: t('hotkeys.showing', { count: allHotkeys.length }),
        items: allHotkeys.map((h) => ({
          id: `hotkey-${h.id}`,
          name: h.name,
          aliases: h.hotkey ? [h.hotkey] : [],
          control: (
            <div className="setting-command-hotkeys">
              <HotkeyPill hotkey={h.hotkey} emptyLabel={t('hotkeys.blank')} />
            </div>
          ),
        })),
      },
    ],
  };

  /* ---------------- Keychain ---------------- */
  const keychain: SettingTabDef = {
    id: 'keychain',
    name: t('tab.keychain'),
    icon: <KeyRound size={ICON} />,
    section: 'options',
    groups: [
      {
        id: 'keychain-secrets',
        heading: t('keychain.secrets'),
        items: [
          {
            id: 'gdrive-session',
            name: t('keychain.gdrive'),
            desc: t('keychain.gdriveDesc'),
            aliases: ['oauth', 'google', 'session', 'token'],
            control: (
              <>
                <StatusPill tone={sync.isAuthenticated ? 'success' : 'neutral'}>
                  {sync.isAuthenticated ? t('keychain.connected') : t('keychain.notConnected')}
                </StatusPill>
                {sync.isAuthenticated ? (
                  <SettingButton onClick={() => sync.logout()}>{t('keychain.revoke')}</SettingButton>
                ) : (
                  <SettingButton disabled={sync.isAuthenticating} onClick={() => sync.loginWithGoogle()}>
                    {t('keychain.signIn')}
                  </SettingButton>
                )}
              </>
            ),
          },
        ],
      },
    ],
  };

  /* ---------------- Core plugins ---------------- */
  const corePlugins: SettingTabDef = {
    id: 'core-plugins',
    name: t('tab.corePlugins'),
    icon: <Blocks size={ICON} />,
    section: 'options',
    groups: [
      {
        id: 'core-plugins-list',
        className: 'mod-list',
        heading: t('tab.corePlugins'),
        headingControl: <span className="setting-item-value">{t('corePlugins.desc')}</span>,
        items: CORE_PLUGIN_IDS.map((id) => {
          const meta = CORE_PLUGIN_META[id];
          const enabled = settings.corePlugins[id];
          return {
            id: `plugin-${id}`,
            name: t(meta.nameKey),
            desc: t(meta.descKey),
            icon: meta.icon,
            control: (
              <>
                {enabled && (
                  <ExtraButton
                    icon={<SettingsIcon size={ICON} />}
                    tooltip={t('corePlugins.options')}
                    onClick={() => openSettings(meta.tabId)}
                  />
                )}
                <Toggle value={enabled} onChange={(v) => setCorePluginEnabled(id, v)} ariaLabel={t(meta.nameKey)} />
              </>
            ),
          };
        }),
      },
    ],
  };

  /* ---------------- Community plugins ---------------- */
  const communityPlugins: SettingTabDef = {
    id: 'community-plugins',
    name: t('tab.communityPlugins'),
    icon: <Puzzle size={ICON} />,
    section: 'options',
    groups: [
      {
        id: 'community-restricted',
        items: [
          {
            id: 'restricted-mode',
            name: t('community.restrictedMode'),
            desc: (
              <>
                {t('community.restrictedModeDesc')}
                <br />
                {t('community.notAvailable')}
              </>
            ),
            descText: `${t('community.restrictedModeDesc')} ${t('community.notAvailable')}`,
            control: <Toggle value={settings.communityRestrictedMode} onChange={set('communityRestrictedMode')} ariaLabel={t('community.restrictedMode')} />,
          },
        ],
      },
    ],
  };

  /* ---------------- Core plugin tabs ---------------- */
  const pluginTab = (id: CorePluginId, groups: SettingGroupDef[]): SettingTabDef => ({
    id: CORE_PLUGIN_META[id].tabId,
    name: t(CORE_PLUGIN_META[id].nameKey),
    icon: CORE_PLUGIN_META[id].icon,
    section: 'core-plugins',
    hidden: !settings.corePlugins[id],
    groups,
  });

  const backlinks = pluginTab('backlinks', [
    {
      id: 'backlinks-options',
      items: [
        {
          id: 'backlinks-in-document',
          name: t('backlinks.showInDocument'),
          desc: t('backlinks.showInDocumentDesc'),
          control: <Toggle value={settings.backlinksInDocument} onChange={set('backlinksInDocument')} ariaLabel={t('backlinks.showInDocument')} />,
        },
      ],
    },
  ]);

  const canvas = pluginTab('canvas', [
    {
      id: 'canvas-options',
      items: [
        {
          id: 'canvas-snap-grid',
          name: t('canvas.snapToGrid'),
          desc: t('canvas.snapToGridDesc'),
          control: <Toggle value={settings.canvasSnapToGrid} onChange={set('canvasSnapToGrid')} ariaLabel={t('canvas.snapToGrid')} />,
        },
        {
          id: 'canvas-snap-objects',
          name: t('canvas.snapToObjects'),
          desc: t('canvas.snapToObjectsDesc'),
          control: <Toggle value={settings.canvasSnapToObjects} onChange={set('canvasSnapToObjects')} ariaLabel={t('canvas.snapToObjects')} />,
        },
        {
          id: 'canvas-zoom-threshold',
          name: t('canvas.zoomThreshold'),
          desc: t('canvas.zoomThresholdDesc'),
          control: (
            <Slider
              value={settings.canvasZoomThreshold}
              min={0.1}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setSetting('canvasZoomThreshold', Math.round(v * 100) / 100)}
              ariaLabel={t('canvas.zoomThreshold')}
            />
          ),
        },
      ],
    },
  ]);

  const commandPalette = pluginTab('command-palette', [
    {
      id: 'command-palette-pinned',
      heading: t('commandPalette.pinned'),
      items: [
        {
          id: 'command-palette-pinned-info',
          name: t('commandPalette.pinned'),
          desc: `${t('commandPalette.pinnedDesc')} ${t('commandPalette.none')}`,
        },
      ],
    },
  ]);

  const dailyNotes = pluginTab('daily-notes', [
    {
      id: 'daily-notes-options',
      items: [
        {
          id: 'daily-notes-format',
          name: t('dailyNotes.format'),
          desc: t('dailyNotes.formatDesc'),
          control: <span className="setting-item-value">YYYY-MM-DD</span>,
        },
        {
          id: 'daily-notes-folder',
          name: t('dailyNotes.folder'),
          desc: t('dailyNotes.folderDesc'),
          control: (
            <TextInput
              value={settings.dailyNotesFolder}
              placeholder={t('files.folderPlaceholder')}
              onChange={set('dailyNotesFolder')}
              ariaLabel={t('dailyNotes.folder')}
            />
          ),
        },
        {
          id: 'daily-notes-startup',
          name: t('dailyNotes.openOnStartup'),
          desc: t('dailyNotes.openOnStartupDesc'),
          control: <Toggle value={settings.dailyNotesOpenOnStartup} onChange={set('dailyNotesOpenOnStartup')} ariaLabel={t('dailyNotes.openOnStartup')} />,
        },
      ],
    },
  ]);

  const fileRecovery = pluginTab('file-recovery', [
    {
      id: 'file-recovery-options',
      items: [
        {
          id: 'file-recovery-interval',
          name: t('fileRecovery.interval'),
          desc: t('fileRecovery.intervalDesc'),
          control: (
            <Slider
              value={settings.fileRecoveryIntervalMinutes}
              min={1}
              max={60}
              step={1}
              format={(v) => `${v} min`}
              onChange={set('fileRecoveryIntervalMinutes')}
              ariaLabel={t('fileRecovery.interval')}
            />
          ),
        },
        {
          id: 'file-recovery-history',
          name: t('fileRecovery.history'),
          desc: t('fileRecovery.historyDesc'),
          control: (
            <Slider
              value={settings.fileRecoveryHistoryDays}
              min={1}
              max={30}
              step={1}
              format={(v) => `${v} d`}
              onChange={set('fileRecoveryHistoryDays')}
              ariaLabel={t('fileRecovery.history')}
            />
          ),
        },
      ],
    },
  ]);

  const noteComposer = pluginTab('note-composer', [
    {
      id: 'note-composer-options',
      items: [
        {
          id: 'note-composer-text',
          name: t('noteComposer.templateFile'),
          desc: t('noteComposer.templateFileDesc'),
          control: (
            <TextInput
              value={settings.noteComposerTextAfterExtraction}
              onChange={set('noteComposerTextAfterExtraction')}
              ariaLabel={t('noteComposer.templateFile')}
            />
          ),
        },
        {
          id: 'note-composer-confirm',
          name: t('noteComposer.confirm'),
          desc: t('noteComposer.confirmDesc'),
          control: <Toggle value={settings.noteComposerConfirmMerge} onChange={set('noteComposerConfirmMerge')} ariaLabel={t('noteComposer.confirm')} />,
        },
      ],
    },
  ]);

  const pagePreview = pluginTab('page-preview', [
    {
      id: 'page-preview-options',
      items: [
        {
          id: 'page-preview-ctrl',
          name: t('pagePreview.requireCtrl'),
          desc: t('pagePreview.requireCtrlDesc'),
          control: <Toggle value={settings.pagePreviewRequireCtrl} onChange={set('pagePreviewRequireCtrl')} ariaLabel={t('pagePreview.requireCtrl')} />,
        },
      ],
    },
  ]);

  const quickSwitcher = pluginTab('switcher', [
    {
      id: 'switcher-options',
      items: [
        {
          id: 'switcher-attachments',
          name: t('quickSwitcher.showAttachments'),
          desc: t('quickSwitcher.showAttachmentsDesc'),
          control: <Toggle value={settings.quickSwitcherShowAttachments} onChange={set('quickSwitcherShowAttachments')} ariaLabel={t('quickSwitcher.showAttachments')} />,
        },
        {
          id: 'switcher-existing',
          name: t('quickSwitcher.showExisting'),
          desc: t('quickSwitcher.showExistingDesc'),
          control: <Toggle value={settings.quickSwitcherShowExistingOnly} onChange={set('quickSwitcherShowExistingOnly')} ariaLabel={t('quickSwitcher.showExisting')} />,
        },
      ],
    },
  ]);

  /* ---------------- Sync (Google Drive) ----------------
     Mirrors Urano's Sync tab (urano.asar/app.js `mie.display`): account / remote vault
     first, then "Sync status" with its Pause/Resume-style action, then "Activity log" → View
     (`optionSyncLog` + `buttonView`). */
  const syncStatusKey = `sync.status.${sync.isSyncing ? 'syncing' : sync.status}` as Parameters<Translate>[0];
  const syncStatusTone =
    sync.isSyncing
      ? 'active'
      : sync.status === 'synced'
      ? 'success'
      : sync.status === 'conflict'
      ? 'warning'
      : sync.status === 'error' || sync.status === 'offline'
      ? 'error'
      : 'neutral';

  const syncTab = pluginTab('sync', [
    {
      id: 'sync-account-group',
      heading: t('sync.account'),
      items: [
        {
          id: 'sync-account',
          name: sync.isAuthenticated && sync.user ? sync.user.name : t('sync.account'),
          desc: sync.isAuthenticated && sync.user
            ? t('sync.connectedAs', { name: sync.user.name, email: sync.user.email })
            : t('sync.notConnected'),
          aliases: ['google', 'drive', 'login', 'sign in', 'account'],
          control: sync.isAuthenticated ? (
            <div className="flex items-center gap-2">
              {sync.userAvatar ? (
                <img
                  src={sync.userAvatar}
                  alt={sync.userName || 'Google'}
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded-full border border-urano-border"
                />
              ) : null}
              <SettingButton onClick={() => sync.logout()}>{t('sync.disconnect')}</SettingButton>
            </div>
          ) : (
            <SettingButton cta disabled={sync.isAuthenticating} onClick={() => sync.loginWithGoogle()}>
              {sync.isAuthenticating ? t('sync.connecting') : t('sync.connect')}
            </SettingButton>
          ),
        },
      ],
    },
    {
      id: 'sync-options-group',
      heading: t('sync.statusName'),
      items: [
        {
          id: 'sync-auto',
          name: t('sync.autoSync'),
          desc: t('sync.autoSyncDesc'),
          aliases: ['auto', 'automatic', 'real time'],
          control: (
            <Toggle
              value={sync.autoSyncEnabled}
              onChange={(enabled) => sync.setAutoSyncEnabled(enabled)}
              ariaLabel={t('sync.autoSync')}
            />
          ),
        },
        {
          id: 'sync-status',
          name: t('sync.statusName'),
          desc: activeVault
            ? sync.lastSynced
              ? t('sync.lastSynced', { time: sync.lastSynced })
              : t('sync.never')
            : t('sync.noVault'),
          control: (
            <>
              <StatusPill tone={syncStatusTone}>{t(syncStatusKey)}</StatusPill>
              <SettingButton
                cta
                disabled={!activeVault || sync.isSyncing || !sync.isAuthenticated || !sync.isOnline}
                onClick={() => activeVault && sync.triggerSync(activeVault)}
              >
                {t('sync.syncNow')}
              </SettingButton>
            </>
          ),
        },
        {
          id: 'sync-log',
          name: t('sync.activityLog'),
          desc: t('sync.activityLogDesc'),
          aliases: ['log', 'history'],
          control: <SettingButton onClick={ctx.onOpenSyncLogs}>{t('sync.viewLog')}</SettingButton>,
        },
        {
          id: 'sync-manage',
          name: t('sync.manage'),
          desc: t('sync.manageDesc'),
          aliases: ['drive', 'remote', 'download', 'vaults'],
          control: (
            <SettingButton disabled={!sync.isAuthenticated} onClick={() => sync.setShowConfigModal(true)}>
              {t('general.manage')}
            </SettingButton>
          ),
        },
      ],
    },
  ]);

  const templates = pluginTab('templates', [
    {
      id: 'templates-options',
      items: [
        {
          id: 'templates-folder',
          name: t('templates.folder'),
          desc: t('templates.folderDesc'),
          control: (
            <TextInput
              value={settings.templatesFolder}
              placeholder={t('files.folderPlaceholder')}
              onChange={set('templatesFolder')}
              ariaLabel={t('templates.folder')}
            />
          ),
        },
        {
          id: 'templates-date',
          name: t('templates.dateFormat'),
          control: <TextInput value={settings.templatesDateFormat} onChange={set('templatesDateFormat')} ariaLabel={t('templates.dateFormat')} />,
        },
        {
          id: 'templates-time',
          name: t('templates.timeFormat'),
          control: <TextInput value={settings.templatesTimeFormat} onChange={set('templatesTimeFormat')} ariaLabel={t('templates.timeFormat')} />,
        },
      ],
    },
  ]);

  // Order: Options group (9) then Core plugins group (10), exactly like Urano's sidebar.
  return [
    general,
    appearance,
    interfaceTab,
    editor,
    files,
    hotkeys,
    keychain,
    corePlugins,
    communityPlugins,
    backlinks,
    canvas,
    commandPalette,
    dailyNotes,
    fileRecovery,
    noteComposer,
    pagePreview,
    quickSwitcher,
    syncTab,
    templates,
  ];
}
