import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const obsidianTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--text-normal, #dcddde)',
      backgroundColor: 'transparent',
      fontSize: 'var(--editor-font-size, 15px)',
      lineHeight: '1.7',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: "var(--font-interface, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
      padding: '0.75rem 3rem 40vh 3rem',
      overflow: 'auto',
    },
    '.cm-content': {
      maxWidth: 'var(--file-line-width, 820px)',
      margin: '0 auto',
      caretColor: '#e06c1b',
      fontFamily: "var(--font-interface, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
    },
    '.cm-line': {
      padding: '0.12rem 0',
    },
    '&.cm-focused': {
      outline: 'none !important',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#e06c1b',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(224, 108, 27, 0.25) !important',
    },
    // Gutters only exist when "Show line number" is on (lineNumbers() extension)
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--text-faint, #555555)',
      fontSize: '0.85em',
      paddingRight: '12px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '3ch',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent !important',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent !important',
      color: 'var(--text-muted, #888888)',
    },
  },
  { dark: true }
);

export const obsidianHighlightStyle = HighlightStyle.define([
  // Markdown structures
  { tag: t.strong, fontWeight: '700', color: '#ffffff' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#dcddde' },
  { tag: t.link, color: '#e06c1b', textDecoration: 'underline' },
  { tag: t.url, color: '#f97316' },
  // Remove background pill effect from monospace inside code blocks
  { tag: t.monospace, color: '#fed7aa', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
  { tag: t.comment, color: '#78716c', fontStyle: 'italic' },
  { tag: t.quote, color: '#888888', fontStyle: 'italic' },
  { tag: t.heading, fontWeight: '700', color: '#ffffff' },

  // Programming Languages Syntax Highlighting (Obsidian style with Urano orange accent)
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#f97316', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#86efac' },
  { tag: [t.number, t.integer, t.float], color: '#38bdf8' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#facc15' },
  { tag: [t.typeName, t.className, t.standard(t.typeName)], color: '#f472b6' },
  { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator], color: '#e06c1b' },
  { tag: [t.bracket, t.squareBracket, t.paren], color: '#d6d3d1' },
  { tag: [t.punctuation, t.separator], color: '#888888' },
  { tag: [t.propertyName, t.attributeName], color: '#67e8f9' },
  { tag: [t.bool, t.null], color: '#c084fc', fontWeight: '500' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#fed7aa' },
  { tag: t.meta, color: '#fb7185' },
]);

export const obsidianSyntax = syntaxHighlighting(obsidianHighlightStyle);
