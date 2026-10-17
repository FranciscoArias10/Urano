import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const obsidianTheme = EditorView.theme(
  {
    '&': {
      color: '#dcddde',
      backgroundColor: 'transparent',
      fontSize: '16px',
      lineHeight: '1.75',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      padding: '2.5rem 3rem 50vh 3rem', // 50vh enables Obsidian scroll-past-end
      overflow: 'auto',
    },
    '.cm-content': {
      maxWidth: '780px',
      margin: '0 auto',
      caretColor: '#a78bfa',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    '.cm-line': {
      padding: '0.1rem 0',
    },
    '&.cm-focused': {
      outline: 'none !important',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#a78bfa',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(124, 58, 237, 0.3) !important',
    },
    // Hide code editor gutters & line numbers completely for authentic Obsidian note feel
    '.cm-gutters': {
      display: 'none !important',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent !important',
    },
    '.cm-activeLineGutter': {
      display: 'none !important',
    },
  },
  { dark: true }
);

export const obsidianHighlightStyle = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700', color: '#ffffff' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#e2e2e8' },
  { tag: t.link, color: '#a78bfa', textDecoration: 'underline' },
  { tag: t.url, color: '#818cf8' },
  { tag: t.monospace, color: '#f472b6', backgroundColor: '#1e1e24', borderRadius: '4px', padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace" },
  { tag: t.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: t.quote, color: '#9ca3af', fontStyle: 'italic' },
]);

export const obsidianSyntax = syntaxHighlighting(obsidianHighlightStyle);
