/**
 * Utility functions for color conversion and dynamic Obsidian accent variable application.
 */

export const DEFAULT_ACCENT_COLOR = '#e06c1b';

export interface HSL {
  h: number;
  s: number;
  l: number;
}

/**
 * Converts a hex color string (#rgb, #rrggbb, #rrggbbaa) to HSL values.
 */
export function hexToHsl(hex: string): HSL {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length < 6) {
    clean = 'e06c1b';
  }

  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Injects dynamic Obsidian CSS variables for accent color into document.documentElement:
 * --accent-h, --accent-s, --accent-l, --color-accent, --interactive-accent
 */
export function applyAccentColor(hex: string): void {
  const effectiveHex = hex && hex.startsWith('#') ? hex : DEFAULT_ACCENT_COLOR;
  const { h, s, l } = hexToHsl(effectiveHex);
  const root = document.documentElement;

  root.style.setProperty('--accent-h', `${h}`);
  root.style.setProperty('--accent-s', `${s}%`);
  root.style.setProperty('--accent-l', `${l}%`);
  root.style.setProperty('--color-accent', `hsl(${h}, ${s}%, ${l}%)`);
  root.style.setProperty(
    '--color-accent-1',
    `hsl(${Math.max(0, h - 3)}, ${Math.min(100, Math.round(s * 1.02))}%, ${Math.min(100, Math.round(l * 1.15))}%)`
  );
  root.style.setProperty(
    '--color-accent-2',
    `hsl(${Math.max(0, h - 5)}, ${Math.min(100, Math.round(s * 1.05))}%, ${Math.min(100, Math.round(l * 1.29))}%)`
  );
  root.style.setProperty('--interactive-accent', `hsl(${h}, ${s}%, ${l}%)`);
  root.style.setProperty(
    '--interactive-accent-hover',
    `hsl(${Math.max(0, h - 3)}, ${Math.min(100, Math.round(s * 1.02))}%, ${Math.min(100, Math.round(l * 1.15))}%)`
  );
}
