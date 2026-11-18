import React, { useState, useEffect, useRef } from 'react';
import { Search, Command, FileText, LayoutDashboard, LayoutList, Pin } from 'lucide-react';
import { FileItem } from '../../types';
import {
  useVaultStore,
  flattenVaultFiles,
  extractUnresolvedWikilinks,
} from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT, useLocaleStore } from '../../stores/localeStore';
import { HOTKEY_CATALOG, getActiveHotkeys } from '../../services/hotkeyRegistry';
import { getRelativeVaultPath } from '../../utils/pathUtils';
import {
  buildQuickSwitcherFileEntries,
  buildQuickSwitcherEntries,
} from './QuickSwitcher';

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

  const { activeVault, createNote, files, notesContentMap, activeFile, fileContent } =
    useVaultStore();

  const userIgnoreFilters = useSettingsStore((s) => s.settings.userIgnoreFilters) || [];
  const showAttachments = useSettingsStore((s) => s.settings.quickSwitcherShowAttachments);
  const showExistingOnly = useSettingsStore((s) => s.settings.quickSwitcherShowExistingOnly);
  const pinnedCommandIds = useSettingsStore((s) => s.settings.pinnedCommands) || [];
  const customHotkeys = useSettingsStore((s) => s.settings.hotkeys) || {};
  const currentLang =
    useLocaleStore((s) => s.locale) || useSettingsStore((s) => s.settings.language) || 'es';
  const isEs = currentLang.toLowerCase().startsWith('es');

  const sourceFiles = React.useMemo(
    () => (files.length > 0 ? files : flattenVaultFiles(fileTree)),
    [files, fileTree]
  );

  // Flatten and filter vault documents + attachments (respecting quickSwitcherShowAttachments)
  const allFiles = React.useMemo(
    () =>
      buildQuickSwitcherFileEntries({
        files: sourceFiles,
        vaultPath: activeVault || '',
        userIgnoreFilters,
        showAttachments,
      }),
    [sourceFiles, activeVault, userIgnoreFilters, showAttachments]
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const pinnedSet = React.useMemo(() => new Set(pinnedCommandIds), [pinnedCommandIds]);

  const { pinnedCommandItems, unpinnedCommandItems, orderedCommands } = React.useMemo(() => {
    const q = query.toLowerCase();
    const matchesQuery = (c: CommandItem) => !q || c.name.toLowerCase().includes(q);

    const byId = new Map<string, CommandItem>();
    for (const c of commands) {
      if (!byId.has(c.id)) {
        byId.set(c.id, c);
      }
    }

    const catalogById = new Map(HOTKEY_CATALOG.map((c) => [c.id, c]));

    const pinned: CommandItem[] = [];
    const seenIds = new Set<string>();

    for (const pinnedId of pinnedCommandIds) {
      if (seenIds.has(pinnedId)) continue;
      let resolved = byId.get(pinnedId);
      if (!resolved) {
        const hc = catalogById.get(pinnedId);
        if (hc) {
          resolved = {
            id: hc.id,
            name: isEs ? hc.nameEs : hc.nameEn,
            shortcut: hc.defaultHotkeys[0],
            icon: <Command size={15} />,
            action: () => {},
          };
        }
      }
      if (resolved) {
        seenIds.add(pinnedId);
        if (matchesQuery(resolved)) {
          pinned.push(resolved);
        }
      }
    }

    const unpinned: CommandItem[] = [];
    for (const c of commands) {
      if (pinnedSet.has(c.id) || seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      if (matchesQuery(c)) {
        unpinned.push(c);
      }
    }

    return {
      pinnedCommandItems: pinned,
      unpinnedCommandItems: unpinned,
      orderedCommands: [...pinned, ...unpinned],
    };
  }, [commands, pinnedCommandIds, pinnedSet, query, isEs]);

  const unresolvedLinks = React.useMemo(() => {
    if (!isOpen || mode !== 'files' || showExistingOnly) return [];
    return extractUnresolvedWikilinks(
      notesContentMap,
      sourceFiles,
      activeVault || null,
      activeFile,
      fileContent
    );
  }, [isOpen, mode, showExistingOnly, notesContentMap, sourceFiles, activeVault, activeFile, fileContent]);

  if (!isOpen) return null;

  const filteredFiles = buildQuickSwitcherEntries({
    fileEntries: allFiles,
    unresolvedLinks,
    showExistingOnly,
    query,
  });

  const items = mode === 'commands' ? orderedCommands : filteredFiles;

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
        className="prompt w-[580px] max-w-[94vw] bg-urano-bg border border-urano-border rounded-xl shadow-2xl shadow-black/90 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-urano-border bg-urano-sidebar">
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
            className="flex-1 text-sm text-urano-text bg-transparent outline-none placeholder:text-urano-faint font-sans"
          />
        </div>

        {/* Results List */}
        <div className="max-h-[340px] overflow-y-auto p-1.5 flex flex-col gap-0.5">
          {items.length === 0 ? (
            <div className="p-8 text-center text-urano-faint text-xs">
              {mode === 'files' && query.trim() ? (
                <div>
                  <p className="text-urano-text mb-1">
                    {t('commandPalette.notFound', { query })}
                  </p>
                  <p className="text-urano-faint text-[11px]">
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
            (items as CommandItem[]).map((cmd, i) => {
              const isPinned = pinnedSet.has(cmd.id);
              const activeShortcut =
                cmd.id in customHotkeys
                  ? getActiveHotkeys(cmd.id, customHotkeys)[0]
                  : cmd.shortcut || getActiveHotkeys(cmd.id, customHotkeys)[0];
              const showSeparatorAfter =
                pinnedCommandItems.length > 0 &&
                unpinnedCommandItems.length > 0 &&
                i === pinnedCommandItems.length - 1;
              return (
                <React.Fragment key={cmd.id}>
                  <div
                    onClick={() => {
                      cmd.action();
                      onClose();
                    }}
                    className={`suggestion-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      i === selectedIndex
                        ? 'is-selected'
                        : 'text-urano-text hover:bg-[var(--interactive-hover)]'
                    }`}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-urano-muted">
                        {cmd.icon}
                      </span>
                      <span className="font-medium">{cmd.name}</span>
                    </div>
                    {(isPinned || activeShortcut) && (
                      <div className="command-palette-right-meta">
                        {activeShortcut && (
                          <span className="text-[10px] text-urano-muted font-mono bg-[var(--interactive-normal)] px-2 py-0.5 rounded border border-urano-border">
                            {activeShortcut}
                          </span>
                        )}
                        {isPinned && (
                          <Pin
                            size={13}
                            className="command-palette-pin-icon"
                            aria-label={t('commandPalette.pinned')}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {showSeparatorAfter && (
                    <div className="command-palette-pinned-separator" role="separator" />
                  )}
                </React.Fragment>
              );
            })
          ) : (
            (items as typeof allFiles).map((file, i) => {
              const isSelected = i === selectedIndex;
              const rel = getRelativeVaultPath(file.path, activeVault || '');
              const isSubfolder = rel.includes('/');
              const isMarkdown = file.ext === 'md' || file.ext === 'markdown';
              const displayName = isMarkdown
                ? (isSubfolder ? rel.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || file.basename : rel?.replace(/\.(md|markdown)$/i, '') || file.basename)
                : file.name;

              return (
                <div
                  key={file.path}
                  onClick={() => {
                    onSelectFile(file.path);
                    onClose();
                  }}
                  className={`suggestion-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                    isSelected
                      ? 'is-selected'
                      : 'text-urano-text hover:bg-[var(--interactive-hover)]'
                  }`}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {file.ext === 'canvas' ? (
                      <LayoutDashboard
                        size={14}
                        className="text-urano-muted shrink-0"
                      />
                    ) : file.ext === 'base' ? (
                      <LayoutList
                        size={14}
                        className="text-urano-muted shrink-0"
                      />
                    ) : (
                      <FileText
                        size={14}
                        className="text-urano-muted shrink-0"
                      />
                    )}
                    <span className="font-medium truncate">{displayName}</span>
                    {file.ext === 'canvas' && <span className="nav-file-tag">CANVAS</span>}
                    {file.ext === 'base' && <span className="nav-file-tag">BASE</span>}
                    {!isMarkdown && file.ext !== 'canvas' && file.ext !== 'base' && file.ext && (
                      <span className="nav-file-tag uppercase">{file.ext}</span>
                    )}
                  </div>
                  {isSubfolder && (
                    <span className="text-[10px] text-urano-faint truncate max-w-[240px] ml-2 font-mono">
                      {rel}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Keyboard Instruction Bar (1:1 with Urano) */}
        <div className="prompt-instructions select-none">
          <span className="flex items-center gap-1">
            <span className="font-mono bg-[var(--interactive-normal)] text-urano-text px-1 py-0.2 rounded border border-urano-border">
              ↑↓
            </span>{' '}
            {t('commandPalette.toNavigate')}
          </span>
          <span className="flex items-center gap-1">
            <span className="font-mono bg-[var(--interactive-normal)] text-urano-text px-1 py-0.2 rounded border border-urano-border">
              ↵
            </span>{' '}
            {t('commandPalette.toOpen')}
          </span>
          {mode === 'files' && (
            <>
              <span className="flex items-center gap-1">
                <span className="font-mono bg-[var(--interactive-normal)] text-urano-text px-1 py-0.2 rounded border border-urano-border">
                  Ctrl + ↵
                </span>{' '}
                {t('commandPalette.toOpenInNewTab')}
              </span>
              <span className="flex items-center gap-1">
                <span className="font-mono bg-[var(--interactive-normal)] text-urano-text px-1 py-0.2 rounded border border-urano-border">
                  Shift + ↵
                </span>{' '}
                {t('commandPalette.toCreate')}
              </span>
            </>
          )}
          <span className="flex items-center gap-1">
            <span className="font-mono bg-[var(--interactive-normal)] text-urano-text px-1 py-0.2 rounded border border-urano-border">
              Esc
            </span>{' '}
            {t('commandPalette.toDismiss')}
          </span>
        </div>
      </div>
    </div>
  );
};
