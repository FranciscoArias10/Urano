import React, { useState } from 'react';
import { X, Trash2, Plus } from 'lucide-react';
import { useSettingsStore, useT } from '../../stores/settingsStore';

interface ExcludedFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExcludedFilesModal: React.FC<ExcludedFilesModalProps> = ({ isOpen, onClose }) => {
  const t = useT();
  const filters = useSettingsStore((s) => s.settings.userIgnoreFilters) || [];
  const setSetting = useSettingsStore((s) => s.setSetting);
  const [newFilter, setNewFilter] = useState('');

  if (!isOpen) return null;

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newFilter.trim();
    if (!trimmed) return;
    if (!filters.includes(trimmed)) {
      setSetting('userIgnoreFilters', [...filters, trimmed]);
    }
    setNewFilter('');
  };

  const handleRemove = (index: number) => {
    const updated = filters.filter((_, i) => i !== index);
    setSetting('userIgnoreFilters', updated);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--background-modifier-cover)] backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="relative w-[480px] max-w-[92vw] bg-[var(--background-primary)] border border-[var(--background-modifier-border)] rounded-[10px] p-6 text-[var(--text-normal)] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.7),0_10px_10px_-5px_rgba(0,0,0,0.5)] select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Close Button (×) */}
        <button
          onClick={onClose}
          title={t('modal.close')}
          className="absolute top-4 right-4 p-1 text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] rounded transition-colors outline-none cursor-pointer"
        >
          <X size={16} />
        </button>

        {/* Modal Title */}
        <h2 className="text-[17px] font-semibold text-[var(--text-normal)] tracking-tight mb-1 pr-6">
          {t('files.excludedFilesModalTitle')}
        </h2>

        {/* Modal Description */}
        <p className="text-[13px] text-[var(--text-muted)] leading-relaxed mb-4">
          {t('files.excludedFilesModalDesc')}
        </p>

        {/* Add Input Form */}
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <input
            type="text"
            value={newFilter}
            onChange={(e) => setNewFilter(e.target.value)}
            placeholder={t('files.filterPlaceholder')}
            className="flex-1 bg-[var(--background-modifier-form-field)] border border-[var(--background-modifier-border)] rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-normal)] outline-none focus:border-[var(--interactive-accent)] transition-colors"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e06c1b] hover:bg-[#ea7e31] text-white text-[13px] font-medium rounded-[6px] transition-colors cursor-pointer outline-none"
          >
            <Plus size={14} />
            <span>{t('files.addFilter')}</span>
          </button>
        </form>

        {/* List of filters */}
        <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
          {filters.length === 0 ? (
            <div className="text-center py-6 text-[13px] text-[var(--text-faint)]">
              {t('files.noFilters')}
            </div>
          ) : (
            filters.map((filter, index) => (
              <div
                key={`${filter}-${index}`}
                className="flex items-center justify-between px-3 py-1.5 bg-[var(--background-secondary)] border border-[var(--background-modifier-border)] rounded-[6px] text-[13px]"
              >
                <span className="font-mono text-[12px] truncate max-w-[340px]" title={filter}>
                  {filter}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="p-1 text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--background-modifier-hover)] rounded transition-colors cursor-pointer"
                  title={t('modal.close')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bottom Close Button */}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] text-[var(--text-normal)] border border-[var(--background-modifier-border)] text-xs font-medium rounded-[6px] transition-colors outline-none cursor-pointer"
          >
            {t('modal.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

