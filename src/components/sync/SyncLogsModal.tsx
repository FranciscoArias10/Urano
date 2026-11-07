import React, { useMemo, useState } from 'react';
import { X, Copy, Search } from 'lucide-react';
import { useSyncStore } from '../../stores/syncStore';
import { useT } from '../../stores/localeStore';
import { useNoticeStore } from '../common/Notice';
import type { SyncLog } from '../../types';

/**
 * Sync activity log, modelled on Urano's `.modal.mod-sync-log.mod-lg` (urano.asar/app.js,
 * class `Tie`): title "Sync log", an event-type dropdown (All / Errors / …) next to a filter
 * search box, a monospace `.sync-log-container` with one `.list-item` per entry (`.mod-error`
 * in `--text-error`), and a `.modal-button-container` with "Copy sync log" (mod-cta) + "Done".
 */
interface SyncLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type LogFilter = 'all' | 'errors' | 'warnings';

const LEVEL_KEY: Record<SyncLog['type'], string> = {
  info: 'sync.logsModal.levelInfo',
  success: 'sync.logsModal.levelSuccess',
  warn: 'sync.logsModal.levelWarn',
  error: 'sync.logsModal.levelError',
};

const LEVEL_CLASS: Record<SyncLog['type'], string> = {
  info: '',
  success: 'text-urano-text',
  warn: 'text-[var(--color-yellow)]',
  error: 'mod-error text-[var(--color-red)]',
};

export const SyncLogsModal: React.FC<SyncLogsModalProps> = ({ isOpen, onClose }) => {
  const logs = useSyncStore((s) => s.logs);
  const clearLogs = useSyncStore((s) => s.clearLogs);
  const showNotice = useNoticeStore((s) => s.showNotice);
  const t = useT();
  const [filter, setFilter] = useState<LogFilter>('all');
  const [query, setQuery] = useState('');

  const visibleLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (filter === 'errors' && log.type !== 'error') return false;
      if (filter === 'warnings' && log.type !== 'warn' && log.type !== 'error') return false;
      return !q || log.message.toLowerCase().includes(q);
    });
  }, [logs, filter, query]);

  if (!isOpen) return null;

  const levelLabel = (type: SyncLog['type']) => t(LEVEL_KEY[type]);

  const handleCopy = async () => {
    // Oldest first, like Urano's "Copy sync log" (`ts Error/Info message`).
    const text = [...visibleLogs]
      .reverse()
      .map((log) => `${log.timestamp} ${levelLabel(log.type).padEnd(5)} ${log.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showNotice(t('sync.logsModal.copied'));
    } catch (err) {
      console.error('No se pudo copiar el registro de sincronización:', err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background-modifier-cover)] p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('sync.logsModal.title')}
        className="modal mod-sync-log bg-urano-sidebar border border-urano-border rounded-xl w-full max-w-2xl h-[70vh] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-urano-border">
          <h2 className="text-[15px] font-semibold text-urano-text">{t('sync.logsModal.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-urano-muted hover:text-urano-text p-1 rounded-md transition-colors cursor-pointer"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 px-5 py-4 gap-3">
          {/* Toolbar: event-type dropdown + filter search (Urano: addDropdown + addSearch) */}
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as LogFilter)}
              aria-label={t('sync.logsModal.filterLabel')}
              className="h-[30px] rounded-[5px] border border-urano-border bg-[var(--interactive-normal)] text-urano-text text-[13px] px-2 outline-none cursor-pointer"
            >
              <option value="all">{t('sync.logsModal.filterAll')}</option>
              <option value="errors">{t('sync.logsModal.filterErrors')}</option>
              <option value="warnings">{t('sync.logsModal.filterWarnings')}</option>
            </select>
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-urano-faint pointer-events-none"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('sync.logsModal.searchPlaceholder')}
                className="w-full h-[30px] rounded-[5px] border border-urano-border bg-urano-bg text-urano-text text-[13px] pl-8 pr-2 outline-none focus:border-[var(--interactive-accent)]"
              />
            </div>
          </div>

          {/* .sync-log-container — newest entries at the bottom (column-reverse keeps the
              scroll anchored there, like a terminal) */}
          <div className="sync-log-container flex-1 min-h-0 overflow-y-auto flex flex-col-reverse rounded-[6px] border border-urano-border bg-urano-bg p-3 font-mono text-[11px] leading-[1.6] text-urano-muted whitespace-pre-wrap">
            {visibleLogs.length === 0 ? (
              <div className="m-auto font-sans text-xs text-urano-faint">{t('sync.logsModal.empty')}</div>
            ) : (
              visibleLogs.map((log) => (
                <div key={log.id} className={`list-item ${LEVEL_CLASS[log.type]}`}>
                  <span className="opacity-70">{log.timestamp}</span>{' '}
                  <span className="uppercase opacity-60">{levelLabel(log.type)}</span> {log.message}
                </div>
              ))
            )}
          </div>
        </div>

        {/* .modal-button-container: Clear · Copy sync log (mod-cta) · Done */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-urano-border">
          <button
            type="button"
            onClick={clearLogs}
            disabled={logs.length === 0}
            className="h-[32px] px-4 rounded-[5px] text-[13px] font-medium text-urano-muted hover:text-urano-text hover:bg-[var(--interactive-hover)] disabled:opacity-40 transition-colors cursor-pointer"
          >
            {t('sync.logsModal.clear')}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={visibleLogs.length === 0}
            className="h-[32px] px-4 rounded-[5px] text-[13px] font-medium text-white bg-[var(--interactive-accent)] hover:bg-[var(--interactive-accent-hover)] disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Copy size={13} />
            {t('sync.logsModal.copy')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[32px] px-4 rounded-[5px] text-[13px] font-medium text-urano-text bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] border border-urano-border transition-colors cursor-pointer"
          >
            {t('sync.logsModal.done')}
          </button>
        </div>
      </div>
    </div>
  );
};
