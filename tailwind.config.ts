import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: 'var(--background-primary)',
          sidebar: 'var(--background-secondary)',
          active: 'var(--interactive-hover, var(--background-modifier-hover))',
          border: 'var(--background-modifier-border)',
          hover: 'var(--background-modifier-hover)',
          text: 'var(--text-normal)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
          accent: 'var(--interactive-accent)',
          accentHover: 'var(--interactive-accent-hover)',
          uraniumGlow: '#fb923c',
          conflict: '#f59e0b',
          synced: '#10b981',
          syncing: '#f97316',
        },
        uranium: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#e06c1b',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
