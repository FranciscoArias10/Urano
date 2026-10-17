import React, { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { obsidianTheme, obsidianSyntax } from '../../editor/theme';
import { createWikilinksExtension } from '../../editor/wikilinks';
import { useVaultStore } from '../../stores/vaultStore';
import { FileText, Save, CheckCircle2 } from 'lucide-react';

interface EditorProps {
  onWikilinkClick: (noteName: string) => void;
}

export const Editor: React.FC<EditorProps> = ({ onWikilinkClick }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  
  const {
    activeFile,
    activeFileName,
    fileContent,
    updateContent,
    isDirty,
    saveCurrentFile,
    isLoading,
  } = useVaultStore();

  // Create or re-init editor when activeFile changes
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const state = EditorState.create({
      doc: fileContent,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Mod-s',
            run: () => {
              saveCurrentFile();
              return true;
            },
          },
        ]),
        markdown(),
        obsidianTheme,
        obsidianSyntax,
        EditorView.lineWrapping,
        createWikilinksExtension({
          onWikilinkClick,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newDoc = update.state.doc.toString();
            updateContent(newDoc);
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [activeFile]);

  // Synchronize doc if file content was changed externally or on initial load
  useEffect(() => {
    if (viewRef.current && activeFile) {
      const currentDoc = viewRef.current.state.doc.toString();
      if (currentDoc !== fileContent) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: fileContent },
        });
      }
    }
  }, [fileContent, activeFile]);

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-obsidian-muted p-8 text-center bg-obsidian-bg">
        <FileText className="w-16 h-16 mb-4 text-obsidian-border stroke-1" />
        <h2 className="text-xl font-medium text-obsidian-text mb-2">Ningún archivo seleccionado</h2>
        <p className="text-sm max-w-sm text-obsidian-muted">
          Selecciona una nota del explorador de la izquierda o crea una nueva para comenzar a escribir.
        </p>
        <div className="mt-6 flex items-center gap-3 text-xs text-obsidian-muted bg-obsidian-sidebar px-4 py-2 rounded-lg border border-obsidian-border">
          <span>Tip: Usa <kbd className="bg-obsidian-active px-1.5 py-0.5 rounded text-purple-400">[[Nombre Nota]]</kbd> para enlazar ideas</span>
        </div>
      </div>
    );
  }

  const cleanTitle = activeFileName ? activeFileName.replace(/\.md$/i, '') : 'Nota';

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-bg overflow-hidden relative">
      {/* Note Header */}
      <div className="flex items-center justify-between px-8 py-3 border-b border-obsidian-border bg-obsidian-bg/80 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-purple-400" />
          <span className="font-semibold text-sm text-obsidian-text tracking-wide">{cleanTitle}</span>
          <span className="text-xs text-obsidian-muted">.md</span>
        </div>

        <div className="flex items-center gap-3">
          {isDirty ? (
            <button
              onClick={() => saveCurrentFile()}
              className="flex items-center gap-1.5 text-xs bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 px-2.5 py-1 rounded transition-colors"
              title="Guardar cambios (Ctrl+S)"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 text-xs text-emerald-400/80">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Guardado</span>
            </div>
          )}
        </div>
      </div>

      {/* Editor Scroller Canvas */}
      <div className="flex-1 overflow-auto relative">
        {isLoading && (
          <div className="absolute inset-0 bg-obsidian-bg/50 backdrop-blur-[1px] flex items-center justify-center z-20">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-500 border-t-transparent" />
          </div>
        )}
        <div ref={editorRef} className="h-full" />
      </div>
    </div>
  );
};
