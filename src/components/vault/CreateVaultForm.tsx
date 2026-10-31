import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useT } from '../../stores/localeStore';
import { validateFileName } from '../../stores/vaultStore';

export interface CreateVaultFormProps {
  onBack: () => void;
  onSubmit: (vaultName: string, location: string) => Promise<void>;
}

export const CreateVaultForm: React.FC<CreateVaultFormProps> = ({ onBack, onSubmit }) => {
  const t = useT();
  const [vaultName, setVaultName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('vaultManager.dialogs.selectLocation'),
      });
      if (selected && typeof selected === 'string') {
        setLocation(selected);
        setError(null);
      }
    } catch (err) {
      console.error('Error browsing location:', err);
    }
  };

  const handleCreate = async () => {
    setError(null);
    const trimmed = vaultName.trim();
    if (!trimmed) {
      setError(t('vaultManager.createForm.errorNameEmpty'));
      return;
    }

    const validation = validateFileName(trimmed);
    if (!validation.valid) {
      setError(validation.error || t('vaultManager.createForm.errorNameEmpty'));
      return;
    }

    if (!location) {
      setError(t('vaultManager.createForm.errorLocationEmpty'));
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit(trimmed, location);
    } catch (err: any) {
      setError(`${t('vaultManager.createForm.errorCreateFailed')} ${err?.toString() || ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="py-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12.5px] text-obsidian-muted hover:text-obsidian-text mb-3 transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} />
        <span>{t('vaultManager.createForm.back')}</span>
      </button>

      {/* Vault name */}
      <div className="py-2.5 flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-obsidian-text">
            {t('vaultManager.createForm.vaultName')}
          </span>
          <span className="text-[12px] text-obsidian-muted mt-0.5">
            {t('vaultManager.createForm.vaultNameDesc')}
          </span>
        </div>
        <input
          type="text"
          value={vaultName}
          onChange={(e) => {
            setVaultName(e.target.value);
            setError(null);
          }}
          placeholder={t('vaultManager.createForm.vaultNamePlaceholder')}
          className="w-[170px] bg-[var(--interactive-normal)] border border-obsidian-border focus:border-[#e06c1b] rounded-[5px] px-3 py-1.5 text-[13px] text-obsidian-text outline-none transition-colors"
        />
      </div>

      {/* Location */}
      <div className="py-2.5 border-t border-obsidian-border flex items-center justify-between gap-4">
        <div className="flex flex-col max-w-[260px]">
          <span className="text-[13.5px] font-medium text-obsidian-text">
            {t('vaultManager.createForm.location')}
          </span>
          <span className="text-[12px] text-obsidian-muted mt-0.5 truncate" title={location || undefined}>
            {location ? (
              <>
                {t('vaultManager.createForm.locationPreview')}
                <span className="text-orange-400 font-mono">
                  {location}
                  {vaultName ? `/${vaultName}` : ''}
                </span>
              </>
            ) : (
              t('vaultManager.createForm.locationDesc')
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={handleBrowse}
          className="bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] border border-obsidian-border text-obsidian-text hover:text-obsidian-text font-medium text-[13px] rounded-[5px] h-[32px] px-4 whitespace-nowrap inline-flex items-center justify-center min-w-[86px] transition-colors cursor-pointer text-center"
        >
          {t('vaultManager.createForm.browse')}
        </button>
      </div>

      {error && (
        <div className="text-[12px] text-red-400 mt-2 px-1">
          {error}
        </div>
      )}

      {/* Create Button */}
      <div className="pt-3 border-t border-obsidian-border flex justify-center">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleCreate}
          className="bg-[#e06c1b] hover:brightness-110 text-white font-medium text-[13px] rounded-[5px] h-[32px] px-6 whitespace-nowrap inline-flex items-center justify-center min-w-[100px] transition-all cursor-pointer text-center disabled:opacity-50"
        >
          {t('vaultManager.options.buttonCreate')}
        </button>
      </div>
    </div>
  );
};
