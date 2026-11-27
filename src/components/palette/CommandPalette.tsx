import React, { useState, useEffect, useRef } from 'react';
import { Search, Command, Pin } from 'lucide-react';
import { FileItem } from '../../types';
import {
  useVaultStore,
  flattenVaultFiles,
  extractUnresolvedWikilinks,
} from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import { getActiveHotkeys } from '../../services/hotkeyRegistry';
import {
  buildQuickSwitcherFileEntries,
  buildQuickSwitcherEntries,
  QuickSwitcherItemRow,
  type QuickSwitcherEntry,
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

    const pinned: CommandItem[] = [];
    const seenIds = new Set<string>();

    // Only surface pinned commands that are actively registered & enabled (never synthesize no-ops)
    for (const pinnedId of pinnedCommandIds) {
      if (seenIds.has(pinnedId)) continue;
      const resolved = byId.get(pinnedId);
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
  }, [commands, pinnedCommandIds, pinnedSet, query]);

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

  const handleSelectSwitcherEntry = async (
    entry: QuickSwitcherEntry,
    openInNewTab = false
  ): Promise<boolean> => {
    if (entry.isUnresolved) {
      if (!activeVault) return false;
      const raw = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
      const hasFolder = raw.includes('/');
      const cleanRoot = activeVault.replace(/[\\/]+$/, '');
      const parentDir = hasFolder
        ? `${cleanRoot}/${raw.slice(0, raw.lastIndexOf('/'))}`
        : activeVault;
      const baseName = hasFolder ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
      const cleanTitle = baseName.toLowerCase().endsWith('.md') ? baseName : `${baseName}.md`;
      const newPath = await createNote(parentDir, cleanTitle);
      if (!newPath) return false;
      if (openInNewTab && onOpenInNewTab) onOpenInNewTab(newPath);
      else onSelectFile(newPath);
      return true;
    }

    if (openInNewTab && onOpenInNewTab) {
      onOpenInNewTab(entry.path);
    } else {
      onSelectFile(entry.path);
    }
    return true;
  };

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
        if (newPath) {
          onSelectFile(newPath);
          onClose();
        }
        return;
      }
    }

    // Ctrl + Enter: Open in new tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        if (mode === 'commands') {
          (items[selectedIndex] as CommandItem).action();
          onClose();
        } else {
          const ok = await handleSelectSwitcherEntry(items[selectedIndex] as QuickSwitcherEntry, true);
          if (ok) onClose();
        }
        return;
      }
    }

    // Enter: Open
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        if (mode === 'commands') {
          (items[selectedIndex] as CommandItem).action();
          onClose();
        } else {
          const ok = await handleSelectSwitcherEntry(items[selectedIndex] as QuickSwitcherEntry, false);
          if (ok) onClose();
        }
      } else if (mode === 'files' && query.trim() && activeVault) {
        // Fallback: create note if no matches
        const cleanTitle = query.trim().endsWith('.md') ? query.trim() : `${query.trim()}.md`;
        const newPath = await createNote(activeVault, cleanTitle);
        if (newPath) {
          onSelectFile(newPath);
          onClose();
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--background-modifier-cover)] backdrop-blur-[2px] flex items-start justify-center pt-[14vh] z-50 select-none animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="prompt w-[680px] max-w-[94vw] bg-urano-bg border border-urano-border rounded-xl shadow-2xl shadow-black/90 overflow-hidden flex flex-col"
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
            (items as QuickSwitcherEntry[]).map((file, i) => (
              <QuickSwitcherItemRow
                key={file.key}
                entry={file}
                isSelected={i === selectedIndex}
                unresolvedHint={t('commandPalette.createUnresolvedHint')}
                onHover={() => setSelectedIndex(i)}
                onSelect={async () => {
                  const ok = await handleSelectSwitcherEntry(file, false);
                  if (ok) onClose();
                }}
              />
            ))
          )}
        </div>

        {/* Bottom Keyboard Instruction Bar (1:1 with Urano) */}
        <div className="prompt-instructions select-none">
          <span className="prompt-instruction">
            <span className="prompt-instruction-command">↑↓</span>
            <span>{t('commandPalette.toNavigate')}</span>
          </span>
          <span className="prompt-instruction">
            <span className="prompt-instruction-command">↵</span>
            <span>{t('commandPalette.toOpen')}</span>
          </span>
          {mode === 'files' && (
            <>
              <span className="prompt-instruction">
                <span className="prompt-instruction-command">Ctrl + ↵</span>
                <span>{t('commandPalette.toOpenInNewTab')}</span>
              </span>
              <span className="prompt-instruction">
                <span className="prompt-instruction-command">Shift + ↵</span>
                <span>{t('commandPalette.toCreate')}</span>
              </span>
            </>
          )}
          <span className="prompt-instruction">
            <span className="prompt-instruction-command">Esc</span>
            <span>{t('commandPalette.toDismiss')}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
