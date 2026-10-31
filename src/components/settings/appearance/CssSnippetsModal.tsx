import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, X, FileCode } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, useT } from '../../../stores/settingsStore';
import { themeService } from '../../../services/themeService';
import type { CssSnippet } from '../../../types/theme';
import { Toggle, SettingButton } from '../SettingControls';
import { useNoticeStore } from '../../common/Notice';

interface CssSnippetsModalProps {
  vaultPath: string;
  isOpen: boolean;
  onClose: () => void;
}

export const CssSnippetsModal: React.FC<CssSnippetsModalProps> = ({
  vaultPath,
  isOpen,
  onClose,
}) => {
  const t = useT();
  const { showNotice } = useNoticeStore();
  const enabledCssSnippets = useSettingsStore((s) => s.settings.enabledCssSnippets);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const [snippets, setSnippets] = useState<CssSnippet[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSnippets = async () => {
    if (!vaultPath) return;
    setLoading(true);
    try {
      const list = await themeService.listSnippets(vaultPath, enabledCssSnippets);
      setSnippets(list);
    } catch (err) {
      console.error('Error al cargar snippets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadSnippets();
    }
  }, [isOpen, vaultPath]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOpenFolder = async () => {
    if (!vaultPath) return;
    try {
      await invoke('open_snippets_folder', { vaultPath });
    } catch (err) {
      console.error('No se pudo abrir la carpeta de fragmentos:', err);
    }
  };

  const handleReload = async () => {
    await loadSnippets();
    await themeService.applySnippets(vaultPath, enabledCssSnippets);
    showNotice(t('appearance.reloadedSnippets'));
  };

  const handleToggle = async (name: string, enable: boolean) => {
    const next = enable
      ? Array.from(new Set([...enabledCssSnippets, name]))
      : enabledCssSnippets.filter((n) => n !== name);

    setSetting('enabledCssSnippets', next);
    setSnippets((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: enable } : s))
    );
    await themeService.applySnippets(vaultPath, next);
  };

  return (
    <div
      className="urano-settings-root modal-container mod-dim"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal modal-sub-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90vw',
          maxWidth: '560px',
          maxHeight: '75vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--background-secondary, #1e1e1e)',
          border: '1px solid var(--background-modifier-border, #2a2a2a)',
          borderRadius: '12px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-5 py-4"
          style={{
            borderBottom: '1px solid var(--background-modifier-border)',
          }}
        >
          <div className="flex items-center gap-2">
            <FileCode size={20} className="text-[#e06c1b]" />
            <h2 className="text-base font-semibold text-[var(--text-normal)] m-0">
              {t('appearance.cssSnippets')}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="clickable-icon p-1.5 text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors rounded"
              title={t('appearance.openSnippetsFolder')}
              aria-label={t('appearance.openSnippetsFolder')}
              onClick={handleOpenFolder}
            >
              <FolderOpen size={16} />
            </button>
            <button
              type="button"
              className={`clickable-icon p-1.5 text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors rounded ${
                loading ? 'animate-spin text-[#e06c1b]' : ''
              }`}
              title={t('appearance.reloadSnippets')}
              aria-label={t('appearance.reloadSnippets')}
              onClick={handleReload}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              className="clickable-icon p-1.5 text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors rounded ml-1"
              title={t('general.close') || 'Cerrar'}
              aria-label={t('general.close') || 'Cerrar'}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="px-5 py-3 text-xs text-[var(--text-muted)] border-b border-[var(--background-modifier-border)] bg-[var(--background-primary)]">
          {t('appearance.cssSnippetsDesc')}
        </div>

        {/* Content list */}
        <div
          className="modal-content overflow-y-auto px-5 py-3 flex-1 flex flex-col gap-2"
          style={{ minHeight: '160px' }}
        >
          {snippets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3 text-[var(--text-muted)]">
              <FileCode size={36} className="text-[var(--text-faint)]" />
              <p className="text-sm max-w-sm m-0">
                {t('appearance.noSnippetsFound')}
              </p>
              <SettingButton onClick={handleOpenFolder}>
                <span className="flex items-center gap-1.5">
                  <FolderOpen size={14} />
                  {t('appearance.openSnippetsFolder')}
                </span>
              </SettingButton>
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.name}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--background-primary)] border border-[var(--background-modifier-border)] hover:border-[var(--background-modifier-border-hover)] transition-colors"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-[var(--text-normal)]">
                    {snippet.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {snippet.source === 'obsidian' ? '.obsidian/snippets' : '.urano/snippets'}
                  </span>
                </div>
                <Toggle
                  value={snippet.enabled}
                  onChange={(val) => handleToggle(snippet.name, val)}
                  ariaLabel={snippet.name}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
