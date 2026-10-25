import nspell from 'nspell';

export type SpellChecker = ReturnType<typeof nspell>;

// Cache de instancias de diccionarios por código base ('en', 'es', etc.)
const spellcheckerCache = new Map<string, SpellChecker>();
const loadingPromises = new Map<string, Promise<SpellChecker | null>>();

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
 * Carga el diccionario Hunspell correspondiente de forma asíncrona y lo cachea.
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
      let dictData: any = null;
      if (base === 'es') {
        const mod = await import('dictionary-es');
        dictData = mod.default || mod;
      } else if (base === 'en') {
        const mod = await import('dictionary-en');
        dictData = mod.default || mod;
      } else if (base === 'fr') {
        const mod = await import('dictionary-fr');
        dictData = mod.default || mod;
      } else if (base === 'de') {
        const mod = await import('dictionary-de');
        dictData = mod.default || mod;
      } else if (base === 'it') {
        const mod = await import('dictionary-it');
        dictData = mod.default || mod;
      } else if (base === 'pt') {
        const mod = await import('dictionary-pt');
        dictData = mod.default || mod;
      } else {
        // Fallback a inglés para otros idiomas sin diccionario empaquetado
        const mod = await import('dictionary-en');
        dictData = mod.default || mod;
      }

      if (dictData) {
        const instance = nspell(dictData);
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
