import { StateField, StateEffect } from '@codemirror/state';
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

/**
 * Encuentra rangos de caracteres que deben ignorarse en la corrección ortográfica:
 * - Bloques de código multilínea (```)
 * - Código inline (`)
 * - Ecuaciones matemáticas LaTeX ($$ y $)
 * - URLs (http:// o https://)
 * - Enlaces internos Wikilinks ([[...]])
 */
function getIgnoredRanges(text: string): { from: number; to: number }[] {
  const ignored: { from: number; to: number }[] = [];
  const regexes = [
    /```[\s\S]*?```/g,
    /`[^`\n]+`/g,
    /\$\$[\s\S]*?\$\$/g,
    /\$[^$\n]+\$/g,
    /https?:\/\/[^\s)\]]+/g,
    /\[\[[\s\S]*?\]\]/g,
  ];

  for (const regex of regexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      ignored.push({ from: match.index, to: match.index + match[0].length });
    }
  }

  return ignored;
}

function isInsideIgnored(pos: number, len: number, ignored: { from: number; to: number }[]): boolean {
  const end = pos + len;
  for (const range of ignored) {
    if (pos >= range.from && end <= range.to) {
      return true;
    }
    if (pos < range.to && end > range.from) {
      return true;
    }
  }
  return false;
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
    const settings = useSettingsStore.getState().settings;
    if (!settings.spellcheck) {
      this.view.dispatch({ effects: setSpellErrorsEffect.of(Decoration.none) });
      return;
    }

    const currentGen = ++this.generation;
    const doc = this.view.state.doc;
    const lang = settings.language || 'en';
    const customWords = settings.customDictionary || [];

    // Recolectar palabras únicas dentro del área visible
    const ranges = this.view.visibleRanges;
    const wordsToQuery = new Set<string>();
    const wordRegex = /\p{L}{2,}/gu;

    for (const { from, to } of ranges) {
      const text = doc.sliceString(from, to);
      const ignored = getIgnoredRanges(text);

      let m: RegExpExecArray | null;
      wordRegex.lastIndex = 0;
      while ((m = wordRegex.exec(text)) !== null) {
        if (!isInsideIgnored(m.index, m[0].length, ignored)) {
          wordsToQuery.add(m[0]);
        }
      }
    }

    if (wordsToQuery.size === 0) {
      this.view.dispatch({ effects: setSpellErrorsEffect.of(Decoration.none) });
      return;
    }

    const uniqueWords = Array.from(wordsToQuery);

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

      // Construir decoraciones en orden estrictamente ascendente
      for (const { from, to } of ranges) {
        const text = doc.sliceString(from, to);
        const ignored = getIgnoredRanges(text);

        wordRegex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = wordRegex.exec(text)) !== null) {
          const word = m[0];
          if (!isInsideIgnored(m.index, word.length, ignored) && misspelledSet.has(word)) {
            const wordFrom = from + m.index;
            const wordTo = wordFrom + word.length;
            builder.add(
              wordFrom,
              wordTo,
              Decoration.mark({
                class: 'cm-spell-error',
                attributes: { 'data-word': word },
              })
            );
          }
        }
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
