import React, { useEffect, useRef, useState, useMemo } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { indentUnit } from '@codemirror/language';
import { useSettingsStore, UranoSettings } from '../../stores/settingsStore';
import { languages } from '@codemirror/language-data';
import { obsidianTheme, obsidianSyntax } from '../../editor/theme';
import { liveMarkdownExtension } from '../../editor/liveMarkdown';
import { mathExtension } from '../../editor/mathExtension';
import { codeBlockExtension } from '../../editor/codeBlockExtension';
import { calloutExtension } from '../../editor/calloutExtension';
import { tableExtension, setPendingTableFocus, findAllTables } from '../../editor/tableExtension';
import { createWikilinksExtension } from '../../editor/wikilinks';
import { formattingClickExtension } from '../../editor/formattingClickExtension';
import {
  createImageExtension,
  createImageDropPasteHandler,
  copyImageBlobToClipboard,
  procesarPegadoDeImagen,
  getImageWidgetState,
  type ImageEmbedInfo,
} from '../../editor/imageExtension';
import { spellcheckExtension, triggerSpellCheckEffect } from '../../editor/spellcheckExtension';
import { getStorageAdapter, toUint8Array } from '../../services/storageAdapter';
import { themeService } from '../../services/themeService';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore, ILLEGAL_FILENAME_CHARS } from '../../stores/vaultStore';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { useNoticeStore } from '../common/Notice';
import { useT } from '../../stores/localeStore';
import { ImageLightbox } from '../common/ImageLightbox';
import { FileItem } from '../../types';
import {
  FileText,
  Highlighter,
  Bold,
  Italic,
  Strikethrough,
  Code,
  MessageSquare,
  Sigma,
  Link,
  ExternalLink,
  PlusCircle,
  Columns,
  Copy,
  Scissors,
  Table,
  Minus,
  Paintbrush,
  Pilcrow,
  ListPlus,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Search,
  FolderInput,
  Eraser,
  ClipboardCheck,
  ClipboardType,
  SquareDashed,
  FilePen,
  SquareSigma,
  TableProperties,
  FileImage,
  ImageMinus,
  Trash2,
  Repeat,
  BookPlus,
} from 'lucide-react';

interface EditorProps {
  onWikilinkClick: (noteName: string) => void;
  onOpenInNewTab?: (noteName: string) => void;
  onOpenToRight?: (noteName: string) => void;
  onStatsChange?: (stats: { words: number; chars: number }) => void;
  /** Controlled view mode (driven by the .view-header action button / Ctrl+E) */
  viewMode?: 'live-preview' | 'reading' | 'source';
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
  viewMode,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const inlineTitleRef = useRef<HTMLInputElement>(null);
  const lastDispatchedDocRef = useRef<string>('');

  // Holds the Live Preview rendering extensions; emptied in Source Mode
  const livePreviewCompartment = useRef(new Compartment());

  // Settings → Editor (line numbers, tab size, indent unit, spellcheck) live in
  // their own compartment so changes apply without recreating the editor.
  const editorSettingsCompartment = useRef(new Compartment());
  const showLineNumbers = useSettingsStore((st) => st.settings.showLineNumbers);
  const tabSize = useSettingsStore((st) => st.settings.tabSize);
  const useTabs = useSettingsStore((st) => st.settings.useTabs);
  const spellcheck = useSettingsStore((st) => st.settings.spellcheck);
  const language = useSettingsStore((st) => st.settings.language);
  const customDictionary = useSettingsStore((st) => st.settings.customDictionary);
  const strictLineBreaks = useSettingsStore((st) => st.settings.strictLineBreaks);
  const showInlineTitle = useSettingsStore((st) => st.settings.showInlineTitle);
  const editorSettingsRef = useRef({ showLineNumbers, tabSize, useTabs, spellcheck, language });
  editorSettingsRef.current = { showLineNumbers, tabSize, useTabs, spellcheck, language };

  const buildEditorSettingsExtensions = (
    s: Pick<UranoSettings, 'showLineNumbers' | 'tabSize' | 'useTabs' | 'spellcheck' | 'language'>
  ) => [
    ...(s.showLineNumbers ? [lineNumbers()] : []),
    EditorState.tabSize.of(s.tabSize),
    indentUnit.of(s.useTabs ? '\t' : ' '.repeat(s.tabSize)),
    EditorView.contentAttributes.of({
      spellcheck: s.spellcheck ? 'true' : 'false',
      autocorrect: 'on',
      autocapitalize: 'on',
      contenteditable: 'true',
    }),
    ...(s.spellcheck ? spellcheckExtension : []),
  ];

  const editorMode = viewMode ?? 'live-preview';
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  // Full-screen image lightbox state (Obsidian `showImage`)
  const [lightbox, setLightbox] = useState<{
    images: { src: string; alt?: string; filePath?: string }[];
    activeIndex: number;
  } | null>(null);

  // Latest lightbox opener, kept in a ref so the CodeMirror extension (created
  // once per note) always dispatches to the current handler without re-creating
  // the editor.
  const zoomHandlerRef = useRef<(info: ImageEmbedInfo, src: string) => void>(() => {});

  // Quick font size adjustment via Ctrl + Wheel when baseFontSizeAction is enabled
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && useSettingsStore.getState().settings.baseFontSizeAction) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 1 : -1;
        const current = useSettingsStore.getState().settings.baseFontSize || 16;
        const next = Math.max(10, Math.min(30, current + delta));
        if (next !== current) {
          useSettingsStore.getState().setSetting('baseFontSize', next);
          useSettingsStore.getState().setSetting('editorFontSize', next);
          const s = useSettingsStore.getState().settings;
          themeService.applyFonts({
            fontSize: next,
            interfaceFont: s.interfaceFontFamily,
            textFont: s.textFontFamily,
            monoFont: s.monospaceFontFamily,
          });
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Every Live Preview decoration. Source Mode swaps this for `[]` so the raw
  // Markdown is shown (Obsidian "Source mode"). Paste/drop handling is NOT part
  // of this list: pasting an image must keep working in Source Mode.
  const buildLivePreviewExtensions = (mode: typeof editorMode) =>
    mode === 'source'
      ? []
      : [
          liveMarkdownExtension,
          mathExtension, // KaTeX LaTeX math equations
          codeBlockExtension, // Code blocks with syntax highlighting & copy button
          calloutExtension, // Obsidian Callout boxes in Live Preview
          tableExtension, // Obsidian Markdown Tables in Live Preview
          createImageExtension({
            onOpenInNewTab,
            onZoomImage: (info, src) => zoomHandlerRef.current(info, src),
          }),
          formattingClickExtension,
          createWikilinksExtension({ onWikilinkClick }),
        ];

  // Floating [[ Wikilink suggestion autocompletion state
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestCoords, setSuggestCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const {
    activeVault,
    activeFile,
    activeFileName,
    fileContent,
    fileTree,
    updateContent,
    isDirty,
    saveCurrentFile,
    deleteItem,
    renameNoteWithLinkRefactor,
    autoFocusTitle,
    setAutoFocusTitle,
    shouldSelectTitleOnOpen,
    setShouldSelectTitleOnOpen,
    isLoading,
    refreshTree,
  } = useVaultStore();

  const { showNotice } = useNoticeStore();
  const t = useT();

  const cleanTitle = activeFileName
    ? activeFileName.replace(/\.md$/i, '')
    : t('common.untitled');

  // Estado local para edición de título sin renombrar en cada pulsación
  const [draftTitle, setDraftTitle] = useState(cleanTitle);

  // Sincronización bidireccional: si el archivo se renombra externamente, actualizar draftTitle
  useEffect(() => {
    setDraftTitle(cleanTitle);
  }, [cleanTitle]);

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

  // Auto-focus y selección completa de "Untitled" en .inline-title al crear una nota nueva
  useEffect(() => {
    if ((shouldSelectTitleOnOpen || autoFocusTitle) && inlineTitleRef.current) {
      inlineTitleRef.current.focus();
      inlineTitleRef.current.select();
      setShouldSelectTitleOnOpen(false);
      setAutoFocusTitle(false);
    }
  }, [shouldSelectTitleOnOpen, autoFocusTitle, activeFile, setShouldSelectTitleOnOpen, setAutoFocusTitle]);

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
        // Live Preview rendering lives in a compartment so Source Mode can
        // disable every decoration and show the raw Markdown (Obsidian "Source mode").
        livePreviewCompartment.current.of(buildLivePreviewExtensions(editorMode)),
        editorSettingsCompartment.current.of(
          buildEditorSettingsExtensions(editorSettingsRef.current)
        ),
        createImageDropPasteHandler(),
        EditorView.lineWrapping,
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

  // Toggle Live Preview <-> Source Mode without recreating the editor:
  // reconfigures the compartment holding every Live Preview decoration.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: livePreviewCompartment.current.reconfigure(
        buildLivePreviewExtensions(editorMode)
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

  // Apply Settings → Editor changes live (CodeMirror 6 compartment reconfigure)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        editorSettingsCompartment.current.reconfigure(
          buildEditorSettingsExtensions({ showLineNumbers, tabSize, useTabs, spellcheck, language })
        ),
        triggerSpellCheckEffect.of(true),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLineNumbers, tabSize, useTabs, spellcheck, language]);

  // Re-validate visible words when the custom dictionary changes (Settings → Editor,
  // "Add to dictionary" or edits to .urano/dictionary.txt)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !spellcheck) return;
    view.dispatch({ effects: triggerSpellCheckEffect.of(true) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customDictionary]);

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

  // Collect every image embed in the document and open the clicked one at its
  // index (1:1 with Obsidian's `showImage`).
  useEffect(() => {
    zoomHandlerRef.current = (_info: ImageEmbedInfo, src: string) => {
      const root = editorRef.current;
      if (!root) {
        setLightbox({ images: [{ src }], activeIndex: 0 });
        return;
      }

      const nodes = Array.from(root.querySelectorAll<HTMLElement>('.cm-image-embed'));
      const images = nodes
        .map((node) => {
          const state = getImageWidgetState(node);
          const widgetImg = state?.img ?? node.querySelector('img');
          if (!widgetImg || !widgetImg.src) return null;
          const entry: { src: string; alt?: string; filePath?: string } = {
            src: widgetImg.src,
            alt: state?.info.alt,
            filePath: state?.info.resolvedFilePath || state?.info.targetPathOrUrl,
          };
          return entry;
        })
        .filter((entry): entry is { src: string; alt?: string; filePath?: string } => entry !== null);

      if (images.length === 0) {
        setLightbox({ images: [{ src }], activeIndex: 0 });
        return;
      }

      const activeIndex = Math.max(
        0,
        images.findIndex((entry) => entry.src === src)
      );
      setLightbox({ images, activeIndex });
    };
  }, []);

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

  // Listen for image-specific context menu events (1:1 with Obsidian)
  useEffect(() => {
    const handleImageContextMenu = (e: Event) => {
      const customEvent = e as CustomEvent<{
        x: number;
        y: number;
        filePath: string;
        src: string;
        alt: string;
        from: number;
        to: number;
        onOpenInNewTab?: (filePath: string) => void;
      }>;
      const { x, y, filePath, src, from, to, onOpenInNewTab: eventOnOpen } = customEvent.detail;

      const items: MenuItemData[] = [
        {
          title: t('editor.image.copyImage'),
          icon: <Copy size={14} />,
          action: async () => {
            try {
              let blob: Blob;
              if (src.startsWith('blob:') || src.startsWith('data:')) {
                const res = await fetch(src);
                blob = await res.blob();
              } else {
                blob = await getStorageAdapter().readBinary(filePath);
              }
              await copyImageBlobToClipboard(blob);
              showNotice(t('editor.notices.imageCopied'), 2000, 'success');
            } catch (err) {
              console.error('Error copying image:', err);
              showNotice(t('editor.notices.imageCopyFailed'), 2500, 'error');
            }
          },
        },
        {
          title: t('editor.contextMenu.openInNewTab'),
          icon: <FileImage size={14} />,
          action: () => {
            if (eventOnOpen) {
              eventOnOpen(filePath);
            } else if (onOpenInNewTab) {
              onOpenInNewTab(filePath);
            }
          },
        },
        { type: 'separator' },
        {
          title: t('editor.image.removeFromDocument'),
          icon: <ImageMinus size={14} />,
          action: () => {
            if (viewRef.current) {
              viewRef.current.dispatch({
                changes: { from, to, insert: '' },
              });
            }
          },
        },
        {
          title: t('editor.image.deleteFile'),
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: async () => {
            await deleteItem(filePath);
            showNotice(t('editor.notices.fileDeleted'), 2000, 'info');
            if (viewRef.current) {
              viewRef.current.dispatch({
                changes: { from, to, insert: '' },
              });
            }
          },
        },
      ];

      setContextMenu({ x, y, items });
    };

    window.addEventListener('urano-image-contextmenu', handleImageContextMenu);
    return () => {
      window.removeEventListener('urano-image-contextmenu', handleImageContextMenu);
    };
  }, [onOpenInNewTab, deleteItem, showNotice, t]);

  // Handle .inline-title keyboard events (Enter / Tab / ArrowDown / Escape)
  const handleTitleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowDown') {
      e.preventDefault();
      const newTitle = draftTitle.trim();

      if (newTitle && newTitle !== cleanTitle && activeFile) {
        const result = await renameNoteWithLinkRefactor(activeFile, newTitle);
        if (!result.success) {
          showNotice(result.error || t('editor.notices.invalidFileName'), 4000, 'error');
          setDraftTitle(cleanTitle);
          return;
        }
      } else if (!newTitle) {
        setDraftTitle(cleanTitle);
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
      setDraftTitle(cleanTitle);
      inlineTitleRef.current?.blur();
    }
  };

  // Handle .inline-title onBlur (auto-commit rename)
  const handleTitleBlur = async () => {
    const newTitle = draftTitle.trim();
    if (!newTitle) {
      setDraftTitle(cleanTitle);
      return;
    }

    if (newTitle !== cleanTitle && activeFile) {
      const result = await renameNoteWithLinkRefactor(activeFile, newTitle);
      if (!result.success) {
        showNotice(result.error || t('editor.notices.invalidFileName'), 4000, 'error');
        setDraftTitle(cleanTitle);
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

      // If cursor is on or right after a word (e.g., user wrote "suu" and cursor is at "suu|", "s|uu", or after spaces "suu ")
      let targetWord: { from: number; to: number; text: string } | null = null;
      const wordAtPos = view.state.wordAt(pos);
      if (wordAtPos && wordAtPos.from >= line.from && wordAtPos.to <= line.to) {
        targetWord = {
          from: wordAtPos.from,
          to: wordAtPos.to,
          text: view.state.sliceDoc(wordAtPos.from, wordAtPos.to),
        };
      } else {
        // Look backwards on current line for the word right behind the cursor (ignoring trailing whitespace)
        const textBefore = lineText.slice(0, relPos);
        const match = textBefore.match(/([\p{L}\p{N}_]+)\s*$/u);
        if (match) {
          const word = match[1];
          const matchIndex = match.index ?? 0;
          const from = line.from + matchIndex;
          const to = from + word.length;
          targetWord = { from, to, text: word };
        }
      }

      if (targetWord && targetWord.text.length > 0) {
        // Check if targetWord is already wrapped with delimiter or altDelimiter
        const beforeTarget = view.state.sliceDoc(Math.max(0, targetWord.from - len), targetWord.from);
        const afterTarget = view.state.sliceDoc(
          targetWord.to,
          Math.min(view.state.doc.length, targetWord.to + len)
        );
        const isTargetWrapped = beforeTarget === delimiter && afterTarget === delimiter;

        const altLen = altDelimiter ? altDelimiter.length : 0;
        const beforeAlt = altDelimiter
          ? view.state.sliceDoc(Math.max(0, targetWord.from - altLen), targetWord.from)
          : '';
        const afterAlt = altDelimiter
          ? view.state.sliceDoc(
              targetWord.to,
              Math.min(view.state.doc.length, targetWord.to + altLen)
            )
          : '';
        const isTargetWrappedAlt = altDelimiter
          ? beforeAlt === altDelimiter && afterAlt === altDelimiter
          : false;

        if (isTargetWrapped) {
          // Unwrap target word
          view.dispatch({
            changes: [
              { from: targetWord.to, to: targetWord.to + len, insert: '' },
              { from: targetWord.from - len, to: targetWord.from, insert: '' },
            ],
            selection: {
              anchor: pos >= targetWord.to + len ? pos - len * 2 : Math.max(targetWord.from - len, pos - len),
            },
          });
        } else if (isTargetWrappedAlt && altDelimiter) {
          // Unwrap altDelimiter target word
          view.dispatch({
            changes: [
              { from: targetWord.to, to: targetWord.to + altLen, insert: '' },
              { from: targetWord.from - altLen, to: targetWord.from, insert: '' },
            ],
            selection: {
              anchor: pos >= targetWord.to + altLen ? pos - altLen * 2 : Math.max(targetWord.from - altLen, pos - altLen),
            },
          });
        } else {
          // Wrap target word with delimiter
          view.dispatch({
            changes: {
              from: targetWord.from,
              to: targetWord.to,
              insert: `${delimiter}${targetWord.text}${delimiter}`,
            },
            selection: {
              anchor: pos >= targetWord.to ? pos + len * 2 : pos + len,
            },
          });
        }

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

  const HIGHLIGHT_COLOR_EMOJI: Record<string, string> = {
    default: '',
    red: '🔴',
    orange: '🟠',
    yellow: '🟡',
    green: '🟢',
    blue: '🔵',
    purple: '🟣',
  };

  const applyHighlight = (
    color: 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
  ) => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    let from = sel.from;
    let to = sel.to;
    let selectedText = view.state.sliceDoc(from, to);

    const colorEmoji = HIGHLIGHT_COLOR_EMOJI[color] ?? '';

    // If cursor is collapsed, check if cursor is currently inside any highlight on this line
    if (from === to) {
      const line = view.state.doc.lineAt(from);
      const lineText = line.text;
      const offset = from - line.from;

      const hlPatterns = [
        /==(🔴|🟠|🟡|🟢|🔵|🟣)?([^=\n]+)==/g,
        /<mark class="hl-(?:red|orange|yellow|green|blue|purple)">([\s\S]*?)<\/mark>/gi,
        /==\[(?:red|orange|yellow|green|blue|purple)\]([\s\S]*?)==/gi,
      ];

      let found = false;
      for (const pat of hlPatterns) {
        let m: RegExpExecArray | null;
        while ((m = pat.exec(lineText)) !== null) {
          const mStart = m.index;
          const mEnd = mStart + m[0].length;
          if (offset >= mStart && offset <= mEnd) {
            from = line.from + mStart;
            to = line.from + mEnd;
            selectedText = m[0];
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        const word = view.state.wordAt(from);
        if (word && word.from >= line.from && word.to <= line.to) {
          from = word.from;
          to = word.to;
          selectedText = view.state.sliceDoc(from, to);
        } else {
          // Look backwards on current line for word behind cursor
          const textBefore = lineText.slice(0, offset);
          const match = textBefore.match(/([\p{L}\p{N}_]+)\s*$/u);
          if (match) {
            const wordStr = match[1];
            const matchIndex = match.index ?? 0;
            from = line.from + matchIndex;
            to = from + wordStr.length;
            selectedText = wordStr;
          }
        }
      }
    }

    const line = view.state.doc.lineAt(from);
    const lineText = line.text;
    const offsetInLineFrom = from - line.from;
    const offsetInLineTo = to - line.from;

    const beforeText = lineText.slice(0, offsetInLineFrom);
    const afterText = lineText.slice(offsetInLineTo);

    const surroundingRegexBefore = /==(🔴|🟠|🟡|🟢|🔵|🟣)?$/;
    const surroundingRegexAfter = /^==/;

    const markOpenRegex = /<mark class="hl-(?:red|orange|yellow|green|blue|purple)">$/i;
    const markCloseRegex = /^<\/mark>/i;

    const bracketOpenRegex = /==\[(?:red|orange|yellow|green|blue|purple)\]$/i;
    const bracketCloseRegex = /^==/;

    // Strip existing highlight delimiters and emoji from inside selectedText
    let cleanText = selectedText;
    cleanText = cleanText
      .replace(/^<mark class="hl-[a-z]+">/i, '')
      .replace(/<\/mark>$/i, '')
      .replace(/^==\[[a-z]+\]/i, '')
      .replace(/^==(🔴|🟠|🟡|🟢|🔵|🟣)?/, '')
      .replace(/==$/, '')
      .trim();

    let replaceFrom = from;
    let replaceTo = to;

    // Check if delimiters immediately surround the selection
    if (surroundingRegexBefore.test(beforeText) && surroundingRegexAfter.test(afterText)) {
      const matchBefore = beforeText.match(surroundingRegexBefore)!;
      replaceFrom = from - matchBefore[0].length;
      replaceTo = to + 2;
    } else if (markOpenRegex.test(beforeText) && markCloseRegex.test(afterText)) {
      const matchOpen = beforeText.match(markOpenRegex)!;
      replaceFrom = from - matchOpen[0].length;
      replaceTo = to + 7;
    } else if (bracketOpenRegex.test(beforeText) && bracketCloseRegex.test(afterText)) {
      const matchOpen = beforeText.match(bracketOpenRegex)!;
      replaceFrom = from - matchOpen[0].length;
      replaceTo = to + 2;
    }

    const hasContent = Boolean(cleanText);
    const newWrapped = `==${colorEmoji}${cleanText}==`;

    view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert: newWrapped },
      selection: {
        anchor: hasContent
          ? replaceFrom + newWrapped.length
          : replaceFrom + 2 + colorEmoji.length,
      },
    });

    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertFootnote = () => {
    console.log('[Urano Menu] Ejecutando comando: Nota al pie');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;

    const doc = view.state.doc;
    const docText = doc.toString();

    // 1. Calcular el número más alto existente [^1], [^2], etc.
    const fnRegex = /\[\^(\d+)\]/g;
    let maxN = 0;
    let match: RegExpExecArray | null;
    while ((match = fnRegex.exec(docText)) !== null) {
      const val = parseInt(match[1], 10);
      if (!isNaN(val) && val > maxN) {
        maxN = val;
      }
    }
    const n = maxN + 1;

    // 2. Insertar [^n] en la posición actual del cursor (o justo después de la selección)
    const sel = view.state.selection.main;
    const insertPos = sel.empty ? sel.from : sel.to;
    const insertRef = `[^${n}]`;

    // 3. Al final del documento agregar una nueva línea con [^n]: 
    const docLen = doc.length;
    const docEndsWithNewline = docLen > 0 && doc.sliceString(docLen - 1, docLen) === '\n';
    const defPrefix = docEndsWithNewline ? '' : '\n';
    const defText = `${defPrefix}[^${n}]: `;

    if (insertPos >= docLen) {
      const fullInsert = `${insertRef}${defText}`;
      const targetPos = docLen + fullInsert.length;
      view.dispatch({
        changes: { from: docLen, to: docLen, insert: fullInsert },
        selection: { anchor: targetPos },
        scrollIntoView: true,
      });
    } else {
      const targetPos = docLen + insertRef.length + defText.length;
      view.dispatch({
        changes: [
          { from: insertPos, to: insertPos, insert: insertRef },
          { from: docLen, to: docLen, insert: defText },
        ],
        selection: { anchor: targetPos },
        scrollIntoView: true,
      });
    }

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
    const content = selected ? selected : t('editor.insert.calloutContent');
    const calloutTitle = t('editor.insert.calloutTitle');
    const insert = `${prefix}> [!NOTE] ${calloutTitle}\n> ${content}\n`;
    const titleStart = sel.from + prefix.length + 10;
    const titleEnd = titleStart + calloutTitle.length;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: titleStart, head: titleEnd },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertHr = () => {
    console.log('[Urano Menu] Ejecutando comando: Línea horizontal');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const prefix = line.text.trim().length > 0 ? '\n' : '';
    const insertText = `${prefix}---\n\n`;
    const targetAnchor = sel.from + insertText.length;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: targetAnchor },
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
    const line = view.state.doc.lineAt(sel.from);
    const prefix = line.text.trim().length > 0 ? '\n' : '';
    const selectedText = view.state.sliceDoc(sel.from, sel.to);
    const insertText = selectedText ? `${prefix}\`\`\`\n${selectedText}\n\`\`\`\n` : `${prefix}\`\`\`\n\n\`\`\`\n`;
    const targetAnchor = sel.from + prefix.length + 4;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: { anchor: targetAnchor },
    });

    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertMath = () => {
    console.log('[Urano Menu] Ejecutando comando: Bloque matemático');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const selectedText = view.state.sliceDoc(sel.from, sel.to);
    const prefix = line.text.trim().length > 0 ? '\n' : '';
    const content = selectedText || '';
    const insertText = `${prefix}$$\n${content}\n$$\n`;
    const targetAnchor = sel.from + prefix.length + 3;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: insertText },
      selection: {
        anchor: targetAnchor,
        head: content ? targetAnchor + content.length : targetAnchor,
      },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const handleInsertNewBase = async () => {
    console.log('[Urano Menu] Ejecutando comando: Nueva base');
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;

    try {
      const { createBaseFile, activeVault } = useVaultStore.getState();
      const parentDir = activeFile
        ? activeFile.substring(0, activeFile.lastIndexOf('/'))
        : activeVault || undefined;

      const res = await createBaseFile(parentDir);
      if (!res.fileName) return;

      const sel = view.state.selection.main;
      const insertText = `![[${res.fileName}]]`;

      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: insertText },
        selection: { anchor: sel.from + insertText.length },
      });

      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
      showNotice(t('editor.notices.baseCreated', { name: res.fileName }), 3000, 'success');
    } catch (err) {
      console.error('Error al insertar nueva base:', err);
      showNotice(t('editor.notices.baseCreateFailed'), 3000, 'error');
    }
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
      // 1. Intentar leer imagen del portapapeles nativo del SO vía Tauri/arboard
      try {
        const nativeBytes = toUint8Array(
          await invoke<ArrayBuffer | number[] | null>('read_clipboard_image')
        );
        if (nativeBytes && nativeBytes.length > 0) {
          const file = new File([nativeBytes], 'pasted_image.png', { type: 'image/png' });
          await procesarPegadoDeImagen(file, view);
          view.focus();
          return;
        }
      } catch (nativeErr) {
        console.warn('Native clipboard image read failed:', nativeErr);
      }

      // 2. Intentar leer imagen del portapapeles web
      if (navigator.clipboard && navigator.clipboard.read) {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                const blob = await item.getType(type);
                const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1] || 'png';
                const file = new File([blob], `clipboard_image.${ext}`, { type });
                await procesarPegadoDeImagen(file, view);
                view.focus();
                return;
              }
            }
          }
        } catch {
          // Ignorar y proceder a pegado de texto
        }
      }

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

  const handleAddInternalLink = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      const replacement = `[[${text}]]`;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replacement },
        selection: { anchor: sel.from + 2, head: sel.from + 2 + text.length },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    } else {
      const pos = sel.from;
      view.dispatch({
        changes: { from: pos, to: pos, insert: '[[]]' },
        selection: { anchor: pos + 2, head: pos + 2 },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();

      setTimeout(() => {
        const coords = view.coordsAtPos(pos + 2);
        if (coords) {
          setSuggestCoords({
            top: coords.bottom + 6,
            left: Math.max(20, Math.min(coords.left, window.innerWidth - 280)),
          });
          setSuggestQuery('');
          setSuggestIndex(0);
          setShowSuggest(true);
        }
      }, 50);
    }
  };

  const handleAddExternalLink = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      const replacement = `[${text}](url)`;
      const urlStart = sel.from + 1 + text.length + 2;
      const urlEnd = urlStart + 3;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replacement },
        selection: { anchor: urlStart, head: urlEnd },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    } else {
      const pos = sel.from;
      const replacement = '[](url)';
      view.dispatch({
        changes: { from: pos, to: pos, insert: replacement },
        selection: { anchor: pos + 1, head: pos + 1 },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
    }
  };

  const handleSearchSelection = (text: string) => {
    (window as any).__uranoInitialSearchQuery = text;
    window.dispatchEvent(new CustomEvent('urano-search', { detail: { query: text } }));
  };

  const handleExtractSelection = async (
    selectedText: string,
    selFrom: number,
    selTo: number
  ) => {
    const view = viewRef.current || getActiveEditorView();
    if (!view || !selectedText) return;

    const noteTitle = window.prompt(t('editor.prompt.newNoteTitle'));
    if (!noteTitle || !noteTitle.trim()) return;

    const cleanName = noteTitle.trim().replace(ILLEGAL_FILENAME_CHARS, '');
    if (!cleanName) {
      showNotice(t('editor.notices.invalidNoteName'), 2500, 'warning');
      return;
    }

    const parentDir = activeFile
      ? activeFile.substring(0, activeFile.lastIndexOf('/'))
      : activeVault;

    if (!parentDir) return;

    const fullPath = `${parentDir}/${cleanName}.md`.replace(/\/+/g, '/');

    try {
      await invoke('create_file', { filePath: fullPath });
      await invoke('write_file', { filePath: fullPath, content: selectedText });
      await refreshTree();

      const replacement = `[[${cleanName}]]`;
      view.dispatch({
        changes: { from: selFrom, to: selTo, insert: replacement },
        selection: { anchor: selFrom + 2, head: selFrom + 2 + cleanName.length },
      });
      const newDoc = view.state.doc.toString();
      lastDispatchedDocRef.current = newDoc;
      updateContent(newDoc);
      view.focus();
      showNotice(t('editor.notices.noteExtracted', { name: cleanName }), 2500, 'success');
    } catch (err) {
      console.error('Error al extraer selección:', err);
      showNotice(t('editor.notices.noteExtractFailed'), 3000, 'error');
    }
  };

  const handleClearFormatting = () => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;
    const sel = view.state.selection.main;
    let from = sel.from;
    let to = sel.to;

    if (sel.empty) {
      const pos = sel.head;
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const relPos = pos - line.from;

      const patterns = [
        /\*\*(.*?)\*\*/g,
        /__(.*?)__/g,
        /~~(.*?)~~/g,
        /==(?:[🔴🟠🟡🟢🔵🟣])?(.*?)==/g,
        /`([^`]+)`/g,
        /\$([^$]+)\$/g,
        /%%([\s\S]*?)%%/g,
        /\*([^*]+)\*/g,
        /_([^_]+)_/g,
        /<\/?mark[^>]*>.*?<\/mark>/gi,
      ];

      let found = false;
      for (const pat of patterns) {
        let m: RegExpExecArray | null;
        while ((m = pat.exec(lineText)) !== null) {
          const mStart = m.index;
          const mEnd = mStart + m[0].length;
          if (relPos >= mStart && relPos <= mEnd) {
            from = line.from + mStart;
            to = line.from + mEnd;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        const word = view.state.wordAt(pos);
        if (word && word.from >= line.from && word.to <= line.to) {
          from = word.from;
          to = word.to;
        } else {
          const textBefore = lineText.slice(0, relPos);
          const match = textBefore.match(/([\p{L}\p{N}_]+)\s*$/u);
          if (match) {
            const matchIndex = match.index ?? 0;
            from = line.from + matchIndex;
            to = from + match[1].length;
          } else {
            return;
          }
        }
      }
    }

    const text = view.state.sliceDoc(from, to);
    const cleaned = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/==(?:[🔴🟠🟡🟢🔵🟣])?(.*?)==/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\$([^$]+)\$/g, '$1')
      .replace(/%%([\s\S]*?)%%/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/<\/?mark[^>]*>/gi, '');

    view.dispatch({
      changes: { from, to, insert: cleaned },
      selection: { anchor: from, head: from + cleaned.length },
    });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  const applyParagraphPrefix = (
    type:
      | 'body'
      | 'h1'
      | 'h2'
      | 'h3'
      | 'h4'
      | 'h5'
      | 'h6'
      | 'bullet'
      | 'numbered'
      | 'todo'
      | 'quote'
  ) => {
    const view = viewRef.current || getActiveEditorView();
    if (!view) return;

    const { state } = view;
    const sel = state.selection.main;
    const startLine = state.doc.lineAt(sel.from);
    const endLine = state.doc.lineAt(sel.to);

    const prefixRegex = /^(?:#{1,6}\s+|>\s+|-\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/;

    const changes: { from: number; to: number; insert: string }[] = [];
    let itemIndex = 1;

    for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
      const line = state.doc.line(lineNo);
      const text = line.text;
      const match = text.match(prefixRegex);
      const content = match ? text.slice(match[0].length) : text;

      let newPrefix = '';
      switch (type) {
        case 'body':
          newPrefix = '';
          break;
        case 'h1':
          newPrefix = '# ';
          break;
        case 'h2':
          newPrefix = '## ';
          break;
        case 'h3':
          newPrefix = '### ';
          break;
        case 'h4':
          newPrefix = '#### ';
          break;
        case 'h5':
          newPrefix = '##### ';
          break;
        case 'h6':
          newPrefix = '###### ';
          break;
        case 'bullet':
          newPrefix = '- ';
          break;
        case 'numbered':
          newPrefix = `${itemIndex}. `;
          itemIndex++;
          break;
        case 'todo':
          newPrefix = '- [ ] ';
          break;
        case 'quote':
          newPrefix = '> ';
          break;
      }

      changes.push({
        from: line.from,
        to: line.to,
        insert: `${newPrefix}${content}`,
      });
    }

    view.dispatch({ changes });
    const newDoc = view.state.doc.toString();
    lastDispatchedDocRef.current = newDoc;
    updateContent(newDoc);
    view.focus();
  };

  // Right-click context menu handler matching Obsidian specification
  const handleContextMenu = async (e: React.MouseEvent) => {
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

    const currentView = viewRef.current || getActiveEditorView();
    const activeSel = currentView ? currentView.state.selection.main : null;
    const hasSelection = Boolean(activeSel && !activeSel.empty);
    const selectedText =
      hasSelection && currentView
        ? currentView.state.sliceDoc(activeSel!.from, activeSel!.to)
        : '';

    // Check if right-clicked on [[Wikilink]]
    let clickedWikilink: string | null = null;
    const wikilinkEl = target.closest('.cm-wikilink');
    if (wikilinkEl && currentView) {
      const pos = currentView.posAtDOM(wikilinkEl);
      const line = currentView.state.doc.lineAt(pos);
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

    // 0. Corrección ortográfica (Sugerencias nativas de enchant/spellbook + Añadir al diccionario)
    const spellErrorEl = target.closest('.cm-spell-error');
    if (spellErrorEl) {
      const misspelledWord =
        spellErrorEl.getAttribute('data-word') || spellErrorEl.textContent?.trim() || '';
      if (misspelledWord) {
        const currentLang = useSettingsStore.getState().settings.language || 'en';
        const suggestions: string[] = await invoke<string[]>('suggest_word', {
          word: misspelledWord,
          lang: currentLang,
        }).catch(() => []);

        // Calcular rango exacto en el documento de la palabra subrayada
        let wordRange: { from: number; to: number } | null = null;
        if (currentView) {
          try {
            const pos = currentView.posAtDOM(spellErrorEl);
            const line = currentView.state.doc.lineAt(pos);
            const text = line.text;
            let idx = 0;
            while ((idx = text.indexOf(misspelledWord, idx)) !== -1) {
              const candidateFrom = line.from + idx;
              const candidateTo = candidateFrom + misspelledWord.length;
              if (pos >= candidateFrom && pos <= candidateTo) {
                wordRange = { from: candidateFrom, to: candidateTo };
                break;
              }
              idx += Math.max(1, misspelledWord.length);
            }
          } catch {
            // Ignorar si posAtDOM no resuelve
          }
        }

        if (suggestions.length === 0) {
          items.push({
            title: t('editor.contextMenu.noSuggestions'),
            disabled: true,
          });
        } else {
          for (const sug of suggestions) {
            items.push({
              title: sug,
              icon: <Repeat size={14} />,
              action: () => {
                if (currentView && wordRange) {
                  currentView.dispatch({
                    changes: { from: wordRange.from, to: wordRange.to, insert: sug },
                    selection: { anchor: wordRange.from + sug.length },
                  });
                }
              },
            });
          }
        }

        items.push({
          title: t('editor.contextMenu.addToDictionary'),
          icon: <BookPlus size={14} />,
          action: () => {
            void useSettingsStore.getState().addWordToDictionary(misspelledWord);
            if (currentView) {
              currentView.dispatch({ effects: triggerSpellCheckEffect.of(true) });
            }
          },
        });

        items.push({ type: 'separator' });
      }
    }

    // Optional Wikilink Options if clicked specifically on a [[Wikilink]]
    if (clickedWikilink) {
      items.push(
        {
          title: t('editor.contextMenu.openLink'),
          icon: <ExternalLink size={14} />,
          action: () => onWikilinkClick(clickedWikilink!),
        },
        {
          title: t('editor.contextMenu.openInNewTab'),
          icon: <PlusCircle size={14} />,
          action: () => onOpenInNewTab?.(clickedWikilink!),
        },
        {
          title: t('editor.contextMenu.openToTheRight'),
          icon: <Columns size={14} />,
          action: () => onOpenToRight?.(clickedWikilink!),
        },
        {
          title: t('editor.contextMenu.copyUranoUrl'),
          icon: <Copy size={14} />,
          action: () => {
            navigator.clipboard.writeText(`[[${clickedWikilink}]]`);
            showNotice(t('editor.notices.linkCopied'), 2500, 'success');
          },
        },
        { type: 'separator' }
      );
    }

    // =========================================================================
    // BLOQUE 1 (Arriba - Enlaces + Bloque dinámico de selección)
    // =========================================================================
    items.push(
      {
        title: t('editor.contextMenu.addLink'),
        icon: <Link size={14} />,
        action: handleAddInternalLink,
      },
      {
        title: t('editor.contextMenu.addExternalLink'),
        icon: <ExternalLink size={14} />,
        action: handleAddExternalLink,
      }
    );

    if (hasSelection && selectedText.trim()) {
      const querySnippet =
        selectedText.trim().length > 25
          ? `${selectedText.trim().slice(0, 22)}...`
          : selectedText.trim();
      const safeTitle = querySnippet.replace(/\n+/g, ' ');

      items.push(
        {
          title: t('editor.contextMenu.search', { query: safeTitle }),
          icon: <Search size={14} />,
          action: () => handleSearchSelection(selectedText.trim()),
        },
        {
          title: t('editor.contextMenu.extractSelection'),
          icon: <FolderInput size={14} />,
          action: () =>
            handleExtractSelection(
              selectedText,
              activeSel!.from,
              activeSel!.to
            ),
        }
      );
    }

    items.push({ type: 'separator' });

    // =========================================================================
    // BLOQUE 2 (Centro - Los 3 Submenús en este orden exacto)
    // 1. Formato (Paintbrush con chevron >)
    // 2. Párrafo (Pilcrow ¶ con chevron >)
    // 3. Insertar (ListPlus con chevron >)
    // =========================================================================
    items.push(
      {
        title: t('editor.contextMenu.format'),
        icon: <Paintbrush size={14} />,
        submenu: [
          {
            title: t('editor.formatting.bold'),
            icon: <Bold size={14} />,
            action: () => toggleInlineFormatting('**', '__'),
          },
          {
            title: t('editor.formatting.italic'),
            icon: <Italic size={14} />,
            action: () => toggleInlineFormatting('*', '_'),
          },
          {
            title: t('editor.formatting.strikethrough'),
            icon: <Strikethrough size={14} />,
            action: () => toggleInlineFormatting('~~'),
          },
          {
            title: t('editor.formatting.highlight'),
            icon: <Highlighter size={14} />,
            submenu: [
              {
                title: t('editor.highlightColor.default'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-yellow-600/40"
                    style={{ backgroundColor: 'rgba(255, 208, 0, 0.9)' }}
                  />
                ),
                action: () => applyHighlight('default'),
              },
              {
                title: t('editor.highlightColor.red'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-red-600/40"
                    style={{ backgroundColor: '#ef4444' }}
                  />
                ),
                action: () => applyHighlight('red'),
              },
              {
                title: t('editor.highlightColor.orange'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-orange-600/40"
                    style={{ backgroundColor: '#f97316' }}
                  />
                ),
                action: () => applyHighlight('orange'),
              },
              {
                title: t('editor.highlightColor.yellow'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-yellow-600/40"
                    style={{ backgroundColor: '#eab308' }}
                  />
                ),
                action: () => applyHighlight('yellow'),
              },
              {
                title: t('editor.highlightColor.green'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-green-600/40"
                    style={{ backgroundColor: '#22c55e' }}
                  />
                ),
                action: () => applyHighlight('green'),
              },
              {
                title: t('editor.highlightColor.blue'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-blue-600/40"
                    style={{ backgroundColor: '#3b82f6' }}
                  />
                ),
                action: () => applyHighlight('blue'),
              },
              {
                title: t('editor.highlightColor.purple'),
                icon: (
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-purple-600/40"
                    style={{ backgroundColor: '#a855f7' }}
                  />
                ),
                action: () => applyHighlight('purple'),
              },
            ],
          },
          { type: 'separator' },
          {
            title: t('editor.formatting.code'),
            icon: <Code size={14} />,
            action: () => toggleInlineFormatting('`'),
          },
          {
            title: t('editor.formatting.math'),
            icon: <Sigma size={14} />,
            action: () => toggleInlineFormatting('$'),
          },
          {
            title: t('editor.formatting.comment'),
            icon: <MessageSquare size={14} />,
            action: () => toggleInlineFormatting('%%'),
          },
          { type: 'separator' },
          {
            title: t('editor.formatting.clearFormatting'),
            icon: <Eraser size={14} />,
            action: handleClearFormatting,
          },
        ],
      },
      {
        title: t('editor.contextMenu.paragraph'),
        icon: <Pilcrow size={14} />,
        submenu: [
          {
            title: t('editor.paragraph.body'),
            icon: <Pilcrow size={14} />,
            action: () => applyParagraphPrefix('body'),
          },
          {
            title: t('editor.paragraph.heading', { level: 1 }),
            icon: <Heading1 size={14} />,
            action: () => applyParagraphPrefix('h1'),
          },
          {
            title: t('editor.paragraph.heading', { level: 2 }),
            icon: <Heading2 size={14} />,
            action: () => applyParagraphPrefix('h2'),
          },
          {
            title: t('editor.paragraph.heading', { level: 3 }),
            icon: <Heading3 size={14} />,
            action: () => applyParagraphPrefix('h3'),
          },
          {
            title: t('editor.paragraph.heading', { level: 4 }),
            icon: <Heading4 size={14} />,
            action: () => applyParagraphPrefix('h4'),
          },
          {
            title: t('editor.paragraph.heading', { level: 5 }),
            icon: <Heading5 size={14} />,
            action: () => applyParagraphPrefix('h5'),
          },
          {
            title: t('editor.paragraph.heading', { level: 6 }),
            icon: <Heading6 size={14} />,
            action: () => applyParagraphPrefix('h6'),
          },
          { type: 'separator' },
          {
            title: t('editor.paragraph.bulletList'),
            icon: <List size={14} />,
            action: () => applyParagraphPrefix('bullet'),
          },
          {
            title: t('editor.paragraph.numberedList'),
            icon: <ListOrdered size={14} />,
            action: () => applyParagraphPrefix('numbered'),
          },
          {
            title: t('editor.paragraph.taskList'),
            icon: <ListTodo size={14} />,
            action: () => applyParagraphPrefix('todo'),
          },
          {
            title: t('editor.paragraph.quote'),
            icon: <Quote size={14} />,
            action: () => applyParagraphPrefix('quote'),
          },
        ],
      },
      {
        title: t('editor.contextMenu.insert'),
        icon: <ListPlus size={14} />,
        submenu: [
          {
            title: t('editor.insert.footnote'),
            icon: <FilePen size={14} />,
            action: handleInsertFootnote,
          },
          {
            title: t('editor.insert.table'),
            icon: <Table size={14} />,
            action: handleInsertTable,
          },
          {
            title: t('editor.insert.callout'),
            icon: <Quote size={14} />,
            action: handleInsertCallout,
          },
          {
            title: t('editor.insert.horizontalRule'),
            icon: <Minus size={14} />,
            action: handleInsertHr,
          },
          { type: 'separator' },
          {
            title: t('editor.insert.codeBlock'),
            icon: <Code size={14} />,
            action: handleInsertCode,
          },
          {
            title: t('editor.insert.mathBlock'),
            icon: <SquareSigma size={14} />,
            action: handleInsertMath,
          },
          {
            title: t('editor.insert.newBase'),
            icon: <TableProperties size={14} />,
            action: handleInsertNewBase,
          },
        ],
      }
    );

    items.push({ type: 'separator' });

    // =========================================================================
    // BLOQUE 3 (Abajo - Portapapeles con iconos exactos y estado deshabilitado)
    // 1. Cortar (Scissors, deshabilitado si no hay selección)
    // 2. Copiar (Copy, deshabilitado si no hay selección)
    // 3. Pegar (ClipboardCheck)
    // 4. Pegar sin formato (ClipboardType)
    // 5. Seleccionar todo (SquareDashed)
    // =========================================================================
    items.push(
      {
        title: t('common.cut'),
        icon: <Scissors size={14} />,
        disabled: !hasSelection,
        action: handleCut,
      },
      {
        title: t('common.copy'),
        icon: <Copy size={14} />,
        disabled: !hasSelection,
        action: handleCopy,
      },
      {
        title: t('common.paste'),
        icon: <ClipboardCheck size={14} />,
        action: handlePaste,
      },
      {
        title: t('editor.contextMenu.pastePlainText'),
        icon: <ClipboardType size={14} />,
        action: handlePastePlainText,
      },
      {
        title: t('editor.contextMenu.selectAll'),
        icon: <SquareDashed size={14} />,
        action: handleSelectAll,
      }
    );

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-obsidian-muted p-8 text-center bg-obsidian-bg">
        <FileText className="w-16 h-16 mb-4 text-obsidian-border stroke-1" />
        <h2 className="text-xl font-medium text-obsidian-text mb-2">
          {t('editor.emptyState.noFileOpen')}
        </h2>
        <p className="text-sm max-w-sm text-obsidian-muted">{t('editor.emptyState.hint')}</p>
      </div>
    );
  }

  return (
    <div
      onContextMenu={handleContextMenu}
      className="flex-1 flex flex-col h-full bg-obsidian-bg overflow-hidden relative"
    >
      {/* Clean Document Canvas */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {isLoading && (
          <div className="absolute inset-0 bg-obsidian-bg/50 backdrop-blur-[1px] flex items-center justify-center z-20">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
          </div>
        )}

        {editorMode === 'reading' ? (
          /* Reading View Mode */
          <div className="h-full overflow-y-auto px-12 py-10 max-w-[var(--file-line-width,820px)] mx-auto text-obsidian-text leading-relaxed font-sans">
            {showInlineTitle && (
              <h1 className="text-3xl font-bold text-obsidian-text mb-6 border-b border-obsidian-border pb-3">
                {cleanTitle}
              </h1>
            )}
            <div className="whitespace-pre-wrap select-text">
              {strictLineBreaks
                ? // Markdown spec: a single newline is a soft break (rendered as a space)
                  fileContent.replace(/([^\n])\n(?!\n)/g, '$1 ')
                : fileContent}
            </div>
          </div>
        ) : (
          /* Live Preview / Source Mode (CodeMirror 6) */
          <div
            className={`flex-1 flex flex-col h-full overflow-hidden relative ${
              editorMode === 'source' ? 'source-mode' : ''
            }`}
          >
            {/* Inline Title (.inline-title) directly above the CodeMirror 6 canvas */}
            <div
              className={`w-full max-w-[var(--file-line-width,820px)] mx-auto px-12 pt-6 shrink-0${
                showInlineTitle ? '' : ' hidden'
              }`}
            >
              <input
                ref={inlineTitleRef}
                type="text"
                className="inline-title"
                value={draftTitle}
                spellCheck={spellcheck}
                autoCorrect="on"
                autoCapitalize="on"
                lang={language}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleBlur}
              />
            </div>

            {/* CodeMirror 6 Editor Canvas */}
            <div ref={editorRef} className="flex-1 min-h-0" />
          </div>
        )}
      </div>

      {/* Floating Obsidian [[ Wikilink Suggestion Dropdown */}
      {showSuggest && availableNotes.length > 0 && (
        <div
          className="fixed z-50 w-64 bg-obsidian-sidebar border border-orange-500/30 rounded-lg shadow-2xl shadow-black/80 overflow-hidden text-xs select-none animate-fadeIn"
          style={{ top: `${suggestCoords.top}px`, left: `${suggestCoords.left}px` }}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-orange-400/80 border-b border-obsidian-border font-semibold bg-obsidian-sidebar">
            {t('editor.suggest.linkToNote')}
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
                    : 'text-obsidian-text hover:bg-[var(--interactive-hover)]'
                }`}
              >
                <FileText
                  size={12}
                  className={idx === suggestIndex ? 'text-orange-400' : 'text-obsidian-faint'}
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

      {/* Full-screen image Lightbox (zoom button / Ctrl+click) */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          activeIndex={lightbox.activeIndex}
          onClose={() => setLightbox(null)}
          onOpenInNewTab={onOpenInNewTab}
        />
      )}
    </div>
  );
};
