import { create } from 'zustand';
import { useCallback, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t as translateKey, subscribe as subscribeI18n, getVersion as getI18nVersion } from '../locales/i18n';
import type { TranslateParams } from '../locales/i18n';
import { DEFAULT_LANGUAGE, detectSystemLanguage, normalizeLanguageCode } from '../locales/languages';

/** Código de idioma BCP-47 en minúsculas (`en`, `es`, `pt-br`…). Ver `locales/languages.ts`. */
export type Language = string;
export type ThemeMode = 'dark' | 'light' | 'system';
export type UpdateLinksPref = 'always' | 'prompt' | 'never';
export type AttachmentLocation = 'root' | 'folder' | 'current';
export type StorageBackend = 'local' | 'gdrive';

export const CORE_PLUGIN_IDS = [
  'backlinks',
  'canvas',
  'command-palette',
  'daily-notes',
  'file-recovery',
  'note-composer',
  'page-preview',
  'switcher',
  'sync',
  'templates',
] as const;
export type CorePluginId = (typeof CORE_PLUGIN_IDS)[number];

/** Everything Urano persists in `.urano/settings.json` (and mirrors in localStorage). */
export interface UranoSettings {
  // General
  autoUpdate: boolean;
  language: Language;
  slowStartupCheck: boolean;
  cli: boolean;
  hardwareAcceleration: boolean;

  // Appearance
  theme: ThemeMode;
  accentColor: string;
  cssTheme: string;
  enabledCssSnippets: string[];
  interfaceFontFamily: string;
  textFontFamily: string;
  monospaceFontFamily: string;
  baseFontSize: number;
  baseFontSizeAction: boolean;
  customIcon: string | null;
  editorFontSize: number;
  zoomLevel: number;

  // Interface
  showRibbon: boolean;
  showInlineTitle: boolean;
  showStatusBar: boolean;

  // Editor (CodeMirror 6)
  spellcheck: boolean;
  customDictionary: string[];
  readableLineLength: boolean;
  strictLineBreaks: boolean;
  showLineNumbers: boolean;
  useTabs: boolean;
  tabSize: number;

  // Files and links
  confirmFileDeletion: boolean;
  alwaysUpdateLinks: UpdateLinksPref;
  attachmentLocation: AttachmentLocation;
  attachmentFolderPath: string;

  // Sync / storage
  storageBackend: StorageBackend;

  // Core plugins
  corePlugins: Record<CorePluginId, boolean>;

  // Core plugin options
  backlinksInDocument: boolean;
  canvasSnapToGrid: boolean;
  canvasSnapToObjects: boolean;
  canvasZoomThreshold: number;
  dailyNotesFolder: string;
  dailyNotesOpenOnStartup: boolean;
  fileRecoveryIntervalMinutes: number;
  fileRecoveryHistoryDays: number;
  noteComposerConfirmMerge: boolean;
  noteComposerTextAfterExtraction: string;
  pagePreviewRequireCtrl: boolean;
  quickSwitcherShowAttachments: boolean;
  quickSwitcherShowExistingOnly: boolean;
  templatesFolder: string;
  templatesDateFormat: string;
  templatesTimeFormat: string;
  communityRestrictedMode: boolean;
}

export const URANO_ACCENT = '#e06c1b';

export const DEFAULT_SETTINGS: UranoSettings = {
  autoUpdate: true,
  // Igual que Obsidian: idioma del sistema si está en el catálogo, si no inglés.
  language: detectSystemLanguage(),
  slowStartupCheck: false,
  cli: false,
  hardwareAcceleration: true,

  theme: 'dark',
  accentColor: URANO_ACCENT,
  cssTheme: '',
  enabledCssSnippets: [],
  interfaceFontFamily: '',
  textFontFamily: '',
  monospaceFontFamily: '',
  baseFontSize: 16,
  baseFontSizeAction: true,
  customIcon: null,
  editorFontSize: 16,
  zoomLevel: 1,

  showRibbon: true,
  showInlineTitle: true,
  showStatusBar: true,

  spellcheck: true,
  customDictionary: [],
  readableLineLength: true,
  strictLineBreaks: false,
  showLineNumbers: false,
  useTabs: false,
  tabSize: 4,

  confirmFileDeletion: true,
  alwaysUpdateLinks: 'prompt',
  attachmentLocation: 'root',
  attachmentFolderPath: 'attachments',

  storageBackend: 'local',

  corePlugins: {
    backlinks: true,
    canvas: true,
    'command-palette': true,
    'daily-notes': true,
    'file-recovery': true,
    'note-composer': true,
    'page-preview': true,
    switcher: true,
    sync: true,
    templates: true,
  },

  backlinksInDocument: false,
  canvasSnapToGrid: true,
  canvasSnapToObjects: true,
  canvasZoomThreshold: 0.5,
  dailyNotesFolder: '',
  dailyNotesOpenOnStartup: false,
  fileRecoveryIntervalMinutes: 5,
  fileRecoveryHistoryDays: 7,
  noteComposerConfirmMerge: true,
  noteComposerTextAfterExtraction: '![[{{newFile}}]]',
  pagePreviewRequireCtrl: false,
  quickSwitcherShowAttachments: false,
  quickSwitcherShowExistingOnly: false,
  templatesFolder: 'Templates',
  templatesDateFormat: 'YYYY-MM-DD',
  templatesTimeFormat: 'HH:mm',
  communityRestrictedMode: true,
};

const LOCAL_STORAGE_KEY = 'urano_settings';
/** Key read by `linkRefactorService.getAlwaysUpdateLinksPref()`; kept in sync. */
const LINKS_PREF_KEY = 'urano_always_update_links';
const SETTINGS_FILE_RELATIVE = '.urano/settings.json';

/** Merges a partial/unknown object into the defaults, dropping unknown keys and bad types. */
function mergeSettings(raw: unknown): UranoSettings {
  const out: UranoSettings = { ...DEFAULT_SETTINGS, corePlugins: { ...DEFAULT_SETTINGS.corePlugins } };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof UranoSettings)[]) {
    const value = src[key];
    if (value === undefined) continue;
    if (key === 'corePlugins') {
      if (value && typeof value === 'object') {
        for (const id of CORE_PLUGIN_IDS) {
          const v = (value as Record<string, unknown>)[id];
          if (typeof v === 'boolean') out.corePlugins[id] = v;
        }
      }
      continue;
    }
    if (key === 'customDictionary') {
      if (Array.isArray(value)) {
        out.customDictionary = Array.from(
          new Set(
            value
              .filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
              .map((w) => w.trim())
          )
        );
      }
      continue;
    }
    if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  out.spellcheck = src.spellcheck !== undefined ? Boolean(src.spellcheck) : true;
  out.language =
    typeof out.language === 'string' && out.language.trim()
      ? normalizeLanguageCode(out.language)
      : DEFAULT_LANGUAGE;
  if (!['dark', 'light', 'system'].includes(out.theme)) out.theme = 'dark';
  if (!['always', 'prompt', 'never'].includes(out.alwaysUpdateLinks)) out.alwaysUpdateLinks = 'prompt';
  if (!['root', 'folder', 'current'].includes(out.attachmentLocation)) out.attachmentLocation = 'root';
  if (!['local', 'gdrive'].includes(out.storageBackend)) out.storageBackend = 'local';
  if (!/^#[0-9a-fA-F]{6}$/.test(out.accentColor)) out.accentColor = URANO_ACCENT;
  out.cssTheme = typeof src?.cssTheme === 'string' ? src.cssTheme : '';
  out.enabledCssSnippets = Array.isArray(src?.enabledCssSnippets) ? src.enabledCssSnippets : [];
  out.interfaceFontFamily = typeof src?.interfaceFontFamily === 'string' ? src.interfaceFontFamily : '';
  out.textFontFamily = typeof src?.textFontFamily === 'string' ? src.textFontFamily : '';
  out.monospaceFontFamily = typeof src?.monospaceFontFamily === 'string' ? src.monospaceFontFamily : '';
  out.baseFontSize = typeof src?.baseFontSize === 'number' ? Math.min(30, Math.max(10, Math.round(src.baseFontSize))) : 16;
  out.baseFontSizeAction = src?.baseFontSizeAction !== undefined ? Boolean(src.baseFontSizeAction) : true;
  out.customIcon = typeof src?.customIcon === 'string' ? src.customIcon : null;
  out.editorFontSize = typeof src?.editorFontSize === 'number' ? Math.min(30, Math.max(10, Math.round(src.editorFontSize))) : out.baseFontSize;
  out.zoomLevel = Math.min(2, Math.max(0.5, Math.round(out.zoomLevel * 10) / 10));
  out.tabSize = [2, 3, 4, 6, 8].includes(out.tabSize) ? out.tabSize : 4;
  return out;
}

function readLocalSettings(): UranoSettings {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const merged = mergeSettings(parsed);
    merged.spellcheck = parsed?.spellcheck ?? true;
    // Legacy key written by the "Update links" modal before the settings store existed
    const legacyLinks = localStorage.getItem(LINKS_PREF_KEY);
    if (!raw && (legacyLinks === 'always' || legacyLinks === 'never' || legacyLinks === 'prompt')) {
      merged.alwaysUpdateLinks = legacyLinks;
    }
    return merged;
  } catch {
    const fallback = mergeSettings(null);
    fallback.spellcheck = true;
    return fallback;
  }
}

function writeLocalSettings(settings: UranoSettings): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(LINKS_PREF_KEY, settings.alwaysUpdateLinks);
  } catch {
    // localStorage unavailable
  }
}

let vaultWriteTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleVaultWrite(vaultPath: string | null, settings: UranoSettings): void {
  if (!vaultPath) return;
  if (vaultWriteTimer) clearTimeout(vaultWriteTimer);
  vaultWriteTimer = setTimeout(() => {
    vaultWriteTimer = null;
    const filePath = `${vaultPath.replace(/[\\/]+$/, '')}/${SETTINGS_FILE_RELATIVE}`;
    invoke('write_file', { filePath, content: JSON.stringify(settings, null, 2) }).catch((err) => {
      console.warn('[Urano] No se pudo guardar .urano/settings.json:', err);
    });
  }, 300);
}

export interface SettingsStoreState {
  settings: UranoSettings;
  /** Vault whose `.urano/settings.json` is the source of truth right now. */
  vaultPath: string | null;
  isOpen: boolean;
  activeTabId: string;
  /** Milliseconds from navigation start until the workspace mounted. */
  startupMs: number | null;
  /** Atajo al idioma activo */
  language: string;
  /** Atajo a si el corrector ortográfico está activo */
  spellcheck: boolean;

  openSettings: (tabId?: string) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setActiveTab: (tabId: string) => void;

  setSetting: <K extends keyof UranoSettings>(key: K, value: UranoSettings[K]) => void;
  setCorePluginEnabled: (id: CorePluginId, enabled: boolean) => void;
  resetSetting: <K extends keyof UranoSettings>(key: K) => void;

  addWordToDictionary: (word: string) => Promise<void>;
  removeWordFromDictionary: (word: string) => Promise<void>;

  loadFromVault: (vaultPath: string) => Promise<void>;
  markStartupComplete: () => void;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: readLocalSettings(),
  get language() {
    return get().settings.language;
  },
  get spellcheck() {
    return get().settings.spellcheck;
  },
  vaultPath: null,
  isOpen: false,
  activeTabId: 'general',
  startupMs: null,

  openSettings: (tabId) =>
    set((state) => ({ isOpen: true, activeTabId: tabId ?? state.activeTabId })),
  closeSettings: () => set({ isOpen: false }),
  toggleSettings: () => set((state) => ({ isOpen: !state.isOpen })),
  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setSetting: (key, value) => {
    const next = { ...get().settings, [key]: value };
    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });

    if (key === 'language' || key === 'spellcheck') {
      invoke('set_spellcheck_language', {
        lang: next.language,
        enabled: next.spellcheck,
      }).catch(() => {});
    }
  },

  setCorePluginEnabled: (id, enabled) => {
    const current = get().settings;
    const next = { ...current, corePlugins: { ...current.corePlugins, [id]: enabled } };
    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });
  },

  resetSetting: (key) => {
    get().setSetting(key, DEFAULT_SETTINGS[key]);
  },

  addWordToDictionary: async (word: string) => {
    const cleanWord = word.trim();
    if (!cleanWord) return;
    const current = get().settings;
    const words = current.customDictionary || [];
    if (words.some((w) => w.toLowerCase() === cleanWord.toLowerCase())) return;

    const nextWords = [...words, cleanWord];
    const nextSettings = { ...current, customDictionary: nextWords };
    writeLocalSettings(nextSettings);
    scheduleVaultWrite(get().vaultPath, nextSettings);
    set({ settings: nextSettings });

    const vaultPath = get().vaultPath;
    if (vaultPath) {
      const dictFilePath = `${vaultPath.replace(/[\\/]+$/, '')}/.urano/dictionary.txt`;
      invoke('write_file', { filePath: dictFilePath, content: nextWords.join('\n') + '\n' }).catch((err) => {
        console.warn('[Urano] No se pudo guardar .urano/dictionary.txt:', err);
      });
    }
  },

  removeWordFromDictionary: async (word: string) => {
    const cleanWord = word.trim().toLowerCase();
    const current = get().settings;
    const words = (current.customDictionary || []).filter((w) => w.toLowerCase() !== cleanWord);
    const nextSettings = { ...current, customDictionary: words };
    writeLocalSettings(nextSettings);
    scheduleVaultWrite(get().vaultPath, nextSettings);
    set({ settings: nextSettings });

    const vaultPath = get().vaultPath;
    if (vaultPath) {
      const dictFilePath = `${vaultPath.replace(/[\\/]+$/, '')}/.urano/dictionary.txt`;
      invoke('write_file', { filePath: dictFilePath, content: words.join('\n') + (words.length ? '\n' : '') }).catch(() => {});
    }
  },

  loadFromVault: async (vaultPath) => {
    const filePath = `${vaultPath.replace(/[\\/]+$/, '')}/${SETTINGS_FILE_RELATIVE}`;
    const dictFilePath = `${vaultPath.replace(/[\\/]+$/, '')}/.urano/dictionary.txt`;
    let dictWords: string[] = [];
    try {
      const dictRaw = await invoke<string>('read_file', { filePath: dictFilePath });
      dictWords = dictRaw
        .split('\n')
        .map((w) => w.trim())
        .filter((w) => w.length > 0 && !w.startsWith('#'));
    } catch {
      // dictionary.txt not yet created
    }

    try {
      const raw = await invoke<string>('read_file', { filePath });
      const parsed = JSON.parse(raw);
      const merged = mergeSettings(parsed);
      merged.spellcheck = parsed?.spellcheck ?? true;
      if (dictWords.length > 0) {
        merged.customDictionary = Array.from(new Set([...merged.customDictionary, ...dictWords]));
      }
      writeLocalSettings(merged);
      set({ settings: merged, vaultPath });
      invoke('set_spellcheck_language', {
        lang: merged.language,
        enabled: merged.spellcheck,
      }).catch(() => {});
    } catch {
      // No settings file yet: seed the vault with the current (localStorage) settings
      const current = get().settings;
      if (dictWords.length > 0) {
        current.customDictionary = Array.from(new Set([...current.customDictionary, ...dictWords]));
      }
      set({ vaultPath });
      scheduleVaultWrite(vaultPath, current);
      invoke('set_spellcheck_language', {
        lang: current.language,
        enabled: current.spellcheck,
      }).catch(() => {});
    }
  },

  markStartupComplete: () => {
    if (get().startupMs !== null) return;
    set({ startupMs: Math.round(performance.now()) });
  },
}));

/* ------------------------------------------------------------------ *
 * Helpers used outside React (editor extensions, services)
 * ------------------------------------------------------------------ */

export function getSettings(): UranoSettings {
  return useSettingsStore.getState().settings;
}

/**
 * Directory where a new attachment (pasted/dropped image) should be written,
 * following the "Default location for new attachments" setting.
 */
export function resolveAttachmentDir(vaultPath: string, activeFile: string | null): string {
  const sep = vaultPath.includes('\\') ? '\\' : '/';
  const cleanVault = vaultPath.replace(/[\\/]+$/, '');
  const { attachmentLocation, attachmentFolderPath } = getSettings();

  if (attachmentLocation === 'current' && activeFile) {
    const normalized = activeFile.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? activeFile.slice(0, idx) : cleanVault;
  }
  if (attachmentLocation === 'folder') {
    const folder = attachmentFolderPath.trim().replace(/^[\\/]+|[\\/]+$/g, '');
    return folder ? `${cleanVault}${sep}${folder.replace(/\//g, sep)}` : cleanVault;
  }
  return cleanVault;
}

/* ------------------------------------------------------------------ *
 * i18n (Ajustes)
 * ------------------------------------------------------------------ */

/**
 * Clave de la pestaña de Ajustes sin el prefijo `settings.` (`'general.language'`).
 * Los textos viven en `src/locales/<lang>.json` bajo `settings`.
 */
export type SettingsStringKey = string;
export type Translate = (key: SettingsStringKey, vars?: TranslateParams) => string;

/** Traduce una clave de Ajustes en el idioma activo del motor i18n. */
export function translate(key: SettingsStringKey, vars?: TranslateParams): string {
  return translateKey(`settings.${key}`, vars);
}

/**
 * Hook para la pestaña de Ajustes: `t('general.language')` ≡ `t('settings.general.language')`.
 * Se re-renderiza al cambiar el idioma o al cargar un diccionario nuevo.
 */
export function useT(): Translate {
  const version = useSyncExternalStore(subscribeI18n, getI18nVersion, getI18nVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback<Translate>((key, vars) => translate(key, vars), [version]);
}
