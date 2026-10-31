import React, { useState, useEffect, useMemo } from 'react';
import { Type, X, Check, Search, RotateCcw } from 'lucide-react';
import { useSettingsStore, useT } from '../../../stores/settingsStore';
import { themeService } from '../../../services/themeService';

export type FontTarget = 'interfaceFontFamily' | 'textFontFamily' | 'monospaceFontFamily';

interface FontPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: FontTarget;
}

const COMMON_UI_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Segoe UI',
  'SF Pro Display',
  'Ubuntu',
  'Cantarell',
  'Noto Sans',
  'Helvetica Neue',
  'Arial',
  'Georgia',
  'Merriweather',
  'Lora',
  'PT Serif',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
];

const COMMON_MONO_FONTS = [
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Cascadia Code',
  'Cascadia Mono',
  'Roboto Mono',
  'Inconsolata',
  'DejaVu Sans Mono',
  'Ubuntu Mono',
  'Monaco',
  'Consolas',
  'Courier New',
];

export const FontPickerModal: React.FC<FontPickerModalProps> = ({
  isOpen,
  onClose,
  target,
}) => {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const currentValue = settings[target] || '';
  const [query, setQuery] = useState('');

  // Handle Escape
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

  const fontOptions = useMemo(() => {
    return target === 'monospaceFontFamily' ? COMMON_MONO_FONTS : COMMON_UI_FONTS;
  }, [target]);

  const filteredFonts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fontOptions;
    return fontOptions.filter((f) => f.toLowerCase().includes(q));
  }, [fontOptions, query]);

  if (!isOpen) return null;

  const targetTitle =
    target === 'interfaceFontFamily'
      ? t('appearance.interfaceFont')
      : target === 'textFontFamily'
      ? t('appearance.textFont')
      : t('appearance.monospaceFont');

  const handleSelectFont = (fontName: string) => {
    setSetting(target, fontName);
    const updated = {
      interfaceFont: target === 'interfaceFontFamily' ? fontName : settings.interfaceFontFamily,
      textFont: target === 'textFontFamily' ? fontName : settings.textFontFamily,
      monoFont: target === 'monospaceFontFamily' ? fontName : settings.monospaceFontFamily,
      fontSize: settings.baseFontSize,
    };
    themeService.applyFonts(updated);
    onClose();
  };

  const handleResetToDefault = () => {
    setSetting(target, '');
    const updated = {
      interfaceFont: target === 'interfaceFontFamily' ? '' : settings.interfaceFontFamily,
      textFont: target === 'textFontFamily' ? '' : settings.textFontFamily,
      monoFont: target === 'monospaceFontFamily' ? '' : settings.monospaceFontFamily,
      fontSize: settings.baseFontSize,
    };
    themeService.applyFonts(updated);
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      handleSelectFont(query.trim());
    }
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
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-6 py-4"
          style={{
            borderBottom: '1px solid var(--background-modifier-border)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <Type size={18} className="text-[#e06c1b]" />
            <h2 className="text-base font-semibold text-[var(--text-normal)] m-0">
              {targetTitle}
            </h2>
          </div>
          <button
            type="button"
            className="clickable-icon p-1.5 text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors rounded"
            title={t('general.close') || 'Cerrar'}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Bar / Input */}
        <form
          onSubmit={handleCustomSubmit}
          className="px-6 py-3 border-b border-[var(--background-modifier-border)] bg-[var(--background-primary)] flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('appearance.fontModalCustomPlaceholder')}
              className="w-full bg-[var(--background-modifier-form-field)] text-[var(--text-normal)] text-xs pl-9 pr-3 py-2 rounded-md border border-[var(--background-modifier-border)] focus:border-[var(--interactive-accent)] focus:outline-none placeholder-[var(--text-faint)]"
              autoFocus
            />
          </div>
          {query.trim() && (
            <button
              type="submit"
              className="px-3 py-1.5 bg-[#e06c1b] hover:bg-[#cc5f14] text-white text-xs font-medium rounded transition-colors whitespace-nowrap"
            >
              Aplicar
            </button>
          )}
        </form>

        {/* Current status & Reset button */}
        <div className="px-6 py-2.5 bg-[var(--background-primary-alt)] border-b border-[var(--background-modifier-border)] flex items-center justify-between">
          <div className="text-xs text-[var(--text-muted)]">
            {currentValue ? (
              <span>
                Activa:{' '}
                <strong className="text-[var(--text-normal)]" style={{ fontFamily: currentValue }}>
                  {currentValue}
                </strong>
              </span>
            ) : (
              <span>Fuente predeterminada activa</span>
            )}
          </div>
          {currentValue && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[#e06c1b] transition-colors cursor-pointer"
              onClick={handleResetToDefault}
              title={t('appearance.fontModalReset')}
            >
              <RotateCcw size={13} />
              <span>{t('appearance.fontModalReset')}</span>
            </button>
          )}
        </div>

        {/* Font List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {/* Default Option */}
          <div
            className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
              !currentValue
                ? 'bg-[var(--background-modifier-hover)] border-[#e06c1b]'
                : 'bg-[var(--background-primary)] border-[var(--background-modifier-border)] hover:bg-[var(--background-modifier-hover)]'
            }`}
            onClick={handleResetToDefault}
          >
            <div>
              <div className="text-xs font-semibold text-[var(--text-normal)]">
                {t('appearance.defaultTheme') || 'Por defecto'}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Fuente del sistema / Urano predeterminada
              </div>
            </div>
            {!currentValue && <Check size={16} className="text-[#e06c1b]" />}
          </div>

          {/* List of fonts */}
          {filteredFonts.map((font) => {
            const isSelected = currentValue.toLowerCase() === font.toLowerCase();
            return (
              <div
                key={font}
                className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'bg-[var(--background-modifier-hover)] border-[#e06c1b]'
                    : 'bg-[var(--background-primary)] border-[var(--background-modifier-border)] hover:bg-[var(--background-modifier-hover)]'
                }`}
                onClick={() => handleSelectFont(font)}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <div
                    className="text-sm font-semibold text-[var(--text-normal)] truncate"
                    style={{ fontFamily: font }}
                  >
                    {font}
                  </div>
                  <div
                    className="text-xs text-[var(--text-muted)] truncate mt-1"
                    style={{ fontFamily: font }}
                  >
                    El veloz murciélago hindú comía feliz cardillo y kiwi. 1234567890
                  </div>
                </div>
                {isSelected && <Check size={16} className="text-[#e06c1b] flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
