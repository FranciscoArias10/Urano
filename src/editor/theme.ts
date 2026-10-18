import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const obsidianTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--text-normal, #dcddde)',
      backgroundColor: 'transparent',
      fontSize: '15px',
      lineHeight: '1.7',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: "var(--font-interface, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
      padding: '0.75rem 3rem 40vh 3rem',
      overflow: 'auto',
    },
    '.cm-content': {
      maxWidth: '820px',
      margin: '0 auto',
      caretColor: '#f97316',
      fontFamily: "var(--font-interface, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
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
  // Markdown structures
  { tag: t.strong, fontWeight: '700', color: '#ffffff' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#e7e5e4' },
  { tag: t.link, color: '#fb923c', textDecoration: 'underline' },
  { tag: t.url, color: '#fdba74' },
  { tag: t.monospace, color: '#fed7aa', backgroundColor: 'rgba(255, 255, 255, 0.06)', borderRadius: '4px', padding: '1px 5px', fontFamily: "'Fira Code', 'JetBrains Mono', monospace" },
  { tag: t.comment, color: '#78716c', fontStyle: 'italic' },
  { tag: t.quote, color: '#a8a29e', fontStyle: 'italic' },
  { tag: t.heading, fontWeight: '700', color: '#ffffff' },

  // Programming Languages Syntax Highlighting (Obsidian style with Uranium brick-orange palette)
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#fb923c', fontWeight: '600' }, // Orange accent
  { tag: [t.string, t.special(t.string)], color: '#86efac' }, // Soft green
  { tag: [t.number, t.integer, t.float], color: '#38bdf8' }, // Sky cyan
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#facc15' }, // Amber gold
  { tag: [t.typeName, t.className, t.standard(t.typeName)], color: '#f472b6' }, // Rose pink
  { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator], color: '#f97316' }, // Uranium orange
  { tag: [t.bracket, t.squareBracket, t.paren], color: '#d6d3d1' }, // Light gray
  { tag: [t.punctuation, t.separator], color: '#a8a29e' },
  { tag: [t.propertyName, t.attributeName], color: '#67e8f9' }, // Cyan
  { tag: [t.bool, t.null], color: '#c084fc', fontWeight: '500' }, // Purple
  { tag: [t.variableName, t.definition(t.variableName)], color: '#fed7aa' }, // Light peach
  { tag: t.meta, color: '#fb7185' },
]);

export const obsidianSyntax = syntaxHighlighting(obsidianHighlightStyle);
