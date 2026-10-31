import React, { useState, useEffect, useRef } from 'react';
import { Search, Command, FileText, LayoutDashboard, LayoutList } from 'lucide-react';
import { FileItem } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';

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
  onOpenInNewTab?: (filePath: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  mode,
  fileTree,
  commands,
  onClose,
  onSelectFile,
  onOpenInNewTab,
}) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { activeVault, createNote } = useVaultStore();

  // Flatten all files from fileTree
  const allFiles = React.useMemo(() => {
    const list: { name: string; path: string; basename: string; ext: string }[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (!item.isDir) {
          const extMatch = item.name.match(/\.(md|canvas|base|markdown)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : '';
          list.push({
            name: item.name,
            path: item.path,
            basename: item.name.replace(/\.(md|canvas|base|markdown)$/i, ''),
            ext,
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

  // "Press {key} to create this note": the key is rendered as a styled element, so the
  // translated sentence is split around the placeholder instead of concatenating fragments.
  const [createHintBefore, createHintAfter] = t('commandPalette.pressToCreate').split('{key}');

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
      return;
    }

    // Shift + Enter: Create note if doesn't exist
    if (e.shiftKey && e.key === 'Enter' && mode === 'files') {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed && activeVault) {
        const cleanTitle = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
        const newPath = await createNote(activeVault, cleanTitle);
        onSelectFile(newPath);
        onClose();
        return;
      }
    }

    // Ctrl + Enter: Open in new tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        if (mode === 'commands') {
          (items[selectedIndex] as CommandItem).action();
        } else {
          const target = items[selectedIndex] as (typeof allFiles)[0];
          if (onOpenInNewTab) onOpenInNewTab(target.path);
          else onSelectFile(target.path);
        }
        onClose();
        return;
      }
    }

    // Enter: Open
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        if (mode === 'commands') {
          (items[selectedIndex] as CommandItem).action();
        } else {
          onSelectFile((items[selectedIndex] as (typeof allFiles)[0]).path);
        }
        onClose();
      } else if (mode === 'files' && query.trim() && activeVault) {
        // Fallback: create note if no matches
        const cleanTitle = query.trim().endsWith('.md') ? query.trim() : `${query.trim()}.md`;
        const newPath = await createNote(activeVault, cleanTitle);
        onSelectFile(newPath);
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--background-modifier-cover)] backdrop-blur-[2px] flex items-start justify-center pt-[14vh] z-50 select-none animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-[580px] max-w-[94vw] bg-obsidian-bg border border-obsidian-border rounded-xl shadow-2xl shadow-black/90 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-obsidian-border bg-obsidian-sidebar">
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
                ? t('commandPalette.placeholderCommands')
                : t('commandPalette.placeholderFiles')
            }
            className="flex-1 text-sm text-obsidian-text bg-transparent outline-none placeholder:text-obsidian-faint font-sans"
          />
        </div>

        {/* Results List */}
        <div className="max-h-[340px] overflow-y-auto p-1.5 flex flex-col gap-0.5">
          {items.length === 0 ? (
            <div className="p-8 text-center text-obsidian-faint text-xs">
              {mode === 'files' && query.trim() ? (
                <div>
                  <p className="text-obsidian-text mb-1">
                    {t('commandPalette.notFound', { query })}
                  </p>
                  <p className="text-obsidian-faint text-[11px]">
                    {createHintBefore}
                    <span className="text-orange-400 font-mono">Shift + Enter</span>
                    {createHintAfter}
                  </p>
                </div>
              ) : (
                t('commandPalette.noMatches', { query })
              )}
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
                    ? 'bg-orange-500/15 text-white border border-orange-500/30'
                    : 'text-obsidian-text hover:bg-[var(--interactive-hover)]'
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-center gap-2.5">
                  <span className={i === selectedIndex ? 'text-orange-400' : 'text-obsidian-muted'}>
                    {cmd.icon}
                  </span>
                  <span className="font-medium">{cmd.name}</span>
                </div>
                {cmd.shortcut && (
                  <span className="text-[10px] text-obsidian-muted font-mono bg-[var(--interactive-normal)] px-2 py-0.5 rounded border border-obsidian-border">
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            ))
          ) : (
            (items as typeof allFiles).map((file, i) => {
              const isSelected = i === selectedIndex;
              return (
                <div
                  key={file.path}
                  onClick={() => {
                    onSelectFile(file.path);
                    onClose();
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                    isSelected
                      ? 'bg-orange-500/15 text-white border border-orange-500/30'
                      : 'text-obsidian-text hover:bg-[var(--interactive-hover)]'
                  }`}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {file.ext === 'canvas' ? (
                      <LayoutDashboard
                        size={14}
                        className={isSelected ? 'text-orange-400' : 'text-obsidian-muted'}
                      />
                    ) : file.ext === 'base' ? (
                      <LayoutList
                        size={14}
                        className={isSelected ? 'text-orange-400' : 'text-obsidian-muted'}
                      />
                    ) : (
                      <FileText
                        size={14}
                        className={isSelected ? 'text-orange-400' : 'text-obsidian-muted'}
                      />
                    )}
                    <span className="font-medium truncate">{file.basename}</span>
                    {file.ext === 'canvas' && <span className="nav-file-tag">CANVAS</span>}
                    {file.ext === 'base' && <span className="nav-file-tag">BASE</span>}
                  </div>
                  <span className="text-[10px] text-obsidian-faint truncate max-w-[200px] ml-2">
                    {file.path.split('/').slice(-2).join('/')}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Keyboard Instruction Bar (1:1 with Obsidian) */}
        <div className="px-4 py-2 border-t border-obsidian-border bg-obsidian-sidebar flex items-center justify-between text-[11px] text-obsidian-muted select-none">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="font-mono bg-[var(--interactive-normal)] text-obsidian-text px-1 py-0.2 rounded border border-obsidian-border">
                ↑↓
              </span>{' '}
              {t('commandPalette.toNavigate')}
            </span>
            <span className="flex items-center gap-1">
              <span className="font-mono bg-[var(--interactive-normal)] text-obsidian-text px-1 py-0.2 rounded border border-obsidian-border">
                ↵
              </span>{' '}
              {t('commandPalette.toOpen')}
            </span>
            {mode === 'files' && (
              <>
                <span className="flex items-center gap-1">
                  <span className="font-mono bg-[var(--interactive-normal)] text-obsidian-text px-1 py-0.2 rounded border border-obsidian-border">
                    Ctrl + ↵
                  </span>{' '}
                  {t('commandPalette.toOpenInNewTab')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-mono bg-[var(--interactive-normal)] text-obsidian-text px-1 py-0.2 rounded border border-obsidian-border">
                    Shift + ↵
                  </span>{' '}
                  {t('commandPalette.toCreate')}
                </span>
              </>
            )}
          </div>
          <span className="flex items-center gap-1">
            <span className="font-mono bg-[var(--interactive-normal)] text-obsidian-text px-1 py-0.2 rounded border border-obsidian-border">
              Esc
            </span>{' '}
            {t('commandPalette.toDismiss')}
          </span>
        </div>
      </div>
    </div>
  );
};
