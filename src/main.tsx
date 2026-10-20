import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import 'katex/dist/katex.min.css';
import './index.css';

// Dev browser mock for Tauri internals when running outside native webview
if (!(window as any).__TAURI_INTERNALS__) {
  const sampleFiles = [
    { name: 'Bienvenida.md', path: '/vault/Bienvenida.md', isDir: false },
    { name: 'Nota de prueba.md', path: '/vault/Nota de prueba.md', isDir: false },
  ];
  const mockFileContent: Record<string, string> = {
    '/vault/Bienvenida.md': '# Bienvenida a Urano\n\nEste es un texto de prueba para verificar el editor.',
    '/vault/Nota de prueba.md': 'Hola mundo esto es una prueba de formato en Urano',
  };
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: any) => {
      console.log('[Mock Tauri]', cmd, args);
      if (cmd === 'is_authenticated') return false;
      if (cmd === 'open_vault' || cmd === 'list_vault_files') return sampleFiles;
      if (cmd === 'get_vault_notes_content') return mockFileContent;
      if (cmd === 'read_file') return mockFileContent[args?.filePath] || 'Contenido de nota';
      if (cmd === 'write_file') {
        if (args?.filePath) mockFileContent[args.filePath] = args?.content;
        return null;
      }
      if (cmd === 'create_file') {
        sampleFiles.push({ name: args.filePath.split('/').pop(), path: args.filePath, isDir: false });
        return null;
      }
      return null;
    },
    metadata: { currentWindow: { label: 'main' } },
  };
  if (!localStorage.getItem('urano_last_vault')) {
    localStorage.setItem('urano_last_vault', '/vault');
  }
}

window.addEventListener('error', (event) => {
  const errorDetails = {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack || 'No stack',
    time: new Date().toISOString(),
  };
  console.error('[Urano Fatal Error]', errorDetails);
  try {
    localStorage.setItem('urano_last_crash', JSON.stringify(errorDetails));
  } catch {}
});

window.addEventListener('unhandledrejection', (event) => {
  const errorDetails = {
    reason: String(event.reason?.message || event.reason),
    stack: event.reason?.stack || 'No stack',
    time: new Date().toISOString(),
  };
  console.error('[Urano Unhandled Rejection]', errorDetails);
  try {
    localStorage.setItem('urano_last_crash', JSON.stringify(errorDetails));
  } catch {}
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

