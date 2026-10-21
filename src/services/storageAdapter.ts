import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';

export interface StorageAdapter {
  writeBinary(path: string, data: ArrayBuffer | Blob | Uint8Array): Promise<void>;
  readBinary(path: string): Promise<Blob>;
  getResourcePath(path: string): Promise<string>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'ico',
] as const;

export type ImageExtension = typeof IMAGE_EXTENSIONS[number];

export function isImagePath(filePath: string): boolean {
  if (!filePath) return false;
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? (IMAGE_EXTENSIONS as readonly string[]).includes(ext) : false;
}

export function getImageMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

export function getImageFormatTag(filePath: string): string | null {
  if (!filePath) return null;
  const ext = filePath.split('.').pop()?.toUpperCase();
  if (!ext) return null;
  if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG', 'AVIF', 'BMP'].includes(ext)) {
    return ext === 'JPEG' ? 'JPG' : ext;
  }
  return null;
}

/**
 * Local file system implementation of StorageAdapter
 */
export class LocalAdapter implements StorageAdapter {
  private resourceCache = new Map<string, string>();

  async writeBinary(path: string, data: ArrayBuffer | Blob | Uint8Array): Promise<void> {
    let uint8: Uint8Array;
    if (data instanceof Uint8Array) {
      uint8 = data;
    } else if (data instanceof Blob) {
      const arrayBuffer = await data.arrayBuffer();
      uint8 = new Uint8Array(arrayBuffer);
    } else {
      uint8 = new Uint8Array(data);
    }

    try {
      // First attempt native plugin-fs writeFile
      await writeFile(path, uint8);
    } catch (pluginErr) {
      console.warn('[LocalAdapter] writeFile from plugin-fs failed, falling back to invoke write_file_binary:', pluginErr);
      await invoke('write_file_binary', {
        filePath: path,
        data: Array.from(uint8),
      });
    }

    // Invalidate cached URL if exists
    if (this.resourceCache.has(path)) {
      const oldUrl = this.resourceCache.get(path);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      this.resourceCache.delete(path);
    }
  }

  async readBinary(path: string): Promise<Blob> {
    const mime = getImageMimeType(path);
    try {
      const uint8 = await readFile(path);
      return new Blob([uint8], { type: mime });
    } catch (pluginErr) {
      console.warn('[LocalAdapter] readFile from plugin-fs failed, falling back to invoke read_file_binary:', pluginErr);
      const rawData = await invoke<number[]>('read_file_binary', { filePath: path });
      const uint8 = new Uint8Array(rawData);
      return new Blob([uint8], { type: mime });
    }
  }

  async getResourcePath(path: string): Promise<string> {
    if (!path) return '';

    // If it's already an external HTTP/HTTPS URL, blob URL or asset protocol, return directly
    if (/^(https?:|blob:|data:|asset:)/i.test(path)) {
      return path;
    }

    // Fast-path: Convert directly to Tauri asset protocol URL (synchronous, 0ms latency, direct disk streaming)
    try {
      const assetUrl = convertFileSrc(path);
      if (assetUrl) {
        return assetUrl;
      }
    } catch {
      // Fallback to cache/readBinary below
    }

    // Check cached ObjectURL fallback
    const cached = this.resourceCache.get(path);
    if (cached) {
      return cached;
    }

    // Read binary, construct Blob ObjectURL and cache
    try {
      const blob = await this.readBinary(path);
      const objectUrl = URL.createObjectURL(blob);
      this.resourceCache.set(path, objectUrl);
      return objectUrl;
    } catch (err) {
      console.error(`[LocalAdapter] Error resolving resource path for "${path}":`, err);
      return '';
    }
  }

  async read(path: string): Promise<string> {
    return await invoke<string>('read_file', { filePath: path });
  }

  async write(path: string, content: string): Promise<void> {
    await invoke('write_file', { filePath: path, content });
  }

  clearCache(): void {
    for (const url of this.resourceCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.resourceCache.clear();
  }
}

/**
 * Google Drive implementation of StorageAdapter
 */
export class GoogleDriveAdapter implements StorageAdapter {
  private localFallback = new LocalAdapter();

  async writeBinary(path: string, data: ArrayBuffer | Blob | Uint8Array): Promise<void> {
    // Write locally first so sync engine can mirror to Drive
    await this.localFallback.writeBinary(path, data);
  }

  async readBinary(path: string): Promise<Blob> {
    return await this.localFallback.readBinary(path);
  }

  async getResourcePath(path: string): Promise<string> {
    return await this.localFallback.getResourcePath(path);
  }

  async read(path: string): Promise<string> {
    return await this.localFallback.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.localFallback.write(path, content);
  }
}

// Global default adapter singleton
let currentAdapter: StorageAdapter = new LocalAdapter();

export function getStorageAdapter(): StorageAdapter {
  return currentAdapter;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  currentAdapter = adapter;
}
