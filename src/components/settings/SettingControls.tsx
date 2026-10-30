import React, { useId, useState } from 'react';
import { ChevronsUpDown, X } from 'lucide-react';

/* ----------------------------------------------------------------------------
 * Primitive building blocks mirroring Obsidian's `Setting` component family
 * (app.js: rT = Setting, oT = SettingGroup, pT = ToggleComponent,
 *  bT = DropdownComponent, ButtonComponent, ExtraButtonComponent, vT = Search).
 * Class names are the real Obsidian ones so the CSS reconstruction applies.
 * ------------------------------------------------------------------------- */

export interface SettingGroupProps {
  id?: string;
  heading?: React.ReactNode;
  headingControl?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** `.setting-group > .setting-item.setting-item-heading + .setting-items` */
export const SettingGroup: React.FC<SettingGroupProps> = ({
  id,
  heading,
  headingControl,
  className,
  children,
}) => (
  <div className={`setting-group${className ? ` ${className}` : ''}`} id={id}>
    {heading !== undefined && heading !== null && (
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">{heading}</div>
        </div>
        {headingControl && <div className="setting-item-control">{headingControl}</div>}
      </div>
    )}
    <div className="setting-items">{children}</div>
  </div>
);

export interface SettingItemProps {
  id?: string;
  name: React.ReactNode;
  desc?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /** Stack controls vertically (Obsidian `.setting-item-control.mod-vertical`). */
  vertical?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}

/** `.setting-item > .setting-item-info (name, description) + .setting-item-control` */
export const SettingItem: React.FC<SettingItemProps> = ({
  id,
  name,
  desc,
  icon,
  disabled,
  className,
  vertical,
  onClick,
  children,
}) => (
  <div
    className={`setting-item${disabled ? ' is-disabled' : ''}${onClick ? ' is-clickable cursor-pointer hover:bg-[rgba(255,255,255,0.02)]' : ''}${className ? ` ${className}` : ''}`}
    id={id}
    tabIndex={onClick ? 0 : -1}
    onClick={onClick}
    data-setting-item
  >
    {icon && <div className="setting-item-icon">{icon}</div>}
    <div className="setting-item-info">
      <div className="setting-item-name">{name}</div>
      {desc !== undefined && desc !== null && desc !== '' && (
        <div className="setting-item-description">{desc}</div>
      )}
    </div>
    {children && (
      <div className={`setting-item-control${vertical ? ' mod-vertical' : ''}`}>{children}</div>
    )}
  </div>
);

/* --- Toggle ----------------------------------------------------------------- */

export interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

/** `label.checkbox-container.is-enabled > input[type=checkbox]` */
export const Toggle: React.FC<ToggleProps> = ({ value, onChange, disabled, ariaLabel }) => {
  const toggle = () => {
    if (disabled) return;
    onChange(!value);
  };
  return (
    <label
      className={`checkbox-container${value ? ' is-enabled' : ''}${disabled ? ' is-disabled' : ''}`}
      tabIndex={disabled ? -1 : 0}
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <input
        type="checkbox"
        tabIndex={-1}
        checked={value}
        disabled={disabled}
        onChange={toggle}
      />
    </label>
  );
};

/* --- Dropdown --------------------------------------------------------------- */

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

export interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

/** `select.dropdown` with Obsidian's double-chevron glyph (lucide ChevronsUpDown). */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: DropdownProps<T>) {
  return (
    <div className="dropdown-container">
      <select
        className="dropdown"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="dropdown-icon">
        <ChevronsUpDown size={14} strokeWidth={2} />
      </span>
    </div>
  );
}

/* --- Buttons ---------------------------------------------------------------- */

export interface SettingButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  cta?: boolean;
  warning?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

/** Obsidian `button` / `button.mod-cta` / `button.mod-loading` */
export const SettingButton: React.FC<SettingButtonProps> = ({
  cta,
  warning,
  loading,
  className,
  children,
  ...rest
}) => (
  <button
    type="button"
    {...rest}
    className={`setting-button${cta ? ' mod-cta' : ''}${warning ? ' mod-warning' : ''}${
      loading ? ' mod-loading' : ''
    }${className ? ` ${className}` : ''}`}
  >
    {children}
  </button>
);

export interface ExtraButtonProps {
  icon: React.ReactNode;
  tooltip?: string;
  onClick?: () => void;
  disabled?: boolean;
}

/** Icon-only button placed before the main control (Obsidian `addExtraButton`). */
export const ExtraButton: React.FC<ExtraButtonProps> = ({ icon, tooltip, onClick, disabled }) => (
  <button
    type="button"
    className="extra-setting-button clickable-icon"
    aria-label={tooltip}
    title={tooltip}
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
  </button>
);

/** Underlined inline link inside a description (`.setting-item-description a`). */
export const SettingLink: React.FC<{
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ href, onClick, children }) => {
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" className="setting-link" onClick={onClick}>
      {children}
    </button>
  );
};

/* --- Text / number / slider / color ---------------------------------------- */

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Commit on blur/Enter instead of every keystroke. */
  commitOnBlur?: boolean;
}

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
  commitOnBlur = true,
}) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused && commitOnBlur ? draft : value;
  return (
    <input
      type="text"
      spellCheck={false}
      value={shown}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!commitOnBlur) onChange(e.target.value);
      }}
      onBlur={() => {
        setFocused(false);
        if (commitOnBlur && draft !== value) onChange(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  ariaLabel,
}) => (
  <input
    type="number"
    value={value}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    aria-label={ariaLabel}
    onChange={(e) => {
      const n = Number(e.target.value);
      if (!Number.isFinite(n)) return;
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      onChange(clamped);
    }}
  />
);

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Range slider with a tabular value readout (Obsidian `SliderComponent` + tooltip). */
export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min,
  max,
  step,
  format,
  disabled,
  ariaLabel,
}) => (
  <>
    <span className="slider-value">{format ? format(value) : value}</span>
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </>
);

export interface ColorInputProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export const ColorInput: React.FC<ColorInputProps> = ({ value, onChange, ariaLabel }) => {
  const id = useId();
  return (
    <div className="color-input-container">
      <span className="color-input-value">{value.toLowerCase()}</span>
      <input
        id={id}
        type="color"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

/* --- Misc display ----------------------------------------------------------- */

export const StatusPill: React.FC<{
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'active';
  children: React.ReactNode;
}> = ({ tone = 'neutral', children }) => (
  <span className={`setting-item-status${tone !== 'neutral' ? ` mod-${tone}` : ''}`}>
    <span className="status-dot" />
    {children}
  </span>
);

/** `.setting-hotkey` pill, e.g. "Ctrl + ," */
export const HotkeyPill: React.FC<{ hotkey?: string; emptyLabel: string }> = ({
  hotkey,
  emptyLabel,
}) => (
  <span className={`setting-hotkey${hotkey ? '' : ' mod-empty'}`}>
    {hotkey ? hotkey.replace(/\+/g, ' + ') : emptyLabel}
  </span>
);

/** Clear (×) button used inside the search input. */
export const SearchClearButton: React.FC<{ onClick: () => void; label: string }> = ({
  onClick,
  label,
}) => (
  <button
    type="button"
    className="search-input-clear-button"
    aria-label={label}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    <X size={11} strokeWidth={2.5} />
  </button>
);
