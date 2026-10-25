import nspell from 'nspell';

export type SpellChecker = ReturnType<typeof nspell>;

// Cache de instancias de diccionarios por código base ('en', 'es', etc.)
const spellcheckerCache = new Map<string, SpellChecker>();
const loadingPromises = new Map<string, Promise<SpellChecker | null>>();

export const SUPPORTED_DICTS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt']);

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

/**
 * Alias para compatibilidad
 */
export const getBaseLanguageCode = normalizeSpellcheckLanguage;

/**
 * Carga el diccionario Hunspell (.aff y .dic) de forma asíncrona mediante fetch
 * y ejecuta una prueba de humo automática.
 */
export async function loadSpellchecker(langCode: string): Promise<SpellChecker | null> {
  const base = normalizeSpellcheckLanguage(langCode);
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

        // Prueba de humo automática al cargar el diccionario
        if (base === 'en') {
          const isHello = instance.correct('hello');
          const isHola = instance.correct('hola');
          if (isHello && !isHola) {
            console.info(`[Spellcheck] Dictionary 'en' loaded and verified successfully (hello=true, hola=false)`);
          } else {
            console.warn(`[Spellcheck] Dictionary 'en' smoke test warning: hello=${isHello}, hola=${isHola}`);
          }
        } else if (base === 'es') {
          const isHola = instance.correct('hola');
          const isRapido = instance.correct('rapido');
          const isRapidoAccent = instance.correct('rápido');
          if (isHola && !isRapido && isRapidoAccent) {
            console.info(`[Spellcheck] Dictionary 'es' loaded and verified successfully (hola=true, rapido=false, rápido=true)`);
          } else {
            console.warn(`[Spellcheck] Dictionary 'es' smoke test warning: hola=${isHola}, rapido=${isRapido}, rápido=${isRapidoAccent}`);
          }
        } else {
          console.info(`[Spellcheck] Dictionary '${base}' loaded successfully`);
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

  // 1. Diccionario personalizado del usuario
  if (customWords && customWords.has(word.toLowerCase())) {
    return true;
  }

  const sp = getCachedSpellchecker(langCode);
  if (!sp) {
    // Si aún se está cargando el diccionario, disparar carga en segundo plano
    void loadSpellchecker(langCode);
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

// Pre-cargar de inmediato inglés y español en segundo plano para que estén listos
if (typeof window !== 'undefined') {
  void loadSpellchecker('en');
  void loadSpellchecker('es');
}
