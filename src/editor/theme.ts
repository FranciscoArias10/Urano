import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const obsidianTheme = EditorView.theme(
  {
    '&': {
      color: '#e2dfda',
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
      caretColor: '#f97316',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    '.cm-line': {
      padding: '0.12rem 0',
    },
    '&.cm-focused': {
      outline: 'none !important',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#f97316',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(234, 88, 12, 0.28) !important',
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
  { tag: t.emphasis, fontStyle: 'italic', color: '#e8e5df' },
  { tag: t.link, color: '#fb923c', textDecoration: 'underline' },
  { tag: t.url, color: '#fdba74' },
  { tag: t.monospace, color: '#fba160', backgroundColor: '#24211d', borderRadius: '4px', padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace" },
  { tag: t.comment, color: '#78716c', fontStyle: 'italic' },
  { tag: t.quote, color: '#a8a29e', fontStyle: 'italic' },
  { tag: t.heading, fontWeight: '700', color: '#ffffff' },
]);

export const obsidianSyntax = syntaxHighlighting(obsidianHighlightStyle);
