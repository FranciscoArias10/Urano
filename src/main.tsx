import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import 'katex/dist/katex.min.css';
import './index.css';

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

