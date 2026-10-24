/**
 * Desplegable de idioma de Ajustes → General, réplica del de Obsidian.
 *
 * Evidencia (REA, `obsidian.asar`):
 *   app.js  → `e.addDropdown(d => { for (code of Fy) d.addOption(code, Oy[code]); d.setValue(cur) })`
 *             (Fy = códigos ordenados, Oy = autónimos). Obsidian usa un `<select class="dropdown">`
 *             nativo y pide reiniciar; Urano aplica el cambio en vivo.
 *   app.css → `.dropdown { background-image: url(chevrons ↕ svg), …; padding: var(--dropdown-padding) }`
 *             `.menu-item.selected { background-color: var(--background-modifier-hover) }`
 *             `.menu { background: var(--menu-background); border-radius: var(--menu-radius); box-shadow: var(--menu-shadow) }`
 *             `.mod-rtl .menu { direction: rtl }`
 *
 * El popover flotante reproduce el aspecto del `<select>` nativo de la captura (fondo #181818,
 * borde #2e2e2e, sombra profunda, scrollbar fina) y resalta el idioma activo con el color de
 * acento configurado en Urano. Se renderiza en un portal para escapar del `overflow` del modal.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown } from 'lucide-react';
import type { LanguageOption } from '../../stores/localeStore';

export interface LanguageDropdownProps {
  value: string;
  languages: LanguageOption[];
  onChange: (code: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

const MENU_MIN_WIDTH = 180;
const MENU_MAX_HEIGHT = 410;
const GAP = 4;

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  placement: 'bottom' | 'top';
}

export const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  value,
  languages,
  onChange,
  ariaLabel,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const listboxId = useId();

  const selectedIndex = Math.max(
    0,
    languages.findIndex((l) => l.code === value)
  );
  const selected = languages[selectedIndex];

  /* ---- Posicionamiento anclado al botón (abajo, o arriba si no cabe) ---- */
  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, MENU_MIN_WIDTH);
    const menuHeight = Math.min(MENU_MAX_HEIGHT, menuRef.current?.scrollHeight ?? MENU_MAX_HEIGHT) + 2;
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const placement: MenuPosition['placement'] =
      spaceBelow < menuHeight && rect.top - GAP > spaceBelow ? 'top' : 'bottom';
    const top = placement === 'bottom' ? rect.bottom + GAP : Math.max(GAP, rect.top - GAP - menuHeight);
    const left = Math.min(Math.max(GAP, rect.right - width), window.innerWidth - width - GAP);
    setPosition({ top, left, width, placement });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    // Al abrir, el idioma activo queda a la vista (centrado) de inmediato.
    const item = menuRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    item?.scrollIntoView({ block: 'center' });
    menuRef.current?.focus({ preventScroll: true });
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => updatePosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, updatePosition]);

  /* ---- Cierre por clic fuera ---- */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  };
  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  };
  const commit = (index: number) => {
    const lang = languages[index];
    if (lang && lang.code !== value) onChange(lang.code);
    closeMenu();
  };

  // Mantener el ítem resaltado a la vista al navegar con el teclado.
  useEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      openMenu();
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
        closeMenu();
        return;
      case 'Tab':
        closeMenu(false);
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

  const menu = useMemo(() => {
    if (!open || !position) return null;
    return createPortal(
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-activedescendant={`${listboxId}-${activeIndex}`}
        className={`language-dropdown-menu is-${position.placement}`}
        style={{ top: position.top, left: position.left, minWidth: position.width }}
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
              onClick={() => commit(index)}
            >
              {/* Como en Obsidian: una sola columna alineada a la izquierda; `dir="auto"`
                  solo en el texto interno para que árabe/persa/hebreo se dibujen en su orden pero
                  permanezcan pegados al margen izquierdo. */}
              <span className="language-dropdown-item-label">
                <span dir="auto">{lang.nativeName}</span>
              </span>
              {lang.custom && <span className="language-dropdown-item-badge">{lang.code}</span>}
            </div>
          );
        })}
      </div>,
      document.body
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position, languages, value, activeIndex, listboxId, ariaLabel]);

  return (
    <>
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
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="language-dropdown-button-label">
          <span dir="auto">{selected?.nativeName ?? value}</span>
        </span>
        <ChevronsUpDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {menu}
    </>
  );
};
