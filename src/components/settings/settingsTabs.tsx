import React, { useState } from 'react';
import {
  CircleUserRound,
  Palette,
  AppWindow,
  PenLine,
  Folder,
  Command,
  KeyRound,
  Blocks,
  Puzzle,
  Link,
  LayoutGrid,
  Terminal,
  Calendar,
  History,
  GitMerge,
  Eye,
  FileSearch,
  RefreshCw,
  Files,
  Timer,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  useSettingsStore,
  useT,
  Translate,
  UranoSettings,
  CorePluginId,
  CORE_PLUGIN_IDS,
  DEFAULT_SETTINGS,
  URANO_ACCENT,
  Language,
  ThemeMode,
  UpdateLinksPref,
  AttachmentLocation,
  StorageBackend,
} from '../../stores/settingsStore';
import { useSyncStore } from '../../stores/syncStore';
import { useVaultStore } from '../../stores/vaultStore';
import { useNoticeStore } from '../common/Notice';
import {
  LocalAdapter,
  GoogleDriveAdapter,
  setStorageAdapter,
} from '../../services/storageAdapter';
import type { CommandItem } from '../palette/CommandPalette';
import {
  Toggle,
  Dropdown,
  SettingButton,
  ExtraButton,
  SettingLink,
  TextInput,
  Slider,
  ColorInput,
  StatusPill,
  HotkeyPill,
} from './SettingControls';

/* ----------------------------------------------------------------------------
 * Declarative tab definitions (mirrors Obsidian's `SettingTab.getSettingDefinitions`)
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
  /** Extra search terms (Obsidian `aliases`). */
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
}

export const URANO_VERSION = '1.14.5';
export const URANO_INSTALLER_VERSION = '1.14.4';

const ICON = 16;

export const CORE_PLUGIN_META: Record<
  CorePluginId,
  { tabId: string; nameKey: Parameters<Translate>[0]; descKey: Parameters<Translate>[0]; icon: React.ReactNode }
> = {
  backlinks: { tabId: 'backlinks', nameKey: 'tab.backlinks', descKey: 'plugin.backlinks.desc', icon: <Link size={ICON} /> },
  canvas: { tabId: 'canvas', nameKey: 'tab.canvas', descKey: 'plugin.canvas.desc', icon: <LayoutGrid size={ICON} /> },
  'command-palette': { tabId: 'command-palette', nameKey: 'tab.commandPalette', descKey: 'plugin.commandPalette.desc', icon: <Terminal size={ICON} /> },
  'daily-notes': { tabId: 'daily-notes', nameKey: 'tab.dailyNotes', descKey: 'plugin.dailyNotes.desc', icon: <Calendar size={ICON} /> },
  'file-recovery': { tabId: 'file-recovery', nameKey: 'tab.fileRecovery', descKey: 'plugin.fileRecovery.desc', icon: <History size={ICON} /> },
  'note-composer': { tabId: 'note-composer', nameKey: 'tab.noteComposer', descKey: 'plugin.noteComposer.desc', icon: <GitMerge size={ICON} /> },
  'page-preview': { tabId: 'page-preview', nameKey: 'tab.pagePreview', descKey: 'plugin.pagePreview.desc', icon: <Eye size={ICON} /> },
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

/* --- Hook building every tab -------------------------------------------------- */

export function useSettingTabs(ctx: SettingTabsContext = {}): SettingTabDef[] {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const setCorePluginEnabled = useSettingsStore((s) => s.setCorePluginEnabled);
  const startupMs = useSettingsStore((s) => s.startupMs);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const { showNotice } = useNoticeStore();

  const sync = useSyncStore();
  const { activeVault } = useVaultStore();

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
                <SettingLink href="https://obsidian.md/changelog/">{t('general.readChangelog')}</SettingLink>
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
                <SettingLink href="https://help.obsidian.md/translations">{t('general.addLanguage')}</SettingLink>
              </>
            ),
            descText: `${t('general.languageDesc')} ${t('general.addLanguage')}`,
            aliases: ['idioma', 'english', 'español', 'spanish'],
            control: (
              <Dropdown<Language>
                value={settings.language}
                ariaLabel={t('general.language')}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'es', label: 'Español' },
                ]}
                onChange={set('language')}
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
                <SettingLink href="https://obsidian.md/license">{t('general.learnMore')}</SettingLink>
              </>
            ),
            descText: `${t('general.commercialLicenseDesc')} ${t('general.learnMore')}`,
            control: (
              <>
                <SettingButton onClick={() => showNotice('Urano is free and open: no license needed.', 3000, 'info')}>
                  {t('general.activate')}
                </SettingButton>
                <SettingButton onClick={() => window.open('https://obsidian.md/pricing', '_blank', 'noopener')}>
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
                  icon={<Timer size={ICON} color="#888" />}
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
                <span className="mod-warning" style={{ color: '#e08a3c' }}>
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
            aliases: ['dark', 'light', 'theme', 'tema', 'oscuro', 'claro'],
            control: (
              <Dropdown<ThemeMode>
                value={settings.theme}
                ariaLabel={t('appearance.baseTheme')}
                options={[
                  { value: 'dark', label: t('appearance.themeDark') },
                  { value: 'light', label: t('appearance.themeLight') },
                  { value: 'system', label: t('appearance.themeSystem') },
                ]}
                onChange={set('theme')}
              />
            ),
          },
          {
            id: 'accent-color',
            name: t('appearance.accent'),
            desc: t('appearance.accentDesc'),
            aliases: ['color', 'naranja', 'orange'],
            control: (
              <>
                {settings.accentColor.toLowerCase() !== URANO_ACCENT && (
                  <SettingButton onClick={() => setSetting('accentColor', URANO_ACCENT)}>
                    {t('appearance.restoreDefault')}
                  </SettingButton>
                )}
                <ColorInput value={settings.accentColor} onChange={set('accentColor')} ariaLabel={t('appearance.accent')} />
              </>
            ),
          },
        ],
      },
      {
        id: 'appearance-font',
        heading: t('appearance.interfaceFont'),
        items: [
          {
            id: 'font-size',
            name: t('appearance.fontSize'),
            desc: t('appearance.fontSizeDesc'),
            control: (
              <>
                {settings.editorFontSize !== DEFAULT_SETTINGS.editorFontSize && (
                  <ExtraButton
                    icon={<History size={ICON} />}
                    tooltip={t('appearance.restoreDefault')}
                    onClick={() => setSetting('editorFontSize', DEFAULT_SETTINGS.editorFontSize)}
                  />
                )}
                <Slider
                  value={settings.editorFontSize}
                  min={10}
                  max={30}
                  step={1}
                  format={(v) => `${v}px`}
                  onChange={set('editorFontSize')}
                  ariaLabel={t('appearance.fontSize')}
                />
              </>
            ),
          },
          {
            id: 'zoom-level',
            name: t('appearance.zoom'),
            desc: t('appearance.zoomDesc'),
            control: (
              <>
                {settings.zoomLevel !== 1 && (
                  <ExtraButton
                    icon={<History size={ICON} />}
                    tooltip={t('appearance.restoreDefault')}
                    onClick={() => setSetting('zoomLevel', 1)}
                  />
                )}
                <Slider
                  value={settings.zoomLevel}
                  min={0.5}
                  max={2}
                  step={0.1}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setSetting('zoomLevel', Math.round(v * 10) / 10)}
                  ariaLabel={t('appearance.zoom')}
                />
              </>
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
      {
        id: 'interface-layout',
        items: [
          {
            id: 'show-ribbon',
            name: t('interface.showRibbon'),
            desc: t('interface.showRibbonDesc'),
            control: <Toggle value={settings.showRibbon} onChange={set('showRibbon')} ariaLabel={t('interface.showRibbon')} />,
          },
          {
            id: 'show-inline-title',
            name: t('interface.showInlineTitle'),
            desc: t('interface.showInlineTitleDesc'),
            control: <Toggle value={settings.showInlineTitle} onChange={set('showInlineTitle')} ariaLabel={t('interface.showInlineTitle')} />,
          },
          {
            id: 'show-status-bar',
            name: t('interface.showStatusBar'),
            desc: t('interface.showStatusBarDesc'),
            control: <Toggle value={settings.showStatusBar} onChange={set('showStatusBar')} ariaLabel={t('interface.showStatusBar')} />,
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
      {
        id: 'editor-behavior',
        heading: t('editor.behavior'),
        items: [
          {
            id: 'spellcheck',
            name: t('editor.spellcheck'),
            desc: t('editor.spellcheckDesc'),
            aliases: ['ortografía', 'corrector'],
            control: <Toggle value={settings.spellcheck} onChange={set('spellcheck')} ariaLabel={t('editor.spellcheck')} />,
          },
        ],
      },
      {
        id: 'editor-display',
        heading: t('editor.display'),
        items: [
          {
            id: 'readable-line-length',
            name: t('editor.readableLineLength'),
            desc: t('editor.readableLineLengthDesc'),
            control: <Toggle value={settings.readableLineLength} onChange={set('readableLineLength')} ariaLabel={t('editor.readableLineLength')} />,
          },
          {
            id: 'strict-line-breaks',
            name: t('editor.strictLineBreaks'),
            desc: t('editor.strictLineBreaksDesc'),
            control: <Toggle value={settings.strictLineBreaks} onChange={set('strictLineBreaks')} ariaLabel={t('editor.strictLineBreaks')} />,
          },
          {
            id: 'show-line-numbers',
            name: t('editor.showLineNumbers'),
            desc: t('editor.showLineNumbersDesc'),
            aliases: ['gutter', 'números de línea'],
            control: <Toggle value={settings.showLineNumbers} onChange={set('showLineNumbers')} ariaLabel={t('editor.showLineNumbers')} />,
          },
        ],
      },
      {
        id: 'editor-indent',
        heading: t('editor.indentation'),
        items: [
          {
            id: 'use-tabs',
            name: t('editor.useTabs'),
            desc: t('editor.useTabsDesc'),
            control: <Toggle value={settings.useTabs} onChange={set('useTabs')} ariaLabel={t('editor.useTabs')} />,
          },
          {
            id: 'tab-size',
            name: t('editor.tabSize'),
            desc: t('editor.tabSizeDesc'),
            aliases: ['tabulación', 'indent'],
            control: (
              <Dropdown
                value={String(settings.tabSize)}
                ariaLabel={t('editor.tabSize')}
                options={['2', '3', '4', '6', '8'].map((v) => ({ value: v, label: v }))}
                onChange={(v) => setSetting('tabSize', Number(v))}
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
      {
        id: 'files-general',
        items: [
          {
            id: 'confirm-deletion',
            name: t('files.confirmDeletion'),
            desc: t('files.confirmDeletionDesc'),
            control: <Toggle value={settings.confirmFileDeletion} onChange={set('confirmFileDeletion')} ariaLabel={t('files.confirmDeletion')} />,
          },
          {
            id: 'update-links',
            name: t('files.updateLinks'),
            desc: t('files.updateLinksDesc'),
            aliases: ['rename', 'renombrar', 'wikilink'],
            control: (
              <Dropdown<UpdateLinksPref>
                value={settings.alwaysUpdateLinks}
                ariaLabel={t('files.updateLinks')}
                options={[
                  { value: 'always', label: t('files.updateLinks.always') },
                  { value: 'prompt', label: t('files.updateLinks.prompt') },
                  { value: 'never', label: t('files.updateLinks.never') },
                ]}
                onChange={set('alwaysUpdateLinks')}
              />
            ),
          },
        ],
      },
      {
        id: 'files-attachments',
        items: [
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
                  { value: 'root', label: t('files.attachment.root') },
                  { value: 'folder', label: t('files.attachment.folder') },
                  { value: 'current', label: t('files.attachment.current') },
                ]}
                onChange={set('attachmentLocation')}
              />
            ),
          },
          ...(settings.attachmentLocation === 'folder'
            ? [
                {
                  id: 'attachment-folder',
                  name: t('files.attachmentFolder'),
                  desc: t('files.attachmentFolderDesc'),
                  control: (
                    <TextInput
                      value={settings.attachmentFolderPath}
                      placeholder={t('files.folderPlaceholder')}
                      onChange={set('attachmentFolderPath')}
                      ariaLabel={t('files.attachmentFolder')}
                    />
                  ),
                } as SettingItemDef,
              ]
            : []),
        ],
      },
    ],
  };

  /* ---------------- Hotkeys ---------------- */
  const fixedHotkeys: { id: string; name: string; hotkey: string }[] = [
    { id: 'app:open-settings', name: 'Open settings', hotkey: 'Ctrl+,' },
    { id: 'workspace:new-tab', name: 'New tab', hotkey: 'Ctrl+T' },
    { id: 'markdown:toggle-preview', name: 'Toggle reading view', hotkey: 'Ctrl+E' },
    { id: 'app:go-back', name: 'Navigate back', hotkey: 'Alt+←' },
    { id: 'app:go-forward', name: 'Navigate forward', hotkey: 'Alt+→' },
    { id: 'editor:save-file', name: 'Save current file', hotkey: 'Ctrl+S' },
    { id: 'editor:toggle-bold', name: 'Toggle bold', hotkey: 'Ctrl+B (editor)' },
    { id: 'editor:toggle-italics', name: 'Toggle italics', hotkey: 'Ctrl+I' },
    { id: 'app:reload', name: 'Reload app', hotkey: 'Ctrl+R' },
  ];
  const commandHotkeys = (ctx.commands ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    hotkey: c.shortcut,
  }));
  const allHotkeys = [...commandHotkeys, ...fixedHotkeys.filter((f) => !commandHotkeys.some((c) => c.id === f.id))];

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
        headingControl: <span className="setting-item-value">{t('hotkeys.readOnly')}</span>,
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
            id: 'gdrive-oauth',
            name: t('keychain.gdrive'),
            desc: t('keychain.gdriveDesc'),
            aliases: ['oauth', 'client id', 'secret'],
            control: (
              <>
                <StatusPill tone={sync.clientId ? 'success' : 'neutral'}>
                  {sync.clientId ? t('keychain.configured') : t('keychain.notConfigured')}
                </StatusPill>
                <SettingButton onClick={() => sync.setShowConfigModal(true)}>{t('keychain.edit')}</SettingButton>
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

  /* ---------------- Sync (StorageAdapter: Local / Google Drive) ---------------- */
  const statusKey = `sync.status.${sync.isSyncing ? 'syncing' : sync.status}` as Parameters<Translate>[0];
  const statusTone =
    sync.isSyncing ? 'active' : sync.status === 'synced' ? 'success' : sync.status === 'conflict' ? 'warning' : sync.status === 'error' ? 'error' : 'neutral';

  const applyBackend = (backend: StorageBackend) => {
    setStorageAdapter(backend === 'gdrive' ? new GoogleDriveAdapter() : new LocalAdapter());
    setSetting('storageBackend', backend);
  };

  const syncTab = pluginTab('sync', [
    {
      id: 'sync-storage',
      heading: t('sync.storage'),
      items: [
        {
          id: 'sync-adapter',
          name: t('sync.adapter'),
          desc: t('sync.adapterDesc'),
          aliases: ['local', 'google drive', 'storage adapter'],
          control: (
            <Dropdown<StorageBackend>
              value={settings.storageBackend}
              ariaLabel={t('sync.adapter')}
              options={[
                { value: 'local', label: t('sync.adapter.local') },
                { value: 'gdrive', label: t('sync.adapter.gdrive') },
              ]}
              onChange={applyBackend}
            />
          ),
        },
        {
          id: 'sync-account',
          name: t('sync.account'),
          desc: sync.isAuthenticated && sync.user
            ? t('sync.connectedAs', { name: sync.user.name, email: sync.user.email })
            : t('sync.notConnected'),
          control: sync.isAuthenticated ? (
            <>
              <SettingButton onClick={() => sync.setShowConfigModal(true)}>{t('sync.configure')}</SettingButton>
              <SettingButton onClick={() => sync.logout()}>{t('sync.disconnect')}</SettingButton>
            </>
          ) : (
            <>
              <SettingButton onClick={() => sync.setShowConfigModal(true)}>{t('sync.configure')}</SettingButton>
              <SettingButton cta onClick={() => sync.loginWithGoogle()}>{t('sync.connect')}</SettingButton>
            </>
          ),
        },
        {
          id: 'sync-remote-folder',
          name: t('sync.remoteFolder'),
          desc: t('sync.remoteFolderDesc'),
          control: (
            <TextInput
              value={sync.folderName}
              onChange={(v) => sync.setCredentials(sync.clientId, sync.clientSecret, v.trim() || 'UranoVault')}
              ariaLabel={t('sync.remoteFolder')}
            />
          ),
        },
      ],
    },
    {
      id: 'sync-status-group',
      heading: t('sync.status'),
      items: [
        {
          id: 'sync-status',
          name: t(statusKey),
          desc: activeVault
            ? sync.lastSynced
              ? t('sync.lastSynced', { time: sync.lastSynced })
              : t('sync.never')
            : t('sync.noVault'),
          control: (
            <>
              <StatusPill tone={statusTone}>{t(statusKey)}</StatusPill>
              <SettingButton onClick={ctx.onOpenSyncLogs}>{t('sync.viewLog')}</SettingButton>
              <SettingButton
                cta
                disabled={!activeVault || sync.isSyncing}
                onClick={() => activeVault && sync.triggerSync(activeVault)}
              >
                {t('sync.syncNow')}
              </SettingButton>
            </>
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

  // Order: Options group (9) then Core plugins group (10), exactly like Obsidian's sidebar.
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
