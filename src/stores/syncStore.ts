import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  SyncStatus,
  SyncLog,
  SyncLogEvent,
  SyncProgress,
  GoogleUserProfile,
  RemoteVaultInfo,
  SyncSummary,
} from '../types';
import { t, hasTranslation } from '../locales/i18n';

/**
 * Google Drive sync state (Obsidian-like "Sync" core plugin backed by Drive API v3).
 *
 * - Credentials: the OAuth client lives only in the Rust backend (`.env` or the built-in
 *   client); the UI never asks the user for a client id / secret.
 * - Layout: every vault is mirrored to `Urano Vaults/<vaultName>` in the user's Drive.
 * - Session: `google_check_auth` on startup silently refreshes the access token with the
 *   stored refresh token, so the user stays signed in across launches.
 * - Auto-sync: `notifyVaultChanged` is called by `vaultStore` after every save / create /
 *   rename / delete and debounces `sync_vault_with_drive` by {@link AUTO_SYNC_DEBOUNCE_MS}.
 *   Changes notified while a sync is running are coalesced into one follow-up sync.
 *   `App.tsx` runs an immediate sync as soon as session + vault + connection are ready.
 * - Progress: Rust emits `drive-sync:progress` per file; the modal and the status bar show
 *   "Syncing… 3/12 · note.md" and then "Synced: X files uploaded".
 * - Activity log: frontend entries plus per-file events emitted by Rust (`drive-sync:log`).
 */
export const AUTO_SYNC_DEBOUNCE_MS = 3000;
export const REMOTE_ROOT_FOLDER = 'Urano Vaults';
const MAX_LOG_ENTRIES = 200;

const LS_AUTO_SYNC = 'urano_auto_sync';
const LS_LAST_SYNCED = 'urano_last_synced';
const LS_LAST_SYNCED_TS = 'urano_last_synced_ts';

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
/** Change notified while a sync was already running → re-run once it finishes. */
let pendingResync: { vaultPath: string; vaultName?: string } | null = null;

const readLS = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLS = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable */
  }
};

const formatClock = (date: Date, withSeconds = false): string =>
  date.toLocaleTimeString(
    [],
    withSeconds
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' }
  );

const errorText = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
};

const isBrowserOnline = (): boolean =>
  typeof navigator === 'undefined' ? true : navigator.onLine !== false;

const vaultNameFromPath = (vaultPath: string): string =>
  vaultPath.split(/[/\\]/).filter(Boolean).pop() || 'Urano Vault';

export interface SyncStoreState {
  /** Current sync state (`syncStatus` is an alias kept for older call sites). */
  status: SyncStatus;
  syncStatus: SyncStatus;
  /** Last successful sync as a localized clock string (`lastSyncTime` is an alias). */
  lastSynced: string | null;
  lastSyncTime: string | null;
  /** Last successful sync as epoch milliseconds (for "X min ago" tooltips). */
  lastSyncTimestamp: number | null;
  /** Counts of the last finished pass ("Synced: 5 files uploaded"). */
  lastSummary: SyncSummary | null;
  /** Live per-file progress while a sync/download runs; `null` when idle. */
  progress: SyncProgress | null;
  /** A local change is waiting for the debounced auto-sync (or for a session/connection). */
  hasPendingChanges: boolean;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  user: GoogleUserProfile | null;
  userEmail: string | null;
  userName: string | null;
  userAvatar: string | null;
  isSyncing: boolean;
  isOnline: boolean;
  autoSyncEnabled: boolean;
  /** Exact last error from Rust/Drive, shown in red in the Google Drive modal. */
  errorMessage: string | null;
  logs: SyncLog[];
  syncLogs: SyncLog[];
  remoteVaults: RemoteVaultInfo[];
  isLoadingVaults: boolean;
  showConfigModal: boolean;

  // Actions
  setShowConfigModal: (show: boolean) => void;
  setAutoSyncEnabled: (enabled: boolean) => void;
  checkAuthStatus: () => Promise<void>;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => Promise<void>;
  fetchRemoteVaults: () => Promise<RemoteVaultInfo[]>;
  downloadRemoteVault: (remoteFolderId: string, localDestPath: string) => Promise<boolean>;
  /** Runs a full differential sync now (manual "Sync now" or the debounced auto-sync). */
  triggerSync: (vaultPath: string, vaultName?: string) => Promise<SyncSummary | null>;
  /** Called by `vaultStore` after each change; debounces an automatic background sync. */
  notifyVaultChanged: (vaultPath: string, vaultName?: string) => void;
  cancelPendingAutoSync: () => void;
  handleConnectivityChange: (online: boolean) => void;
  handleBackendLogEvent: (event: SyncLogEvent) => void;
  handleProgressEvent: (event: SyncProgress) => void;
  addLog: (message: string, type?: SyncLog['type']) => void;
  clearLogs: () => void;
}

export const useSyncStore = create<SyncStoreState>((set, get) => {
  const initialAutoSync = readLS(LS_AUTO_SYNC) !== 'false';
  const initialLastSynced = readLS(LS_LAST_SYNCED);
  const storedTs = Number(readLS(LS_LAST_SYNCED_TS));
  const initialLastSyncTs = Number.isFinite(storedTs) && storedTs > 0 ? storedTs : null;

  const applyStatus = (status: SyncStatus) => set({ status, syncStatus: status });

  const markSynced = (date: Date) => {
    const clock = formatClock(date);
    writeLS(LS_LAST_SYNCED, clock);
    writeLS(LS_LAST_SYNCED_TS, String(date.getTime()));
    set({ lastSynced: clock, lastSyncTime: clock, lastSyncTimestamp: date.getTime() });
  };

  const applyProfile = (profile: GoogleUserProfile | null) =>
    set({
      isAuthenticated: Boolean(profile),
      user: profile,
      userEmail: profile?.email ?? null,
      userName: profile?.name ?? null,
      userAvatar: profile?.picture ?? null,
    });

  return {
    status: 'idle',
    syncStatus: 'idle',
    lastSynced: initialLastSynced,
    lastSyncTime: initialLastSynced,
    lastSyncTimestamp: initialLastSyncTs,
    lastSummary: null,
    progress: null,
    hasPendingChanges: false,
    isAuthenticated: false,
    isAuthenticating: false,
    user: null,
    userEmail: null,
    userName: null,
    userAvatar: null,
    isSyncing: false,
    isOnline: isBrowserOnline(),
    autoSyncEnabled: initialAutoSync,
    errorMessage: null,
    logs: [],
    syncLogs: [],
    remoteVaults: [],
    isLoadingVaults: false,
    showConfigModal: false,

    setShowConfigModal: (show) => set({ showConfigModal: show }),

    setAutoSyncEnabled: (enabled) => {
      writeLS(LS_AUTO_SYNC, enabled ? 'true' : 'false');
      set({ autoSyncEnabled: enabled });
      if (!enabled) get().cancelPendingAutoSync();
      get().addLog(t(enabled ? 'sync.log.autoSyncOn' : 'sync.log.autoSyncOff'), 'info');
    },

    addLog: (message, type = 'info') => {
      const entry: SyncLog = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: formatClock(new Date(), true),
        message,
        type,
      };
      set((state) => {
        const logs = [entry, ...state.logs].slice(0, MAX_LOG_ENTRIES);
        return { logs, syncLogs: logs };
      });
    },

    clearLogs: () => set({ logs: [], syncLogs: [] }),

    checkAuthStatus: async () => {
      try {
        // Silent refresh: the Rust side renews the access token with the stored refresh token.
        const profile = await invoke<GoogleUserProfile | null>('google_check_auth');
        const online = isBrowserOnline();
        set({ isOnline: online });
        if (profile && profile.email) {
          applyProfile(profile);
          applyStatus(online ? 'idle' : 'offline');
          get().addLog(t('sync.log.sessionRestored', { email: profile.email }), 'info');
        } else {
          applyProfile(null);
          applyStatus('idle');
        }
      } catch (err) {
        const message = errorText(err);
        set({ errorMessage: message });
        console.warn('Error al verificar autenticación de Google:', err);
      }
    },

    loginWithGoogle: async () => {
      const { addLog, isAuthenticating } = get();
      if (isAuthenticating) return false;
      set({ isAuthenticating: true });
      addLog(t('sync.log.startingAuth'), 'info');
      try {
        const profile = await invoke<GoogleUserProfile>('google_oauth_login');
        if (profile && profile.email) {
          applyProfile(profile);
          set({ errorMessage: null });
          applyStatus(isBrowserOnline() ? 'idle' : 'offline');
          addLog(t('sync.log.authSuccessUser', { name: profile.name }), 'success');
          // App.tsx reacts to `isAuthenticated` and syncs the open vault right away.
          return true;
        }
        addLog(t('sync.log.authNotCompleted'), 'warn');
        return false;
      } catch (err) {
        addLog(t('sync.log.authError', { error: errorText(err) }), 'error');
        return false;
      } finally {
        set({ isAuthenticating: false });
      }
    },

    logout: async () => {
      get().cancelPendingAutoSync();
      try {
        await invoke('google_logout');
      } catch (err) {
        console.error('Error al cerrar sesión:', err);
      }
      applyProfile(null);
      applyStatus('idle');
      set({
        remoteVaults: [],
        progress: null,
        lastSummary: null,
        errorMessage: null,
        showConfigModal: false,
      });
      get().addLog(t('sync.log.loggedOut'), 'info');
    },

    fetchRemoteVaults: async () => {
      if (!get().isAuthenticated) return [];
      set({ isLoadingVaults: true });
      try {
        const vaults = await invoke<RemoteVaultInfo[]>('list_remote_drive_vaults');
        set((state) => ({
          remoteVaults: vaults,
          isLoadingVaults: false,
          // A successful listing must not erase the error of a failed sync pass.
          errorMessage: state.status === 'error' ? state.errorMessage : null,
        }));
        return vaults;
      } catch (err) {
        const message = errorText(err);
        set({ isLoadingVaults: false, errorMessage: message });
        console.error('[Drive Sync] list_remote_drive_vaults falló:', message);
        get().addLog(t('sync.log.listVaultsError', { error: message }), 'error');
        return [];
      }
    },

    downloadRemoteVault: async (remoteFolderId, localDestPath) => {
      const { addLog, isSyncing } = get();
      if (isSyncing) return false;
      set({
        isSyncing: true,
        progress: { phase: 'scan', current: 0, total: 0, file: null },
        errorMessage: null,
      });
      applyStatus('syncing');
      addLog(t('sync.log.downloadingVault', { path: localDestPath }), 'info');
      try {
        const summary = await invoke<SyncSummary>('download_remote_vault', {
          remoteFolderId,
          localDestPath,
        });
        markSynced(new Date());
        set({ lastSummary: summary });
        applyStatus(summary.errors > 0 ? 'error' : 'synced');
        if (summary.errors > 0) {
          set({ errorMessage: summary.message });
        }
        addLog(
          t('sync.log.downloadDone', { downloaded: summary.downloaded, errors: summary.errors }),
          summary.errors > 0 ? 'warn' : 'success'
        );
        return true;
      } catch (err) {
        const message = errorText(err);
        applyStatus('error');
        set({ errorMessage: message });
        addLog(t('sync.log.downloadError', { error: message }), 'error');
        return false;
      } finally {
        set({ isSyncing: false, progress: null });
      }
    },

    triggerSync: async (vaultPath, vaultName) => {
      const { isSyncing, isAuthenticated, isOnline, addLog } = get();
      if (!vaultPath) return null;
      if (!isAuthenticated) {
        addLog(t('sync.log.loginRequired'), 'warn');
        return null;
      }
      if (!isOnline) {
        applyStatus('offline');
        addLog(t('sync.log.offline'), 'warn');
        return null;
      }
      if (isSyncing) {
        // Coalesce: run once more when the current pass finishes.
        pendingResync = { vaultPath, vaultName };
        return null;
      }

      if (autoSyncTimer) {
        clearTimeout(autoSyncTimer);
        autoSyncTimer = null;
      }

      const resolvedVaultName = vaultName || vaultNameFromPath(vaultPath);
      set({
        isSyncing: true,
        progress: { phase: 'scan', current: 0, total: 0, file: null },
        errorMessage: null,
      });
      applyStatus('syncing');
      addLog(t('sync.log.syncingVault', { name: resolvedVaultName }), 'info');

      try {
        const summary = await invoke<SyncSummary>('sync_vault_with_drive', {
          vaultPath,
          vaultName: resolvedVaultName,
        });
        markSynced(new Date());
        set({ lastSummary: summary, hasPendingChanges: pendingResync !== null });
        const counts = {
          uploaded: summary.uploaded,
          downloaded: summary.downloaded,
          deleted: summary.deleted ?? 0,
          conflicts: summary.conflicts,
          errors: summary.errors ?? 0,
        };
        if (summary.errors > 0) {
          // Per-file errors arrive as `drive-sync:log`; keep the exact detail when present.
          set((state) => ({ errorMessage: state.errorMessage ?? summary.message }));
          applyStatus('error');
          addLog(t('sync.log.syncDoneWithErrors', counts), 'warn');
        } else if (summary.conflicts > 0) {
          applyStatus('conflict');
          addLog(t('sync.log.syncConflicts', counts), 'warn');
        } else {
          applyStatus('synced');
          set({ errorMessage: null });
          addLog(t('sync.log.syncDone', counts), 'success');
        }
        // Refresh "Vaults in Google Drive" immediately so the new vault appears as
        // "Connected" and the status badge switches to "Synced".
        void get().fetchRemoteVaults();
        return summary;
      } catch (err) {
        const message = errorText(err);
        applyStatus(isBrowserOnline() ? 'error' : 'offline');
        set({ errorMessage: message });
        console.error('[Drive Sync] sync_vault_with_drive falló:', message);
        addLog(t('sync.log.syncError', { error: message }), 'error');
        return null;
      } finally {
        set({ isSyncing: false, progress: null });
        if (pendingResync) {
          const next = pendingResync;
          pendingResync = null;
          get().notifyVaultChanged(next.vaultPath, next.vaultName);
        }
      }
    },

    notifyVaultChanged: (vaultPath, vaultName) => {
      if (!vaultPath) return;
      set({ hasPendingChanges: true });
      const { isAuthenticated, autoSyncEnabled, isSyncing, isOnline } = get();
      if (!isAuthenticated || !autoSyncEnabled || !isOnline) return;
      if (isSyncing) {
        pendingResync = { vaultPath, vaultName };
        return;
      }
      if (autoSyncTimer) clearTimeout(autoSyncTimer);
      autoSyncTimer = setTimeout(() => {
        autoSyncTimer = null;
        void get().triggerSync(vaultPath, vaultName);
      }, AUTO_SYNC_DEBOUNCE_MS);
    },

    cancelPendingAutoSync: () => {
      if (autoSyncTimer) {
        clearTimeout(autoSyncTimer);
        autoSyncTimer = null;
      }
      pendingResync = null;
    },

    handleConnectivityChange: (online) => {
      if (get().isOnline === online) return;
      set({ isOnline: online });
      if (!online) {
        get().cancelPendingAutoSync();
        applyStatus('offline');
        get().addLog(t('sync.log.offline'), 'warn');
      } else {
        // App.tsx re-launches the sync when `isOnline` flips back to true.
        if (get().status === 'offline') applyStatus('idle');
        get().addLog(t('sync.log.backOnline'), 'info');
      }
    },

    handleBackendLogEvent: (event) => {
      const key = `sync.log.event.${event.kind}`;
      const params = { file: event.file ?? '', detail: event.detail ?? '' };
      const message = hasTranslation(key)
        ? t(key, params)
        : `${event.kind}: ${event.file ?? ''}`.trim();
      const type: SyncLog['type'] =
        event.kind === 'error' ? 'error' : event.kind === 'conflict' ? 'warn' : 'info';
      if (event.kind === 'error') {
        const detail = event.detail || event.file || message;
        set({ errorMessage: detail });
      }
      get().addLog(message, type);
    },

    handleProgressEvent: (event) => {
      if (!get().isSyncing) return;
      set({ progress: event });
    },
  };
});

/* ---------------------------------------------------------------------- */
/* Global listeners (connectivity + per-file events from the Rust engine) */
/* ---------------------------------------------------------------------- */

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useSyncStore.getState().handleConnectivityChange(true));
  window.addEventListener('offline', () => useSyncStore.getState().handleConnectivityChange(false));
  listen<SyncLogEvent>('drive-sync:log', (event) => {
    useSyncStore.getState().handleBackendLogEvent(event.payload);
  }).catch(() => {
    /* not running inside Tauri (browser dev) */
  });
  listen<SyncProgress>('drive-sync:progress', (event) => {
    useSyncStore.getState().handleProgressEvent(event.payload);
  }).catch(() => {
    /* not running inside Tauri (browser dev) */
  });
}
