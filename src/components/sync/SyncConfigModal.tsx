import React, { useCallback, useEffect, useState } from 'react';
import { open as openFolderDialog } from '@tauri-apps/plugin-dialog';
import {
  X,
  FolderSync,
  ShieldCheck,
  RefreshCw,
  Loader2,
  Folder,
  Cloud,
  CloudDownload,
  Check,
  CloudOff,
  AlertTriangle,
  LogIn,
  Vault,
} from 'lucide-react';
import { useSyncStore } from '../../stores/syncStore';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';
import { useNoticeStore } from '../common/Notice';
import type { RemoteVaultInfo, SyncProgress } from '../../types';

/**
 * Settings → General → Account → "Manage": the Google Drive panel for end users.
 *
 * It never shows OAuth client ids / secrets or the remote root folder: those live in the Rust
 * backend (`.env` or the built-in client) and every vault is mirrored to
 * `Urano Vaults/<vaultName>`. The modal only offers:
 *   1. the connected account (avatar, name, email, log out);
 *   2. the open local vault with its sync state, live progress, "Sync now" and the auto-sync
 *      switch;
 *   3. the vaults found in `Urano Vaults` on Drive: "Connected" for the open one, "Download and
 *      open" for the others (native folder picker → download → open in Urano).
 */

/**
 * Sustituye los marcadores `{name}` de una cadena traducida por nodos React (para
 * conservar <strong>/<code>/<em> dentro de un único texto traducible).
 */
function richText(template: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/).map((chunk, i) => {
    const match = /^\{(\w+)\}$/.exec(chunk);
    if (match && match[1] in parts) {
      return <React.Fragment key={i}>{parts[match[1]]}</React.Fragment>;
    }
    return chunk;
  });
}

type VaultSyncState = 'syncing' | 'synced' | 'pending' | 'conflict' | 'offline' | 'error';

/** Obsidian-style switch (40×22 track, 18 px thumb); the settings `Toggle` CSS is scoped to the
 *  settings modal, so the Drive panel carries its own. */
const Switch: React.FC<{ value: boolean; onChange: (value: boolean) => void; ariaLabel: string }> = ({
  value,
  onChange,
  ariaLabel,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={value}
    aria-label={ariaLabel}
    onClick={() => onChange(!value)}
    className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-accent)]/50 ${
      value ? 'bg-[var(--interactive-accent)]' : 'bg-[var(--background-modifier-border-hover,#4a4a4f)]'
    }`}
  >
    <span
      className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${
        value ? 'translate-x-[18px]' : 'translate-x-0'
      }`}
    />
  </button>
);

const STATE_STYLE: Record<VaultSyncState, string> = {
  syncing: 'text-[var(--interactive-accent)] bg-[var(--interactive-accent)]/10 border-[var(--interactive-accent)]/30',
  synced: 'text-[var(--color-green)] bg-[var(--color-green)]/10 border-[var(--color-green)]/30',
  pending: 'text-[var(--color-yellow)] bg-[var(--color-yellow)]/10 border-[var(--color-yellow)]/30',
  conflict: 'text-[var(--color-yellow)] bg-[var(--color-yellow)]/10 border-[var(--color-yellow)]/30',
  offline: 'text-[var(--color-red)] bg-[var(--color-red)]/10 border-[var(--color-red)]/30',
  error: 'text-[var(--color-red)] bg-[var(--color-red)]/10 border-[var(--color-red)]/30',
};

const StateIcon: React.FC<{ state: VaultSyncState }> = ({ state }) => {
  switch (state) {
    case 'syncing':
      return <Loader2 size={11} className="animate-spin" />;
    case 'synced':
      return <Check size={11} strokeWidth={2.5} />;
    case 'offline':
      return <CloudOff size={11} />;
    case 'error':
    case 'conflict':
      return <AlertTriangle size={11} />;
    default:
      return <RefreshCw size={11} />;
  }
};

/** "Uploading 3/12 · note.md" while the Rust engine streams `drive-sync:progress`. */
export function describeProgress(
  t: (key: string, params?: Record<string, string | number>) => string,
  progress: SyncProgress | null
): string {
  if (!progress) return t('sync.config.progress.scan');
  switch (progress.phase) {
    case 'upload':
      return t('sync.config.progress.upload', { current: progress.current, total: progress.total });
    case 'download':
      return t('sync.config.progress.download', { current: progress.current, total: progress.total });
    case 'done':
      return t('sync.config.progress.done');
    default:
      return t('sync.config.progress.scan');
  }
}

export const SyncConfigModal: React.FC = () => {
  const t = useT();
  const showNotice = useNoticeStore((s) => s.showNotice);

  const showConfigModal = useSyncStore((s) => s.showConfigModal);
  const setShowConfigModal = useSyncStore((s) => s.setShowConfigModal);
  const isAuthenticated = useSyncStore((s) => s.isAuthenticated);
  const isAuthenticating = useSyncStore((s) => s.isAuthenticating);
  const user = useSyncStore((s) => s.user);
  const loginWithGoogle = useSyncStore((s) => s.loginWithGoogle);
  const logout = useSyncStore((s) => s.logout);
  const status = useSyncStore((s) => s.status);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const isOnline = useSyncStore((s) => s.isOnline);
  const progress = useSyncStore((s) => s.progress);
  const lastSynced = useSyncStore((s) => s.lastSynced);
  const lastSummary = useSyncStore((s) => s.lastSummary);
  const errorMessage = useSyncStore((s) => s.errorMessage);
  const hasPendingChanges = useSyncStore((s) => s.hasPendingChanges);
  const autoSyncEnabled = useSyncStore((s) => s.autoSyncEnabled);
  const setAutoSyncEnabled = useSyncStore((s) => s.setAutoSyncEnabled);
  const triggerSync = useSyncStore((s) => s.triggerSync);
  const remoteVaults = useSyncStore((s) => s.remoteVaults);
  const isLoadingVaults = useSyncStore((s) => s.isLoadingVaults);
  const fetchRemoteVaults = useSyncStore((s) => s.fetchRemoteVaults);
  const downloadRemoteVault = useSyncStore((s) => s.downloadRemoteVault);

  const activeVault = useVaultStore((s) => s.activeVault);
  const vaultName = useVaultStore((s) => s.vaultName);
  const setVault = useVaultStore((s) => s.setVault);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Refresh the remote list every time the panel opens with a session.
  useEffect(() => {
    if (showConfigModal && isAuthenticated) void fetchRemoteVaults();
  }, [showConfigModal, isAuthenticated, fetchRemoteVaults]);

  const close = useCallback(() => setShowConfigModal(false), [setShowConfigModal]);

  useEffect(() => {
    if (!showConfigModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConfigModal, close]);

  if (!showConfigModal) return null;

  const vaultState: VaultSyncState = isSyncing
    ? 'syncing'
    : !isOnline || status === 'offline'
    ? 'offline'
    : status === 'error'
    ? 'error'
    : hasPendingChanges
    ? 'pending'
    : status === 'conflict'
    ? 'conflict'
    : status === 'synced' || lastSynced
    ? 'synced'
    : 'pending';

  const handleSyncNow = async () => {
    if (!activeVault) return;
    // `triggerSync` refreshes `remoteVaults` automatically once the pass finishes.
    await triggerSync(activeVault, vaultName ?? undefined);
  };

  const handleDownload = async (remote: RemoteVaultInfo) => {
    if (downloadingId || isSyncing) return;
    try {
      const selected = await openFolderDialog({
        directory: true,
        multiple: false,
        title: t('vaultManager.remote.chooseFolder', { name: remote.name }),
      });
      if (!selected || typeof selected !== 'string') return;
      const destPath = `${selected.replace(/[\\/]+$/, '')}/${remote.name}`;
      setDownloadingId(remote.id);
      const ok = await downloadRemoteVault(remote.id, destPath);
      if (ok) {
        await setVault(destPath);
        showNotice(t('sync.config.remote.opened', { name: remote.name }), 4000, 'success');
        close();
      }
    } catch (err) {
      console.error('Error al descargar la bóveda remota:', err);
      showNotice(t('sync.log.downloadError', { error: String(err) }), 5000, 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : null;

  const lastResult =
    !isSyncing && lastSummary
      ? t('sync.config.lastResult', {
          uploaded: lastSummary.uploaded,
          downloaded: lastSummary.downloaded,
        })
      : null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--background-modifier-cover)] backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('sync.config.title')}
        className="bg-obsidian-sidebar border border-obsidian-border rounded-xl w-full max-w-lg max-h-[85vh] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-obsidian-border bg-obsidian-bg/50">
          <div className="flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-semibold text-obsidian-text">{t('sync.config.title')}</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-obsidian-muted hover:text-obsidian-text p-1 rounded-md transition-colors cursor-pointer"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs overflow-y-auto">
          {/* Account */}
          {isAuthenticated && user ? (
            <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-9 h-9 rounded-full border border-emerald-500/50 shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-emerald-600/30 text-emerald-300 flex items-center justify-center font-bold shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-obsidian-text font-medium text-[13px] truncate">{user.name}</div>
                  <div className="text-emerald-400 text-[11px] truncate">{user.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2.5 py-1 rounded transition-colors cursor-pointer shrink-0"
              >
                {t('sync.config.logout')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-obsidian-text flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-obsidian-text">{t('sync.config.privacyTitle')}</span>
                  <p className="text-[11px] text-obsidian-muted mt-0.5">
                    {richText(t('sync.config.privacyBody'), {
                      scope: (
                        <code className="text-orange-300 bg-orange-950/40 px-1 py-0.5 rounded">drive.file</code>
                      ),
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isAuthenticating}
                onClick={() => void loginWithGoogle()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white font-medium transition-colors shadow-lg shadow-orange-600/20 cursor-pointer"
              >
                {isAuthenticating ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                {isAuthenticating ? t('settings.sync.connecting') : t('settings.sync.connect')}
              </button>
            </div>
          )}

          {isAuthenticated && (
            <>
              {/* Section 1 — current local vault */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-obsidian-muted mb-2">
                  {t('sync.config.localVault.title')}
                </h3>
                <div className="rounded-lg border border-obsidian-border bg-obsidian-bg p-3.5 space-y-3">
                  {activeVault ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded bg-obsidian-sidebar text-orange-400 shrink-0">
                            <Vault size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-obsidian-text truncate">{vaultName}</div>
                            <div className="text-[11px] text-obsidian-muted truncate" title={activeVault}>
                              {activeVault}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0 ${STATE_STYLE[vaultState]}`}
                        >
                          <StateIcon state={vaultState} />
                          {t(`sync.config.state.${vaultState}`)}
                        </span>
                      </div>

                      {isSyncing ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-obsidian-muted">
                            <span className="truncate">{describeProgress(t, progress)}</span>
                            {percent !== null && <span className="font-mono shrink-0 ml-2">{percent}%</span>}
                          </div>
                          <div className="h-1.5 rounded-full bg-obsidian-sidebar overflow-hidden">
                            <div
                              className={`h-full rounded-full bg-[var(--interactive-accent)] transition-[width] duration-200 ${
                                percent === null ? 'w-1/3 animate-pulse' : ''
                              }`}
                              style={percent === null ? undefined : { width: `${percent}%` }}
                            />
                          </div>
                          {progress?.file && (
                            <div className="text-[11px] text-obsidian-faint truncate font-mono">{progress.file}</div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-[11px] text-obsidian-muted">
                            {lastSynced
                              ? t('sync.config.lastSynced', { time: lastSynced })
                              : t('sync.config.neverSynced')}
                            {lastResult ? ` · ${lastResult}` : ''}
                          </div>
                          {errorMessage && (
                            <div
                              role="alert"
                              className="text-[11px] leading-snug text-[var(--color-red)] whitespace-pre-wrap break-words select-text"
                            >
                              {errorMessage}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-obsidian-border">
                        <div className="flex items-center gap-2.5">
                          <Switch
                            value={autoSyncEnabled}
                            onChange={setAutoSyncEnabled}
                            ariaLabel={t('sync.config.autoSync')}
                          />
                          <span className="text-obsidian-text">{t('sync.config.autoSync')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSyncNow()}
                          disabled={isSyncing || !isOnline}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors shadow-lg shadow-orange-600/20 cursor-pointer"
                        >
                          <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                          {isSyncing ? t('sync.config.state.syncing') : t('sync.config.syncNow')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="py-4 text-center text-obsidian-muted">{t('sync.config.localVault.none')}</div>
                  )}
                </div>
              </section>

              {/* Section 2 — vaults in Google Drive */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-obsidian-muted">
                    {t('sync.config.remote.title')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => void fetchRemoteVaults()}
                    disabled={isLoadingVaults}
                    className="p-1 rounded text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-hover transition-colors cursor-pointer disabled:opacity-50"
                    title={t('common.refresh')}
                    aria-label={t('common.refresh')}
                  >
                    <RefreshCw size={13} className={isLoadingVaults ? 'animate-spin text-orange-400' : ''} />
                  </button>
                </div>
                <div className="rounded-lg border border-obsidian-border bg-obsidian-bg p-2 max-h-[220px] overflow-y-auto flex flex-col gap-1.5">
                  {isLoadingVaults && remoteVaults.length === 0 ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2 text-obsidian-muted">
                      <Loader2 size={22} className="animate-spin text-orange-400" />
                      <span>{t('vaultManager.remote.loading')}</span>
                    </div>
                  ) : remoteVaults.length === 0 ? (
                    <div className="py-6 text-center text-obsidian-muted flex flex-col items-center gap-2">
                      <Cloud size={26} className="text-obsidian-faint" />
                      <p>{t('sync.config.remote.empty')}</p>
                    </div>
                  ) : (
                    remoteVaults.map((rv) => {
                      const connected = Boolean(vaultName) && rv.name === vaultName;
                      const downloading = downloadingId === rv.id;
                      return (
                        <div
                          key={rv.id}
                          className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border transition-colors ${
                            connected
                              ? 'border-[var(--color-green)]/30 bg-[var(--color-green)]/5'
                              : 'border-obsidian-border bg-obsidian-sidebar hover:border-orange-500/40'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Folder size={16} className="text-orange-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-obsidian-text truncate">{rv.name}</div>
                              {rv.modified_time && (
                                <div className="text-[11px] text-obsidian-muted">
                                  {t('vaultManager.remote.modified', {
                                    time: new Date(rv.modified_time).toLocaleString([], {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    }),
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                          {connected ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0 text-[var(--color-green)] bg-[var(--color-green)]/10 border-[var(--color-green)]/30">
                              <Check size={11} strokeWidth={2.5} />
                              {t('sync.config.remote.connected')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={Boolean(downloadingId) || isSyncing}
                              onClick={() => void handleDownload(rv)}
                              className="inline-flex items-center gap-1.5 bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] border border-obsidian-border text-obsidian-text font-medium rounded px-2.5 py-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {downloading ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  <span>{describeProgress(t, progress)}</span>
                                </>
                              ) : (
                                <>
                                  <CloudDownload size={13} />
                                  <span>{t('sync.config.remote.downloadAndOpen')}</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-2 text-[11px] text-obsidian-faint">
                  {t('sync.config.remote.hint', { folder: 'Urano Vaults' })}
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
