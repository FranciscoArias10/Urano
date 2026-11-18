export const QUICK_SWITCHER_DOC_EXTENSIONS = new Set([
  'md',
  'markdown',
  'canvas',
  'base',
]);

export const QUICK_SWITCHER_ATTACHMENT_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'mp4',
  'webm',
  'ogv',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'pdf',
]);

export interface QuickSwitcherEntry {
  key: string;
  name: string;
  path: string;
  basename: string;
  ext: string;
  relPath: string;
  isUnresolved: boolean;
  isAttachment: boolean;
}

export function isQuickSwitcherDocumentExt(ext: string): boolean {
  return QUICK_SWITCHER_DOC_EXTENSIONS.has(ext.toLowerCase());
}

export function isQuickSwitcherAttachmentExt(ext: string): boolean {
  return QUICK_SWITCHER_ATTACHMENT_EXTENSIONS.has(ext.toLowerCase());
}
