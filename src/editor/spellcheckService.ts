import nspell from 'nspell';

export type SpellChecker = ReturnType<typeof nspell>;

// Cache de instancias de diccionarios por código base ('en', 'es', etc.)
const spellcheckerCache = new Map<string, SpellChecker>();
const loadingPromises = new Map<string, Promise<SpellChecker | null>>();

const SUPPORTED_DICTS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt']);

/**
 * Normaliza el código de idioma ('es-ES' -> 'es', 'en-GB' -> 'en').
 */
export function getBaseLanguageCode(langCode: string): string {
  if (!langCode) return 'en';
  const clean = langCode.trim().toLowerCase();
  if (clean.startsWith('es')) return 'es';
  if (clean.startsWith('en')) return 'en';
  if (clean.startsWith('fr')) return 'fr';
  if (clean.startsWith('de')) return 'de';
  if (clean.startsWith('it')) return 'it';
  if (clean.startsWith('pt')) return 'pt';
  return clean.split(/[-_]/)[0] || 'en';
}

/**
 * Carga el diccionario Hunspell (.aff y .dic) de forma asíncrona mediante fetch nativo.
 */
export async function loadSpellchecker(langCode: string): Promise<SpellChecker | null> {
  const base = getBaseLanguageCode(langCode);
  if (spellcheckerCache.has(base)) {
    return spellcheckerCache.get(base)!;
  }

  if (loadingPromises.has(base)) {
    return loadingPromises.get(base)!;
  }

  const promise = (async () => {
    try {
      const targetLang = SUPPORTED_DICTS.has(base) ? base : 'en';

      const [affRes, dicRes] = await Promise.all([
        fetch(`/dictionaries/${targetLang}/index.aff`),
        fetch(`/dictionaries/${targetLang}/index.dic`),
      ]);

      if (!affRes.ok || !dicRes.ok) {
        throw new Error(`HTTP error ${affRes.status} / ${dicRes.status}`);
      }

      const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);

      if (aff && dic) {
        const instance = nspell({ aff, dic });
        spellcheckerCache.set(base, instance);
        return instance;
      }
    } catch (err) {
      console.warn(`[Spellcheck] No se pudo cargar el diccionario para '${base}':`, err);
    }
    return null;
  })();

  loadingPromises.set(base, promise);
  return promise;
}

/**
 * Obtiene el corrector de forma síncrona si ya está en caché.
 */
export function getCachedSpellchecker(langCode: string): SpellChecker | null {
  const base = getBaseLanguageCode(langCode);
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

  // 1. Diccionario personalizado del usuario
  if (customWords && customWords.has(word.toLowerCase())) {
    return true;
  }

  const sp = getCachedSpellchecker(langCode);
  if (!sp) {
    // Si aún se está cargando el diccionario, no marcar error prematuramente
    return true;
  }

  // 2. Diccionario Hunspell nativo
  if (sp.correct(word)) {
    return true;
  }

  // Comprobar también en minúsculas (por si está capitalizada pero es válida)
  const lower = word.toLowerCase();
  if (lower !== word && sp.correct(lower)) {
    return true;
  }

  return false;
}

/**
 * Obtiene sugerencias de corrección para una palabra mal escrita.
 */
export function getWordSuggestions(word: string, langCode: string, limit = 6): string[] {
  const sp = getCachedSpellchecker(langCode);
  if (!sp) return [];
  try {
    const list = sp.suggest(word) || [];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}
