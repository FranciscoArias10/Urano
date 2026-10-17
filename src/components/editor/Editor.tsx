import React, { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { obsidianTheme, obsidianSyntax } from '../../editor/theme';
import { liveMarkdownExtension } from '../../editor/liveMarkdown';
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
        // No line numbers & no IDE active line - clean Obsidian document style
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
        liveMarkdownExtension,
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
        <h2 className="text-xl font-medium text-obsidian-text mb-2">Ninguna nota seleccionada</h2>
        <p className="text-sm max-w-sm text-obsidian-muted">
          Selecciona una nota del explorador lateral o crea una nueva para comenzar a escribir.
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
      {/* Subtle Obsidian Note Top Bar (Tab style) */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-obsidian-border/50 bg-obsidian-bg/90 backdrop-blur z-10 select-none">
        <div className="flex items-center gap-2 text-obsidian-muted hover:text-obsidian-text transition-colors">
          <FileText className="w-3.5 h-3.5 text-purple-400" />
          <span className="font-medium text-xs text-obsidian-text tracking-normal">{cleanTitle}</span>
        </div>

        <div className="flex items-center gap-3">
          {isDirty ? (
            <button
              onClick={() => saveCurrentFile()}
              className="flex items-center gap-1.5 text-[11px] bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 px-2 py-0.5 rounded transition-colors"
              title="Guardar cambios (Ctrl+S)"
            >
              <Save className="w-3 h-3" />
              <span>Guardar</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-emerald-400/70">
              <CheckCircle2 className="w-3 h-3" />
              <span>Guardado</span>
            </div>
          )}
        </div>
      </div>

      {/* Clean Document Canvas */}
      <div className="flex-1 overflow-hidden relative">
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
