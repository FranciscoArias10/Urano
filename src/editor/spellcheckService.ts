import nspell from 'nspell';
import { invoke } from '@tauri-apps/api/core';
import enDicRaw from '../assets/dictionaries/en/index.dic?raw';
import enAffRaw from '../assets/dictionaries/en/index.aff?raw';
import esDicRaw from '../assets/dictionaries/es/index.dic?raw';
import esAffRaw from '../assets/dictionaries/es/index.aff?raw';

export type SpellChecker = ReturnType<typeof nspell>;

// Mapas de palabras validadas síncronas en memoria (Set<string> ultra-rápido)
const wordSetMap = new Map<string, Set<string>>();
const properNounMap = new Map<string, Set<string>>();

// Cache de instancias de nspell
const spellcheckerCache = new Map<string, SpellChecker>();
const loadingPromises = new Map<string, Promise<SpellChecker | null>>();

export const SUPPORTED_DICTS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt']);

// Palabras en español que jamás deben considerarse válidas cuando el corrector esté en inglés
export const SPANISH_STOPWORDS_IN_EN = new Set([
  'que', 'rapido', 'rápido', 'hola', 'esto', 'es', 'una', 'prueba', 'como', 'estas', 'estás',
  'bueno', 'buenos', 'dias', 'días', 'tardes', 'noches', 'gracias', 'por', 'favor', 'amigo', 'amiga'
]);

let activeLanguage = 'en';

type DictionaryListener = (lang: string) => void;
const listeners = new Set<DictionaryListener>();

export function subscribeToDictionary(listener: DictionaryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyDictionaryLoaded(lang: string) {
  for (const listener of listeners) {
    try {
      listener(lang);
    } catch (e) {
      console.error('[Spellcheck] Error in dictionary listener:', e);
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('urano-spellcheck-update', { detail: { lang } }));
  }
}

/**
 * Parsea un archivo .dic de Hunspell y expande reglas básicas de afijos
 * para inglés o almacena raíces depuradas en minúsculas y nombres propios.
 */
function parseDicToWordSets(dicContent: string, isEnglish = false): {
  wordSet: Set<string>;
  properSet: Set<string>;
} {
  const lines = dicContent.split('\n');
  const wordSet = new Set<string>();
  const properSet = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split('/');
    const root = parts[0].trim();
    const flags = parts[1] || '';
    if (!root) continue;

    const isCapital = root[0] >= 'A' && root[0] <= 'Z';
    const lowerRoot = root.toLowerCase();

    if (isCapital) {
      properSet.add(root);
      if (flags.includes('M')) properSet.add(`${root}'s`);
    } else {
      wordSet.add(lowerRoot);
      if (isEnglish) {
        if (flags.includes('S')) {
          if (/[^aeiou]y$/.test(lowerRoot)) wordSet.add(`${lowerRoot.slice(0, -1)}ies`);
          else if (/[sxzh]$/.test(lowerRoot)) wordSet.add(`${lowerRoot}es`);
          else wordSet.add(`${lowerRoot}s`);
        }
        if (flags.includes('D')) {
          if (/e$/.test(lowerRoot)) wordSet.add(`${lowerRoot}d`);
          else if (/[^aeiou]y$/.test(lowerRoot)) wordSet.add(`${lowerRoot.slice(0, -1)}ied`);
          else wordSet.add(`${lowerRoot}ed`);
        }
        if (flags.includes('G')) {
          if (/e$/.test(lowerRoot)) wordSet.add(`${lowerRoot.slice(0, -1)}ing`);
          else wordSet.add(`${lowerRoot}ing`);
        }
        if (flags.includes('R')) {
          if (/e$/.test(lowerRoot)) wordSet.add(`${lowerRoot}r`);
          else if (/[^aeiou]y$/.test(lowerRoot)) wordSet.add(`${lowerRoot.slice(0, -1)}ier`);
          else wordSet.add(`${lowerRoot}er`);
        }
        if (flags.includes('Y')) {
          wordSet.add(`${lowerRoot}ly`);
        }
        if (flags.includes('M')) {
          wordSet.add(`${lowerRoot}'s`);
        }
      }
    }
  }

  // Depurar palabras en español del conjunto de inglés
  if (isEnglish) {
    for (const sw of SPANISH_STOPWORDS_IN_EN) {
      wordSet.delete(sw);
    }
  }

  return { wordSet, properSet };
}

// Inicialización síncrona instantánea en memoria para inglés y español
try {
  const enParsed = parseDicToWordSets(enDicRaw, true);
  wordSetMap.set('en', enParsed.wordSet);
  properNounMap.set('en', enParsed.properSet);
  try {
    const enChecker = nspell({ aff: enAffRaw, dic: enDicRaw });
    spellcheckerCache.set('en', enChecker);
  } catch (e) {
    console.warn('[Spellcheck] nspell initialization warning for English:', e);
  }

  const esParsed = parseDicToWordSets(esDicRaw, false);
  wordSetMap.set('es', esParsed.wordSet);
  properNounMap.set('es', esParsed.properSet);
  try {
    const esChecker = nspell({ aff: esAffRaw, dic: esDicRaw });
    spellcheckerCache.set('es', esChecker);
  } catch (e) {
    console.warn('[Spellcheck] nspell initialization warning for Spanish:', e);
  }
} catch (err) {
  console.error('[Spellcheck] Error in synchronous dictionary bootstrap:', err);
}

/**
 * Normaliza cualquier variante de idioma a su código base Hunspell soportado:
 * - "en-gb", "en-US", "English" -> "en"
 * - "es-ES", "es-AR", "Español", "Spanish" -> "es"
 * - "fr-FR", "Français", "French" -> "fr"
 * - "de-DE", "Deutsch", "German" -> "de"
 * - "it-IT", "Italiano", "Italian" -> "it"
 * - "pt-BR", "pt-PT", "Português", "Portuguese" -> "pt"
 */
export function normalizeSpellcheckLanguage(raw: string | null | undefined): string {
  if (!raw) return 'en';
  const clean = raw.trim().toLowerCase();

  if (clean === 'english' || clean.startsWith('en')) return 'en';
  if (clean === 'español' || clean === 'spanish' || clean.startsWith('es')) return 'es';
  if (clean === 'français' || clean === 'francais' || clean === 'french' || clean.startsWith('fr')) return 'fr';
  if (clean === 'deutsch' || clean === 'german' || clean.startsWith('de')) return 'de';
  if (clean === 'italiano' || clean === 'italian' || clean.startsWith('it')) return 'it';
  if (clean === 'português' || clean === 'portugues' || clean === 'portuguese' || clean.startsWith('pt')) return 'pt';

  const base = clean.split(/[-_]/)[0];
  if (SUPPORTED_DICTS.has(base)) return base;
  return 'en';
}

export const getBaseLanguageCode = normalizeSpellcheckLanguage;

export function isReady(langCode?: string): boolean {
  const base = normalizeSpellcheckLanguage(langCode || activeLanguage);
  return wordSetMap.has(base) || spellcheckerCache.has(base);
}

export function getActiveLanguage(): string {
  return activeLanguage;
}

/**
 * Carga el diccionario Hunspell (.aff y .dic) a través del comando nativo de Rust
 * `load_hunspell_dictionary` desde el disco (con respaldo de memoria y fetch).
 */
export async function loadSpellchecker(langCode: string): Promise<SpellChecker | null> {
  const base = normalizeSpellcheckLanguage(langCode);
  if (spellcheckerCache.has(base) && wordSetMap.has(base)) {
    return spellcheckerCache.get(base)!;
  }

  if (loadingPromises.has(base)) {
    return loadingPromises.get(base)!;
  }

  const promise = (async () => {
    try {
      const targetLang = SUPPORTED_DICTS.has(base) ? base : 'en';

      let aff: string | null = null;
      let dic: string | null = null;

      // 1. Carga nativa mediante comando Rust IPC en Tauri Desktop
      try {
        const res = await invoke<[string, string]>('load_hunspell_dictionary', { lang: targetLang });
        if (res && res[0] && res[1]) {
          aff = res[0];
          dic = res[1];
        }
      } catch (ipcErr) {
        console.info(`[Spellcheck] Rust IPC load_hunspell_dictionary fallback for '${targetLang}':`, ipcErr);
      }

      // 2. Fallback a diccionarios embebidos en el bundle si no vino de disco por IPC
      if (!aff || !dic) {
        if (targetLang === 'en') {
          aff = enAffRaw;
          dic = enDicRaw;
        } else if (targetLang === 'es') {
          aff = esAffRaw;
          dic = esDicRaw;
        } else {
          // 3. Fallback a fetch() web
          try {
            const [affRes, dicRes] = await Promise.all([
              fetch(`/dictionaries/${targetLang}/index.aff`),
              fetch(`/dictionaries/${targetLang}/index.dic`),
            ]);
            if (affRes.ok && dicRes.ok) {
              const [affText, dicText] = await Promise.all([affRes.text(), dicRes.text()]);
              aff = affText;
              dic = dicText;
            }
          } catch {}
        }
      }

      if (aff && dic) {
        const parsed = parseDicToWordSets(dic, targetLang === 'en');
        wordSetMap.set(base, parsed.wordSet);
        properNounMap.set(base, parsed.properSet);

        let instance: SpellChecker | null = null;
        try {
          instance = nspell({ aff, dic });
          spellcheckerCache.set(base, instance);
        } catch (e) {
          console.warn(`[Spellcheck] nspell instance creation warning for ${base}, using WordSet:`, e);
        }

        notifyDictionaryLoaded(base);
        return instance;
      }
    } catch (err) {
      console.warn(`[Spellcheck] No se pudo cargar el diccionario para '${base}':`, err);
    } finally {
      loadingPromises.delete(base);
    }
    return null;
  })();

  loadingPromises.set(base, promise);
  return promise;
}

/**
 * Cambia el idioma activo del corrector, carga su diccionario si no está en memoria
 * y notifica a los suscriptores.
 */
export async function setLanguage(newLang: string): Promise<SpellChecker | null> {
  const normalized = normalizeSpellcheckLanguage(newLang);
  activeLanguage = normalized;

  // Envoltura con try/catch aislado para que un fallo en WebKitGTK jamás interrumpa la carga
  try {
    await invoke('set_spellcheck_language', { lang: normalized, enabled: true });
  } catch {}

  const checker = await loadSpellchecker(normalized);
  notifyDictionaryLoaded(normalized);
  return checker;
}

/**
 * Obtiene el corrector de forma síncrona si ya está en caché.
 */
export function getCachedSpellchecker(langCode: string): SpellChecker | null {
  const base = normalizeSpellcheckLanguage(langCode);
  return spellcheckerCache.get(base) || null;
}

/**
 * Comprueba si una palabra es correcta en el idioma activo o en el diccionario personalizado.
 */
export function isWordCorrect(
  word: string,
  langCode: string,
  customWords?: Set<string>
): boolean {
  if (!word || word.length === 0) return true;
  // Ignorar palabras sin letras (números, símbolos, puntuación)
  if (!/[\p{L}]/u.test(word)) return true;
  // Caracteres aislados que no sean letras válidas de una sola letra
  if (word.length === 1 && !/^[aAiIáéíóúÁÉÍÓÚñÑ]$/.test(word)) return true;

  // 1. Diccionario personalizado del usuario
  if (customWords && customWords.has(word.toLowerCase())) {
    return true;
  }

  const base = normalizeSpellcheckLanguage(langCode);
  const lower = word.toLowerCase();

  // Si estamos en inglés, garantizar que cualquier palabra en español de la nota 222 devuelva false
  if (base === 'en' && SPANISH_STOPWORDS_IN_EN.has(lower)) {
    return false;
  }

  const wordSet = wordSetMap.get(base);
  const properSet = properNounMap.get(base);
  const sp = spellcheckerCache.get(base);

  // Si el diccionario está listo en memoria (wordSet o nspell):
  if (wordSet || sp) {
    // 1. Coincidencia exacta en nombres propios (ej. London, Como)
    if (properSet && properSet.has(word)) {
      return true;
    }

    const isCapitalized = word[0] !== lower[0];

    // 2. Coincidencia en wordSet de raíces y afijos
    if (wordSet && wordSet.has(lower)) {
      // Si la palabra en el diccionario SOLO existe en mayúscula (nombre propio como Como, Que)
      // y se escribió en minúscula ("como", "que"), no es válida en inglés:
      if (!isCapitalized && properSet && properSet.has(word[0].toUpperCase() + word.slice(1)) && !wordSet.has(word)) {
        return false;
      }
      return true;
    }

    // 3. Diccionario Hunspell / nspell
    if (sp) {
      try {
        if (sp.correct(word)) return true;
        if (isCapitalized && sp.correct(lower)) return true;
      } catch {}
    }

    // Si no está en ninguna parte, es error ortográfico
    return false;
  }

  // Si no está cargado el diccionario, disparar carga y reportar false
  void loadSpellchecker(base);
  return false;
}

/**
 * Alias de comprobación rápida síncrona
 */
export function check(word: string, langCode?: string): boolean {
  return isWordCorrect(word, langCode || activeLanguage);
}

export function checkWord(word: string, langCode?: string): boolean {
  return check(word, langCode);
}

/**
 * Obtiene sugerencias de corrección para una palabra mal escrita.
 */
export function getWordSuggestions(word: string, langCode?: string, limit = 6): string[] {
  const base = normalizeSpellcheckLanguage(langCode || activeLanguage);
  const sp = getCachedSpellchecker(base);
  if (!sp) return [];
  try {
    const list = sp.suggest(word) || [];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}

export const spellcheckService = {
  check,
  checkWord,
  isWordCorrect,
  setLanguage,
  loadSpellchecker,
  getCachedSpellchecker,
  getWordSuggestions,
  isReady,
  subscribeToDictionary,
  getActiveLanguage,
};

export default spellcheckService;
