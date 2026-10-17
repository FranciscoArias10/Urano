import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: '#141312',
          sidebar: '#1a1816',
          active: '#24211d',
          border: '#2c2723',
          hover: '#26221e',
          text: '#e2dfda',
          muted: '#928c84',
          accent: '#ea580c',      // Uranium brick-orange
          accentHover: '#f97316', // Glowing amber-orange
          uraniumGlow: '#fb923c',
          conflict: '#f59e0b',    // Warning amber
          synced: '#10b981',      // Emerald
          syncing: '#f97316',     // Active pulsing uranium orange
        },
        uranium: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
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
