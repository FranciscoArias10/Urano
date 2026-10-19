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
import { calloutExtension } from '../../editor/calloutExtension';
import { tableExtension, setPendingTableFocus, findAllTables } from '../../editor/tableExtension';
import { createWikilinksExtension } from '../../editor/wikilinks';
import { useVaultStore } from '../../stores/vaultStore';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { useNoticeStore } from '../common/Notice';
import { FileItem } from '../../types';
import {
  FileText,
  Highlighter,
  Bold,
  Italic,
  Strikethrough,
  Code,
  MessageSquare,
  CheckSquare,
  Sigma,
  Link,
  BookOpen,
  Edit3,
  ExternalLink,
  PlusCircle,
  Columns,
  Copy,
  Scissors,
  Clipboard,
  Terminal,
  Table,
  AlertCircle,
  Minus,
  Type,
  PlusSquare,
  FilePlus,
  ArrowLeft,
  ArrowRight,
  MoreVertical,
} from 'lucide-react';

interface EditorProps {
  onWikilinkClick: (noteName: string) => void;
  onOpenInNewTab?: (noteName: string) => void;
  onOpenToRight?: (noteName: string) => void;
  onStatsChange?: (stats: { words: number; chars: number }) => void;
}

// Module-level reference to the active EditorView
let globalActiveEditorView: EditorView | null = null;
export const getActiveEditorView = (): EditorView | null => {
  return globalActiveEditorView || (window as any).__uranoEditorView || null;
};

export const Editor: React.FC<EditorProps> = ({
  onWikilinkClick,
  onOpenInNewTab,
  onOpenToRight,
  onStatsChange,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const inlineTitleRef = useRef<HTMLDivElement>(null);
  const lastDispatchedDocRef = useRef<string>('');

  const [editorMode, setEditorMode] = useState<'live-preview' | 'reading'>('live-preview');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  // Floating [[ Wikilink suggestion autocompletion state
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestCoords, setSuggestCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const {
    activeFile,
    activeFileName,
    fileContent,
    fileTree,
    updateContent,
    isDirty,
    saveCurrentFile,
    renameNoteWithLinkRefactor,
    autoFocusTitle,
    setAutoFocusTitle,
    isLoading,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();

  const cleanTitle = activeFileName ? activeFileName.replace(/\.md$/i, '') : 'Sin título';

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

  // Silent automatic save with 1.2s debounce (Obsidian 1:1)
  useEffect(() => {
    if (!isDirty || !activeFile) return;
    const timer = setTimeout(() => {
      saveCurrentFile();
    }, 1200);
    return () => clearTimeout(timer);
  }, [fileContent, isDirty, activeFile, saveCurrentFile]);

  // Synchronize inline-title innerText when note changes
  useEffect(() => {
    if (inlineTitleRef.current && document.activeElement !== inlineTitleRef.current) {
      inlineTitleRef.current.innerText = cleanTitle;
    }
  }, [cleanTitle]);

  // Auto-focus and select all text in .inline-title when a note is newly created
  useEffect(() => {
    if (autoFocusTitle && inlineTitleRef.current) {
      inlineTitleRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(inlineTitleRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      setAutoFocusTitle(false);
    }
  }, [autoFocusTitle, setAutoFocusTitle]);

  // Create or switch editor document
  useEffect(() => {
    if (!editorRef.current || !activeFile) return;

    // If activeFile path changed due to inline renaming, preserve editor state & cursor
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
          {
            key: 'Enter',
            run: (v) => {
              const sel = v.state.selection.main;
              if (sel.empty) {
                const line = v.state.doc.lineAt(sel.head);
                if (line.text.startsWith('```') && sel.head === line.to) {
                  if (line.number < v.state.doc.lines) {
                    const nextLine = v.state.doc.line(line.number + 1);
                    if (nextLine.text === '') {
                      v.dispatch({
                        selection: { anchor: nextLine.from, head: nextLine.from },
                        scrollIntoView: true,
                      });
                      return true;
                    }
                  }
                }
              }
              return false;
            },
          },
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
          {
            key: 'Mod-b',
            run: () => {
              toggleInlineFormatting('**', '__');
              return true;
            },
          },
          {
            key: 'Mod-i',
            run: () => {
              toggleInlineFormatting('*', '_');
              return true;
            },
          },
        ]),
        markdown({ codeLanguages: languages }),
        obsidianTheme,
        obsidianSyntax,
        liveMarkdownExtension,
        mathExtension, // KaTeX LaTeX math equations
        codeBlockExtension, // Code blocks with syntax highlighting & copy button
        calloutExtension, // Obsidian Callout boxes in Live Preview
        tableExtension, // Obsidian Markdown Tables in Live Preview
        EditorView.lineWrapping,
        createWikilinksExtension({
          onWikilinkClick,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newDoc = update.state.doc.toString();
            lastDispatchedDocRef.current = newDoc;
            updateContent(newDoc);
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
    globalActiveEditorView = view;
    (window as any).__uranoEditorView = view;
    lastDispatchedDocRef.current = fileContent;

    return () => {
      if (globalActiveEditorView === view) {
        globalActiveEditorView = null;
      }
      if ((window as any).__uranoEditorView === view) {
        (window as any).__uranoEditorView = null;
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [activeFile]);

  // Synchronize doc if file content was changed externally
  useEffect(() => {
    if (viewRef.current && activeFile) {
      const currentDoc = viewRef.current.state.doc.toString();
      if (currentDoc !== fileContent && lastDispatchedDocRef.current !== fileContent) {
        lastDispatchedDocRef.current = fileContent;
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
      const textAfter = line.text.slice(pos - line.from);
      const closeOffset = textAfter.startsWith(']]') ? 2 : 0;
      const to = pos + closeOffset;
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
        setSuggestIndex(
          (prev) => (prev - 1 + availableNotes.length) % Math.max(1, availableNotes.length)
        );
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

  // Listen for table-specific context menu events (1:1 with Obsidian)
  useEffect(() => {
    const handleTableContextMenu = (e: Event) => {
      const customEvent = e as CustomEvent<{
        x: number;
        y: number;
        items: MenuItemData[];
      }>;
      if (customEvent.detail?.items) {
        setContextMenu({
          x: customEvent.detail.x,
          y: customEvent.detail.y,
          items: customEvent.detail.items,
        });
      }
    };

    window.addEventListener('urano-table-contextmenu', handleTableContextMenu);
    return () => {
      window.removeEventListener('urano-table-contextmenu', handleTableContextMenu);
    };
  }, []);

  // Handle .inline-title keyboard events (Enter / Escape)
  const handleTitleKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newTitle = inlineTitleRef.current?.innerText.trim() || '';

      if (newTitle && newTitle !== cleanTitle && activeFile) {
        const result = await renameNoteWithLinkRefactor(activeFile, newTitle);
        if (!result.success) {
          showNotice(result.error || 'Nombre de archivo inválido', 4000, 'error');
          if (inlineTitleRef.current) {
            inlineTitleRef.current.innerText = cleanTitle;
          }
          return;
        }
      }

      // Smoothly transition focus to beginning of CodeMirror 6 editor
      if (viewRef.current) {
        viewRef.current.focus();
        viewRef.current.dispatch({
          selection: { anchor: 0, head: 0 },
          scrollIntoView: true,
        });
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inlineTitleRef.current) {
        inlineTitleRef.current.innerText = cleanTitle;
        inlineTitleRef.current.blur();
      }
    }
  };

  // Handle .inline-title onBlur (auto-commit rename)
  const handleTitleBlur = async () => {
    const newTitle = inlineTitleRef.current?.innerText.trim() || '';
    if (!newTitle) {
      if (inlineTitleRef.current) {
        inlineTitleRef.current.innerText = cleanTitle;
      }
      showNotice('El nombre de archivo no puede estar vacío.', 3500, 'error');
      return;
    }

    if (newTitle !== cleanTitle && activeFile) {
      const result = await renameNoteWithLinkRefactor(activeFile, newTitle);
      if (!result.success) {
        showNotice(result.error || 'Nombre de archivo inválido', 4000, 'error');
        if (inlineTitleRef.current) {
          inlineTitleRef.current.innerText = cleanTitle;
        }
      }
    }
  };

  // Intelligent Obsidian-like toggle formatting
  const toggleInlineFormatting = (delimiter: string, altDelimiter?: string) => {
    console.log('[Urano Menu] Ejecutando comando: Formato', delimiter);
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;

    const sel = view.state.selection.main;
    const len = delimiter.length;

    if (!sel.empty) {
      // 1. Text is selected
      const selectedText = view.state.sliceDoc(sel.from, sel.to);

      // Check if selectedText itself starts and ends with delimiter
      const isWrappedDirectly =
        selectedText.length >= len * 2 &&
        selectedText.startsWith(delimiter) &&
        selectedText.endsWith(delimiter);

      const isWrappedDirectlyAlt =
        altDelimiter &&
        selectedText.length >= altDelimiter.length * 2 &&
        selectedText.startsWith(altDelimiter) &&
        selectedText.endsWith(altDelimiter);

      if (isWrappedDirectly) {
        const unwrapped = selectedText.slice(len, -len);
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: unwrapped },
          selection: { anchor: sel.from, head: sel.from + unwrapped.length },
        });
        const newDoc = view.state.doc.toString();
        lastDispatchedDocRef.current = newDoc;
        updateContent(newDoc);
        view.focus();
        return;
      }

      if (isWrappedDirectlyAlt && altDelimiter) {
        const altLen = altDelimiter.length;
        const unwrapped = selectedText.slice(altLen, -altLen);
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: unwrapped },
          selection: { anchor: sel.from, head: sel.from + unwrapped.length },
        });
        const newDoc = view.state.doc.toString();
        lastDispatchedDocRef.current = newDoc;
        updateContent(newDoc);
        view.focus();
        return;
      }

      // Check if immediately surrounding characters in document match delimiter
      const before = view.state.sliceDoc(Math.max(0, sel.from - len), sel.from);
      const after = view.state.sliceDoc(sel.to, Math.min(view.state.doc.length, sel.to + len));

      if (before === delimiter && after === delimiter) {
        view.dispatch({
          changes: [
            { from: sel.to, to: sel.to + len, insert: '' },
            { from: sel.from - len, to: sel.from, insert: '' },
          ],
          selection: { anchor: sel.from - len, head: sel.to - len },
        });
        const newDoc = view.state.doc.toString();
        lastDispatchedDocRef.current = newDoc;
        updateContent(newDoc);
        view.focus();
        return;
      }

      // Check altDelimiter surrounding
      if (altDelimiter) {
        const altLen = altDelimiter.length;
        const beforeAlt = view.state.sliceDoc(Math.max(0, sel.from - altLen), sel.from);
        const afterAlt = view.state.sliceDoc(
          sel.to,
          Math.min(view.state.doc.length, sel.to + altLen)
        );
        if (beforeAlt === altDelimiter && afterAlt === altDelimiter) {
          view.dispatch({
            changes: [
              { from: sel.to, to: sel.to + altLen, insert: '' },
              { from: sel.from - altLen, to: sel.from, insert: '' },
            ],
            selection: { anchor: sel.from - altLen, head: sel.to - altLen },
          });
          const newDoc = view.state.doc.toString();
          lastDispatchedDocRef.current = newDoc;
          updateContent(newDoc);
          view.focus();
          return;
        }
      }

      // Not formatted -> wrap with delimiter
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: `${delimiter}${selectedText}${delimiter}` },
        selection: { anchor: sel.from + len, head: sel.to + len },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    } else {
      // 2. Empty selection (cursor at single position)
      const pos = sel.head;
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const relPos = pos - line.from;

      // Check if cursor is right inside delimiter (e.g., `|` or **|**)
      const beforeChar = view.state.sliceDoc(Math.max(0, pos - len), pos);
      const afterChar = view.state.sliceDoc(pos, Math.min(view.state.doc.length, pos + len));

      if (beforeChar === delimiter && afterChar === delimiter) {
        // Toggle off: remove empty delimiter pair
        view.dispatch({
          changes: { from: pos - len, to: pos + len, insert: '' },
          selection: { anchor: pos - len },
        });
        const newDoc = view.state.doc.toString();
        lastDispatchedDocRef.current = newDoc;
        updateContent(newDoc);
        view.focus();
        return;
      }

      // Check pairs on current line for primary delimiter and altDelimiter
      const checkPairs = (d: string) => {
        const dLen = d.length;
        let sIdx = 0;
        while (sIdx < lineText.length) {
          const open = lineText.indexOf(d, sIdx);
          if (open === -1) break;
          if (dLen === 1 && (lineText[open - 1] === d || lineText[open + 1] === d)) {
            sIdx = open + 1;
            continue;
          }
          const close = lineText.indexOf(d, open + dLen);
          if (close === -1) break;
          if (dLen === 1 && (lineText[close - 1] === d || lineText[close + 1] === d)) {
            sIdx = close + 1;
            continue;
          }

          if (relPos >= open && relPos <= close + dLen) {
            return { start: line.from + open, end: line.from + close + dLen, len: dLen };
          }
          sIdx = close + dLen;
        }
        return null;
      };

      const foundPair = checkPairs(delimiter) || (altDelimiter ? checkPairs(altDelimiter) : null);

      if (foundPair) {
        // Unwrap this existing token
        const fullToken = view.state.sliceDoc(foundPair.start, foundPair.end);
        const innerContent = fullToken.slice(foundPair.len, -foundPair.len);
        view.dispatch({
          changes: { from: foundPair.start, to: foundPair.end, insert: innerContent },
          selection: { anchor: Math.max(foundPair.start, pos - foundPair.len) },
        });
        const newDoc = view.state.doc.toString();
        lastDispatchedDocRef.current = newDoc;
        updateContent(newDoc);
        view.focus();
        return;
      }

      // Otherwise insert pair and place cursor in the middle
      view.dispatch({
        changes: { from: pos, insert: `${delimiter}${delimiter}` },
        selection: { anchor: pos + len },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    }
  };

  const wrapSelection = (prefix: string, suffix: string, placeholder = 'Nota') => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to) || placeholder;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${prefix}${text}${suffix}` },
      selection: { anchor: sel.from + prefix.length, head: sel.to + prefix.length },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertMath = () => {
    const view = viewRef.current || getActiveEditorView();
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
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertCode = () => {
    console.log('[Urano Menu] Ejecutando comando: Bloque de código');
    const view = viewRef.current || getActiveEditorView();
    if (!view) {
      console.warn('[Urano Menu] EditorView no disponible');
      return;
    }
    const sel = view.state.selection.main;
    const selectedText = view.state.sliceDoc(sel.from, sel.to);
    const insertText = selectedText ? `\`\`\`\n${selectedText}\n\`\`\`` : '```\n\n```';
    const targetAnchor = sel.from + 4;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: targetAnchor },
    });

    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertTable = () => {
    console.log('[Urano Menu] Ejecutando comando: Insertar Tabla 2x2 Limpia');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;

    const currentTables = findAllTables(view.state.doc);
    const enclosingTable = currentTables.find(
      (t) => sel.from >= t.from && sel.from <= t.to
    );

    let insertFrom = sel.from;
    let insertTo = sel.to;
    if (enclosingTable) {
      insertFrom = enclosingTable.to;
      insertTo = enclosingTable.to;
    }

    const docLen = view.state.doc.length;
    const textBefore = view.state.sliceDoc(0, insertFrom);
    const textAfter = view.state.sliceDoc(insertTo);

    let prefix = '';
    if (insertFrom > 0) {
      if (textBefore.endsWith('\n\n')) {
        prefix = '';
      } else if (textBefore.endsWith('\n')) {
        prefix = '\n';
      } else {
        prefix = '\n\n';
      }
    }

    let suffix = '\n';
    if (insertTo < docLen && !textAfter.startsWith('\n')) {
      suffix = '\n\n';
    }

    const tableMarkdown = '|  |  |\n| --- | --- |\n|  |  |';
    const insert = `${prefix}${tableMarkdown}${suffix}`;
    const targetPos = insertFrom + prefix.length;

    const prevTables = currentTables.filter((t) => t.from < insertFrom);
    const targetTableIndex = prevTables.length;

    setPendingTableFocus({ tableIndex: targetTableIndex, row: 0, col: 0 });

    view.dispatch({
      changes: { from: insertFrom, to: insertTo, insert },
      selection: { anchor: targetPos },
    });

    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertCallout = () => {
    console.log('[Urano Menu] Ejecutando comando: Callout');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const prefix = line.text.trim().length > 0 ? '\n' : '';
    const selected = view.state.sliceDoc(sel.from, sel.to);
    const content = selected ? selected : 'Contenido del aviso';
    const insert = `${prefix}> [!note] Título\n> ${content}\n`;
    const titleStart = sel.from + prefix.length + 10;
    const titleEnd = titleStart + 6;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: titleStart, head: titleEnd },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertWikilink = () => {
    console.log('[Urano Menu] Ejecutando comando: Enlace interno');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const insert = '[[]]';
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + 2 },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();

    // Trigger autocompletion popup immediately
    setSuggestQuery('');
    setSuggestIndex(0);
    setShowSuggest(true);
    const coords = view.coordsAtPos(sel.from + 2);
    if (coords) {
      setSuggestCoords({
        top: coords.bottom + 6,
        left: Math.max(20, Math.min(coords.left, window.innerWidth - 280)),
      });
    }
  };

  const handleInsertHr = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: '\n---\n' },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleCut = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (text) {
      navigator.clipboard.writeText(text);
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    }
  };

  const handleCopy = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (text) {
      navigator.clipboard.writeText(text);
    }
  };

  const handlePaste = async () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    try {
      const text = await navigator.clipboard.readText();
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    } catch (err) {
      console.error('Clipboard paste failed:', err);
    }
  };

  const handlePastePlainText = async () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    try {
      const text = await navigator.clipboard.readText();
      const plain = text.replace(/\r\n/g, '\n');
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: plain } });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    } catch (err) {
      console.error('Clipboard paste plain text failed:', err);
    }
  };

  const handleSelectAll = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    view.focus();
  };

  // Right-click context menu handler matching Obsidian specification
  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.urano-table-editor') || target.closest('.cm-table-widget')) {
      return;
    }
    e.preventDefault();

    // If no text is selected or right-click is outside active selection, move cursor
    if (viewRef.current) {
      const sel = viewRef.current.state.selection.main;
      let clickPos = viewRef.current.posAtCoords({ x: e.clientX, y: e.clientY });
      if (clickPos === null) {
        clickPos = viewRef.current.state.doc.length;
      }
      if (clickPos !== null) {
        if (sel.empty || clickPos < sel.from || clickPos > sel.to) {
          viewRef.current.dispatch({
            selection: { anchor: clickPos, head: clickPos },
          });
        }
      }
    }

    // Check if right-clicked on [[Wikilink]]
    let clickedWikilink: string | null = null;
    const wikilinkEl = target.closest('.cm-wikilink');
    if (wikilinkEl && viewRef.current) {
      const pos = viewRef.current.posAtDOM(wikilinkEl);
      const line = viewRef.current.state.doc.lineAt(pos);
      const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line.text)) !== null) {
        const start = line.from + match.index;
        const end = start + match[0].length;
        if (pos >= start && pos <= end) {
          clickedWikilink = match[1].trim();
          break;
        }
      }
    }

    const items: MenuItemData[] = [];

    // 1. Wikilink Options if clicked on [[Wikilink]]
    if (clickedWikilink) {
      items.push(
        {
          title: 'Abrir enlace',
          icon: <ExternalLink size={14} />,
          action: () => onWikilinkClick(clickedWikilink!),
        },
        {
          title: 'Abrir en una pestaña nueva',
          icon: <PlusCircle size={14} />,
          action: () => onOpenInNewTab?.(clickedWikilink!),
        },
        {
          title: 'Abrir a la derecha',
          icon: <Columns size={14} />,
          action: () => onOpenToRight?.(clickedWikilink!),
        },
        {
          title: 'Copiar enlace de Urano',
          icon: <Copy size={14} />,
          action: () => {
            navigator.clipboard.writeText(`[[${clickedWikilink}]]`);
            showNotice('Enlace copiado al portapapeles', 2500, 'success');
          },
        },
        { type: 'separator' }
      );
    }

    // 2. Submenús desplegables: Formato ▸ & Insertar ▸
    items.push(
      {
        title: 'Formato',
        icon: <Type size={14} />,
        submenu: [
          {
            title: 'Negrita',
            shortcut: 'Ctrl+B',
            icon: <Bold size={14} />,
            action: () => toggleInlineFormatting('**', '__'),
          },
          {
            title: 'Cursiva',
            shortcut: 'Ctrl+I',
            icon: <Italic size={14} />,
            action: () => toggleInlineFormatting('*', '_'),
          },
          {
            title: 'Tachado',
            icon: <Strikethrough size={14} />,
            action: () => toggleInlineFormatting('~~'),
          },
          {
            title: 'Código en línea',
            icon: <Code size={14} />,
            action: () => toggleInlineFormatting('`'),
          },
          {
            title: 'Resaltado (==)',
            icon: <Highlighter size={14} />,
            action: () => toggleInlineFormatting('=='),
          },
          {
            title: 'Comentario (%%)',
            icon: <MessageSquare size={14} />,
            action: () => toggleInlineFormatting('%%'),
          },
        ],
      },
      {
        title: 'Insertar',
        icon: <PlusSquare size={14} />,
        submenu: [
          {
            title: 'Enlace interno [[]]',
            icon: <Link size={14} />,
            action: handleInsertWikilink,
          },
          {
            title: 'Nota incrustada ! [[]]',
            icon: <FilePlus size={14} />,
            action: () => wrapSelection('![[', ']]', 'Nota'),
          },
          {
            title: 'Bloque de código',
            icon: <Terminal size={14} />,
            action: handleInsertCode,
          },
          {
            title: 'Tabla',
            icon: <Table size={14} />,
            action: handleInsertTable,
          },
          {
            title: 'Callout (> [!NOTE])',
            icon: <AlertCircle size={14} />,
            action: handleInsertCallout,
          },
          {
            title: 'Ecuación matemática ($$)',
            icon: <Sigma size={14} />,
            action: handleInsertMath,
          },
          {
            title: 'Línea horizontal (---)',
            icon: <Minus size={14} />,
            action: handleInsertHr,
          },
        ],
      },
      { type: 'separator' },
      {
        title: 'Cortar',
        shortcut: 'Ctrl+X',
        icon: <Scissors size={14} />,
        action: handleCut,
      },
      {
        title: 'Copiar',
        shortcut: 'Ctrl+C',
        icon: <Copy size={14} />,
        action: handleCopy,
      },
      {
        title: 'Pegar',
        shortcut: 'Ctrl+V',
        icon: <Clipboard size={14} />,
        action: handlePaste,
      },
      {
        title: 'Pegar sin formato',
        shortcut: 'Ctrl+Shift+V',
        icon: <FileText size={14} />,
        action: handlePastePlainText,
      },
      {
        title: 'Seleccionar todo',
        shortcut: 'Ctrl+A',
        icon: <CheckSquare size={14} />,
        action: handleSelectAll,
      }
    );

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-obsidian-muted p-8 text-center bg-obsidian-bg">
        <FileText className="w-16 h-16 mb-4 text-obsidian-border stroke-1" />
        <h2 className="text-xl font-medium text-obsidian-text mb-2">Ninguna nota seleccionada</h2>
        <p className="text-sm max-w-sm text-obsidian-muted">
          Crea una nueva nota haciendo clic en '+' o presiona Ctrl+N.
        </p>
      </div>
    );
  }

  const pathParts = activeFile ? activeFile.replace(/\\/g, '/').split('/') : [];

  const handleHeaderMoreMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItemData[] = [
      {
        title: editorMode === 'live-preview' ? 'Cambiar a Vista de Lectura' : 'Cambiar a Vista de Edición',
        icon: <BookOpen size={14} />,
        action: () => setEditorMode(editorMode === 'live-preview' ? 'reading' : 'live-preview'),
      },
      {
        title: 'Copiar enlace de Urano',
        icon: <Copy size={14} />,
        action: () => {
          navigator.clipboard.writeText(`[[${cleanTitle}]]`);
          showNotice('Enlace copiado al portapapeles', 2000, 'success');
        },
      },
      {
        title: 'Copiar ruta de archivo',
        icon: <Link size={14} />,
        action: () => {
          if (activeFile) {
            navigator.clipboard.writeText(activeFile);
            showNotice('Ruta copiada al portapapeles', 2000, 'success');
          }
        },
      },
      { type: 'separator' },
      {
        title: 'Renombrar nota',
        icon: <Edit3 size={14} />,
        action: () => {
          if (inlineTitleRef.current) {
            inlineTitleRef.current.focus();
            const range = document.createRange();
            range.selectNodeContents(inlineTitleRef.current);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        },
      },
    ];
    setContextMenu({ x: Math.max(8, rect.left - 180), y: rect.bottom + 6, items });
  };

  return (
    <div
      onContextMenu={handleContextMenu}
      className="flex-1 flex flex-col h-full bg-obsidian-bg overflow-hidden relative"
    >
      {/* Obsidian Note View Header (.view-header) 1:1 Clean */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-obsidian-border bg-obsidian-sidebar z-10 select-none h-[40px]">
        {/* Left: Minimalist Navigation Arrows & Breadcrumbs */}
        <div className="flex items-center gap-2.5 text-xs truncate min-w-0">
          <div className="flex items-center gap-0.5 text-stone-500 shrink-0">
            <button
              onClick={() => window.history.back()}
              title="Atrás"
              className="p-1 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              onClick={() => window.history.forward()}
              title="Adelante"
              className="p-1 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
            >
              <ArrowRight size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-stone-400 text-xs truncate">
            {pathParts.map((part, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-stone-600 font-sans">›</span>}
                <span
                  className={
                    idx === pathParts.length - 1
                      ? 'font-medium text-stone-200 truncate'
                      : 'truncate text-stone-400 hover:text-stone-200 transition-colors'
                  }
                >
                  {idx === pathParts.length - 1 ? cleanTitle : part}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Right: Book Mode Switcher & 3-dots Menu */}
        <div className="flex items-center gap-1 shrink-0 text-stone-400">
          <button
            onClick={() =>
              setEditorMode(editorMode === 'live-preview' ? 'reading' : 'live-preview')
            }
            title={
              editorMode === 'live-preview'
                ? 'Cambiar a Vista de Lectura'
                : 'Cambiar a Vista de Edición (Live Preview)'
            }
            className="p-1.5 hover:text-orange-400 hover:bg-white/5 rounded transition-colors"
          >
            <BookOpen size={15} />
          </button>

          <button
            onClick={handleHeaderMoreMenu}
            title="Más opciones de la nota"
            className="p-1.5 hover:text-stone-200 hover:bg-white/5 rounded transition-colors"
          >
            <MoreVertical size={15} />
          </button>
        </div>
      </div>

      {/* Clean Document Canvas */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {isLoading && (
          <div className="absolute inset-0 bg-obsidian-bg/50 backdrop-blur-[1px] flex items-center justify-center z-20">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
          </div>
        )}

        {editorMode === 'live-preview' ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            {/* Inline Title (.inline-title) directly above the CodeMirror 6 canvas */}
            <div className="w-full max-w-[820px] mx-auto px-12 pt-6 shrink-0">
              <div
                ref={inlineTitleRef}
                className="inline-title"
                contentEditable="true"
                suppressContentEditableWarning
                spellCheck={false}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleBlur}
              >
                {cleanTitle}
              </div>
            </div>

            {/* CodeMirror 6 Editor Canvas */}
            <div ref={editorRef} className="flex-1 min-h-0" />
          </div>
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
                <FileText
                  size={12}
                  className={idx === suggestIndex ? 'text-orange-400' : 'text-stone-500'}
                />
                <span className="truncate">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Obsidian Right-click Context Menu */}
      {contextMenu && (
        <ObsidianMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
