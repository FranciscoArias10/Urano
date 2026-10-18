import React, { useState, useEffect, useRef } from 'react';
import { Search, Command, FileText } from 'lucide-react';
import { FileItem } from '../../types';

export interface CommandItem {
  id: string;
  name: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  mode: 'commands' | 'files';
  fileTree: FileItem[];
  commands: CommandItem[];
  onClose: () => void;
  onSelectFile: (filePath: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  mode,
  fileTree,
  commands,
  onClose,
  onSelectFile,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Flatten all markdown files from fileTree
  const allFiles = React.useMemo(() => {
    const list: { name: string; path: string; basename: string }[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (!item.isDir && item.name.endsWith('.md')) {
          list.push({
            name: item.name,
            path: item.path,
            basename: item.name.replace(/\.md$/i, ''),
          });
        }
        if (item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(fileTree);
    return list;
  }, [fileTree]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredCommands = commands.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  const filteredFiles = allFiles.filter(
    (f) =>
      f.basename.toLowerCase().includes(query.toLowerCase()) ||
      f.path.toLowerCase().includes(query.toLowerCase())
  );

  const items = mode === 'commands' ? filteredCommands : filteredFiles;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        if (mode === 'commands') {
          (items[selectedIndex] as CommandItem).action();
        } else {
          onSelectFile((items[selectedIndex] as (typeof allFiles)[0]).path);
        }
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-[3px] flex items-start justify-center pt-[12vh] z-50 select-none animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] bg-[#1a1714] border border-orange-500/25 rounded-xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-stone-800 bg-[#161412]">
          {mode === 'commands' ? (
            <Command size={16} className="text-orange-500 shrink-0" />
          ) : (
            <Search size={16} className="text-orange-500 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'commands'
                ? 'Escribe un comando de Urano (Obsidian Core)...'
                : 'Buscar nota en la bóveda (Quick Switcher)...'
            }
            className="flex-1 text-sm text-stone-100 bg-transparent outline-none placeholder:text-stone-500"
          />
          <span className="text-[11px] text-stone-500 font-mono bg-stone-900 px-1.5 py-0.5 rounded border border-stone-800">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-1.5 flex flex-col gap-0.5">
          {items.length === 0 ? (
            <div className="p-8 text-center text-stone-500 text-xs italic">
              No se encontraron coincidencias para "{query}"
            </div>
          ) : mode === 'commands' ? (
            (items as CommandItem[]).map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  onClose();
                }}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                  i === selectedIndex
                    ? 'bg-orange-600/20 text-white border border-orange-500/30'
                    : 'text-stone-300 hover:bg-stone-800/60'
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-center gap-2.5">
                  <span className={i === selectedIndex ? 'text-orange-400' : 'text-stone-400'}>
                    {cmd.icon}
                  </span>
                  <span className="font-medium">{cmd.name}</span>
                </div>
                {cmd.shortcut && (
                  <span className="text-[10px] text-stone-400 font-mono bg-stone-900/80 px-2 py-0.5 rounded border border-stone-800">
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            ))
          ) : (
            (items as typeof allFiles).map((file, i) => (
              <div
                key={file.path}
                onClick={() => {
                  onSelectFile(file.path);
                  onClose();
                }}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                  i === selectedIndex
                    ? 'bg-orange-600/20 text-white border border-orange-500/30'
                    : 'text-stone-300 hover:bg-stone-800/60'
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className={i === selectedIndex ? 'text-orange-400' : 'text-stone-400'} />
                  <span className="font-medium truncate">{file.basename}</span>
                </div>
                <span className="text-[10px] text-stone-500 truncate max-w-[200px] ml-2">
                  {file.path.split('/').slice(-2).join('/')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
