/**
 * Desplegable de idioma de Ajustes → General y Administrador de Bóvedas, réplica de Obsidian.
 *
 * Evidencia (REA, `obsidian.asar`):
 *   app.js  → `e.addDropdown(d => { for (code of Fy) d.addOption(code, Oy[code]); d.setValue(cur) })`
 *   app.css → `.dropdown { ... }`
 *
 * Soporta `direction="up"` para menús ubicados en la parte inferior (como en el modal de
 * administrar bóvedas) y `direction="down"` para configuraciones generales.
 */
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import type { LanguageOption } from '../../stores/localeStore';

export interface LanguageDropdownProps {
  value: string;
  languages: LanguageOption[];
  onChange: (code: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  direction?: 'up' | 'down';
  className?: string;
}

export const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  value,
  languages,
  onChange,
  ariaLabel,
  disabled,
  direction = 'down',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const listboxId = useId();

  const selectedIndex = Math.max(
    0,
    languages.findIndex((l) => l.code === value)
  );
  const selected = languages[selectedIndex];

  // Al abrir, el idioma activo queda a la vista (centrado) de inmediato
  useLayoutEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    item?.scrollIntoView({ block: 'center' });
    menuRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Cierre por clic fuera
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const commit = (index: number) => {
    const lang = languages[index];
    if (lang && lang.code !== value) {
      onChange(lang.code);
    }
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };

  // Mantener el ítem resaltado a la vista al navegar con el teclado
  useEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (disabled) return;
      setActiveIndex(selectedIndex);
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const last = languages.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(last, i + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      case 'PageDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(last, i + 8));
        return;
      case 'PageUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 8));
        return;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        e.preventDefault();
        setActiveIndex(last);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(activeIndex);
        return;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        break;
    }
    // Búsqueda por tecleo: "esp" → Español, "日" → 日本語
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const prev = typeaheadRef.current;
      const text = (now - prev.at < 700 ? prev.text : '') + e.key.toLowerCase();
      typeaheadRef.current = { text, at: now };
      const match = languages.findIndex(
        (l) =>
          l.nativeName.toLowerCase().startsWith(text) ||
          l.name.toLowerCase().startsWith(text) ||
          l.code.startsWith(text)
      );
      if (match >= 0) setActiveIndex(match);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`language-dropdown-container ${className ?? ''}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`language-dropdown-button${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        lang={selected?.code}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setActiveIndex(selectedIndex);
          setOpen((prev) => !prev);
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span className="language-dropdown-button-label">
          <span dir="auto">{selected?.nativeName ?? value}</span>
        </span>
        <ChevronsUpDown size={14} color="#888888" className="shrink-0" strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${listboxId}-${activeIndex}`}
          className={`language-dropdown-menu mod-${direction}`}
          onKeyDown={onMenuKeyDown}
        >
          {languages.map((lang, index) => {
            const isSelected = lang.code === value;
            return (
              <div
                key={lang.code}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                data-selected={isSelected ? 'true' : undefined}
                lang={lang.code}
                title={lang.name !== lang.nativeName ? `${lang.name} (${lang.code})` : lang.code}
                className={`language-dropdown-item${isSelected ? ' is-selected' : ''}${
                  index === activeIndex ? ' is-active' : ''
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  commit(index);
                }}
              >
                <span className="language-dropdown-item-label">
                  <span dir="auto">{lang.nativeName}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
