import React, { useEffect, useRef, useState } from 'react';
import { useVaultStore } from '../../stores/vaultStore';
import { useSyncStore } from '../../stores/syncStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import { UranoMenu, MenuItemData } from '../common/UranoMenu';
import {
  RefreshCw,
  RefreshCwOff,
  Check,
  AlertTriangle,
  AlignLeft,
  Settings,
  LogIn,
  PenLine,
  Code2,
  BookOpen,
} from 'lucide-react';

interface StatusBarProps {
  onToggleBacklinks?: () => void;
  backlinksCount?: number;
  onOpenLogs?: () => void;
  viewMode?: 'live-preview' | 'reading' | 'source';
  onToggleViewMode?: () => void;
  onChangeViewMode?: (mode: 'live-preview' | 'reading' | 'source') => void;
}

/**
 * Visual states of the sync icon. Mirrors Urano's `_updateStatusBar` (urano.asar/app.js):
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
  onChangeViewMode,
}) => {
  const t = useT();
  const fileContent = useVaultStore((s) => s.fileContent);
  const activeFile = useVaultStore((s) => s.activeFile);
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
  const showStatusBar = useSettingsStore((s) => s.settings.showStatusBar);
  const showEditorStatus = useSettingsStore((s) => s.settings.showEditorStatus);

  const [syncMenu, setSyncMenu] = useState<{ x: number; y: number } | null>(null);
  const [showEditorMenu, setShowEditorMenu] = useState(false);
  const editorMenuRef = useRef<HTMLDivElement>(null);
  const editorButtonRef = useRef<HTMLButtonElement>(null);

  // Close editor menu on click outside or Escape
  useEffect(() => {
    if (!showEditorMenu) return;
    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      if (
        editorMenuRef.current &&
        !editorMenuRef.current.contains(e.target as Node) &&
        editorButtonRef.current &&
        !editorButtonRef.current.contains(e.target as Node)
      ) {
        setShowEditorMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEditorMenu(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showEditorMenu]);

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
    setShowEditorMenu(false);
    const rect = e.currentTarget.getBoundingClientRect();
    setSyncMenu({ x: rect.right, y: rect.top - 6 });
  };

  const renderEditorStatusIcon = () => {
    switch (viewMode) {
      case 'reading':
        return <BookOpen size={14} />;
      case 'source':
        return <Code2 size={14} />;
      case 'live-preview':
      default:
        return <PenLine size={14} />;
    }
  };

  const currentModeTooltip =
    viewMode === 'reading'
      ? t('statusBar.modeReading')
      : viewMode === 'source'
      ? t('statusBar.modeSource')
      : t('statusBar.modeLivePreview');

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

  const setMode = (mode: 'live-preview' | 'reading' | 'source') => {
    if (onChangeViewMode) {
      onChangeViewMode(mode);
    } else if (onToggleViewMode && mode !== viewMode) {
      onToggleViewMode();
    }
    setShowEditorMenu(false);
  };

  if (!showStatusBar) return null;

  return (
    <div className="status-bar" role="status" aria-label="Status Bar">
      {/* 1. Backlinks item (only when file is open) */}
      {activeFile && (
        <button
          type="button"
          onClick={onToggleBacklinks}
          className="status-bar-item mod-clickable"
          title={t('statusBar.toggleBacklinks')}
        >
          {t('statusBar.backlinks', { count: backlinksCount })}
        </button>
      )}

      {/* 2. Word count (only when file is open) */}
      {activeFile && (
        <div className="status-bar-item" title={t('statusBar.words', { count: words })}>
          {t('statusBar.words', { count: words })}
        </div>
      )}

      {/* 3. Character count (only when file is open) */}
      {activeFile && (
        <div className="status-bar-item" title={t('statusBar.characters', { count: chars })}>
          {t('statusBar.characters', { count: chars })}
        </div>
      )}

      {/* 4. Live sync progress (if any) */}
      {syncMessage && (
        <span
          className={`status-bar-item max-w-[260px] truncate ${
            isSyncing ? 'text-[var(--interactive-accent)]' : 'text-[var(--color-green)]'
          }`}
          title={syncMessage}
        >
          {syncMessage}
        </span>
      )}

      {/* 5. Sync status icon */}
      <button
        type="button"
        onClick={openSyncMenu}
        onContextMenu={openSyncMenu}
        className="status-bar-item mod-clickable plugin-sync"
        title={tooltip}
        aria-label={tooltip}
      >
        <span
          className={`sync-status-icon ${iconModifier} ${iconState === 'syncing' ? 'is-syncing' : ''}`}
        >
          {renderSyncIcon()}
        </span>
      </button>

      {/* 6. Editor status icon (far right, only when file is open) */}
      {activeFile && showEditorStatus && (
        <button
          ref={editorButtonRef}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSyncMenu(null);
            setShowEditorMenu((prev) => !prev);
          }}
          className="status-bar-item mod-clickable plugin-editor-status mod-editor-status"
          title={currentModeTooltip}
          aria-label={currentModeTooltip}
          aria-haspopup="menu"
          aria-expanded={showEditorMenu}
        >
          <span className="status-bar-item-icon">
            {renderEditorStatusIcon()}
          </span>
        </button>
      )}

      {/* Editor mode floating popup menu (.menu.status-bar-menu) */}
      {showEditorMenu && (
        <div
          ref={editorMenuRef}
          className="menu status-bar-menu"
          role="menu"
          aria-label={t('statusBar.modeMenu')}
        >
          <div className="menu-scroll">
            <div
              className={`menu-item ${viewMode === 'reading' ? 'selected' : ''}`}
              role="menuitem"
              tabIndex={0}
              onClick={() => setMode('reading')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setMode('reading');
                }
              }}
            >
              <div className="menu-item-icon">
                <BookOpen size={14} />
              </div>
              <div className="menu-item-title">{t('statusBar.modeReading')}</div>
              {viewMode === 'reading' && (
                <Check size={14} className="menu-item-check ml-auto text-orange-500" />
              )}
            </div>

            <div
              className={`menu-item ${viewMode === 'source' ? 'selected' : ''}`}
              role="menuitem"
              tabIndex={0}
              onClick={() => setMode('source')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setMode('source');
                }
              }}
            >
              <div className="menu-item-icon">
                <Code2 size={14} />
              </div>
              <div className="menu-item-title">{t('statusBar.modeSource')}</div>
              {viewMode === 'source' && (
                <Check size={14} className="menu-item-check ml-auto text-orange-500" />
              )}
            </div>

            <div
              className={`menu-item ${viewMode === 'live-preview' ? 'selected' : ''}`}
              role="menuitem"
              tabIndex={0}
              onClick={() => setMode('live-preview')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setMode('live-preview');
                }
              }}
            >
              <div className="menu-item-icon">
                <PenLine size={14} />
              </div>
              <div className="menu-item-title">{t('statusBar.modeLivePreview')}</div>
              {viewMode === 'live-preview' && (
                <Check size={14} className="menu-item-check ml-auto text-orange-500" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync context menu */}
      {syncMenu && (
        <UranoMenu
          x={syncMenu.x}
          y={syncMenu.y}
          align="right"
          items={syncMenuItems}
          onClose={() => setSyncMenu(null)}
        />
      )}
    </div>
  );
};
