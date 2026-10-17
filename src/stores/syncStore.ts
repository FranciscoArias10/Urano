import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { SyncState, SyncLog, GoogleUser } from '../types';

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
      addLog('Ingresa tus credenciales de Google OAuth para continuar.', 'warn');
      return;
    }

    try {
      set({ status: 'syncing' });
      addLog('Iniciando flujo de autenticación OAuth 2.0 PKCE...', 'info');
      
      const success = await invoke<boolean>('start_oauth_login', {
        clientId,
        clientSecret,
      });

      if (success) {
        const user = await invoke<GoogleUser | null>('get_google_user');
        set({ isAuthenticated: true, user, status: 'synced' });
        addLog(`Autenticación exitosa${user?.name ? `: ${user.name}` : ''}`, 'success');
      } else {
        set({ status: 'error' });
        addLog('No se completó la autorización de Google.', 'error');
      }
    } catch (err: any) {
      set({ status: 'error' });
      addLog(`Error en autenticación: ${err?.message || err}`, 'error');
    }
  },

  logout: async () => {
    try {
      await invoke('logout_google');
      set({ isAuthenticated: false, user: null, status: 'idle' });
      get().addLog('Sesión de Google Drive cerrada.', 'info');
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
    }
  },

  triggerSync: async (vaultPath: string) => {
    const { isSyncing, isAuthenticated, folderName, addLog } = get();
    if (isSyncing) return;

    if (!isAuthenticated) {
      addLog('Inicia sesión en Google Drive para sincronizar.', 'warn');
      get().loginWithGoogle();
      return;
    }

    try {
      set({ isSyncing: true, status: 'syncing' });
      addLog('Iniciando sincronización diferencial con Google Drive...', 'info');

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
          `Sincronización finalizada con ${result.conflicts} conflicto(s) resueltos sin pérdida. Subidos: ${result.uploaded}, Descargados: ${result.downloaded}`,
          'warn'
        );
      } else {
        set({ status: 'synced', lastSynced: now, isSyncing: false });
        addLog(
          `Bóveda sincronizada. Subidos: ${result.uploaded}, Descargados: ${result.downloaded}`,
          'success'
        );
      }
    } catch (err: any) {
      set({ status: 'error', isSyncing: false });
      addLog(`Error de sincronización: ${err?.message || err}`, 'error');
    }
  },
}));
