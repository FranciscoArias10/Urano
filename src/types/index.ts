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
