import React, { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { obsidianTheme, obsidianSyntax } from '../../editor/theme';
import { liveMarkdownExtension } from '../../editor/liveMarkdown';
import { mathExtension } from '../../editor/mathExtension';
import { codeBlockExtension } from '../../editor/codeBlockExtension';
import { createWikilinksExtension } from '../../editor/wikilinks';
import { useVaultStore } from '../../stores/vaultStore';
import { EditorFormattingMenu } from './EditorFormattingMenu';
import {
  FileText,
  Save,
  CheckCircle2,
  Highlighter,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  CheckSquare,
  Sigma,
  Code,
  Link,
  Quote,
} from 'lucide-react';

interface EditorProps {
  onWikilinkClick: (noteName: string) => void;
}

export const Editor: React.FC<EditorProps> = ({ onWikilinkClick }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const renameTimerRef = useRef<any>(null);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  const {
    activeFile,
    activeFileName,
    fileContent,
    updateContent,
    isDirty,
    saveCurrentFile,
    renameCurrentNoteByFirstLine,
    isLoading,
  } = useVaultStore();

  // Create or switch editor document
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    // If activeFile changed solely because of auto-renaming, preserve view & cursor!
    if (
      viewRef.current &&
      currentPathRef.current &&
      viewRef.current.state.doc.toString() === fileContent
    ) {
      currentPathRef.current = activeFile;
      return;
    }

    currentPathRef.current = activeFile;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const state = EditorState.create({
      doc: fileContent,
      extensions: [
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
        mathExtension,        // Real KaTeX math equations (Word/LaTeX feel)
        codeBlockExtension,   // Code blocks with language badges & copy button
        EditorView.lineWrapping,
        createWikilinksExtension({
          onWikilinkClick,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newDoc = update.state.doc.toString();
            updateContent(newDoc);

            // Automatically derive note name from the first line (debounced)
            const firstLine = newDoc.split('\n')[0] || '';
            const title = firstLine.replace(/^#+\s*/, '').trim();

            if (title) {
              if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
              renameTimerRef.current = setTimeout(() => {
                renameCurrentNoteByFirstLine(title);
              }, 700);
            }
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
      if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
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

  // Right-click context menu handler
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Quick toolbar action helpers
  const handleToolbarWrap = (prefix: string, suffix: string, placeholder = 'texto') => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to) || placeholder;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${prefix}${text}${suffix}` },
      selection: { anchor: sel.from + prefix.length, head: sel.to + prefix.length },
    });
    view.focus();
  };

  const handleToolbarLine = (prefix: string) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const cleaned = line.text.replace(/^(#{1,6}\s+|-\s+\[[ x]\]\s+|-\s+|\d+\.\s+|>\s+)/, '');
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: `${prefix}${cleaned}` },
    });
    view.focus();
  };

  const handleInsertMath = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const text = view.state.sliceDoc(sel.from, sel.to) || 'E = mc^2';
    const prefix = line.text.trim().length > 0 ? '\n$$\n' : '$$\n';
    const insertText = `${prefix}${text}\n$$\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: sel.from + prefix.length, head: sel.from + prefix.length + text.length },
    });
    view.focus();
  };

  const handleInsertCode = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const text = view.state.sliceDoc(sel.from, sel.to) || '// escribe tu código aquí';
    const prefix = line.text.trim().length > 0 ? '\n```javascript\n' : '```javascript\n';
    const insertText = `${prefix}${text}\n\`\`\`\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: sel.from + prefix.length, head: sel.from + prefix.length + text.length },
    });
    view.focus();
  };

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-obsidian-muted p-8 text-center bg-obsidian-bg">
        <FileText className="w-16 h-16 mb-4 text-obsidian-border stroke-1" />
        <h2 className="text-xl font-medium text-obsidian-text mb-2">Ninguna nota seleccionada</h2>
        <p className="text-sm max-w-sm text-obsidian-muted">
          Crea una nueva nota haciendo clic en el botón '+' o selecciona una existente.
        </p>
        <div className="mt-6 flex items-center gap-3 text-xs text-obsidian-muted bg-obsidian-sidebar px-4 py-2 rounded-lg border border-obsidian-border">
          <span>El nombre de la nota se define automáticamente en la primera línea que escribas</span>
        </div>
      </div>
    );
  }

  const cleanTitle = activeFileName ? activeFileName.replace(/\.md$/i, '') : 'Nota';

  return (
    <div
      onContextMenu={handleContextMenu}
      className="flex-1 flex flex-col h-full bg-obsidian-bg overflow-hidden relative"
    >
      {/* Subtle Obsidian Note Top Bar (Tab style + Quick Formatting Ribbon) */}
      <div className="flex items-center justify-between px-6 py-1.5 border-b border-obsidian-border/50 bg-obsidian-sidebar/80 backdrop-blur z-10 select-none">
        {/* Left: Note Title */}
        <div className="flex items-center gap-2 text-obsidian-muted hover:text-obsidian-text transition-colors">
          <FileText className="w-3.5 h-3.5 text-orange-500" />
          <span className="font-medium text-xs text-obsidian-text tracking-normal">{cleanTitle}</span>
        </div>

        {/* Center: Obsidian Formatting Toolbar */}
        <div className="hidden md:flex items-center gap-0.5 bg-obsidian-bg/90 px-1 py-0.5 rounded-lg border border-obsidian-border/60 text-obsidian-muted">
          <button
            onClick={() => handleToolbarWrap('==', '==', 'resaltado')}
            title="Resaltar (==texto==)"
            className="p-1.5 hover:bg-orange-500/20 hover:text-orange-300 text-orange-400 rounded transition-colors"
          >
            <Highlighter className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarWrap('**', '**', 'negrita')}
            title="Negrita (**texto**)"
            className="p-1.5 hover:bg-obsidian-hover hover:text-white rounded transition-colors"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarWrap('*', '*', 'cursiva')}
            title="Cursiva (*texto*)"
            className="p-1.5 hover:bg-obsidian-hover hover:text-white rounded transition-colors"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-obsidian-border mx-0.5" />
          <button
            onClick={() => handleToolbarLine('# ')}
            title="Título 1 (# )"
            className="p-1.5 hover:bg-obsidian-hover hover:text-orange-300 rounded transition-colors"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarLine('## ')}
            title="Título 2 (## )"
            className="p-1.5 hover:bg-obsidian-hover hover:text-orange-300 rounded transition-colors"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-obsidian-border mx-0.5" />
          <button
            onClick={() => handleToolbarLine('- ')}
            title="Lista con viñetas"
            className="p-1.5 hover:bg-obsidian-hover hover:text-white rounded transition-colors"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarLine('- [ ] ')}
            title="Lista de tareas"
            className="p-1.5 hover:bg-obsidian-hover hover:text-white rounded transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-obsidian-border mx-0.5" />
          <button
            onClick={handleInsertMath}
            title="Ecuación Matemática KaTeX ($$)"
            className="p-1.5 hover:bg-orange-500/20 hover:text-orange-300 text-orange-400 rounded transition-colors"
          >
            <Sigma className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleInsertCode}
            title="Bloque de Código (```)"
            className="p-1.5 hover:bg-obsidian-hover hover:text-orange-300 rounded transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarWrap('[[', ']]', 'Nota')}
            title="Enlace Bidireccional [[...]]"
            className="p-1.5 hover:bg-orange-500/20 hover:text-orange-300 text-orange-400 rounded transition-colors"
          >
            <Link className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarLine('> ')}
            title="Cita en bloque"
            className="p-1.5 hover:bg-obsidian-hover hover:text-white rounded transition-colors"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Save Status */}
        <div className="flex items-center gap-3">
          {isDirty ? (
            <button
              onClick={() => saveCurrentFile()}
              className="flex items-center gap-1.5 text-[11px] bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 px-2.5 py-0.5 rounded transition-colors border border-orange-500/30"
              title="Guardar cambios (Ctrl+S)"
            >
              <Save className="w-3 h-3" />
              <span>Guardar</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-emerald-400/80">
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
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
          </div>
        )}
        <div ref={editorRef} className="h-full" />
      </div>

      {/* Right-click Context Menu */}
      <EditorFormattingMenu
        view={viewRef.current}
        isOpen={Boolean(contextMenuPos)}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />
    </div>
  );
};
