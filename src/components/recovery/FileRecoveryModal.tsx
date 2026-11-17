import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Copy, RotateCcw, Clock } from 'lucide-react';
import { useSettingsStore, type FileSnapshot } from '../../stores/settingsStore';
import { useVaultStore } from '../../stores/vaultStore';
import { useNoticeStore } from '../common/Notice';
import { useLocaleStore, useT } from '../../stores/localeStore';
import { getRelativeVaultPath, isSamePath } from '../../utils/pathUtils';

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/**
 * Computes a line-by-line diff between `oldText` and `newText` using LCS,
 * falling back to a bounded prefix/suffix diff for very large notes.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  const n = oldLines.length;
  const m = newLines.length;

  if (n * m > 1_200_000) {
    let prefix = 0;
    while (prefix < n && prefix < m && oldLines[prefix] === newLines[prefix]) {
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < n - prefix &&
      suffix < m - prefix &&
      oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]
    ) {
      suffix++;
    }
    const result: DiffLine[] = [];
    for (let i = 0; i < prefix; i++) result.push({ type: 'same', text: oldLines[i] });
    for (let i = prefix; i < n - suffix; i++) result.push({ type: 'del', text: oldLines[i] });
    for (let i = prefix; i < m - suffix; i++) result.push({ type: 'add', text: newLines[i] });
    for (let i = n - suffix; i < n; i++) result.push({ type: 'same', text: oldLines[i] });
    return result;
  }

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      diff.push({ type: 'same', text: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'del', text: oldLines[i] });
      i++;
    } else {
      diff.push({ type: 'add', text: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    diff.push({ type: 'del', text: oldLines[i] });
    i++;
  }
  while (j < m) {
    diff.push({ type: 'add', text: newLines[j] });
    j++;
  }
  return diff;
}

export function formatSnapshotTimestamp(timestamp: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale || 'es', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export interface FileRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface GroupedSnapshotFile {
  path: string;
  relPath: string;
  fileName: string;
  snapshots: FileSnapshot[];
}

export const FileRecoveryModal: React.FC<FileRecoveryModalProps> = ({ isOpen, onClose }) => {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale) || 'es';
  const fileSnapshots = useSettingsStore((s) => s.fileSnapshots);
  const { activeVault, activeFile, notesContentMap, updateNoteContent, selectFile } = useVaultStore();
  const showNotice = useNoticeStore((s) => s.showNotice);

  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [showDiff, setShowDiff] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filesWithSnapshots = useMemo<GroupedSnapshotFile[]>(() => {
    const map = new Map<string, FileSnapshot[]>();
    for (const snap of fileSnapshots) {
      const key = snap.path.replace(/\\/g, '/');
      const existing = map.get(key) || [];
      existing.push(snap);
      map.set(key, existing);
    }
    const groups: GroupedSnapshotFile[] = [];
    for (const [path, list] of map.entries()) {
      const sorted = [...list].sort((a, b) => b.timestamp - a.timestamp);
      const relPath = activeVault ? getRelativeVaultPath(path, activeVault) : path;
      const parts = relPath.split('/');
      const fileName = parts[parts.length - 1] || path;
      groups.push({ path, relPath, fileName, snapshots: sorted });
    }
    return groups.sort((a, b) => b.snapshots[0].timestamp - a.snapshots[0].timestamp);
  }, [fileSnapshots, activeVault]);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filesWithSnapshots;
    return filesWithSnapshots.filter(
      (f) => f.relPath.toLowerCase().includes(q) || f.fileName.toLowerCase().includes(q)
    );
  }, [filesWithSnapshots, query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setShowDiff(false);
    const activeMatch =
      activeFile && filesWithSnapshots.find((f) => isSamePath(f.path, activeFile));
    const initialFile = activeMatch || filesWithSnapshots[0];
    if (initialFile) {
      setSelectedPath(initialFile.path);
      setSelectedSnapshotId(initialFile.snapshots[0]?.id || '');
    } else {
      setSelectedPath('');
      setSelectedSnapshotId('');
    }
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [isOpen, activeFile, filesWithSnapshots]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectedFileGroup =
    filteredFiles.find((f) => isSamePath(f.path, selectedPath)) ||
    filteredFiles[0] ||
    null;

  const snapshots = selectedFileGroup?.snapshots || [];
  const selectedSnapshotIndex = Math.max(
    0,
    snapshots.findIndex((s) => s.id === selectedSnapshotId)
  );
  const selectedSnapshot = snapshots[selectedSnapshotIndex] || snapshots[0] || null;

  const currentNoteContent = (() => {
    if (!selectedFileGroup) return '';
    for (const [k, v] of Object.entries(notesContentMap)) {
      if (isSamePath(k, selectedFileGroup.path)) return v;
    }
    return '';
  })();

  const comparisonSnapshot = snapshots[selectedSnapshotIndex + 1] || null;
  const diffBaseline = comparisonSnapshot ? comparisonSnapshot.content : currentNoteContent;
  const diffLines =
    showDiff && selectedSnapshot
      ? computeLineDiff(diffBaseline, selectedSnapshot.content)
      : [];

  const handleCopy = async () => {
    if (!selectedSnapshot) return;
    try {
      await navigator.clipboard.writeText(selectedSnapshot.content);
      showNotice(t('fileRecoveryModal.copiedNotice'), 2000, 'success');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = selectedSnapshot.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showNotice(t('fileRecoveryModal.copiedNotice'), 2000, 'success');
    }
  };

  const handleRestore = async () => {
    if (!selectedSnapshot) return;
    try {
      await updateNoteContent(selectedSnapshot.path, selectedSnapshot.content);
      if (useVaultStore.getState().activeVault) {
        await useVaultStore.getState().refreshTree();
        if (!activeFile || !isSamePath(activeFile, selectedSnapshot.path)) {
          await selectFile(selectedSnapshot.path);
        }
      }
      showNotice(t('fileRecoveryModal.restoredNotice'), 2500, 'success');
      onClose();
    } catch (err) {
      console.error('Error al restaurar captura:', err);
    }
  };

  return (
    <div
      className="file-recovery-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="file-recovery-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('fileRecoveryModal.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="file-recovery-modal-header">
          <div className="file-recovery-modal-title">{t('fileRecoveryModal.title')}</div>
          <button
            type="button"
            className="clickable-icon file-recovery-close-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="file-recovery-search-bar">
          <Search size={15} className="file-recovery-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('fileRecoveryModal.searchPlaceholder')}
            className="file-recovery-search-input"
          />
          {query && (
            <button
              type="button"
              className="clickable-icon file-recovery-clear-btn"
              aria-label={t('common.close')}
              onClick={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {filesWithSnapshots.length === 0 ? (
          <div className="file-recovery-empty-state">
            <Clock size={28} />
            <p>{t('fileRecoveryModal.noSnapshots')}</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="file-recovery-empty-state">
            <p>{t('fileRecoveryModal.noMatchingFiles')}</p>
          </div>
        ) : (
          <>
            {/* Filtered File Selector List */}
            <div className="file-recovery-file-chips" role="listbox" aria-label={t('fileRecoveryModal.title')}>
              {filteredFiles.map((file) => {
                const isActiveFile = selectedFileGroup && isSamePath(file.path, selectedFileGroup.path);
                return (
                  <button
                    key={file.path}
                    type="button"
                    role="option"
                    aria-selected={Boolean(isActiveFile)}
                    className={`file-recovery-file-chip${isActiveFile ? ' is-selected' : ''}`}
                    title={file.relPath}
                    onClick={() => {
                      setSelectedPath(file.path);
                      setSelectedSnapshotId(file.snapshots[0]?.id || '');
                    }}
                  >
                    <span className="file-recovery-file-chip-path">{file.relPath}</span>
                    <span className="file-recovery-file-chip-count">{file.snapshots.length}</span>
                  </button>
                );
              })}
            </div>

            {/* Bottom Split View: Chronological Snapshots (Left) + Content / Diff (Right) */}
            <div className="file-recovery-body">
              <div className="file-recovery-snapshots-sidebar">
                <div className="file-recovery-sidebar-header">
                  {t('fileRecoveryModal.snapshotsCount', { count: snapshots.length })}
                </div>
                <div className="file-recovery-snapshots-list">
                  {snapshots.map((snap) => {
                    const isSelected = selectedSnapshot?.id === snap.id;
                    return (
                      <button
                        key={snap.id}
                        type="button"
                        className={`file-recovery-snapshot-item${isSelected ? ' is-selected' : ''}`}
                        onClick={() => setSelectedSnapshotId(snap.id)}
                      >
                        <Clock size={13} className="file-recovery-snapshot-icon" />
                        <span className="file-recovery-snapshot-time">
                          {formatSnapshotTimestamp(snap.timestamp, locale)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="file-recovery-viewer">
                {selectedSnapshot ? (
                  <>
                    <div className="file-recovery-viewer-toolbar">
                      <label className="file-recovery-diff-toggle">
                        <input
                          type="checkbox"
                          checked={showDiff}
                          onChange={(e) => setShowDiff(e.target.checked)}
                        />
                        <span>{t('fileRecoveryModal.showDiff')}</span>
                      </label>
                      <div className="file-recovery-viewer-actions">
                        <button
                          type="button"
                          className="mod-cta-secondary file-recovery-action-btn"
                          onClick={handleCopy}
                        >
                          <Copy size={14} />
                          <span>{t('fileRecoveryModal.copy')}</span>
                        </button>
                        <button
                          type="button"
                          className="mod-cta file-recovery-action-btn"
                          onClick={handleRestore}
                        >
                          <RotateCcw size={14} />
                          <span>{t('fileRecoveryModal.restore')}</span>
                        </button>
                      </div>
                    </div>

                    <div className="file-recovery-viewer-content">
                      {showDiff ? (
                        <div className="file-recovery-diff-view">
                          {diffLines.map((line, idx) => (
                            <div
                              key={idx}
                              className={`file-recovery-diff-line${
                                line.type === 'add'
                                  ? ' is-added'
                                  : line.type === 'del'
                                    ? ' is-removed'
                                    : ''
                              }`}
                            >
                              <span className="file-recovery-diff-prefix">
                                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                              </span>
                              <span className="file-recovery-diff-text">
                                {line.text || '\u00A0'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="file-recovery-plain-content">
                          {selectedSnapshot.content}
                        </pre>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="file-recovery-empty-state">
                    <p>{t('fileRecoveryModal.selectFileHint')}</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
