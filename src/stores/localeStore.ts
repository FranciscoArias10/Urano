/**
 * Puente reactivo entre el motor `locales/i18n.ts` y React / Zustand.
 *
 *   - `useT()`            → función `t` que fuerza re-render al cambiar idioma o diccionario.
 *   - `useLocaleStore`    → idioma activo, dirección, lista de idiomas (catálogo + bóveda).
 *   - `setLanguage(code)` → persiste en `localStorage` (`urano_language`) y en la configuración
 *                           global (`settingsStore.language`, que acaba en `.urano/settings.json`).
 *   - `loadVaultLocales`  → lee `.urano/locales/*.json` de la bóveda y los superpone al idioma.
 */
import { create } from 'zustand';
import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as i18n from '../locales/i18n';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  detectSystemLanguage,
  getLanguage,
  normalizeLanguageCode,
  type LanguageInfo,
  type TextDirection,
} from '../locales/languages';
import { useSettingsStore } from './settingsStore';
import { setLanguage as setSpellcheckLanguage } from '../editor/spellcheckService';

export type { TranslationKey, TranslateParams } from '../locales/i18n';
export { t } from '../locales/i18n';

export const LOCALES_DIR_RELATIVE = '.urano/locales';

export interface LanguageOption extends LanguageInfo {
  /** El idioma viene de un `.json` de la bóveda y no existe en el catálogo. */
  custom?: boolean;
}

interface CustomLocaleFile {
  code: string;
  content: string;
}

interface LocaleStoreState {
  language: string;
  dir: TextDirection;
  /** Catálogo de Obsidian + idiomas añadidos por la comunidad en la bóveda. */
  languages: LanguageOption[];
  /** `true` mientras se descarga un diccionario embebido. */
  loading: boolean;
  /** Bóveda cuyos `.urano/locales` están cargados. */
  vaultPath: string | null;

  setLanguage: (code: string) => Promise<void>;
  loadVaultLocales: (vaultPath: string | null) => Promise<void>;
}

function buildLanguageList(): LanguageOption[] {
  const list: LanguageOption[] = [...LANGUAGES];
  for (const meta of i18n.getCustomLocales()) {
    if (getLanguage(meta.code)) continue; // override de un idioma conocido: ya está listado
    list.push({
      code: meta.code,
      name: meta.name ?? meta.code,
      nativeName: meta.nativeName ?? meta.name ?? meta.code,
      dir: meta.dir ?? 'ltr',
      custom: true,
    });
  }
  return list.sort((a, b) => a.code.localeCompare(b.code));
}

export const useLocaleStore = create<LocaleStoreState>((set, get) => ({
  language: i18n.getLanguageCode(),
  dir: i18n.getDirection(),
  languages: buildLanguageList(),
  loading: false,
  vaultPath: null,

  setLanguage: async (code) => {
    const next = normalizeLanguageCode(code);
    set({ loading: true });
    try {
      await i18n.setLanguage(next);
      await setSpellcheckLanguage(next);
    } finally {
      set({ loading: false });
    }
    // Configuración global de Urano (localStorage + .urano/settings.json)
    const settings = useSettingsStore.getState();
    if (settings.settings.language !== next) settings.setSetting('language', next);
  },

  loadVaultLocales: async (vaultPath) => {
    i18n.clearCustomLocales();
    if (!vaultPath) {
      set({ vaultPath: null, languages: buildLanguageList() });
      return;
    }
    try {
      const files = await invoke<CustomLocaleFile[]>('list_custom_locales', { vaultPath });
      for (const file of files ?? []) {
        try {
          const data = JSON.parse(file.content);
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            i18n.registerCustomLocale(file.code, data);
          }
        } catch (err) {
          console.warn(`[i18n] ${LOCALES_DIR_RELATIVE}/${file.code}.json no es JSON válido:`, err);
        }
      }
    } catch (err) {
      console.warn('[i18n] No se pudieron leer los idiomas de la bóveda:', err);
    }
    set({ vaultPath, languages: buildLanguageList() });
    if (get().language !== i18n.getLanguageCode()) set({ language: i18n.getLanguageCode() });
  },
}));

// El motor es la fuente de verdad del idioma/dirección; el store solo lo refleja.
i18n.subscribe(() => {
  const language = i18n.getLanguageCode();
  const dir = i18n.getDirection();
  const state = useLocaleStore.getState();
  if (state.language !== language || state.dir !== dir) useLocaleStore.setState({ language, dir });
});

// Si la configuración cambia de idioma por otra vía (carga de `.urano/settings.json` de otra
// bóveda, reset a valores por defecto…), seguirla.
useSettingsStore.subscribe((state, prev) => {
  if (state.settings.language === prev.settings.language) return;
  const next = normalizeLanguageCode(state.settings.language);
  if (next !== i18n.getLanguageCode()) void useLocaleStore.getState().setLanguage(next);
});

/** Idioma inicial: `urano_language` → configuración guardada → idioma del sistema → `en`. */
const initial =
  i18n.readPersistedLanguage() ??
  normalizeLanguageCode(useSettingsStore.getState().settings.language) ??
  detectSystemLanguage() ??
  DEFAULT_LANGUAGE;
void useLocaleStore.getState().setLanguage(initial);

/**
 * Hook principal: `const t = useT(); t('settings.general.language')`.
 * Se suscribe a la versión del motor, así que cualquier cambio de idioma o diccionario
 * re-renderiza el componente sin recargar la ventana.
 */
export function useT(): typeof i18n.t {
  useSyncExternalStore(i18n.subscribe, i18n.getVersion, i18n.getVersion);
  return i18n.t;
}

/** Dirección del texto del idioma activo (`rtl` para árabe, persa y hebreo). */
export function useTextDirection(): TextDirection {
  return useLocaleStore((s) => s.dir);
}
