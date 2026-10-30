import { applyAccentColor, DEFAULT_ACCENT_COLOR } from '../utils/colorUtils';
import type { ThemeMode } from '../stores/settingsStore';

const ACTIVE_THEME_STYLE_ID = 'urano-active-theme';

export class ThemeService {
  private static instance: ThemeService | null = null;
  private mediaQueryList: MediaQueryList | null = null;
  private mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
  private currentBaseTheme: ThemeMode = 'dark';

  private constructor() {
    this.setupThemeElement();
  }

  public static getInstance(): ThemeService {
    if (!ThemeService.instance) {
      ThemeService.instance = new ThemeService();
    }
    return ThemeService.instance;
  }

  private setupThemeElement(): HTMLStyleElement {
    let el = document.getElementById(ACTIVE_THEME_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = ACTIVE_THEME_STYLE_ID;
      el.type = 'text/css';
      document.head.appendChild(el);
    }
    return el;
  }

  /**
   * Applies the base theme mode (dark, light, system).
   */
  public applyBaseTheme(mode: ThemeMode): void {
    this.currentBaseTheme = mode;

    if (this.mediaQueryList && this.mediaQueryListener) {
      this.mediaQueryList.removeEventListener('change', this.mediaQueryListener);
      this.mediaQueryList = null;
      this.mediaQueryListener = null;
    }

    if (mode === 'system') {
      this.mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
      const updateSystemTheme = (isDark: boolean) => {
        document.body.classList.remove('theme-dark', 'theme-light');
        document.body.classList.add(isDark ? 'theme-dark' : 'theme-light');
      };

      updateSystemTheme(this.mediaQueryList.matches);

      this.mediaQueryListener = (e: MediaQueryListEvent) => {
        updateSystemTheme(e.matches);
      };
      this.mediaQueryList.addEventListener('change', this.mediaQueryListener);
    } else {
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(mode === 'light' ? 'theme-light' : 'theme-dark');
    }
  }

  /**
   * Updates the accent color across all Obsidian variables.
   */
  public applyAccent(hex: string): void {
    applyAccentColor(hex || DEFAULT_ACCENT_COLOR);
  }

  /**
   * Updates active font overrides and font size tokens.
   */
  public applyFonts(fonts: {
    interfaceFont?: string;
    textFont?: string;
    monoFont?: string;
    fontSize?: number;
  }): void {
    const root = document.documentElement;

    if (fonts.interfaceFont) {
      root.style.setProperty('--font-interface-override', `"${fonts.interfaceFont}", Inter, sans-serif`);
    } else {
      root.style.removeProperty('--font-interface-override');
    }

    if (fonts.textFont) {
      root.style.setProperty('--font-text-override', `"${fonts.textFont}", var(--font-interface)`);
    } else {
      root.style.removeProperty('--font-text-override');
    }

    if (fonts.monoFont) {
      root.style.setProperty('--font-monospace-override', `"${fonts.monoFont}", monospace`);
    } else {
      root.style.removeProperty('--font-monospace-override');
    }

    if (fonts.fontSize) {
      const sizePx = `${fonts.fontSize}px`;
      root.style.setProperty('--font-text-size', sizePx);
      root.style.setProperty('--font-preferred-size', sizePx);
      root.style.setProperty('--editor-font-size', sizePx);
    }
  }

  /**
   * Injects CSS text into <style id="urano-active-theme">.
   */
  public setActiveThemeCss(css: string): void {
    const el = this.setupThemeElement();
    if (el.textContent !== css) {
      el.textContent = css;
    }
  }

  /**
   * Scans both .urano/themes and .obsidian/themes for installed themes.
   */
  public async listThemes(vaultPath: string): Promise<import('../types/theme').InstalledTheme[]> {
    if (!vaultPath) return [];
    try {
      const themes = await import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke<import('../types/theme').InstalledTheme[]>('list_installed_themes', { vaultPath })
      );
      return themes;
    } catch {
      return [];
    }
  }

  /**
   * Loads and applies an installed theme by name, or resets to default if empty.
   */
  public async applyThemeByName(vaultPath: string, themeName: string): Promise<void> {
    if (!themeName) {
      this.setActiveThemeCss('');
      return;
    }
    if (!vaultPath) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const css = await invoke<string>('read_theme_css', { vaultPath, themeName });
      this.setActiveThemeCss(css);
    } catch (err) {
      console.warn(`[Urano Theme] Could not load theme "${themeName}":`, err);
      this.setActiveThemeCss('');
    }
  }
}

export const themeService = ThemeService.getInstance();
