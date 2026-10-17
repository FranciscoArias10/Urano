import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const obsidianTheme = EditorView.theme(
  {
    '&': {
      color: '#dedede',
      backgroundColor: '#161618',
      fontSize: '15px',
    },
    '.cm-content': {
      caretColor: '#8b5cf6',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#8b5cf6',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(124, 58, 237, 0.3) !important',
    },
    '.cm-gutters': {
      backgroundColor: '#161618',
      color: '#4e4e58',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#9e9eb0',
    },
  },
  { dark: true }
);

export const obsidianHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.85em', fontWeight: 'bold', color: '#ffffff' },
  { tag: t.heading2, fontSize: '1.45em', fontWeight: 'bold', color: '#f4f4f8' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600', color: '#e2e2e8' },
  { tag: t.strong, fontWeight: 'bold', color: '#f3f4f6' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#d1d5db' },
  { tag: t.link, color: '#a78bfa', textDecoration: 'underline' },
  { tag: t.url, color: '#818cf8' },
  { tag: t.monospace, color: '#f472b6', backgroundColor: '#212128', borderRadius: '3px' },
  { tag: t.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: t.keyword, color: '#c084fc' },
  { tag: t.atom, color: '#fb923c' },
  { tag: t.number, color: '#38bdf8' },
  { tag: t.definition(t.name), color: '#a3e635' },
  { tag: t.quote, color: '#9ca3af', fontStyle: 'italic' },
]);

export const obsidianSyntax = syntaxHighlighting(obsidianHighlightStyle);
