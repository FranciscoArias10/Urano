import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { SyncState, SyncLog, GoogleUser } from '../types';
import { t } from '../locales/i18n';

interface SyncStoreState {
  status: SyncState;
  lastSynced: string | null;
  isAuthenticated: boolean;
  user: GoogleUser | null;
  isSyncing: boolean;
  logs: SyncLog[];
  showConfigModal: boolean;
  clientId: string;
  clientSecret: string;
  folderName: string;

  // Actions
  setShowConfigModal: (show: boolean) => void;
  setCredentials: (clientId: string, clientSecret: string, folderName?: string) => void;
  checkAuthStatus: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  triggerSync: (vaultPath: string) => Promise<void>;
  addLog: (message: string, type?: SyncLog['type']) => void;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: 'idle',
  lastSynced: localStorage.getItem('urano_last_synced') || null,
  isAuthenticated: false,
  user: null,
  isSyncing: false,
  logs: [],
  showConfigModal: false,
  clientId: localStorage.getItem('urano_gdrive_client_id') || '',
  clientSecret: localStorage.getItem('urano_gdrive_client_secret') || '',
  folderName: localStorage.getItem('urano_gdrive_folder_name') || 'UranoVault',

  setShowConfigModal: (show: boolean) => set({ showConfigModal: show }),

  setCredentials: (clientId: string, clientSecret: string, folderName = 'UranoVault') => {
    localStorage.setItem('urano_gdrive_client_id', clientId);
    localStorage.setItem('urano_gdrive_client_secret', clientSecret);
    localStorage.setItem('urano_gdrive_folder_name', folderName);
    set({ clientId, clientSecret, folderName });
  },

  addLog: (message: string, type: SyncLog['type'] = 'info') => {
    const newLog: SyncLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    };
    set((state) => ({ logs: [newLog, ...state.logs.slice(0, 49)] }));
  },

  checkAuthStatus: async () => {
    try {
      const isAuthed = await invoke<boolean>('is_authenticated');
      if (isAuthed) {
        const user = await invoke<GoogleUser | null>('get_google_user');
        set({ isAuthenticated: true, user, status: 'synced' });
      } else {
        set({ isAuthenticated: false, user: null, status: 'idle' });
      }
    } catch (err) {
      console.warn('Error al verificar estado de autenticación:', err);
    }
  },

  loginWithGoogle: async () => {
    const { clientId, clientSecret, addLog } = get();
    if (!clientId) {
      set({ showConfigModal: true });
      addLog(t('sync.log.enterCredentials'), 'warn');
      return;
    }

    try {
      set({ status: 'syncing' });
      addLog(t('sync.log.startingAuth'), 'info');

      const success = await invoke<boolean>('start_oauth_login', {
        clientId,
        clientSecret,
      });

      if (success) {
        const user = await invoke<GoogleUser | null>('get_google_user');
        set({ isAuthenticated: true, user, status: 'synced' });
        addLog(
          user?.name ? t('sync.log.authSuccessUser', { name: user.name }) : t('sync.log.authSuccess'),
          'success'
        );
      } else {
        set({ status: 'error' });
        addLog(t('sync.log.authNotCompleted'), 'error');
      }
    } catch (err: any) {
      set({ status: 'error' });
      addLog(t('sync.log.authError', { error: err?.message || err }), 'error');
    }
  },

  logout: async () => {
    try {
      await invoke('logout_google');
      set({ isAuthenticated: false, user: null, status: 'idle' });
      get().addLog(t('sync.log.loggedOut'), 'info');
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
    }
  },

  triggerSync: async (vaultPath: string) => {
    const { isSyncing, isAuthenticated, folderName, addLog } = get();
    if (isSyncing) return;

    if (!isAuthenticated) {
      addLog(t('sync.log.loginRequired'), 'warn');
      get().loginWithGoogle();
      return;
    }

    try {
      set({ isSyncing: true, status: 'syncing' });
      addLog(t('sync.log.startingSync'), 'info');

      const result = await invoke<{
        uploaded: number;
        downloaded: number;
        conflicts: number;
        total: number;
      }>('sync_vault', {
        vaultPath,
        remoteFolderName: folderName,
      });

      const now = new Date().toLocaleTimeString();
      localStorage.setItem('urano_last_synced', now);

      if (result.conflicts > 0) {
        set({ status: 'conflict', lastSynced: now, isSyncing: false });
        addLog(
          t('sync.log.syncConflicts', {
            conflicts: result.conflicts,
            uploaded: result.uploaded,
            downloaded: result.downloaded,
          }),
          'warn'
        );
      } else {
        set({ status: 'synced', lastSynced: now, isSyncing: false });
        addLog(
          t('sync.log.syncDone', { uploaded: result.uploaded, downloaded: result.downloaded }),
          'success'
        );
      }
    } catch (err: any) {
      set({ status: 'error', isSyncing: false });
      addLog(t('sync.log.syncError', { error: err?.message || err }), 'error');
    }
  },
}));
