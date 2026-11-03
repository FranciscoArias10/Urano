import React, { useEffect, useRef, useState } from 'react';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import {
  RefreshCw,
  RefreshCwOff,
  Check,
  AlertTriangle,
  AlignLeft,
  Settings,
  LogIn,
  Pencil,
  BookOpen,
} from 'lucide-react';

interface StatusBarProps {
  onToggleBacklinks?: () => void;
  backlinksCount?: number;
  onOpenLogs?: () => void;
  viewMode?: 'live-preview' | 'reading' | 'source';
  onToggleViewMode?: () => void;
}

/**
 * Visual states of the sync icon. Mirrors Obsidian's `_updateStatusBar` (obsidian.asar/app.js):
 *   disconnected → icon `refresh-cw-off` + `.mod-error`   (--text-error   = --color-red   #fb464c)
 *   syncing      → icon `sync-small`     + `.mod-working` (--interactive-accent)
 *   synced       → icon `check-small`    + `.mod-success` (--text-success = --color-green #44cf6e)
 *   error        → icon `sync-small`     + `.mod-error`
 * The tooltip is the status text and a click/right-click opens the "Sync: {status}" menu.
 */
type SyncIconState = 'disconnected' | 'offline' | 'idle' | 'syncing' | 'synced' | 'error' | 'conflict';

export const StatusBar: React.FC<StatusBarProps> = ({
  onToggleBacklinks,
  backlinksCount = 0,
  onOpenLogs,
  viewMode = 'live-preview',
  onToggleViewMode,
}) => {
  const t = useT();
  const fileContent = useVaultStore((s) => s.fileContent);
  const activeVault = useVaultStore((s) => s.activeVault);
  const vaultName = useVaultStore((s) => s.vaultName);
  const status = useSyncStore((s) => s.status);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const isAuthenticated = useSyncStore((s) => s.isAuthenticated);
  const isAuthenticating = useSyncStore((s) => s.isAuthenticating);
  const lastSyncTimestamp = useSyncStore((s) => s.lastSyncTimestamp);
  const triggerSync = useSyncStore((s) => s.triggerSync);
  const progress = useSyncStore((s) => s.progress);
  const lastSummary = useSyncStore((s) => s.lastSummary);
  const loginWithGoogle = useSyncStore((s) => s.loginWithGoogle);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const showEditorStatus = useSettingsStore((s) => s.settings.showEditorStatus);

  const [syncMenu, setSyncMenu] = useState<{ x: number; y: number } | null>(null);

  // Re-render every 30 s so the "synced X min ago" tooltip stays fresh.
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => setClock((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  // "Synced: X files uploaded" stays visible a few seconds after each pass finishes.
  const [showResult, setShowResult] = useState(false);
  const wasSyncing = useRef(false);
  useEffect(() => {
    const finished = wasSyncing.current && !isSyncing && lastSummary !== null;
    wasSyncing.current = isSyncing;
    if (!finished) return;
    setShowResult(true);
    const id = setTimeout(() => setShowResult(false), 6000);
    return () => clearTimeout(id);
  }, [isSyncing, lastSummary]);

  const syncMessage: string | null = isSyncing
    ? progress && progress.total > 0
      ? t('statusBar.syncProgress', { current: progress.current, total: progress.total })
      : t('statusBar.syncing')
    : showResult && lastSummary
    ? lastSummary.errors > 0
      ? t('statusBar.syncDoneErrors', { errors: lastSummary.errors })
      : lastSummary.downloaded > 0
      ? t('statusBar.syncDoneMixed', {
          uploaded: lastSummary.uploaded,
          downloaded: lastSummary.downloaded,
        })
      : t('statusBar.syncDoneUploaded', { count: lastSummary.uploaded })
    : null;

  const words = fileContent.trim() ? fileContent.trim().split(/\s+/).length : 0;
  const chars = fileContent.length;

  const iconState: SyncIconState = !isAuthenticated
    ? 'disconnected'
    : status === 'offline'
    ? 'offline'
    : isSyncing
    ? 'syncing'
    : status === 'synced'
    ? 'synced'
    : status === 'error'
    ? 'error'
    : status === 'conflict'
    ? 'conflict'
    : 'idle';

  const formatAgo = (timestamp: number): string => {
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return t('statusBar.ago.justNow');
    if (minutes < 60) return t('statusBar.ago.minutes', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('statusBar.ago.hours', { count: hours });
    return t('statusBar.ago.days', { count: Math.round(hours / 24) });
  };

  const statusLabel = t(`statusBar.syncStatus.${iconState}`);

  const tooltip = (() => {
    switch (iconState) {
      case 'disconnected':
        return t('statusBar.syncNotConnected');
      case 'offline':
        return t('statusBar.syncOffline');
      case 'syncing':
        return t('statusBar.syncing');
      case 'synced':
        return lastSyncTimestamp
          ? t('statusBar.syncedAgo', { ago: formatAgo(lastSyncTimestamp) })
          : t('statusBar.synced');
      case 'error':
        return t('statusBar.syncError');
      case 'conflict':
        return t('statusBar.syncConflict');
      default:
        return t('statusBar.connected');
    }
  })();

  const iconModifier =
    iconState === 'synced'
      ? 'mod-success'
      : iconState === 'syncing' || iconState === 'idle'
      ? 'mod-working'
      : iconState === 'conflict'
      ? 'mod-warning'
      : 'mod-error';

  const renderSyncIcon = () => {
    switch (iconState) {
      case 'disconnected':
      case 'offline':
        return <RefreshCwOff size={12} />;
      case 'synced':
        return <Check size={13} strokeWidth={2.5} />;
      case 'conflict':
        return <AlertTriangle size={12} />;
      default:
        return <RefreshCw size={12} />;
    }
  };

  const openSyncMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setSyncMenu({ x: rect.right, y: rect.top - 6 });
  };

  const syncMenuItems: MenuItemData[] = [
    { title: t('statusBar.syncMenuStatus', { status: statusLabel }), disabled: true },
    { type: 'separator' },
    ...(isAuthenticated
      ? ([
          {
            title: t('statusBar.syncNow'),
            icon: <RefreshCw size={14} />,
            disabled: isSyncing || !activeVault || iconState === 'offline',
            action: () => {
              if (activeVault) void triggerSync(activeVault, vaultName ?? undefined);
            },
          },
          {
            title: t('statusBar.activityLog'),
            icon: <AlignLeft size={14} />,
            action: () => onOpenLogs?.(),
          },
        ] as MenuItemData[])
      : ([
          {
            title: t('statusBar.signIn'),
            icon: <LogIn size={14} />,
            disabled: isAuthenticating,
            action: () => {
              void loginWithGoogle();
            },
          },
        ] as MenuItemData[])),
    {
      title: t('statusBar.syncSettings'),
      icon: <Settings size={14} />,
      action: () => openSettings('sync'),
    },
  ];

  return (
    <footer className="h-6 bg-obsidian-sidebar border-t border-obsidian-border flex items-center justify-between px-3 text-[11px] text-obsidian-muted select-none z-20">
      {/* Left: Spacer */}
      <div className="flex items-center gap-2" />

      {/* Right: Compact Status Pill (0 backlinks  [book/pencil]  55 palabras  497 caracteres + sync icon) */}
      <div className="flex items-center">
        <div className="flex items-center gap-2.5 bg-obsidian-bg hover:bg-obsidian-hover px-2.5 py-0.5 rounded-full border border-obsidian-border text-[11px] text-obsidian-muted transition-colors">
          <button
            onClick={onToggleBacklinks}
            className="hover:text-orange-400 transition-colors cursor-pointer"
            title={t('statusBar.toggleBacklinks')}
          >
            {t('statusBar.backlinks', { count: backlinksCount })}
          </button>

          <span className="text-obsidian-muted select-none opacity-40">•</span>

          {showEditorStatus && onToggleViewMode && (
            <>
              <button
                onClick={onToggleViewMode}
                className="hover:text-orange-400 transition-colors cursor-pointer flex items-center justify-center"
                title={
                  viewMode === 'reading'
                    ? t('statusBar.switchToEditing')
                    : t('statusBar.switchToReading')
                }
                aria-label={t('statusBar.toggleViewMode')}
              >
                {viewMode === 'reading' ? <Pencil size={13} /> : <BookOpen size={13} />}
              </button>
              <span className="text-obsidian-muted select-none opacity-40">•</span>
            </>
          )}

          <span className="font-mono text-[10px] text-obsidian-text">
            {t('statusBar.words', { count: words })}
          </span>

          <span className="text-obsidian-muted select-none opacity-40">•</span>

          <span className="font-mono text-[10px] text-obsidian-text">
            {t('statusBar.characters', { count: chars })}
          </span>

          <span className="text-obsidian-muted select-none opacity-40">•</span>

          {/* Live sync progress / last result (Obsidian shows it in the sync tooltip; Urano
              also prints it inline while files move: "Syncing… 3/12" → "Synced: 5 uploaded") */}
          {syncMessage && (
            <>
              <span
                className={`max-w-[260px] truncate ${
                  isSyncing ? 'text-[var(--interactive-accent)]' : 'text-[var(--color-green)]'
                }`}
                title={syncMessage}
              >
                {syncMessage}
              </span>
              <span className="text-obsidian-muted select-none opacity-40">•</span>
            </>
          )}

          {/* Sync status icon (Obsidian: .status-bar-item.plugin-sync > .sync-status-icon) */}
          <button
            type="button"
            onClick={openSyncMenu}
            onContextMenu={openSyncMenu}
            className="plugin-sync flex items-center hover:opacity-80 transition-opacity cursor-pointer"
            title={tooltip}
            aria-label={tooltip}
          >
            <span
              className={`sync-status-icon ${iconModifier} ${iconState === 'syncing' ? 'is-syncing' : ''}`}
            >
              {renderSyncIcon()}
            </span>
          </button>
        </div>
      </div>

      {syncMenu && (
        <ObsidianMenu
          x={syncMenu.x}
          y={syncMenu.y}
          align="right"
          items={syncMenuItems}
          onClose={() => setSyncMenu(null)}
        />
      )}
    </footer>
  );
};
