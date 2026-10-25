import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import { useSettingsStore } from '../stores/settingsStore';
import {
  isWordCorrect,
  loadSpellchecker,
  getCachedSpellchecker,
  getWordSuggestions,
  subscribeToDictionary,
} from './spellcheckService';

/**
 * StateEffect para forzar a CodeMirror 6 a recomputar y pintar las decoraciones
 * de corrección ortográfica de forma reactiva y sin bloquear la UI.
 */
export const spellcheckRefreshEffect = StateEffect.define<boolean>();

export const spellErrorMark = Decoration.mark({
  class: 'cm-spell-error',
  attributes: { 'data-spell-error': 'true' },
});

// Regex para palabras con soporte unicode (tildes, eñes, diacríticos, apóstrofes)
const WORD_REGEX = /[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)?/gu;

interface ExclusionRange {
  from: number;
  to: number;
}

/**
 * Encuentra todos los rangos que deben ser ignorados por el corrector:
 * - Frontmatter YAML
 * - Bloques de código (``` ... ```)
 * - Código en línea (` ... `)
 * - Fórmulas LaTeX ($$ ... $$ y $ ... $)
 * - Enlaces tipo Wikilink ([[ ... ]])
 * - URLs (http, https, www)
 * - Destino de enlaces Markdown ( [text](url) )
 */
function computeExclusionRanges(docText: string): ExclusionRange[] {
  const ranges: ExclusionRange[] = [];

  // 1. Frontmatter YAML al inicio del documento
  const frontmatterMatch = docText.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (frontmatterMatch && frontmatterMatch.index !== undefined) {
    ranges.push({
      from: frontmatterMatch.index,
      to: frontmatterMatch.index + frontmatterMatch[0].length,
    });
  }

  // 2. Bloques de código ``` ... ```
  const codeBlockRegex = /```[\s\S]*?(?:```|$)/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // 3. LaTeX blocks $$ ... $$
  const mathBlockRegex = /\$\$[\s\S]*?(?:\$\$|$)/g;
  while ((match = mathBlockRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // 4. Código en línea ` ... `
  const inlineCodeRegex = /`[^`\r\n]+`/g;
  while ((match = inlineCodeRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // 5. LaTeX inline $ ... $
  const inlineMathRegex = /\$[^$\r\n]+\$/g;
  while ((match = inlineMathRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // 6. Wikilinks [[ ... ]]
  const wikilinkRegex = /\[\[[^\]\r\n]+\]\]/g;
  while ((match = wikilinkRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // 7. Destinos de enlaces markdown (... )
  const mdLinkUrlRegex = /\]\([^\)\r\n]+\)/g;
  while ((match = mdLinkUrlRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // 8. URLs sueltas
  const urlRegex = /https?:\/\/[^\s)\]>]+/gi;
  while ((match = urlRegex.exec(docText)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // Ordenar los rangos por 'from'
  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

function isInsideExclusions(from: number, to: number, exclusions: ExclusionRange[]): boolean {
  for (const ex of exclusions) {
    if (to > ex.from && from < ex.to) {
      return true;
    }
  }
  return false;
}

/**
 * Analiza únicamente las palabras dentro de `view.visibleRanges`
 * ignorando sintaxis técnica y aplicando Decoration.mark a los errores.
 */
export function buildSpellDecorations(view: EditorView): DecorationSet {
  const settings = useSettingsStore.getState().settings;
  if (!settings.spellcheck) {
    return Decoration.none;
  }

  const lang = settings.language || 'en';
  const customWords = new Set((settings.customDictionary || []).map((w) => w.toLowerCase()));

  // Si el diccionario aún no está en memoria, solicitar carga asíncrona y refrescar
  if (!getCachedSpellchecker(lang)) {
    loadSpellchecker(lang).then((checker) => {
      if (checker) {
        view.dispatch({ effects: spellcheckRefreshEffect.of(true) });
      }
    });
    return Decoration.none;
  }

  const doc = view.state.doc;
  const docText = doc.toString();
  const exclusions = computeExclusionRanges(docText);
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    const textSnippet = doc.sliceString(from, to);
    WORD_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = WORD_REGEX.exec(textSnippet)) !== null) {
      const word = match[0];
      const wordFrom = from + match.index;
      const wordTo = wordFrom + word.length;

      // Ignorar números o palabras de 1 letra no alfabética
      if (word.length <= 1 && !/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜàèìòù]$/.test(word)) {
        continue;
      }

      // Ignorar si cae en bloques excluidos
      if (isInsideExclusions(wordFrom, wordTo, exclusions)) {
        continue;
      }

      // Validar ortografía
      if (!isWordCorrect(word, lang, customWords)) {
        builder.add(wordFrom, wordTo, spellErrorMark);
      }
    }
  }

  return builder.finish();
}

/**
 * Plugin de CodeMirror 6 para corrección ortográfica en tiempo real
 * basado en `visibleRanges`, `spellcheckRefreshEffect` y debounce de 150ms.
 */
export const spellcheckPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeDict: () => void;
    private onSettingsUpdate: () => void;

    constructor(readonly view: EditorView) {
      // Cálculo síncrono inmediato al abrir la vista
      this.decorations = buildSpellDecorations(view);

      // Notificación cuando el diccionario termina de cargar
      this.unsubscribeDict = subscribeToDictionary(() => {
        this.view.dispatch({ effects: spellcheckRefreshEffect.of(true) });
      });

      // Notificación de cambios en ajustes (idioma, toggle, diccionario personalizado)
      this.onSettingsUpdate = () => {
        this.view.dispatch({ effects: spellcheckRefreshEffect.of(true) });
      };
      window.addEventListener('urano-spellcheck-update', this.onSettingsUpdate);
    }

    update(update: ViewUpdate) {
      const forceRefresh = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(spellcheckRefreshEffect))
      );

      if (forceRefresh) {
        this.decorations = buildSpellDecorations(update.view);
        return;
      }

      if (update.docChanged) {
        // Mapear inmediatamente para evitar desfases en el DOM mientras corre el debounce
        this.decorations = this.decorations.map(update.changes);
        this.scheduleCheck();
      } else if (update.viewportChanged) {
        this.scheduleCheck();
      }
    }

    scheduleCheck() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.view.dispatch({ effects: spellcheckRefreshEffect.of(true) });
      }, 150);
    }

    destroy() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.unsubscribeDict();
      window.removeEventListener('urano-spellcheck-update', this.onSettingsUpdate);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * Busca si en una posición determinada (por ejemplo, clic derecho) hay una palabra
 * subrayada como error ortográfico, y devuelve sus detalles y sugerencias.
 */
export function getMisspelledWordAtPos(
  view: EditorView,
  pos: number
): { word: string; from: number; to: number; suggestions: string[] } | null {
  const settings = useSettingsStore.getState().settings;
  if (!settings.spellcheck) return null;

  const lang = settings.language || 'en';
  const customWords = new Set((settings.customDictionary || []).map((w) => w.toLowerCase()));

  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineOffset = pos - line.from;

  WORD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WORD_REGEX.exec(line.text)) !== null) {
    const wordStart = match.index;
    const wordEnd = wordStart + match[0].length;

    if (lineOffset >= wordStart && lineOffset <= wordEnd) {
      const word = match[0];
      const from = line.from + wordStart;
      const to = line.from + wordEnd;

      // Comprobar si es un error
      if (!isWordCorrect(word, lang, customWords)) {
        const suggestions = getWordSuggestions(word, lang, 6);
        return { word, from, to, suggestions };
      }
      return null;
    }
  }

  return null;
}

/**
 * Valida una palabra aislada (por ejemplo del inline-title)
 */
export function checkWordIsolated(
  word: string,
  langCode?: string
): { isMisspelled: boolean; suggestions: string[] } {
  const settings = useSettingsStore.getState().settings;
  if (!settings.spellcheck) {
    return { isMisspelled: false, suggestions: [] };
  }

  const lang = langCode || settings.language || 'en';
  const customWords = new Set((settings.customDictionary || []).map((w) => w.toLowerCase()));

  if (!isWordCorrect(word, lang, customWords)) {
    return {
      isMisspelled: true,
      suggestions: getWordSuggestions(word, lang, 6),
    };
  }

  return { isMisspelled: false, suggestions: [] };
}
