import { StateField, StateEffect, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settingsStore';

export const setSpellErrorsEffect = StateEffect.define<DecorationSet>();
export const triggerSpellCheckEffect = StateEffect.define<boolean>();

export const spellErrorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSpellErrorsEffect)) {
        return effect.value;
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SpellToken {
  from: number;
  to: number;
  word: string;
}

/** Intervalo inclusivo de números de línea (1-based) que no se revisan. */
interface LineInterval {
  from: number;
  to: number;
}

const blockLinesCache = new WeakMap<Text, LineInterval[]>();

/**
 * Detecta, recorriendo el documento COMPLETO, los bloques multilínea que el corrector debe ignorar:
 * - Frontmatter YAML inicial (`---` … `---`)
 * - Bloques de código cercados (``` o ~~~, incluido un bloque sin cerrar hasta el final)
 * - Bloques de ecuaciones `$$` multilínea
 *
 * Se calcula sobre todo el documento (y se cachea por instancia de `Text`) para que el estado
 * "dentro / fuera de bloque" no se invierta cuando el viewport empieza a mitad de un bloque.
 */
export function getIgnoredBlockLines(doc: Text): LineInterval[] {
  const cached = blockLinesCache.get(doc);
  if (cached) return cached;

  const out: LineInterval[] = [];
  let i = 1;

  if (doc.lines >= 2 && doc.line(1).text.trim() === '---') {
    for (let j = 2; j <= doc.lines; j++) {
      const t = doc.line(j).text.trim();
      if (t === '---' || t === '...') {
        out.push({ from: 1, to: j });
        i = j + 1;
        break;
      }
    }
  }

  let fenceChar = '';
  let fenceLen = 0;
  let inMath = false;
  let blockStart = 0;

  for (; i <= doc.lines; i++) {
    const t = doc.line(i).text.trim();

    if (fenceChar) {
      const close = /^(`{3,}|~{3,})\s*$/.exec(t);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        out.push({ from: blockStart, to: i });
        fenceChar = '';
      }
      continue;
    }

    if (inMath) {
      if (t.includes('$$')) {
        out.push({ from: blockStart, to: i });
        inMath = false;
      }
      continue;
    }

    const open = /^(`{3,}|~{3,})/.exec(t);
    if (open) {
      fenceChar = open[1][0];
      fenceLen = open[1].length;
      blockStart = i;
      continue;
    }

    // `$$` que abre un bloque (si se cierra en la misma línea lo cubre el filtro inline)
    if (t.startsWith('$$') && t.indexOf('$$', 2) === -1) {
      inMath = true;
      blockStart = i;
    }
  }

  if (fenceChar || inMath) {
    out.push({ from: blockStart, to: doc.lines });
  }

  blockLinesCache.set(doc, out);
  return out;
}

function isLineInBlocks(lineNo: number, blocks: LineInterval[]): boolean {
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = blocks[mid];
    if (lineNo < b.from) hi = mid - 1;
    else if (lineNo > b.to) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Construcciones de una sola línea que no son prosa. */
const INLINE_IGNORE_PATTERNS: RegExp[] = [
  /``[^\n]*?``|`[^`\n]+`/g, // código inline
  /\$\$[^\n]*?\$\$/g, // ecuación $$…$$ en una línea
  /\$[^$\n]+\$/g, // ecuación inline $…$
  /\[\[[^\]\n]*\]\]/g, // wikilinks
  /\]\([^)\n]*\)/g, // destino de enlaces markdown [texto](destino)
  /<[^>\n]+>/g, // etiquetas HTML
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s)\]>]+/g, // URLs con esquema
  /\bwww\.[^\s)\]>]+/g, // URLs www.
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // correos
  /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_/-]+/gu, // #etiquetas
];

/**
 * Palabra = letras (con marcas combinantes) unidas opcionalmente por apóstrofes internos,
 * para que contracciones como `doesn't` / `doesn’t` o `l'homme` se revisen completas.
 * Se descartan tokens pegados a dígitos o `_` (identificadores, `2nd`, `var_name`).
 */
const WORD_REGEX =
  /(?<![\p{L}\p{M}\p{N}_])\p{L}[\p{L}\p{M}]*(?:['’][\p{L}\p{M}]+)*(?!['’]?[\p{L}\p{M}\p{N}_])/gu;

function tokensInLine(text: string, lineFrom: number, out: SpellToken[]): void {
  const ignored: [number, number][] = [];
  for (const re of INLINE_IGNORE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      ignored.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  WORD_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_REGEX.exec(text)) !== null) {
    const word = m[0];
    if (word.length < 2) continue;
    const start = m.index;
    const end = start + word.length;
    if (ignored.some(([f, t]) => start < t && end > f)) continue;
    out.push({ from: lineFrom + start, to: lineFrom + end, word });
  }
}

/**
 * Devuelve, en orden ascendente y sin duplicados, las palabras a revisar dentro de los rangos
 * visibles. Los rangos se expanden a líneas completas y los bloques ignorados se resuelven con el
 * análisis global del documento.
 */
export function collectSpellcheckTokens(
  doc: Text,
  ranges: readonly { from: number; to: number }[]
): SpellToken[] {
  const blocks = getIgnoredBlockLines(doc);
  const tokens: SpellToken[] = [];
  let lastLine = 0;

  for (const { from, to } of ranges) {
    const startLine = doc.lineAt(Math.min(from, doc.length)).number;
    const endLine = doc.lineAt(Math.min(Math.max(from, to), doc.length)).number;
    for (let n = Math.max(startLine, lastLine + 1); n <= endLine; n++) {
      lastLine = n;
      if (isLineInBlocks(n, blocks)) continue;
      const line = doc.line(n);
      tokensInLine(line.text, line.from, tokens);
    }
  }

  return tokens;
}

class SpellcheckPluginValue {
  private view: EditorView;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private generation: number = 0;
  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
    this.scheduleCheck(20);
  }

  update(update: ViewUpdate) {
    const hasTrigger = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(triggerSpellCheckEffect))
    );
    if (update.docChanged || update.viewportChanged || hasTrigger) {
      // Invalida cualquier respuesta IPC en vuelo: sus posiciones ya no coinciden con el documento
      this.generation++;
      this.scheduleCheck(120);
    }
  }

  destroy() {
    this.destroyed = true;
    this.generation++;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  scheduleCheck(delayMs: number = 120) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSpellCheck();
    }, delayMs);
  }

  private async runSpellCheck() {
    if (this.destroyed) return;
    const settings = useSettingsStore.getState().settings;
    if (!settings.spellcheck) {
      this.view.dispatch({ effects: setSpellErrorsEffect.of(Decoration.none) });
      return;
    }

    const currentGen = ++this.generation;
    const doc = this.view.state.doc;
    const lang = settings.language || 'en';
    const customWords = settings.customDictionary || [];

    const tokens = collectSpellcheckTokens(doc, this.view.visibleRanges);

    if (tokens.length === 0) {
      this.view.dispatch({ effects: setSpellErrorsEffect.of(Decoration.none) });
      return;
    }

    const uniqueWords = Array.from(new Set(tokens.map((t) => t.word)));

    try {
      const misspelledList: string[] = await invoke('check_words_batch', {
        words: uniqueWords,
        lang,
        customWords,
      });

      // Descartar si el editor se destruyó o el viewport/documento cambió mientras esperábamos IPC
      if (this.destroyed || currentGen !== this.generation || this.view.state.doc !== doc) {
        return;
      }

      const misspelledSet = new Set(misspelledList);
      const builder = new RangeSetBuilder<Decoration>();

      // Los tokens ya están en orden estrictamente ascendente
      for (const token of tokens) {
        if (!misspelledSet.has(token.word)) continue;
        builder.add(
          token.from,
          token.to,
          Decoration.mark({
            class: 'cm-spell-error',
            attributes: { 'data-word': token.word },
          })
        );
      }

      this.view.dispatch({
        effects: setSpellErrorsEffect.of(builder.finish()),
      });
    } catch (err) {
      console.warn('[Urano Spellcheck] check_words_batch IPC error:', err);
    }
  }
}

export const spellcheckPlugin = ViewPlugin.fromClass(SpellcheckPluginValue);

export const spellcheckExtension = [spellErrorField, spellcheckPlugin];
