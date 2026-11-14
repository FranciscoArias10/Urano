import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, FileText, FolderInput, Merge } from 'lucide-react';
import type { FileItem } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import { useNoticeStore } from '../common/Notice';
import {
  getCleanFileName,
  getRelativeVaultPath,
  isPathExcluded,
  isSamePath,
} from '../../utils/pathUtils';
import {
  executeNoteExtraction,
  executeNoteMerge,
} from '../../services/noteComposerService';

export interface NoteComposerModalRequest {
  mode: 'extract' | 'merge';
  fromPath: string;
  extractedText?: string;
  initialQuery?: string;
  onExtracted?: (replacementText: string, targetPath: string, targetTitle: string) => void;
  onMerged?: (sourcePath: string, targetPath: string, targetTitle: string) => void;
}

interface NoteComposerModalProps {
  request: NoteComposerModalRequest | null;
  onClose: () => void;
}

interface CandidateNote {
  kind: 'existing';
  path: string;
  title: string;
  relPath: string;
}

interface CreateCandidate {
  kind: 'create';
  newNoteName: string;
  title: string;
}

type PickerOption = CandidateNote | CreateCandidate;

export const NoteComposerModal: React.FC<NoteComposerModalProps> = ({ request, onClose }) => {
  const t = useT();
  const fileTree = useVaultStore((s) => s.fileTree);
  const activeVault = useVaultStore((s) => s.activeVault);
  const userIgnoreFilters = useSettingsStore((s) => s.settings.userIgnoreFilters) || [];
  const confirmMerge = useSettingsStore((s) => s.settings.noteComposerConfirmMerge);
  const showNotice = useNoticeStore((s) => s.showNotice);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingMergeTarget, setPendingMergeTarget] = useState<{
    targetPath?: string;
    newNoteName?: string;
    displayTitle: string;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setQuery(request.initialQuery || '');
    setSelectedIndex(0);
    setPendingMergeTarget(null);
    setIsSubmitting(false);
    setTimeout(() => {
      inputRef.current?.focus();
      if (request.initialQuery) {
        inputRef.current?.select();
      }
    }, 30);
  }, [request]);

  const allNotes = useMemo(() => {
    const out: CandidateNote[] = [];
    const walk = (items: FileItem[]) => {
      for (const item of items) {
        if (item.isDir) {
          if (item.children?.length) walk(item.children);
          continue;
        }
        if (!item.name.toLowerCase().endsWith('.md')) continue;
        if (isPathExcluded(item.path, userIgnoreFilters)) continue;
        if (request?.mode === 'merge' && isSamePath(item.path, request.fromPath)) continue;

        const relPath = getRelativeVaultPath(item.path, activeVault || '');
        const title = getCleanFileName(item.path);
        out.push({
          kind: 'existing',
          path: item.path,
          title,
          relPath,
        });
      }
    };
    walk(fileTree);
    return out.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [fileTree, activeVault, userIgnoreFilters, request]);

  const options: PickerOption[] = useMemo(() => {
    const q = query.trim();
    const qLower = q.toLowerCase();
    const filtered = q
      ? allNotes.filter(
          (n) =>
            n.title.toLowerCase().includes(qLower) ||
            n.relPath.toLowerCase().includes(qLower)
        )
      : allNotes;

    const cleanTargetName = q.replace(/\.md$/i, '').trim();
    const exactMatch = filtered.some(
      (n) =>
        n.title.toLowerCase() === cleanTargetName.toLowerCase() ||
        n.relPath.toLowerCase() === cleanTargetName.toLowerCase()
    );
    const sameAsSource =
      request &&
      cleanTargetName.toLowerCase() === getCleanFileName(request.fromPath).toLowerCase();

    const list: PickerOption[] = [...filtered];
    if (cleanTargetName && !exactMatch && !sameAsSource) {
      list.push({
        kind: 'create',
        newNoteName: cleanTargetName,
        title: cleanTargetName,
      });
    }
    return list;
  }, [allNotes, query, request]);

  useEffect(() => {
    if (selectedIndex >= options.length) {
      setSelectedIndex(Math.max(0, options.length - 1));
    }
  }, [options.length, selectedIndex]);

  if (!request) return null;

  const fromTitle = getCleanFileName(request.fromPath);

  const runExtraction = async (targetPath?: string, newNoteName?: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await executeNoteExtraction({
        extractedText: request.extractedText || '',
        fromPath: request.fromPath,
        targetPath,
        newNoteName,
      });
      request.onExtracted?.(result.replacementText, result.targetPath, result.targetTitle);
      showNotice(t('editor.notices.noteExtracted', { name: result.targetTitle }), 2500, 'success');
      onClose();
    } catch (err) {
      console.error('[NoteComposer] Extract failed:', err);
      showNotice(t('editor.notices.noteExtractFailed'), 3000, 'error');
      setIsSubmitting(false);
    }
  };

  const runMerge = async (targetPath?: string, newNoteName?: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await executeNoteMerge({
        sourcePath: request.fromPath,
        targetPath,
        newNoteName,
      });
      request.onMerged?.(request.fromPath, result.targetPath, result.targetTitle);
      showNotice(t('noteComposer.mergedSuccess', { name: result.targetTitle }), 2500, 'success');
      onClose();
    } catch (err) {
      console.error('[NoteComposer] Merge failed:', err);
      showNotice(t('noteComposer.mergeFailed'), 3000, 'error');
      setIsSubmitting(false);
    }
  };

  const handleChooseOption = (option: PickerOption) => {
    if (request.mode === 'extract') {
      if (option.kind === 'existing') {
        void runExtraction(option.path, undefined);
      } else {
        void runExtraction(undefined, option.newNoteName);
      }
      return;
    }

    // Merge mode
    const targetPath = option.kind === 'existing' ? option.path : undefined;
    const newNoteName = option.kind === 'create' ? option.newNoteName : undefined;
    if (confirmMerge) {
      setPendingMergeTarget({
        targetPath,
        newNoteName,
        displayTitle: option.title,
      });
    } else {
      void runMerge(targetPath, newNoteName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pendingMergeTarget) {
        setPendingMergeTarget(null);
      } else {
        onClose();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (options.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % options.length);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + options.length) % options.length);
      }
      return;
    }

    if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      const trimmed = query.trim().replace(/\.md$/i, '');
      if (!trimmed) return;
      handleChooseOption({ kind: 'create', newNoteName: trimmed, title: trimmed });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = options[selectedIndex];
      if (chosen) {
        handleChooseOption(chosen);
      }
    }
  };

  if (pendingMergeTarget) {
    return (
      <div
        className="fixed inset-0 bg-[var(--background-modifier-cover)] backdrop-blur-[2px] flex items-center justify-center z-50 select-none animate-fadeIn"
        onClick={() => !isSubmitting && onClose()}
      >
        <div
          className="note-composer-confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-composer-confirm-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div id="note-composer-confirm-title" className="note-composer-confirm-title">
            {t('noteComposer.confirmMergeTitle')}
          </div>
          <p className="note-composer-confirm-message">
            {t('noteComposer.confirmMergeMessage', {
              from: fromTitle,
              to: pendingMergeTarget.displayTitle,
            })}
          </p>
          <div className="note-composer-confirm-actions">
            <button
              type="button"
              className="setting-button"
              disabled={isSubmitting}
              onClick={() => setPendingMergeTarget(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="setting-button mod-cta"
              disabled={isSubmitting}
              onClick={() =>
                void runMerge(pendingMergeTarget.targetPath, pendingMergeTarget.newNoteName)
              }
            >
              {t('noteComposer.confirmMergeAccept')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--background-modifier-cover)] backdrop-blur-[2px] flex items-start justify-center pt-[14vh] z-50 select-none animate-fadeIn"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="prompt note-composer-modal w-[580px] max-w-[94vw] bg-urano-bg border border-urano-border rounded-xl shadow-2xl shadow-black/90 overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={
          request.mode === 'extract'
            ? t('noteComposer.extractTitle')
            : t('noteComposer.mergeTitle')
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-urano-border bg-urano-sidebar">
          {request.mode === 'extract' ? (
            <FolderInput size={16} className="text-orange-500 shrink-0" />
          ) : (
            <Merge size={16} className="text-orange-500 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            disabled={isSubmitting}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              request.mode === 'extract'
                ? t('noteComposer.extractPlaceholder')
                : t('noteComposer.mergePlaceholder')
            }
            className="flex-1 text-sm text-urano-text bg-transparent outline-none placeholder:text-urano-faint font-sans"
          />
        </div>

        <div className="max-h-[340px] overflow-y-auto p-1.5 flex flex-col gap-0.5">
          {options.length === 0 ? (
            <div className="p-8 text-center text-urano-faint text-xs">
              {t('commandPalette.noMatches', { query })}
            </div>
          ) : (
            options.map((opt, idx) => {
              const isSelected = idx === selectedIndex;
              if (opt.kind === 'create') {
                return (
                  <div
                    key={`__create__:${opt.newNoteName}`}
                    onClick={() => handleChooseOption(opt)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`suggestion-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? 'is-selected'
                        : 'text-urano-text hover:bg-[var(--interactive-hover)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FilePlus2 size={14} className="text-orange-400 shrink-0" />
                      <span className="font-medium truncate">
                        {t('noteComposer.createNewNote', { name: opt.title })}
                      </span>
                    </div>
                    <span className="text-[10px] text-urano-faint font-mono ml-2 shrink-0">
                      Shift + Enter
                    </span>
                  </div>
                );
              }

              const isSubfolder = opt.relPath.includes('/');
              return (
                <div
                  key={opt.path}
                  onClick={() => handleChooseOption(opt)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`suggestion-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                    isSelected
                      ? 'is-selected'
                      : 'text-urano-text hover:bg-[var(--interactive-hover)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText size={14} className="text-urano-muted shrink-0" />
                    <span className="font-medium truncate">{opt.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {isSubfolder && (
                      <span className="text-[10px] text-urano-faint truncate max-w-[200px] font-mono">
                        {opt.relPath}
                      </span>
                    )}
                    <span className="text-[10px] text-urano-faint">
                      {t('noteComposer.appendToExisting')}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

