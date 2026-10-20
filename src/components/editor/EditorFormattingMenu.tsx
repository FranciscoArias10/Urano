import React, { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import {
  Highlighter,
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Sigma,
  Quote,
  Link,
} from 'lucide-react';

export interface FormattingMenuProps {
  view: EditorView | null;
  isOpen: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export const EditorFormattingMenu: React.FC<FormattingMenuProps> = ({
  view,
  isOpen,
  position,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || !position || !view) return null;

  // Helper to wrap selected text with prefix & suffix (e.g. **bold**, ==highlight==, etc.)
  const applyInlineWrap = (prefix: string, suffix: string, defaultPlaceholder = 'texto') => {
    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to);

    if (selection.empty) {
      const pos = selection.head;
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      const relPos = pos - line.from;

      let targetWord: { from: number; to: number; text: string } | null = null;
      const wordAtPos = view.state.wordAt(pos);
      if (wordAtPos && wordAtPos.from >= line.from && wordAtPos.to <= line.to) {
        targetWord = {
          from: wordAtPos.from,
          to: wordAtPos.to,
          text: view.state.sliceDoc(wordAtPos.from, wordAtPos.to),
        };
      } else {
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
        view.dispatch({
          changes: {
            from: targetWord.from,
            to: targetWord.to,
            insert: `${prefix}${targetWord.text}${suffix}`,
          },
          selection: {
            anchor: pos >= targetWord.to ? pos + prefix.length + suffix.length : pos + prefix.length,
          },
        });
      } else {
        const insertText = defaultPlaceholder
          ? `${prefix}${defaultPlaceholder}${suffix}`
          : `${prefix}${suffix}`;
        view.dispatch({
          changes: { from: pos, insert: insertText },
          selection: defaultPlaceholder
            ? {
                anchor: pos + prefix.length,
                head: pos + prefix.length + defaultPlaceholder.length,
              }
            : { anchor: pos + prefix.length },
        });
      }
    } else {
      // Check if already wrapped, if so unwrap
      const beforeLen = prefix.length;
      const afterLen = suffix.length;
      const docBefore = view.state.sliceDoc(Math.max(0, selection.from - beforeLen), selection.from);
      const docAfter = view.state.sliceDoc(selection.to, selection.to + afterLen);

      if (docBefore === prefix && docAfter === suffix) {
        // Unwrap
        view.dispatch({
          changes: [
            { from: selection.to, to: selection.to + afterLen, insert: '' },
            { from: selection.from - beforeLen, to: selection.from, insert: '' },
          ],
        });
      } else {
        // Wrap
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: `${prefix}${selectedText}${suffix}` },
          selection: { anchor: selection.from + prefix.length, head: selection.to + prefix.length },
        });
      }
    }
    view.focus();
    onClose();
  };

  // Helper to prefix lines with #, ##, -, 1., >
  const applyLinePrefix = (prefix: string) => {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.from);
    const lineText = line.text;

    // Remove existing heading/list prefix if present
    const cleanedText = lineText.replace(/^(#{1,6}\s+|-\s+\[[ x]\]\s+|-\s+|\d+\.\s+|>\s+)/, '');
    const newText = `${prefix}${cleanedText}`;

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
    });
    view.focus();
    onClose();
  };

  const applyMathBlock = () => {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.from);
    const selectedText = view.state.sliceDoc(selection.from, selection.to) || 'E = mc^2';
    const prefix = line.text.trim().length > 0 ? '\n$$\n' : '$$\n';
    const mathBlock = `${prefix}${selectedText}\n$$\n`;

    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: mathBlock },
      selection: { anchor: selection.from + prefix.length, head: selection.from + prefix.length + selectedText.length },
    });
    view.focus();
    onClose();
  };

  const applyCodeBlock = () => {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.from);
    const selectedText = view.state.sliceDoc(selection.from, selection.to) || '// escribe tu código aquí';
    const prefix = line.text.trim().length > 0 ? '\n```javascript\n' : '```javascript\n';
    const codeBlock = `${prefix}${selectedText}\n\`\`\`\n`;

    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: codeBlock },
      selection: { anchor: selection.from + prefix.length, head: selection.from + prefix.length + selectedText.length },
    });
    view.focus();
    onClose();
  };

  // Keep menu inside viewport boundaries
  const menuWidth = 260;
  const menuHeight = 360;
  const adjustedX = Math.min(position.x, window.innerWidth - menuWidth - 16);
  const adjustedY = Math.min(position.y, window.innerHeight - menuHeight - 16);

  return (
    <div
      ref={menuRef}
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-50 bg-obsidian-sidebar border border-obsidian-border rounded-xl shadow-2xl p-1.5 w-64 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 text-xs select-none"
    >
      <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wider text-obsidian-muted border-b border-obsidian-border/50 mb-1 flex items-center justify-between">
        <span>Formato de Texto</span>
        <span className="text-orange-500 font-semibold">Urano</span>
      </div>

      {/* Inline styles group */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-obsidian-bg rounded-lg mb-1.5 border border-obsidian-border/40">
        <button
          onClick={() => applyInlineWrap('==', '==', 'resaltado')}
          className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-orange-500/20 text-orange-400 hover:text-orange-300 transition-colors"
          title="Resaltar texto (==texto==)"
        >
          <Highlighter className="w-4 h-4" />
          <span className="text-[9px] mt-0.5">Resaltar</span>
        </button>
        <button
          onClick={() => applyInlineWrap('**', '**', 'negrita')}
          className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors"
          title="Negrita (**texto**)"
        >
          <Bold className="w-4 h-4" />
          <span className="text-[9px] mt-0.5">Negrita</span>
        </button>
        <button
          onClick={() => applyInlineWrap('*', '*', 'cursiva')}
          className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors"
          title="Cursiva (*texto*)"
        >
          <Italic className="w-4 h-4" />
          <span className="text-[9px] mt-0.5">Cursiva</span>
        </button>
        <button
          onClick={() => applyInlineWrap('~~', '~~', 'tachado')}
          className="flex flex-col items-center justify-center p-1.5 rounded hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors"
          title="Tachado (~~texto~~)"
        >
          <Strikethrough className="w-4 h-4" />
          <span className="text-[9px] mt-0.5">Tachado</span>
        </button>
      </div>

      {/* Headings */}
      <div className="space-y-0.5 mb-1.5">
        <div className="px-2 py-0.5 text-[10px] text-obsidian-muted font-medium">Tamaño / Encabezados</div>
        <button
          onClick={() => applyLinePrefix('# ')}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-orange-500/10 hover:text-orange-300 text-obsidian-text transition-colors text-left"
        >
          <Heading1 className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="font-bold text-sm">Título Principal (H1)</span>
        </button>
        <button
          onClick={() => applyLinePrefix('## ')}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-orange-500/10 hover:text-orange-300 text-obsidian-text transition-colors text-left"
        >
          <Heading2 className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="font-semibold text-xs">Subtítulo (H2)</span>
        </button>
        <button
          onClick={() => applyLinePrefix('### ')}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-orange-500/10 hover:text-orange-300 text-obsidian-text transition-colors text-left"
        >
          <Heading3 className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="font-medium text-xs">Sección (H3)</span>
        </button>
      </div>

      {/* Lists & Bullets */}
      <div className="space-y-0.5 mb-1.5 border-t border-obsidian-border/50 pt-1">
        <div className="px-2 py-0.5 text-[10px] text-obsidian-muted font-medium">Listas y Viñetas</div>
        <button
          onClick={() => applyLinePrefix('- ')}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors text-left"
        >
          <List className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Lista con viñetas</span>
        </button>
        <button
          onClick={() => applyLinePrefix('1. ')}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors text-left"
        >
          <ListOrdered className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Lista numerada</span>
        </button>
        <button
          onClick={() => applyLinePrefix('- [ ] ')}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors text-left"
        >
          <CheckSquare className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <span>Lista de tareas (checkbox)</span>
        </button>
      </div>

      {/* Math, Code & Advanced */}
      <div className="space-y-0.5 border-t border-obsidian-border/50 pt-1">
        <div className="px-2 py-0.5 text-[10px] text-obsidian-muted font-medium">Ecuaciones y Código</div>
        <button
          onClick={applyMathBlock}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors text-left"
        >
          <Sigma className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          <span>Ecuación matemática ($$...)</span>
        </button>
        <button
          onClick={applyCodeBlock}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors text-left"
        >
          <Code className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <span>Bloque de código (```)</span>
        </button>
        <button
          onClick={() => applyInlineWrap('[[', ']]', 'Nota')}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-orange-500/10 text-orange-400 hover:text-orange-300 transition-colors text-left font-medium"
        >
          <Link className="w-3.5 h-3.5 shrink-0" />
          <span>Enlace bidireccional [[...]]</span>
        </button>
        <button
          onClick={() => applyLinePrefix('> ')}
          className="w-full flex items-center gap-2.5 px-2 py-1 rounded-lg hover:bg-obsidian-hover text-obsidian-text hover:text-white transition-colors text-left"
        >
          <Quote className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <span>Cita en bloque</span>
        </button>
      </div>
    </div>
  );
};
