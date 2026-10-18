export interface FileItem {
  path: string;
  name: string;
  isDir: boolean;
  children?: FileItem[];
  mtime?: number;
  size?: number;
}

export interface Vault {
  path: string;
  name: string;
}

export type SyncState = 'synced' | 'syncing' | 'idle' | 'offline' | 'error' | 'conflict';

export interface SyncLog {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

export interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

export interface GraphNode {
  id: string;
  name: string;
  val: number;
  color?: string;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type SortOrder =
  | 'name-asc'
  | 'name-desc'
  | 'mtime-desc'
  | 'mtime-asc'
  | 'ctime-desc'
  | 'ctime-asc';

export interface BookmarkItem {
  id: string;
  type: 'file' | 'folder' | 'search';
  path: string;
  title: string;
  query?: string;
  createdAt?: number;
}

