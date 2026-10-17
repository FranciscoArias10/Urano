import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: '#161618',
          sidebar: '#1c1c1f',
          active: '#242429',
          border: '#2e2e34',
          hover: '#28282e',
          text: '#dedede',
          muted: '#8b8b96',
          accent: '#7c3aed', // Purple accent like Obsidian
          accentHover: '#8b5cf6',
          conflict: '#f97316', // Orange for conflicts
          synced: '#10b981',   // Emerald for in-sync
          syncing: '#3b82f6',  // Blue for syncing
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
