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

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'conflict';
export type SyncState = SyncStatus;

export interface SyncLog {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error';
}
export type SyncLogEntry = SyncLog;

export interface GoogleUserProfile {
  email: string;
  name: string;
  picture?: string;
}
export type GoogleUser = GoogleUserProfile;

export interface RemoteVaultInfo {
  id: string;
  name: string;
  modified_time?: string;
  file_count?: number;
}

export interface SyncSummary {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  /** Files that failed in this pass (the sync keeps going and retries next time). */
  errors: number;
  total: number;
  message: string;
  timestamp: string;
}

/** Per-file event emitted by the Rust sync engine (`drive-sync:log`). */
export interface SyncLogEvent {
  kind: 'upload' | 'download' | 'trash' | 'local_trash' | 'conflict' | 'error' | (string & {});
  file?: string | null;
  detail?: string | null;
}

/** Live progress emitted by the Rust sync engine (`drive-sync:progress`). */
export interface SyncProgress {
  phase: 'scan' | 'upload' | 'download' | 'done' | (string & {});
  current: number;
  total: number;
  file?: string | null;
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

