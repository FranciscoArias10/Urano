/**
 * Motor i18n ultraligero de Urano.
 *
 * Diseño calcado del de Obsidian (evidencia REA sobre `obsidian.asar/app.js`):
 *   - El inglés embebido (`window.OBSIDIAN_DEFAULT_I18N`) es el diccionario base y el
 *     fallback de cualquier clave no traducida. Aquí: `en.json`, importado de forma síncrona.
 *   - Los demás paquetes se cargan bajo demanda (`fetch("/i18n/<code>.txt")`). Aquí:
 *     `import.meta.glob('./*.json')` → un chunk por idioma, importado solo al seleccionarlo.
 *   - Las claves con puntos se aplanan/anidan (`qy`) para buscarlas en O(1).
 *   - Un paquete externo del usuario (ruta a `.json`) se superpone al embebido. Aquí:
 *     `.urano/locales/<code>.json` dentro de la bóveda (ver `localeStore`).
 *   - Resolución de código: exacto → base → `en` (`Ny`).
 *
 * No depende de React ni de Zustand: `t()` es una función plana que leen por igual los
 * componentes (vía `useT()`), los menús contextuales de CodeMirror y los servicios.
 */
import en from './en.json';
import {
  DEFAULT_LANGUAGE,
  getLanguage,
  normalizeLanguageCode,
  type TextDirection,
} from './languages';

export type Dict = { [key: string]: string | Dict };
export type FlatDict = Record<string, string>;
export type TranslateParams = Record<string, string | number | boolean | null | undefined>;

/* ---------------------------------------------------------------------- */
/* Tipado de claves: `"settings.general.language"` con autocompletado      */
/* ---------------------------------------------------------------------- */

type Primitive = string | number | boolean | null | undefined;
type DotPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Primitive
    ? `${Prefix}${K}`
    : DotPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Claves conocidas (de `en.json`) con autocompletado; cualquier string sigue siendo válido
 *  para claves aportadas por paquetes de la comunidad (`.urano/locales`). */
export type TranslationKey = DotPaths<typeof en> | (string & {});

/* ---------------------------------------------------------------------- */
/* Utilidades puras                                                        */
/* ---------------------------------------------------------------------- */

/** Aplana `{a:{b:"x"}}` → `{"a.b":"x"}`. Acepta también diccionarios ya planos. */
export function flattenDict(dict: Dict, prefix = '', out: FlatDict = {}): FlatDict {
  for (const key of Object.keys(dict)) {
    const value = dict[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flattenDict(value, path, out);
    else if (typeof value === 'string') out[path] = value;
  }
  return out;
}

/** `{count}` y `{{count}}` → valor. Las claves sin parámetro se dejan tal cual. */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g, (match, a: string, b: string) => {
    const name = a ?? b;
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/* ---------------------------------------------------------------------- */
/* Estado del motor                                                        */
/* ---------------------------------------------------------------------- */

const LOCAL_STORAGE_KEY = 'urano_language';

/** Carga diferida: `import.meta.glob` crea un chunk por `./xx.json`; nada se importa
 *  hasta que se llama al loader. `en.json` queda además embebido como base. */
const bundledLoaders = import.meta.glob<{ default: Dict }>('./*.json');

const BUNDLED_CODES: ReadonlySet<string> = new Set(
  Object.keys(bundledLoaders)
    .map((p) => p.replace(/^\.\//, '').replace(/\.json$/, ''))
    .map(normalizeLanguageCode)
);

const baseline: FlatDict = flattenDict(en as Dict);
const bundledCache = new Map<string, FlatDict>([[DEFAULT_LANGUAGE, baseline]]);
const bundledLoading = new Map<string, Promise<FlatDict>>();

export interface CustomLocaleMeta {
  code: string;
  name?: string;
  nativeName?: string;
  dir?: TextDirection;
}

/** Paquetes de la bóveda (`.urano/locales/<code>.json`), ya aplanados. */
const custom = new Map<string, { flat: FlatDict; meta: CustomLocaleMeta }>();

let language = DEFAULT_LANGUAGE;
let dir: TextDirection = 'ltr';
let active: FlatDict = baseline;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  listeners.forEach((fn) => fn());
}

function baseOf(code: string): string {
  return code.split('-')[0];
}

async function loadBundled(code: string): Promise<FlatDict> {
  const cached = bundledCache.get(code);
  if (cached) return cached;
  const pending = bundledLoading.get(code);
  if (pending) return pending;
  const file = Object.keys(bundledLoaders).find(
    (p) => normalizeLanguageCode(p.replace(/^\.\//, '').replace(/\.json$/, '')) === code
  );
  if (!file) return {};
  const promise = bundledLoaders[file]()
    .then((mod) => {
      const flat = flattenDict(mod.default as Dict);
      bundledCache.set(code, flat);
      return flat;
    })
    .catch((err) => {
      console.error(`[i18n] No se pudo cargar el idioma "${code}":`, err);
      return {} as FlatDict;
    })
    .finally(() => bundledLoading.delete(code));
  bundledLoading.set(code, promise);
  return promise;
}

/** Cadena de fallback (de menor a mayor prioridad):
 *  en embebido → base embebido (`pt` para `pt-br`) → exacto embebido →
 *  base de la bóveda → exacto de la bóveda. */
function rebuild(): void {
  const base = baseOf(language);
  active = {
    ...baseline,
    ...(base !== language ? bundledCache.get(base) ?? {} : {}),
    ...(bundledCache.get(language) ?? {}),
    ...(base !== language ? custom.get(base)?.flat ?? {} : {}),
    ...(custom.get(language)?.flat ?? {}),
  };
  dir = custom.get(language)?.meta.dir ?? getLanguage(language)?.dir ?? 'ltr';
  applyToDocument();
  emit();
}

/**
 * `<html lang>` + `body.mod-rtl`. Igual que Obsidian, NO se pone `dir="rtl"` en todo el
 * documento: `app.css` solo voltea superficies concretas
 * (`.mod-rtl .menu, .mod-rtl .modal, .mod-rtl .notice, .mod-rtl .tooltip … { direction: rtl }`);
 * Urano replica esa lista en `index.css`. El contenido de las notas sigue la dirección propia
 * de cada texto (CodeMirror / `unicode-bidi`).
 */
function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.body?.classList.toggle('mod-rtl', dir === 'rtl');
}

/* ---------------------------------------------------------------------- */
/* API pública                                                             */
/* ---------------------------------------------------------------------- */

/**
 * Traduce `key` en el idioma activo con fallback automático a inglés. Si la clave no
 * existe en ningún diccionario devuelve la propia clave (y avisa en desarrollo).
 */
export function t(key: TranslationKey, params?: TranslateParams): string {
  const value = active[key] ?? baseline[key];
  if (value === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] Clave sin traducción: "${key}"`);
    return key;
  }
  return interpolate(value, params);
}

/** `true` si la clave existe en el idioma activo o en inglés. */
export function hasTranslation(key: string): boolean {
  return key in active || key in baseline;
}

export function getLanguageCode(): string {
  return language;
}

export function getDirection(): TextDirection {
  return dir;
}

/** Contador que cambia con cada idioma/diccionario nuevo (para `useSyncExternalStore`). */
export function getVersion(): number {
  return version;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Códigos con diccionario embebido en la app (hoy `en` y `es`). */
export function getBundledLanguageCodes(): string[] {
  return [...BUNDLED_CODES];
}

export function readPersistedLanguage(): string | null {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    return stored ? normalizeLanguageCode(stored) : null;
  } catch {
    return null;
  }
}

function persistLanguage(code: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, code);
  } catch {
    // localStorage no disponible
  }
}

/**
 * Cambia el idioma activo. Persiste en `localStorage` de inmediato, carga el diccionario
 * embebido bajo demanda (solo la primera vez) y notifica a todos los suscriptores, con
 * lo que la interfaz se re-renderiza al vuelo sin recargar la ventana.
 */
export async function setLanguage(code: string): Promise<void> {
  const next = normalizeLanguageCode(code);
  language = next;
  persistLanguage(next);
  const base = baseOf(next);
  await Promise.all([loadBundled(next), base !== next ? loadBundled(base) : Promise.resolve({})]);
  // Si mientras cargaba se pidió otro idioma, ese `setLanguage` reconstruirá el suyo.
  if (language !== next) return;
  rebuild();
}

/**
 * Registra (o reemplaza) un paquete de la comunidad para `code`. `data` puede ser un
 * JSON anidado o plano con claves con puntos; una clave opcional `_meta`
 * `{ name, nativeName, dir }` describe idiomas que no están en el catálogo.
 */
export function registerCustomLocale(code: string, data: Dict): CustomLocaleMeta {
  const normalized = normalizeLanguageCode(code);
  const { _meta, ...rest } = data as Dict & { _meta?: Dict };
  const meta: CustomLocaleMeta = { code: normalized };
  if (_meta && typeof _meta === 'object') {
    if (typeof _meta.name === 'string') meta.name = _meta.name;
    if (typeof _meta.nativeName === 'string') meta.nativeName = _meta.nativeName;
    if (_meta.dir === 'rtl' || _meta.dir === 'ltr') meta.dir = _meta.dir;
  }
  custom.set(normalized, { flat: flattenDict(rest), meta });
  if (normalized === language || normalized === baseOf(language)) rebuild();
  return meta;
}

/** Olvida todos los paquetes de la bóveda (al cambiar de bóveda). */
export function clearCustomLocales(): void {
  if (custom.size === 0) return;
  custom.clear();
  rebuild();
}

export function getCustomLocales(): CustomLocaleMeta[] {
  return [...custom.values()].map((c) => c.meta);
}

/** Claves de `en.json` que el idioma activo todavía no traduce (útil para la comunidad). */
export function getUntranslatedKeys(): string[] {
  if (language === DEFAULT_LANGUAGE) return [];
  const own = {
    ...(bundledCache.get(language) ?? {}),
    ...(custom.get(language)?.flat ?? {}),
  };
  return Object.keys(baseline).filter((k) => !(k in own));
}

applyToDocument();
