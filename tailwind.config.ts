import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: '#1e1e1e',          // Obsidian neutral dark primary canvas
          sidebar: '#181818',     // Obsidian neutral dark sidebar
          active: '#262626',
          border: 'rgba(255, 255, 255, 0.08)',
          hover: '#262626',
          text: '#dcddde',
          muted: '#888888',
          accent: '#e06c1b',      // Urano official brick-orange
          accentHover: '#f97316', // Glowing amber-orange
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
