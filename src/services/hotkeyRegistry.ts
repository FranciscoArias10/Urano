/**
 * Hotkey Registry & Shortcuts Service for Urano (1:1 with Obsidian)
 */

export interface HotkeyCommand {
  id: string;
  nameEs: string;
  nameEn: string;
  defaultHotkeys: string[];
  section?: string;
}

export const HOTKEY_CATALOG: HotkeyCommand[] = [
  {
    id: 'app:open-settings',
    nameEs: 'Abrir ajustes',
    nameEn: 'Open settings',
    defaultHotkeys: ['Ctrl + ,'],
    section: 'app',
  },
  {
    id: 'app:open-help',
    nameEs: 'Abrir ayuda',
    nameEn: 'Open help',
    defaultHotkeys: ['F1'],
    section: 'app',
  },
  {
    id: 'app:open-test-vault',
    nameEs: 'Abrir bóveda de prueba',
    nameEn: 'Open test vault',
    defaultHotkeys: [],
    section: 'app',
  },
  {
    id: 'app:open-vault',
    nameEs: 'Abrir bóveda...',
    nameEn: 'Open vault...',
    defaultHotkeys: [],
    section: 'app',
  },
  {
    id: 'editor:open-link-split',
    nameEs: 'Abrir el enlace bajo el cursor a la derecha',
    nameEn: 'Open link under cursor to the right',
    defaultHotkeys: ['Ctrl + Alt + Enter'],
    section: 'editor',
  },
  {
    id: 'editor:open-link-in-new-window',
    nameEs: 'Abrir el enlace bajo el cursor en nueva ventana',
    nameEn: 'Open link under cursor in new window',
    defaultHotkeys: ['Ctrl + Alt + Shift + Enter'],
    section: 'editor',
  },
  {
    id: 'editor:open-link-in-new-tab',
    nameEs: 'Abrir el enlace bajo el cursor en una nueva pestaña',
    nameEn: 'Open link under cursor in new tab',
    defaultHotkeys: ['Ctrl + Enter'],
    section: 'editor',
  },
  {
    id: 'app:open-in-default-app',
    nameEs: 'Abrir en la app por defecto',
    nameEn: 'Open in default app',
    defaultHotkeys: [],
    section: 'app',
  },
  {
    id: 'workspace:open-in-new-window',
    nameEs: 'Abrir panel actual en una ventana nueva',
    nameEn: 'Open current panel in new window',
    defaultHotkeys: [],
    section: 'workspace',
  },
  {
    id: 'app:open-external-file',
    nameEs: 'Abrir un archivo externo a la bóveda...',
    nameEn: 'Open external file outside vault...',
    defaultHotkeys: [],
    section: 'app',
  },
  {
    id: 'app:zoom-in',
    nameEs: 'Acercar',
    nameEn: 'Zoom in',
    defaultHotkeys: ['Ctrl + ='],
    section: 'app',
  },
  {
    id: 'app:zoom-out',
    nameEs: 'Alejar',
    nameEn: 'Zoom out',
    defaultHotkeys: ['Ctrl + -'],
    section: 'app',
  },
  {
    id: 'app:reset-zoom',
    nameEs: 'Restablecer zoom',
    nameEn: 'Reset zoom',
    defaultHotkeys: ['Ctrl + 0'],
    section: 'app',
  },
  {
    id: 'editor:toggle-highlight-yellow',
    nameEs: 'Activar o desactivar el resaltado en amarillo',
    nameEn: 'Toggle yellow highlight',
    defaultHotkeys: [],
    section: 'editor',
  },
  {
    id: 'editor:toggle-highlight-blue',
    nameEs: 'Activar o desactivar el resaltado en azul',
    nameEn: 'Toggle blue highlight',
    defaultHotkeys: [],
    section: 'editor',
  },
  {
    id: 'markdown:toggle-preview',
    nameEs: 'Alternar vista de lectura/edición',
    nameEn: 'Toggle reading view / edit mode',
    defaultHotkeys: ['Ctrl + E'],
    section: 'editor',
  },
  {
    id: 'editor:toggle-source',
    nameEs: 'Alternar código fuente / vista previa en vivo',
    nameEn: 'Toggle source mode / live preview',
    defaultHotkeys: [],
    section: 'editor',
  },
  {
    id: 'global-search:open',
    nameEs: 'Buscar en todos los archivos',
    nameEn: 'Search in all files',
    defaultHotkeys: ['Ctrl + Shift + F'],
    section: 'workspace',
  },
  {
    id: 'file-explorer:new-note',
    nameEs: 'Explorador de archivos: Crear nueva nota',
    nameEn: 'Files: Create new note',
    defaultHotkeys: ['Ctrl + N'],
    section: 'file-explorer',
  },
  {
    id: 'quick-switcher:open',
    nameEs: 'Selector rápido: Abrir selector rápido',
    nameEn: 'Quick switcher: Open quick switcher',
    defaultHotkeys: ['Ctrl + O'],
    section: 'switcher',
  },
  {
    id: 'command-palette:open',
    nameEs: 'Paleta de comandos: Abrir paleta de comandos',
    nameEn: 'Command palette: Open command palette',
    defaultHotkeys: ['Ctrl + P'],
    section: 'command-palette',
  },
  {
    id: 'workspace:close-tab',
    nameEs: 'Cerrar pestaña actual',
    nameEn: 'Close current tab',
    defaultHotkeys: ['Ctrl + W'],
    section: 'workspace',
  },
  {
    id: 'graph:open',
    nameEs: 'Vista gráfica: Abrir vista gráfica',
    nameEn: 'Graph view: Open graph view',
    defaultHotkeys: ['Ctrl + G'],
    section: 'graph',
  },
  {
    id: 'workspace:toggle-left-sidebar',
    nameEs: 'Alternar barra lateral izquierda',
    nameEn: 'Toggle left sidebar',
    defaultHotkeys: ['Ctrl + B'],
    section: 'workspace',
  },
  {
    id: 'workspace:toggle-backlinks',
    nameEs: 'Enlaces entrantes: Alternar panel de enlaces entrantes',
    nameEn: 'Backlinks: Toggle backlinks panel',
    defaultHotkeys: ['Ctrl + Shift + B'],
    section: 'backlink',
  },
  {
    id: 'workspace:new-tab',
    nameEs: 'Nueva pestaña',
    nameEn: 'New tab',
    defaultHotkeys: ['Ctrl + T'],
    section: 'workspace',
  },
  {
    id: 'workspace:undo-close-tab',
    nameEs: 'Reabrir pestaña cerrada',
    nameEn: 'Undo close tab',
    defaultHotkeys: ['Ctrl + Shift + T'],
    section: 'workspace',
  },
  {
    id: 'workspace:next-tab',
    nameEs: 'Ir a la siguiente pestaña',
    nameEn: 'Go to next tab',
    defaultHotkeys: ['Ctrl + Tab'],
    section: 'workspace',
  },
  {
    id: 'workspace:previous-tab',
    nameEs: 'Ir a la pestaña anterior',
    nameEn: 'Go to previous tab',
    defaultHotkeys: ['Ctrl + Shift + Tab'],
    section: 'workspace',
  },
  {
    id: 'workspace:toggle-fullscreen',
    nameEs: 'Alternar pantalla completa',
    nameEn: 'Toggle full screen',
    defaultHotkeys: ['F11'],
    section: 'workspace',
  },
  {
    id: 'file-explorer:rename-file',
    nameEs: 'Explorador de archivos: Renombrar archivo',
    nameEn: 'Files: Rename file',
    defaultHotkeys: ['F2'],
    section: 'file-explorer',
  },
  {
    id: 'file-explorer:new-folder',
    nameEs: 'Explorador de archivos: Nueva carpeta',
    nameEn: 'Files: New folder',
    defaultHotkeys: [],
    section: 'file-explorer',
  },
  {
    id: 'file-explorer:refresh',
    nameEs: 'Explorador de archivos: Actualizar explorador',
    nameEn: 'Files: Reload vault files',
    defaultHotkeys: [],
    section: 'file-explorer',
  },
  {
    id: 'editor:save-file',
    nameEs: 'Guardar archivo actual',
    nameEn: 'Save current file',
    defaultHotkeys: ['Ctrl + S'],
    section: 'editor',
  },
  {
    id: 'editor:toggle-bold',
    nameEs: 'Formato: Negrita',
    nameEn: 'Formatting: Bold',
    defaultHotkeys: ['Ctrl + B'],
    section: 'editor',
  },
  {
    id: 'editor:toggle-italics',
    nameEs: 'Formato: Cursiva',
    nameEn: 'Formatting: Italic',
    defaultHotkeys: ['Ctrl + I'],
    section: 'editor',
  },
  {
    id: 'editor:insert-link',
    nameEs: 'Insertar enlace Markdown',
    nameEn: 'Insert Markdown link',
    defaultHotkeys: ['Ctrl + K'],
    section: 'editor',
  },
  {
    id: 'editor:delete-line',
    nameEs: 'Eliminar línea actual',
    nameEn: 'Delete current line',
    defaultHotkeys: ['Ctrl + D'],
    section: 'editor',
  },
  {
    id: 'canvas:new',
    nameEs: 'Canvas: Crear nuevo lienzo (.canvas)',
    nameEn: 'Canvas: Create new canvas',
    defaultHotkeys: [],
    section: 'canvas',
  },
  {
    id: 'daily-notes:today',
    nameEs: 'Notas diarias: Abrir nota de hoy',
    nameEn: 'Daily notes: Open today note',
    defaultHotkeys: [],
    section: 'daily-notes',
  },
  {
    id: 'templates:insert',
    nameEs: 'Plantillas: Insertar plantilla',
    nameEn: 'Templates: Insert template',
    defaultHotkeys: [],
    section: 'templates',
  },
  {
    id: 'bases:new',
    nameEs: 'Bases: Crear nueva base de datos (.base)',
    nameEn: 'Bases: Create new database',
    defaultHotkeys: [],
    section: 'bases',
  },
  {
    id: 'sync:now',
    nameEs: 'Sync: Sincronizar ahora con Google Drive',
    nameEn: 'Sync: Sync now with Google Drive',
    defaultHotkeys: [],
    section: 'sync',
  },
  {
    id: 'note-composer:extract',
    nameEs: 'Compositor de notas: Extraer selección actual...',
    nameEn: 'Note composer: Extract current selection...',
    defaultHotkeys: [],
    section: 'note-composer',
  },
  {
    id: 'note-composer:merge',
    nameEs: 'Compositor de notas: Fusionar archivo completo con...',
    nameEn: 'Note composer: Merge entire file with...',
    defaultHotkeys: [],
    section: 'note-composer',
  },
  {
    id: 'zk-prefixer:open',
    nameEs: 'Creador de notas únicas: Crear nueva nota única',
    nameEn: 'Unique note creator: Create new unique note',
    defaultHotkeys: [],
    section: 'zk-prefixer',
  },
  {
    id: 'slides:start',
    nameEs: 'Diapositivas: Iniciar presentación',
    nameEn: 'Slides: Start presentation',
    defaultHotkeys: [],
    section: 'slides',
  },
  {
    id: 'outgoing-link:open',
    nameEs: 'Enlaces salientes: Mostrar enlaces salientes',
    nameEn: 'Outgoing links: Show outgoing links',
    defaultHotkeys: [],
    section: 'outgoing-link',
  },
  {
    id: 'workspaces:load',
    nameEs: 'Espacios de trabajo: Cargar diseño de espacio de trabajo',
    nameEn: 'Workspaces: Load workspace layout',
    defaultHotkeys: [],
    section: 'workspaces',
  },
  {
    id: 'markdown-importer:open',
    nameEs: 'Formato de importación markdown: Abrir convertidor de formato Markdown',
    nameEn: 'Format converter: Open Markdown format converter',
    defaultHotkeys: [],
    section: 'markdown-importer',
  },
  {
    id: 'audio-recorder:start',
    nameEs: 'Grabadora de audio: Iniciar/detener grabación',
    nameEn: 'Audio recorder: Start/stop recording audio',
    defaultHotkeys: [],
    section: 'audio-recorder',
  },
  {
    id: 'bookmarks:open',
    nameEs: 'Marcadores: Añadir marcador...',
    nameEn: 'Bookmarks: Bookmark...',
    defaultHotkeys: [],
    section: 'bookmarks',
  },
  {
    id: 'random-note:open',
    nameEs: 'Notas aleatorias: Abrir nota aleatoria',
    nameEn: 'Random note: Open random note',
    defaultHotkeys: [],
    section: 'random-note',
  },
  {
    id: 'properties:open',
    nameEs: 'Propiedades: Mostrar propiedades de archivo',
    nameEn: 'Properties view: Show file properties',
    defaultHotkeys: [],
    section: 'properties',
  },
  {
    id: 'file-recovery:open',
    nameEs: 'Recuperación de archivos: Abrir instantáneas guardadas',
    nameEn: 'File recovery: Open saved snapshots',
    defaultHotkeys: [],
    section: 'file-recovery',
  },
  {
    id: 'tag-pane:open',
    nameEs: 'Vista de etiquetas: Mostrar panel de etiquetas',
    nameEn: 'Tags view: Show tags pane',
    defaultHotkeys: [],
    section: 'tag-pane',
  },
  {
    id: 'app:sync-config',
    nameEs: 'Ajustes: Configurar cuenta de Google Drive y sincronización',
    nameEn: 'Settings: Configure Google Drive and sync',
    defaultHotkeys: [],
    section: 'sync',
  },
  {
    id: 'app:reload',
    nameEs: 'Recargar ventana',
    nameEn: 'Reload app',
    defaultHotkeys: ['Ctrl + R'],
    section: 'app',
  },
  {
    id: 'app:go-back',
    nameEs: 'Ir hacia atrás en el historial de navegación',
    nameEn: 'Navigate back',
    defaultHotkeys: ['Alt + ←'],
    section: 'workspace',
  },
  {
    id: 'app:go-forward',
    nameEs: 'Ir hacia adelante en el historial de navegación',
    nameEn: 'Navigate forward',
    defaultHotkeys: ['Alt + →'],
    section: 'workspace',
  },
];

export const DEFAULT_HOTKEYS: Record<string, string[]> = Object.fromEntries(
  HOTKEY_CATALOG.map((cmd) => [cmd.id, cmd.defaultHotkeys])
);

export function parseHotkeyStr(str: string) {
  const parts = str.split('+').map((s) => s.trim().toLowerCase());
  const hasCtrl = parts.includes('ctrl') || parts.includes('mod');
  const hasAlt = parts.includes('alt');
  const hasShift = parts.includes('shift');
  const hasMeta = parts.includes('meta') || parts.includes('cmd');
  const keyPart = parts.find((p) => !['ctrl', 'mod', 'alt', 'shift', 'meta', 'cmd'].includes(p)) || '';
  return { hasCtrl, hasAlt, hasShift, hasMeta, keyPart };
}

export function matchesHotkey(e: KeyboardEvent, hotkeyStr: string): boolean {
  if (!hotkeyStr) return false;
  const target = parseHotkeyStr(hotkeyStr);
  const eCtrl = Boolean(e.ctrlKey || e.metaKey);
  const eAlt = Boolean(e.altKey);
  const eShift = Boolean(e.shiftKey);
  if (target.hasCtrl !== eCtrl) return false;
  if (target.hasAlt !== eAlt) return false;
  if (target.hasShift !== eShift) return false;

  let key = (e.key || '').toLowerCase();
  if (e.code === 'Comma' || key === ',') key = ',';
  else if (e.code === 'Period' || key === '.') key = '.';
  else if (key === 'arrowleft') key = '←';
  else if (key === 'arrowright') key = '→';
  else if (key === 'arrowup') key = '↑';
  else if (key === 'arrowdown') key = '↓';
  else if (key === 'escape') key = 'esc';
  else if (key === ' ') key = 'space';

  return key === target.keyPart;
}

export function formatHotkeyFromEvent(e: KeyboardEvent): string | null {
  const isModifierKey = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key);
  if (isModifierKey) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (e.code === 'Comma') key = ',';
  else if (e.code === 'Period') key = '.';
  else if (e.code === 'Space' || key === ' ') key = 'Space';
  else if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';
  else if (key === 'Escape') key = 'Esc';
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join(' + ');
}

export function getActiveHotkeys(
  commandId: string,
  customHotkeys?: Record<string, string[]>
): string[] {
  if (customHotkeys && commandId in customHotkeys) {
    return customHotkeys[commandId];
  }
  return DEFAULT_HOTKEYS[commandId] ?? [];
}

export function isCommandTriggered(
  e: KeyboardEvent,
  commandId: string,
  customHotkeys?: Record<string, string[]>
): boolean {
  const hotkeys = getActiveHotkeys(commandId, customHotkeys);
  return hotkeys.some((hk) => matchesHotkey(e, hk));
}
