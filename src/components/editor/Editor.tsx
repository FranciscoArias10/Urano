import React, { useEffect, useRef, useState, useMemo } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { obsidianTheme, obsidianSyntax } from '../../editor/theme';
import { liveMarkdownExtension } from '../../editor/liveMarkdown';
import { mathExtension } from '../../editor/mathExtension';
import { codeBlockExtension } from '../../editor/codeBlockExtension';
import { createWikilinksExtension } from '../../editor/wikilinks';
import { useVaultStore } from '../../stores/vaultStore';
import { EditorFormattingMenu } from './EditorFormattingMenu';
import { FileItem } from '../../types';
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
  BookOpen,
  Edit3,
  ChevronRight,
} from 'lucide-react';

interface EditorProps {
  onWikilinkClick: (noteName: string) => void;
  onStatsChange?: (stats: { words: number; chars: number }) => void;
}

export const Editor: React.FC<EditorProps> = ({ onWikilinkClick, onStatsChange }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const renameTimerRef = useRef<any>(null);

  const [editorMode, setEditorMode] = useState<'live-preview' | 'reading'>('live-preview');
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Floating [[ Wikilink suggestion autocompletion state
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestCoords, setSuggestCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const {
    activeFile,
    activeFileName,
    fileContent,
    fileTree,
    updateContent,
    isDirty,
    saveCurrentFile,
    renameCurrentNoteByFirstLine,
    isLoading,
  } = useVaultStore();

  // Compute available notes for autocompletion
  const availableNotes = useMemo(() => {
    const list: string[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (!item.isDir && item.name.endsWith('.md')) {
          list.push(item.name.replace(/\.md$/i, ''));
        }
        if (item.children) traverse(item.children);
      }
    };
    traverse(fileTree);
    return list.filter((name) =>
      name.toLowerCase().includes(suggestQuery.toLowerCase())
    );
  }, [fileTree, suggestQuery]);

  // Report stats to parent / status bar
  useEffect(() => {
    const words = fileContent.trim() ? fileContent.trim().split(/\s+/).length : 0;
    const chars = fileContent.length;
    onStatsChange?.({ words, chars });
  }, [fileContent, onStatsChange]);

  // Create or switch editor document
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    // If activeFile changed solely because of auto-renaming from line 1, preserve view & cursor!
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
          indentWithTab,
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
        markdown({ codeLanguages: languages }),
        obsidianTheme,
        obsidianSyntax,
        liveMarkdownExtension,
        mathExtension,        // KaTeX LaTeX math equations
        codeBlockExtension,   // Code blocks with syntax highlighting & copy button
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

          // Check [[ wikilink autocompletion
          const sel = update.state.selection.main;
          if (sel.empty) {
            const pos = sel.head;
            const line = update.state.doc.lineAt(pos);
            const textBefore = line.text.slice(0, pos - line.from);
            const openIdx = textBefore.lastIndexOf('[[');

            if (openIdx !== -1 && !textBefore.slice(openIdx).includes(']]')) {
              const query = textBefore.slice(openIdx + 2);
              setSuggestQuery(query);
              setSuggestIndex(0);
              setShowSuggest(true);

              const coords = update.view.coordsAtPos(pos);
              if (coords) {
                setSuggestCoords({
                  top: coords.bottom + 6,
                  left: Math.max(20, Math.min(coords.left, window.innerWidth - 280)),
                });
              }
            } else {
              setShowSuggest(false);
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

  // Insert autocompleted wikilink
  const insertWikilink = (noteName: string) => {
    const view = viewRef.current;
    if (!view) return;

    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const openIdx = textBefore.lastIndexOf('[[');

    if (openIdx !== -1) {
      const from = line.from + openIdx + 2;
      const to = pos;
      const insert = `${noteName}]]`;

      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
    }

    setShowSuggest(false);
  };

  // Keyboard navigation inside suggestion menu
  useEffect(() => {
    if (!showSuggest) return;

    const handleSuggestKeys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev + 1) % Math.max(1, availableNotes.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev - 1 + availableNotes.length) % Math.max(1, availableNotes.length));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (availableNotes.length > 0) {
          e.preventDefault();
          insertWikilink(availableNotes[suggestIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowSuggest(false);
      }
    };

    window.addEventListener('keydown', handleSuggestKeys, true);
    return () => window.removeEventListener('keydown', handleSuggestKeys, true);
  }, [showSuggest, availableNotes, suggestIndex]);

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
    const text = view.state.sliceDoc(sel.from, sel.to) || 'console.log("Hola Urano");';
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
          Crea una nueva nota haciendo clic en '+' o presiona Ctrl+O para buscar en la bóveda.
        </p>
        <div className="mt-6 flex items-center gap-3 text-xs text-obsidian-muted bg-obsidian-sidebar px-4 py-2 rounded-lg border border-obsidian-border">
          <span>El nombre de la nota se define automáticamente en la primera línea que escribas</span>
        </div>
      </div>
    );
  }

  const cleanTitle = activeFileName ? activeFileName.replace(/\.md$/i, '') : 'Nota';
  const pathParts = activeFile ? activeFile.replace(/\\/g, '/').split('/') : [];
  const folderParts = pathParts.slice(0, -1);

  return (
    <div
      onContextMenu={handleContextMenu}
      className="flex-1 flex flex-col h-full bg-obsidian-bg overflow-hidden relative"
    >
      {/* Obsidian Note View Header (.view-header) with Breadcrumbs & Action Ribbon */}
      <div className="flex items-center justify-between px-5 py-1.5 border-b border-obsidian-border/50 bg-[#151311] z-10 select-none">
        {/* Left: Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-obsidian-muted text-xs truncate max-w-[280px]">
          <FileText className="w-3.5 h-3.5 text-orange-500 shrink-0" />
          {folderParts.slice(-2).map((folder, idx) => (
            <React.Fragment key={idx}>
              <span className="truncate">{folder}</span>
              <ChevronRight size={11} className="text-stone-600 shrink-0" />
            </React.Fragment>
          ))}
          <span className="font-semibold text-stone-200 truncate">{cleanTitle}</span>
        </div>

        {/* Center: Obsidian Formatting Toolbar */}
        <div className="hidden lg:flex items-center gap-0.5 bg-[#1a1714] px-1 py-0.5 rounded-lg border border-stone-800 text-stone-400">
          <button
            onClick={() => handleToolbarWrap('==', '==', 'resaltado')}
            title="Resaltar (==texto==)"
            className="p-1 hover:bg-orange-500/20 hover:text-orange-300 text-orange-400 rounded transition-colors"
          >
            <Highlighter className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarWrap('**', '**', 'negrita')}
            title="Negrita (**texto**)"
            className="p-1 hover:bg-stone-800 hover:text-white rounded transition-colors"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarWrap('*', '*', 'cursiva')}
            title="Cursiva (*texto*)"
            className="p-1 hover:bg-stone-800 hover:text-white rounded transition-colors"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-stone-800 mx-0.5" />
          <button
            onClick={() => handleToolbarLine('# ')}
            title="Título 1 (# )"
            className="p-1 hover:bg-stone-800 hover:text-orange-300 rounded transition-colors"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarLine('## ')}
            title="Título 2 (## )"
            className="p-1 hover:bg-stone-800 hover:text-orange-300 rounded transition-colors"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-stone-800 mx-0.5" />
          <button
            onClick={() => handleToolbarLine('- ')}
            title="Lista con viñetas"
            className="p-1 hover:bg-stone-800 hover:text-white rounded transition-colors"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarLine('- [ ] ')}
            title="Lista de tareas"
            className="p-1 hover:bg-stone-800 hover:text-white rounded transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-stone-800 mx-0.5" />
          <button
            onClick={handleInsertMath}
            title="Ecuación Matemática KaTeX ($$)"
            className="p-1 hover:bg-orange-500/20 hover:text-orange-300 text-orange-400 rounded transition-colors"
          >
            <Sigma className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleInsertCode}
            title="Bloque de Código (```)"
            className="p-1 hover:bg-stone-800 hover:text-orange-300 rounded transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarWrap('[[', ']]', 'Nota')}
            title="Enlace Bidireccional [[...]]"
            className="p-1 hover:bg-orange-500/20 hover:text-orange-300 text-orange-400 rounded transition-colors"
          >
            <Link className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleToolbarLine('> ')}
            title="Cita en bloque"
            className="p-1 hover:bg-stone-800 hover:text-white rounded transition-colors"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Mode Switcher & Save Status */}
        <div className="flex items-center gap-2">
          {/* Mode Switch: Live Preview vs Reading View */}
          <button
            onClick={() => setEditorMode(editorMode === 'live-preview' ? 'reading' : 'live-preview')}
            title={
              editorMode === 'live-preview'
                ? 'Cambiar a Vista de Lectura'
                : 'Cambiar a Vista de Edición (Live Preview)'
            }
            className="p-1.5 text-stone-400 hover:text-orange-400 hover:bg-stone-800/60 rounded transition-colors"
          >
            {editorMode === 'live-preview' ? <BookOpen size={14} /> : <Edit3 size={14} />}
          </button>

          {isDirty ? (
            <button
              onClick={() => saveCurrentFile()}
              className="flex items-center gap-1 text-[11px] bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 px-2 py-0.5 rounded transition-colors border border-orange-500/30"
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

        {editorMode === 'live-preview' ? (
          <div ref={editorRef} className="h-full" />
        ) : (
          /* Reading View Mode */
          <div className="h-full overflow-y-auto px-12 py-10 max-w-[820px] mx-auto text-stone-200 leading-relaxed font-sans">
            <h1 className="text-3xl font-bold text-white mb-6 border-b border-stone-800 pb-3">
              {cleanTitle}
            </h1>
            <div className="whitespace-pre-wrap select-text">{fileContent}</div>
          </div>
        )}
      </div>

      {/* Floating Obsidian [[ Wikilink Suggestion Dropdown */}
      {showSuggest && availableNotes.length > 0 && (
        <div
          className="fixed z-50 w-64 bg-[#1a1714] border border-orange-500/30 rounded-lg shadow-2xl shadow-black/80 overflow-hidden text-xs select-none animate-fadeIn"
          style={{ top: `${suggestCoords.top}px`, left: `${suggestCoords.left}px` }}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-orange-400/80 border-b border-stone-800 font-semibold bg-[#141210]">
            Enlazar a nota del Vault
          </div>
          <div className="max-h-48 overflow-y-auto p-1 flex flex-col gap-0.5">
            {availableNotes.map((name, idx) => (
              <div
                key={name}
                onClick={() => insertWikilink(name)}
                onMouseEnter={() => setSuggestIndex(idx)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors ${
                  idx === suggestIndex
                    ? 'bg-orange-600/25 text-white font-medium'
                    : 'text-stone-300 hover:bg-stone-800/50'
                }`}
              >
                <FileText size={12} className={idx === suggestIndex ? 'text-orange-400' : 'text-stone-500'} />
                <span className="truncate">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
