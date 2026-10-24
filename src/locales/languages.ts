/**
 * Catálogo de idiomas de Urano — réplica del de Obsidian 1.14.4.
 *
 * Evidencia (REA sobre `/usr/lib/obsidian/obsidian.asar` → `app.js`):
 *   var Oy = { am:"አማርኛ", ar:"اَلْعَرَبِيَّةُ", be:"беларуская мова", … zh:"简体中文", "zh-TW":"繁體中文" },
 *       Fy = Object.keys(Oy).sort();          // el desplegable se rellena en orden de código
 *   Ajustes → General → Language: `for (code of Fy) dropdown.addOption(code, Oy[code])`
 *   Resolución de idioma (Ny): código exacto → código base ("pt-BR" → "pt") → "en".
 *   Detección inicial (lb): navigator.language exacto → base → "en".
 *   RTL: `.mod-rtl .menu, .mod-rtl .modal, … { direction: rtl }` en app.css.
 *
 * Diferencias deliberadas respecto a Obsidian:
 *   - Códigos en minúsculas (`en-gb`, `pt-br`, `zh-cn`, `zh-tw`); `normalizeLanguageCode`
 *     acepta las variantes de Obsidian (`zh`, `zh-TW`, `pt-BR`, `en-GB`).
 *   - `ru` corrige la errata de Obsidian ("Pусский" con P latina) → "Русский".
 *   - `ar` usa el autónimo sin diacríticos ("العربية"), como pide la especificación.
 */

export type TextDirection = 'ltr' | 'rtl';

export interface LanguageInfo {
  /** Código BCP-47 en minúsculas (`es`, `pt-br`, `zh-cn`). */
  code: string;
  /** Nombre en inglés. */
  name: string;
  /** Autónimo: cómo se llama el idioma a sí mismo, en su propio alfabeto. */
  nativeName: string;
  dir: TextDirection;
}

const L = (code: string, name: string, nativeName: string, dir: TextDirection = 'ltr'): LanguageInfo => ({
  code,
  name,
  nativeName,
  dir,
});

/** Mismo orden que `Object.keys(Oy).sort()` en Obsidian (orden de código). */
export const LANGUAGES: readonly LanguageInfo[] = [
  L('am', 'Amharic', 'አማርኛ'),
  L('ar', 'Arabic', 'العربية', 'rtl'),
  L('be', 'Belarusian', 'беларуская мова'),
  L('bg', 'Bulgarian', 'български език'),
  L('bn', 'Bengali', 'বাংলা'),
  L('ca', 'Catalan', 'català'),
  L('cs', 'Czech', 'čeština'),
  L('da', 'Danish', 'Dansk'),
  L('de', 'German', 'Deutsch'),
  L('el', 'Greek', 'Ελληνικά'),
  L('en', 'English', 'English'),
  L('en-gb', 'English (United Kingdom)', 'English (GB)'),
  L('es', 'Spanish', 'Español'),
  L('fa', 'Persian', 'فارسی', 'rtl'),
  L('fi', 'Finnish', 'suomi'),
  L('fr', 'French', 'Français'),
  L('ga', 'Irish', 'Gaeilge'),
  L('gl', 'Galician', 'Galego'),
  L('he', 'Hebrew', 'עברית', 'rtl'),
  L('hu', 'Hungarian', 'Magyar'),
  L('id', 'Indonesian', 'Bahasa Indonesia'),
  L('it', 'Italian', 'Italiano'),
  L('ja', 'Japanese', '日本語'),
  L('ka', 'Georgian', 'ქართული'),
  L('kab', 'Kabyle', 'Taqbaylit'),
  L('km', 'Khmer', 'ខ្មែរ'),
  L('ko', 'Korean', '한국어'),
  L('lv', 'Latvian', 'Latviešu'),
  L('ms', 'Malay', 'Bahasa Melayu'),
  L('ne', 'Nepali', 'नेपाली'),
  L('nl', 'Dutch', 'Nederlands'),
  L('no', 'Norwegian', 'Norsk'),
  L('pl', 'Polish', 'Polski'),
  L('pt', 'Portuguese', 'Português'),
  L('pt-br', 'Portuguese (Brazil)', 'Português do Brasil'),
  L('ro', 'Romanian', 'Română'),
  L('ru', 'Russian', 'Русский'),
  L('sa', 'Sanskrit', 'संस्कृतम्'),
  L('si', 'Sinhala', 'සිංහල'),
  L('sk', 'Slovak', 'Slovenčina'),
  L('sq', 'Albanian', 'Shqip'),
  L('sr', 'Serbian', 'српски језик'),
  L('sv', 'Swedish', 'Svenska'),
  L('ta', 'Tamil', 'தமிழ்'),
  L('th', 'Thai', 'ไทย'),
  L('tr', 'Turkish', 'Türkçe'),
  L('uk', 'Ukrainian', 'Українська'),
  L('uz', 'Uzbek', 'oʻzbekcha'),
  L('vi', 'Vietnamese', 'Tiếng Việt'),
  L('zh-cn', 'Chinese (Simplified)', '简体中文'),
  L('zh-tw', 'Chinese (Traditional)', '繁體中文'),
];

export const DEFAULT_LANGUAGE = 'en';

const BY_CODE: ReadonlyMap<string, LanguageInfo> = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Alias de códigos que Obsidian / el sistema usan y Urano normaliza. */
const CODE_ALIASES: Record<string, string> = {
  zh: 'zh-cn',
  'zh-hans': 'zh-cn',
  'zh-sg': 'zh-cn',
  'zh-hant': 'zh-tw',
  'zh-hk': 'zh-tw',
  'zh-mo': 'zh-tw',
  nb: 'no',
  nn: 'no',
  in: 'id',
  iw: 'he',
};

/** `"pt_BR"` / `"pt-BR"` / `"zh"` → `"pt-br"` / `"zh-cn"`. */
export function normalizeLanguageCode(code: string | null | undefined): string {
  if (!code) return DEFAULT_LANGUAGE;
  const lower = code.trim().replace(/_/g, '-').toLowerCase();
  return CODE_ALIASES[lower] ?? lower;
}

export function getLanguage(code: string): LanguageInfo | undefined {
  return BY_CODE.get(normalizeLanguageCode(code));
}

export function isKnownLanguage(code: string): boolean {
  return BY_CODE.has(normalizeLanguageCode(code));
}

export function getTextDirection(code: string): TextDirection {
  return getLanguage(code)?.dir ?? 'ltr';
}

/**
 * Resolución estilo Obsidian (`Ny`): código exacto → código base → `en`.
 * `available` es el conjunto de códigos para los que existe un diccionario.
 */
export function resolveLanguage(code: string, available: Iterable<string>): string {
  const set = available instanceof Set ? available : new Set(available);
  const normalized = normalizeLanguageCode(code);
  if (set.has(normalized)) return normalized;
  const base = normalized.split('-')[0];
  if (set.has(base)) return base;
  return DEFAULT_LANGUAGE;
}

/** Detección inicial estilo Obsidian (`lb`): navigator.language exacto → base → `en`. */
export function detectSystemLanguage(): string {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of candidates) {
    const code = normalizeLanguageCode(raw);
    if (BY_CODE.has(code)) return code;
    const base = code.split('-')[0];
    if (BY_CODE.has(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}
