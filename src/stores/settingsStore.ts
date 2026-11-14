import { create } from 'zustand';
import { useCallback, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t as translateKey, subscribe as subscribeI18n, getVersion as getI18nVersion } from '../locales/i18n';
import type { TranslateParams } from '../locales/i18n';
import { DEFAULT_LANGUAGE, detectSystemLanguage, normalizeLanguageCode } from '../locales/languages';
import { applyBaseTheme } from '../services/themeService';

/** Código de idioma BCP-47 en minúsculas (`en`, `es`, `pt-br`…). Ver `locales/languages.ts`. */
export type Language = string;
export type ThemeMode = 'dark' | 'light' | 'system';
export type DefaultFileToOpen = 'last-opened' | 'daily-note' | 'none';
export type NewFileLocation = 'root' | 'current' | 'folder';
export type AttachmentLocation = 'root' | 'folder' | 'current' | 'subfolder';
export type NewLinkFormat = 'shortest' | 'relative' | 'absolute';
export type DeleteAttachmentsWithFile = 'ask' | 'always' | 'never';
export type TrashOption = 'system' | 'local' | 'none';
export type DeletedFilesDestination = 'system' | 'trash' | 'permanent';
export type StorageBackend = 'local' | 'gdrive';
export type CanvasNewFileLocation = 'root' | 'current' | 'folder';
export type CanvasWheelBehavior = 'pan' | 'zoom';
export type CanvasCtrlDragBehavior = 'menu' | 'select';
export type CanvasCardLabel = 'always' | 'hover' | 'never';
export type NoteComposerAfterExtract = 'link' | 'embed' | 'nothing';

export const CORE_PLUGIN_IDS = [
  'bases',
  'global-search',
  'canvas',
  'note-composer',
  'zk-prefixer',
  'slides',
  'backlink',
  'outgoing-link',
  'workspaces',
  'file-explorer',
  'markdown-importer',
  'audio-recorder',
  'bookmarks',
  'random-note',
  'daily-notes',
  'command-palette',
  'templates',
  'properties',
  'file-recovery',
  'word-count',
  'switcher',
  'sync',
  'tag-pane',
  'graph',
  'page-preview',
  'webviewer',
] as const;
export type CorePluginId = (typeof CORE_PLUGIN_IDS)[number];

export type WindowFrameStyle = 'hidden' | 'custom' | 'native';

export interface RibbonItemSetting {
  id: string;
  visible: boolean;
}

export const DEFAULT_RIBBON_ITEMS: RibbonItemSetting[] = [
  { id: 'switcher', visible: true },
  { id: 'graph', visible: true },
  { id: 'canvas', visible: true },
  { id: 'daily-notes', visible: true },
  { id: 'templates', visible: true },
  { id: 'command-palette', visible: true },
  { id: 'bases', visible: true },
  { id: 'sync', visible: true },
];

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
  showTabTitleBar: boolean;
  showStatusBar: boolean;
  ribbonItems: RibbonItemSetting[];
  windowFrameStyle: WindowFrameStyle;
  openSettingsInNewWindow: boolean;
  translucentWindow: boolean;
  nativeMenus: boolean;

  // Editor (CodeMirror 6)
  defaultViewMode: 'source' | 'preview';
  livePreview: boolean;
  showEditorStatus: boolean;
  spellcheck: boolean;
  customDictionary: string[];
  readableLineLength: boolean;
  strictLineBreaks: boolean;
  propertiesInDocument: 'visible' | 'hidden' | 'source';
  foldHeading: boolean;
  foldIndent: boolean;
  showLineNumbers: boolean;
  indentGuides: boolean;
  showIndentationGuides: boolean;
  rightToLeft: boolean;
  useTabs: boolean;
  indentUsingTabs: boolean;
  tabSize: number;
  smartIndent: boolean;
  smartIndentLists: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  autoConvertHtml: boolean;
  vimMode: boolean;

  // Files and links
  defaultFileToOpen: DefaultFileToOpen;
  alwaysFocusNewTabs: boolean;
  newFileLocation: NewFileLocation;
  newFileFolderPath: string;
  attachmentLocation: AttachmentLocation;
  attachmentFolderPath: string;
  attachmentSubfolderPath: string;
  newLinkFormat: NewLinkFormat;
  alwaysUpdateLinks: boolean;
  useWikilinks: boolean;
  detectAllFileExtensions: boolean;
  detectAllFileTypes: boolean;
  confirmFileDeletion: boolean;
  deleteAttachmentsWithFile: DeleteAttachmentsWithFile;
  trashOption: TrashOption;
  deletedFilesDestination: DeletedFilesDestination;
  userIgnoreFilters: string[];
  configFolderOverride: string;
  allowUriCallbacks: boolean;

  // Sync / storage
  storageBackend: StorageBackend;

  // Core plugins
  corePlugins: Record<CorePluginId, boolean>;

  // Core plugin options
  backlinksInDocument: boolean;
  canvasNewFileLocation: CanvasNewFileLocation;
  canvasDefaultFolder: string;
  canvasWheelBehavior: CanvasWheelBehavior;
  canvasCtrlDragBehavior: CanvasCtrlDragBehavior;
  canvasCardLabel: CanvasCardLabel;
  canvasSnapToGrid: boolean;
  canvasSnapToObjects: boolean;
  canvasZoomThreshold: number;
  dailyNotesFolder: string;
  dailyNotesOpenOnStartup: boolean;
  fileRecoveryIntervalMinutes: number;
  fileRecoveryHistoryDays: number;
  noteComposerAfterExtract: NoteComposerAfterExtract;
  noteComposerTemplatePath: string;
  noteComposerConfirmMerge: boolean;
  noteComposerTextAfterExtraction: string;
  pagePreviewRequireCtrl: boolean;
  quickSwitcherShowAttachments: boolean;
  quickSwitcherShowExistingOnly: boolean;
  templatesFolder: string;
  templatesDateFormat: string;
  templatesTimeFormat: string;
  communityRestrictedMode: boolean;
  hotkeys: Record<string, string[]>;
}

export const URANO_ACCENT = '#e06c1b';

export const DEFAULT_SETTINGS: UranoSettings = {
  autoUpdate: true,
  // Igual que Urano: idioma del sistema si está en el catálogo, si no inglés.
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
  zoomLevel: 100,

  showRibbon: true,
  showInlineTitle: true,
  showTabTitleBar: true,
  showStatusBar: true,
  ribbonItems: DEFAULT_RIBBON_ITEMS,
  windowFrameStyle: 'hidden',
  openSettingsInNewWindow: false,
  translucentWindow: false,
  nativeMenus: false,

  defaultViewMode: 'source',
  livePreview: true,
  showEditorStatus: true,
  spellcheck: true,
  customDictionary: [],
  readableLineLength: true,
  strictLineBreaks: false,
  propertiesInDocument: 'visible',
  foldHeading: true,
  foldIndent: true,
  showLineNumbers: false,
  indentGuides: true,
  showIndentationGuides: true,
  rightToLeft: false,
  useTabs: true,
  indentUsingTabs: true,
  tabSize: 4,
  smartIndent: true,
  smartIndentLists: true,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  autoConvertHtml: true,
  vimMode: false,

  defaultFileToOpen: 'last-opened',
  alwaysFocusNewTabs: true,
  newFileLocation: 'root',
  newFileFolderPath: '',
  attachmentLocation: 'root',
  attachmentFolderPath: 'attachments',
  attachmentSubfolderPath: 'attachments',
  newLinkFormat: 'shortest',
  alwaysUpdateLinks: true,
  useWikilinks: true,
  detectAllFileExtensions: false,
  detectAllFileTypes: false,
  confirmFileDeletion: true,
  deleteAttachmentsWithFile: 'never',
  trashOption: 'system',
  deletedFilesDestination: 'system',
  userIgnoreFilters: [],
  configFolderOverride: '',
  allowUriCallbacks: false,

  storageBackend: 'local',

  corePlugins: {
    bases: true,
    'global-search': true,
    canvas: true,
    'note-composer': true,
    'zk-prefixer': false,
    slides: false,
    backlink: true,
    'outgoing-link': true,
    workspaces: false,
    'file-explorer': true,
    'markdown-importer': false,
    'audio-recorder': false,
    bookmarks: true,
    'random-note': false,
    'daily-notes': true,
    'command-palette': true,
    templates: true,
    properties: true,
    'file-recovery': true,
    'word-count': true,
    switcher: true,
    sync: true,
    'tag-pane': true,
    graph: true,
    'page-preview': true,
    webviewer: false,
  },

  backlinksInDocument: false,
  canvasNewFileLocation: 'root',
  canvasDefaultFolder: '',
  canvasWheelBehavior: 'zoom',
  canvasCtrlDragBehavior: 'menu',
  canvasCardLabel: 'always',
  canvasSnapToGrid: true,
  canvasSnapToObjects: true,
  canvasZoomThreshold: 100,
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
  hotkeys: {},
};

const LOCAL_STORAGE_KEY = 'urano_settings';
/** Key read by `linkRefactorService.getAlwaysUpdateLinksPref()`; kept in sync. */
const LINKS_PREF_KEY = 'urano_always_update_links';

export function getConfigFolder(settings?: UranoSettings | null): string {
  const raw = settings?.configFolderOverride?.trim();
  if (!raw) return '.urano';
  return raw.startsWith('.') ? raw : `.${raw}`;
}

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
        const obj = value as Record<string, unknown>;
        for (const id of CORE_PLUGIN_IDS) {
          const v = obj[id];
          if (typeof v === 'boolean') out.corePlugins[id] = v;
        }
        // Migrate legacy key `backlinks` -> `backlink`
        if (typeof obj.backlink !== 'boolean' && typeof obj.backlinks === 'boolean') {
          out.corePlugins.backlink = obj.backlinks;
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
    if (key === 'hotkeys') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const clean: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(value)) {
          if (Array.isArray(v)) {
            clean[k] = v.filter((item): item is string => typeof item === 'string');
          }
        }
        out.hotkeys = clean;
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
  if (!['last-opened', 'daily-note', 'none'].includes(out.defaultFileToOpen)) out.defaultFileToOpen = 'last-opened';
  out.alwaysFocusNewTabs = src.alwaysFocusNewTabs !== undefined ? Boolean(src.alwaysFocusNewTabs) : true;
  if (!['root', 'current', 'folder'].includes(out.newFileLocation)) out.newFileLocation = 'root';
  out.newFileFolderPath = typeof src?.newFileFolderPath === 'string' ? src.newFileFolderPath : '';
  if (!['root', 'folder', 'current', 'subfolder'].includes(out.attachmentLocation)) out.attachmentLocation = 'root';
  out.attachmentFolderPath = typeof src?.attachmentFolderPath === 'string' && src.attachmentFolderPath.trim() ? src.attachmentFolderPath : 'attachments';
  out.attachmentSubfolderPath = typeof src?.attachmentSubfolderPath === 'string' && src.attachmentSubfolderPath.trim() ? src.attachmentSubfolderPath : 'attachments';
  if (!['shortest', 'relative', 'absolute'].includes(out.newLinkFormat)) out.newLinkFormat = 'shortest';

  if (typeof src.alwaysUpdateLinks === 'boolean') {
    out.alwaysUpdateLinks = src.alwaysUpdateLinks;
  } else if (typeof src.alwaysUpdateLinks === 'string') {
    out.alwaysUpdateLinks = src.alwaysUpdateLinks === 'always';
  } else {
    out.alwaysUpdateLinks = true;
  }

  out.useWikilinks = src.useWikilinks !== undefined ? Boolean(src.useWikilinks) : true;
  out.detectAllFileTypes = Boolean(src?.detectAllFileTypes);
  out.confirmFileDeletion = src.confirmFileDeletion !== undefined ? Boolean(src.confirmFileDeletion) : true;
  if (!['system', 'trash', 'permanent'].includes(out.deletedFilesDestination)) out.deletedFilesDestination = 'system';
  out.userIgnoreFilters = Array.isArray(src?.userIgnoreFilters) ? src.userIgnoreFilters.filter((x): x is string => typeof x === 'string') : [];
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
  out.showRibbon = src?.showRibbon !== undefined ? Boolean(src.showRibbon) : true;
  out.showInlineTitle = src?.showInlineTitle !== undefined ? Boolean(src.showInlineTitle) : true;
  out.showTabTitleBar = src?.showTabTitleBar !== undefined ? Boolean(src.showTabTitleBar) : true;
  out.showStatusBar = src?.showStatusBar !== undefined ? Boolean(src.showStatusBar) : true;
  out.translucentWindow = Boolean(src?.translucentWindow);
  out.nativeMenus = Boolean(src?.nativeMenus);
  out.windowFrameStyle =
    src?.windowFrameStyle === 'custom' || src?.windowFrameStyle === 'native'
      ? src.windowFrameStyle
      : 'hidden';
  out.openSettingsInNewWindow = Boolean(src?.openSettingsInNewWindow);

  if (Array.isArray(src?.ribbonItems)) {
    const rawItems = src.ribbonItems as { id?: string; visible?: boolean }[];
    const knownIds = new Set(DEFAULT_RIBBON_ITEMS.map((i) => i.id));
    const merged: RibbonItemSetting[] = [];
    const seen = new Set<string>();

    for (const item of rawItems) {
      if (item && typeof item.id === 'string' && knownIds.has(item.id) && !seen.has(item.id)) {
        merged.push({ id: item.id, visible: item.visible !== false });
        seen.add(item.id);
      }
    }
    for (const def of DEFAULT_RIBBON_ITEMS) {
      if (!seen.has(def.id)) {
        merged.push({ ...def });
      }
    }
    out.ribbonItems = merged;
  } else {
    out.ribbonItems = DEFAULT_RIBBON_ITEMS.map((item) => ({ ...item }));
  }

  if (typeof src?.zoomLevel === 'number') {
    const zl = src.zoomLevel <= 2 ? Math.round(src.zoomLevel * 100) : src.zoomLevel;
    out.zoomLevel = Math.min(150, Math.max(70, Math.round(zl / 5) * 5));
  } else {
    out.zoomLevel = 100;
  }
  if (typeof src?.tabSize === 'number') {
    out.tabSize = Math.min(8, Math.max(2, Math.round(src.tabSize)));
  } else {
    out.tabSize = 4;
  }
  out.defaultViewMode = src?.defaultViewMode === 'preview' ? 'preview' : 'source';
  out.livePreview = src?.livePreview !== undefined ? Boolean(src.livePreview) : true;
  out.showEditorStatus = src?.showEditorStatus !== undefined ? Boolean(src.showEditorStatus) : true;
  out.propertiesInDocument = ['visible', 'hidden', 'source'].includes(src?.propertiesInDocument as string)
    ? (src?.propertiesInDocument as 'visible' | 'hidden' | 'source')
    : 'visible';
  out.foldHeading = src?.foldHeading !== undefined ? Boolean(src.foldHeading) : true;
  out.foldIndent = src?.foldIndent !== undefined ? Boolean(src.foldIndent) : true;
  out.showLineNumbers = src?.showLineNumbers !== undefined ? Boolean(src.showLineNumbers) : false;

  const rawGuides = src?.showIndentationGuides ?? src?.indentGuides;
  out.showIndentationGuides = rawGuides !== undefined ? Boolean(rawGuides) : true;
  out.indentGuides = out.showIndentationGuides;

  out.rightToLeft = Boolean(src?.rightToLeft);

  const rawTabs = src?.indentUsingTabs ?? src?.useTabs;
  out.indentUsingTabs = rawTabs !== undefined ? Boolean(rawTabs) : true;
  out.useTabs = out.indentUsingTabs;

  const rawSmartIndent = src?.smartIndentLists ?? src?.smartIndent;
  out.smartIndentLists = rawSmartIndent !== undefined ? Boolean(rawSmartIndent) : true;
  out.smartIndent = out.smartIndentLists;
  out.autoPairBrackets = src?.autoPairBrackets !== undefined ? Boolean(src.autoPairBrackets) : true;
  out.autoPairMarkdown = src?.autoPairMarkdown !== undefined ? Boolean(src.autoPairMarkdown) : true;
  out.autoConvertHtml = src?.autoConvertHtml !== undefined ? Boolean(src.autoConvertHtml) : true;
  out.vimMode = Boolean(src?.vimMode);

  const detectAll = src?.detectAllFileExtensions ?? src?.detectAllFileTypes ?? false;
  out.detectAllFileExtensions = Boolean(detectAll);
  out.detectAllFileTypes = Boolean(detectAll);

  const rawTrash = String(src?.trashOption ?? (src?.deletedFilesDestination === 'trash' ? 'local' : src?.deletedFilesDestination === 'permanent' ? 'none' : 'system'));
  out.trashOption = (['system', 'local', 'none'].includes(rawTrash) ? rawTrash : 'system') as TrashOption;
  out.deletedFilesDestination = out.trashOption === 'local' ? 'trash' : out.trashOption === 'none' ? 'permanent' : 'system';

  const rawAtt = String(src?.deleteAttachmentsWithFile ?? '');
  out.deleteAttachmentsWithFile = (['ask', 'always', 'never'].includes(rawAtt) ? rawAtt : 'never') as DeleteAttachmentsWithFile;
  const rawConfig = typeof src?.configFolderOverride === 'string' ? src.configFolderOverride.trim() : '';
  out.configFolderOverride = rawConfig ? (rawConfig.startsWith('.') ? rawConfig : `.${rawConfig}`) : '';
  out.allowUriCallbacks = Boolean(src?.allowUriCallbacks);

  if (!['root', 'current', 'folder'].includes(out.canvasNewFileLocation)) {
    out.canvasNewFileLocation = 'root';
  }
  out.canvasDefaultFolder = typeof src?.canvasDefaultFolder === 'string' ? src.canvasDefaultFolder : '';
  if (!['pan', 'zoom'].includes(out.canvasWheelBehavior)) {
    out.canvasWheelBehavior = 'zoom';
  }
  if (!['menu', 'select'].includes(out.canvasCtrlDragBehavior)) {
    out.canvasCtrlDragBehavior = 'menu';
  }
  if (!['always', 'hover', 'never'].includes(out.canvasCardLabel)) {
    out.canvasCardLabel = 'always';
  }
  out.canvasSnapToGrid = src?.canvasSnapToGrid !== undefined ? Boolean(src.canvasSnapToGrid) : true;
  out.canvasSnapToObjects = src?.canvasSnapToObjects !== undefined ? Boolean(src.canvasSnapToObjects) : true;
  if (typeof src?.canvasZoomThreshold === 'number' && Number.isFinite(src.canvasZoomThreshold)) {
    // Migrar valores decimales antiguos (<= 1, ej. 0.5) al porcentaje por defecto 100%
    if (src.canvasZoomThreshold <= 1) {
      out.canvasZoomThreshold = 100;
    } else {
      out.canvasZoomThreshold = Math.min(100, Math.max(10, Math.round(src.canvasZoomThreshold)));
    }
  } else {
    out.canvasZoomThreshold = 100;
  }

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
      merged.alwaysUpdateLinks = legacyLinks === 'always';
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
    localStorage.setItem(LINKS_PREF_KEY, String(settings.alwaysUpdateLinks));
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
    const configDir = getConfigFolder(settings);
    const folderPath = `${vaultPath.replace(/[\\/]+$/, '')}/${configDir}`;
    const filePath = `${folderPath}/settings.json`;
    invoke('create_folder', { folderPath }).catch(() => {});
    invoke('write_file', { filePath, content: JSON.stringify(settings, null, 2) }).catch((err) => {
      console.warn(`[Urano] No se pudo guardar ${configDir}/settings.json:`, err);
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
  hotkeySearchQuery: string;
  setHotkeySearchQuery: (query: string) => void;
  openHotkeysForPlugin: (query: string) => void;

  setSetting: <K extends keyof UranoSettings>(key: K, value: UranoSettings[K]) => void;
  setCorePluginEnabled: (id: CorePluginId, enabled: boolean) => void;
  toggleCorePlugin: (id: CorePluginId) => void;
  resetSetting: <K extends keyof UranoSettings>(key: K) => void;

  addWordToDictionary: (word: string) => Promise<void>;
  removeWordFromDictionary: (word: string) => Promise<void>;

  setHotkey: (commandId: string, hotkeys: string[]) => void;
  removeHotkey: (commandId: string, hotkey?: string) => void;
  resetHotkey: (commandId: string) => void;
  restoreAllHotkeys: () => void;

  loadFromVault: (vaultPath: string) => Promise<void>;
  markStartupComplete: () => void;
}

const initialSettings = readLocalSettings();
if (typeof window !== 'undefined') {
  applyBaseTheme(initialSettings.theme);
  if (initialSettings.translucentWindow) {
    document.body.classList.add('is-translucent');
  }
  const isFrameless = initialSettings.windowFrameStyle !== 'native';
  document.body.classList.toggle('is-frameless', isFrameless);
  document.body.classList.toggle('is-hidden-frameless', initialSettings.windowFrameStyle === 'hidden');
  const zoomFactor = (initialSettings.zoomLevel || 100) / 100;
  if (initialSettings.zoomLevel !== 100) {
    document.body.style.zoom = String(zoomFactor);
  }
  document.documentElement.style.setProperty('--editor-tab-size', String(initialSettings.tabSize || 4));
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: initialSettings,
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
  hotkeySearchQuery: '',

  openSettings: (tabId) => {
    const { settings } = get();
    const isStandaloneWindow =
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('window') === 'settings' ||
        window.location.hash.includes('window=settings'));

    if (settings.openSettingsInNewWindow && !isStandaloneWindow) {
      const vPath =
        get().vaultPath ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('urano_last_vault') : null);
      const vaultName = vPath ? vPath.split(/[\\/]/).pop() || 'Urano' : 'Urano';
      invoke('open_settings_window', {
        tabId: tabId ?? null,
        vaultName,
        frameStyle: settings.windowFrameStyle,
      }).catch((err) => {
        console.warn('[Urano] No se pudo abrir ventana de ajustes, usando modal integrado:', err);
        set((state) => ({ isOpen: true, activeTabId: tabId ?? state.activeTabId }));
      });
      return;
    }
    set((state) => ({ isOpen: true, activeTabId: tabId ?? state.activeTabId }));
  },
  closeSettings: () => set({ isOpen: false }),
  toggleSettings: () => {
    const { isOpen, settings, openSettings, closeSettings } = get();
    if (settings.openSettingsInNewWindow) {
      openSettings();
      return;
    }
    if (isOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  },
  setActiveTab: (tabId) =>
    set((state) => ({
      activeTabId: tabId,
      hotkeySearchQuery: tabId === 'hotkeys' ? state.hotkeySearchQuery : '',
    })),
  setHotkeySearchQuery: (query) => set({ hotkeySearchQuery: query }),
  openHotkeysForPlugin: (query) =>
    set({
      isOpen: true,
      activeTabId: 'hotkeys',
      hotkeySearchQuery: query,
    }),

  setSetting: (key, value) => {
    const next = { ...get().settings, [key]: value };
    if (key === 'detectAllFileExtensions') {
      next.detectAllFileTypes = Boolean(value);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('urano:refresh-tree'));
    }
    if (key === 'detectAllFileTypes') {
      next.detectAllFileExtensions = Boolean(value);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('urano:refresh-tree'));
    }
    if (key === 'trashOption') {
      next.deletedFilesDestination = value === 'local' ? 'trash' : value === 'none' ? 'permanent' : 'system';
    }
    if (key === 'deletedFilesDestination') {
      next.trashOption = value === 'trash' ? 'local' : value === 'permanent' ? 'none' : 'system';
    }
    if (key === 'showIndentationGuides') {
      next.indentGuides = Boolean(value);
    } else if (key === 'indentGuides') {
      next.showIndentationGuides = Boolean(value);
    }
    if (key === 'smartIndentLists') {
      next.smartIndent = Boolean(value);
    } else if (key === 'smartIndent') {
      next.smartIndentLists = Boolean(value);
    }
    if (key === 'indentUsingTabs') {
      next.useTabs = Boolean(value);
    } else if (key === 'useTabs') {
      next.indentUsingTabs = Boolean(value);
    }
    if (key === 'tabSize') {
      next.tabSize = Math.min(8, Math.max(2, Math.round(Number(value) || 4)));
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--editor-tab-size', String(next.tabSize));
      }
    }

    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });

    if (key === 'theme') {
      applyBaseTheme(value as ThemeMode);
    }

    if (key === 'translucentWindow' && typeof document !== 'undefined') {
      document.body.classList.toggle('is-translucent', Boolean(value));
    }

    if (key === 'zoomLevel' && typeof document !== 'undefined') {
      const zoomFactor = (Number(value) || 100) / 100;
      document.body.style.zoom = value === 100 ? '' : String(zoomFactor);
      (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
        value === 100 ? '' : String(zoomFactor);
    }

    if (key === 'windowFrameStyle') {
      const isNative = value === 'native';
      invoke('set_window_decorations', { decorations: isNative }).catch(() => {
        import('@tauri-apps/api/window')
          .then(({ getCurrentWindow }) => {
            getCurrentWindow().setDecorations(isNative).catch(() => {});
          })
          .catch(() => {});
      });
      if (typeof document !== 'undefined') {
        document.body.classList.toggle('is-frameless', !isNative);
        document.body.classList.toggle('is-hidden-frameless', value === 'hidden');
      }
    }

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

  toggleCorePlugin: (id) => {
    const current = get().settings;
    const nextEnabled = !current.corePlugins[id];
    const next = { ...current, corePlugins: { ...current.corePlugins, [id]: nextEnabled } };
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
      const configDir = getConfigFolder(get().settings);
      const folderPath = `${vaultPath.replace(/[\\/]+$/, '')}/${configDir}`;
      const dictFilePath = `${folderPath}/dictionary.txt`;
      invoke('create_folder', { folderPath }).catch(() => {});
      invoke('write_file', { filePath: dictFilePath, content: nextWords.join('\n') + '\n' }).catch((err) => {
        console.warn(`[Urano] No se pudo guardar ${configDir}/dictionary.txt:`, err);
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
      const configDir = getConfigFolder(get().settings);
      const folderPath = `${vaultPath.replace(/[\\/]+$/, '')}/${configDir}`;
      const dictFilePath = `${folderPath}/dictionary.txt`;
      invoke('create_folder', { folderPath }).catch(() => {});
      invoke('write_file', { filePath: dictFilePath, content: words.join('\n') + (words.length ? '\n' : '') }).catch(() => {});
    }
  },

  setHotkey: (commandId, hotkeys) => {
    const current = get().settings;
    const nextHotkeys = { ...(current.hotkeys || {}), [commandId]: hotkeys };
    const next = { ...current, hotkeys: nextHotkeys };
    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('urano:hotkeys-updated', { detail: nextHotkeys }));
    }
  },

  removeHotkey: (commandId, hotkey) => {
    const current = get().settings;
    const existing = current.hotkeys?.[commandId] ?? [];
    const updated = hotkey ? existing.filter((h) => h !== hotkey) : [];
    const nextHotkeys = { ...(current.hotkeys || {}), [commandId]: updated };
    const next = { ...current, hotkeys: nextHotkeys };
    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('urano:hotkeys-updated', { detail: nextHotkeys }));
    }
  },

  resetHotkey: (commandId) => {
    const current = get().settings;
    const nextHotkeys = { ...(current.hotkeys || {}) };
    delete nextHotkeys[commandId];
    const next = { ...current, hotkeys: nextHotkeys };
    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('urano:hotkeys-updated', { detail: nextHotkeys }));
    }
  },

  restoreAllHotkeys: () => {
    const current = get().settings;
    const next = { ...current, hotkeys: {} };
    writeLocalSettings(next);
    scheduleVaultWrite(get().vaultPath, next);
    set({ settings: next });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('urano:hotkeys-updated', { detail: {} }));
    }
  },

  loadFromVault: async (vaultPath) => {
    const configDir = getConfigFolder(get().settings);
    const filePath = `${vaultPath.replace(/[\\/]+$/, '')}/${configDir}/settings.json`;
    const dictFilePath = `${vaultPath.replace(/[\\/]+$/, '')}/${configDir}/dictionary.txt`;
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
      let raw = '';
      try {
        raw = await invoke<string>('read_file', { filePath });
      } catch (e) {
        if (configDir !== '.urano') {
          raw = await invoke<string>('read_file', { filePath: `${vaultPath.replace(/[\\/]+$/, '')}/.urano/settings.json` });
        } else {
          throw e;
        }
      }
      const parsed = JSON.parse(raw);
      const merged = mergeSettings(parsed);
      merged.spellcheck = parsed?.spellcheck ?? true;
      if (dictWords.length > 0) {
        merged.customDictionary = Array.from(new Set([...merged.customDictionary, ...dictWords]));
      }
      writeLocalSettings(merged);
      applyBaseTheme(merged.theme);
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

// Cross-window reactivity: sync settings when modified in another window
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === LOCAL_STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        const merged = mergeSettings(parsed);
        useSettingsStore.setState({ settings: merged });
        if (merged.theme) {
          applyBaseTheme(merged.theme);
        }
        if (typeof document !== 'undefined') {
          document.body.classList.toggle('is-translucent', Boolean(merged.translucentWindow));
          const isFrameless = merged.windowFrameStyle !== 'native';
          document.body.classList.toggle('is-frameless', isFrameless);
          document.body.classList.toggle('is-hidden-frameless', merged.windowFrameStyle === 'hidden');
          const zoomFactor = (Number(merged.zoomLevel) || 100) / 100;
          document.body.style.zoom = merged.zoomLevel === 100 ? '' : String(zoomFactor);
        }
      } catch (err) {
        console.error('Error syncing settings from storage event:', err);
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 * Helpers used outside React (editor extensions, services)
 * ------------------------------------------------------------------ */

export function getSettings(): UranoSettings {
  return useSettingsStore.getState().settings;
}

/**
 * Resolves the directory where newly created notes should be placed,
 * following Settings → Files and links → "Default location for new notes".
 */
export function resolveNewFileDir(vaultPath: string, activeFile: string | null): string {
  const sep = vaultPath.includes('\\') ? '\\' : '/';
  const cleanVault = vaultPath.replace(/[\\/]+$/, '');
  const { newFileLocation, newFileFolderPath } = getSettings();

  if (newFileLocation === 'current' && activeFile) {
    const normalized = activeFile.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? activeFile.slice(0, idx) : cleanVault;
  }
  if (newFileLocation === 'folder') {
    const folder = (newFileFolderPath || '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    return folder ? `${cleanVault}${sep}${folder.replace(/\//g, sep)}` : cleanVault;
  }
  return cleanVault;
}

/**
 * Resolves the directory where newly created canvas files should be placed,
 * following Settings → Canvas → "Default location for new canvas files".
 */
export function resolveNewCanvasDir(vaultPath: string, activeFile: string | null): string {
  const sep = vaultPath.includes('\\') ? '\\' : '/';
  const cleanVault = vaultPath.replace(/[\\/]+$/, '');
  const { canvasNewFileLocation, canvasDefaultFolder } = getSettings();

  if (canvasNewFileLocation === 'current' && activeFile) {
    const normalized = activeFile.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx).replace(/\//g, sep) : cleanVault;
  }
  if (canvasNewFileLocation === 'folder') {
    const folder = (canvasDefaultFolder || '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    return folder ? `${cleanVault}${sep}${folder.replace(/[\\/]/g, sep)}` : cleanVault;
  }
  return cleanVault;
}

/**
 * Directory where a new attachment (pasted/dropped image) should be written,
 * following the "Default location for new attachments" setting.
 */
export function resolveAttachmentDir(vaultPath: string, activeFile: string | null): string {
  const sep = vaultPath.includes('\\') ? '\\' : '/';
  const cleanVault = vaultPath.replace(/[\\/]+$/, '');
  const { attachmentLocation, attachmentFolderPath, attachmentSubfolderPath } = getSettings();

  if (attachmentLocation === 'current') {
    if (activeFile) {
      const normalized = activeFile.replace(/\\/g, '/');
      const idx = normalized.lastIndexOf('/');
      return idx > 0 ? activeFile.slice(0, idx) : cleanVault;
    }
    return cleanVault;
  }
  if (attachmentLocation === 'folder') {
    const folder = (attachmentFolderPath || 'attachments').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    return folder ? `${cleanVault}${sep}${folder.replace(/\//g, sep)}` : cleanVault;
  }
  if (attachmentLocation === 'subfolder') {
    let parentDir = cleanVault;
    if (activeFile) {
      const normalized = activeFile.replace(/\\/g, '/');
      const idx = normalized.lastIndexOf('/');
      if (idx > 0) parentDir = activeFile.slice(0, idx);
    }
    const sub = (attachmentSubfolderPath || 'attachments').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    return sub ? `${parentDir}${sep}${sub.replace(/\//g, sep)}` : parentDir;
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
