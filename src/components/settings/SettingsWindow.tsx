import React, { useEffect, useState, useMemo } from 'react';
import { SettingsModal } from './SettingsModal';
import { SyncLogsModal } from '../sync/SyncLogsModal';
import { NoticeContainer, useNoticeStore } from '../common/Notice';
import { useSettingsStore, URANO_ACCENT } from '../../stores/settingsStore';
import { useVaultStore } from '../../stores/vaultStore';
import { applyBaseTheme } from '../../services/themeService';
import { useT } from '../../stores/localeStore';
import { invoke } from '@tauri-apps/api/core';
import { WindowControls } from '../layout/WindowControls';
import type { CommandItem } from '../palette/CommandPalette';
import {
  FilePlus,
  FileSearch,
  GitFork,
  Grid2X2,
  Calendar,
  Copy,
  PanelLeft,
  ArrowLeftRight,
  FolderPlus,
  RotateCw,
  RefreshCw,
  FolderOpen,
  Settings,
  BookOpen,
  Code,
} from 'lucide-react';

export const SettingsWindow: React.FC = () => {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const [showLogs, setShowLogs] = useState(false);
  const showNotice = useNoticeStore((s) => s.showNotice);

  const settingsWindowTitle = useMemo(() => {
    let vName = '';
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      vName = urlParams.get('vault') || '';
    }
    if (!vName) {
      const vaultPath = useVaultStore.getState().activeVault;
      vName =
        useVaultStore.getState().vaultName ||
        (vaultPath ? vaultPath.split(/[\\/]/).pop() : '') ||
        '';
    }
    return vName ? `Preferencias - ${vName} - Urano` : 'Preferencias - Urano';
  }, []);

  // Window title synchronization
  useEffect(() => {
    document.title = settingsWindowTitle;
    try {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(settingsWindowTitle))
        .catch(() => {});
    } catch {}
  }, [settingsWindowTitle]);

  // Synchronize CSS body classes with frame style
  useEffect(() => {
    document.body.classList.toggle('is-frameless', settings.windowFrameStyle !== 'native');
    document.body.classList.toggle('is-hidden-frameless', settings.windowFrameStyle === 'hidden');
    document.body.classList.add('is-popout-modal');
  }, [settings.windowFrameStyle]);

  // Synchronize native decorations if frameStyle changes
  useEffect(() => {
    const isNative = settings.windowFrameStyle === 'native';
    invoke('set_window_decorations', { decorations: isNative }).catch(() => {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setDecorations(isNative))
        .catch(() => {});
    });
  }, [settings.windowFrameStyle]);

  // Synchronize CSS tokens, zoom level, translucent effect, and theme
  useEffect(() => {
    const root = document.documentElement;
    const accent = settings.accentColor || URANO_ACCENT;
    root.style.setProperty('--interactive-accent', accent);
    root.style.setProperty('--text-accent', accent);
    root.style.setProperty('--interactive-accent-hover', accent);
    root.style.setProperty('--background-modifier-border-hover', `${accent}59`);
    root.style.setProperty('--background-modifier-active-hover', `${accent}26`);
    root.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
    root.style.setProperty('--file-line-width', settings.readableLineLength ? '700px' : '100%');
    root.style.setProperty('--editor-tab-size', String(settings.tabSize));
    const zoomFactor = (settings.zoomLevel || 100) / 100;
    (root.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      settings.zoomLevel === 100 ? '' : String(zoomFactor);
    document.body.style.zoom = settings.zoomLevel === 100 ? '' : String(zoomFactor);
    document.body.classList.toggle('is-translucent', Boolean(settings.translucentWindow));
    applyBaseTheme(settings.theme);
  }, [settings]);

  // Load vault-specific settings if activeVault is known
  useEffect(() => {
    const vaultPath = useVaultStore.getState().activeVault;
    if (vaultPath) {
      useSettingsStore.getState().loadFromVault(vaultPath).catch(() => {});
    }
  }, []);

  const handleHelpClick = () => {
    showNotice(t('app.notices.shortcutsHelp'), 5000, 'info');
  };

  const handleOpenLocalesFolder = async () => {
    const vaultPath = useVaultStore.getState().activeVault;
    if (!vaultPath) {
      window.open('https://github.com/FranciscoArias10/Urano#idiomas', '_blank', 'noopener');
      return;
    }
    try {
      const dir = await invoke<string>('get_custom_locales_dir', { vaultPath });
      await invoke('open_path', { path: dir });
    } catch (err) {
      console.warn('[Urano] No se pudo abrir la carpeta de idiomas:', err);
      showNotice(`${vaultPath.replace(/[\\/]+$/, '')}/.urano/locales`, 4000, 'info');
    }
  };

  // Commands provided to the Hotkeys settings tab
  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'file-explorer:new-note',
        name: t('commands.fileExplorer.newNote'),
        shortcut: 'Ctrl+N',
        icon: <FilePlus size={15} />,
        action: () => {},
      },
      {
        id: 'quick-switcher:open',
        name: t('commands.quickSwitcher.open'),
        shortcut: 'Ctrl+O',
        icon: <FileSearch size={15} />,
        action: () => {},
      },
      {
        id: 'graph:open',
        name: t('commands.graph.open'),
        shortcut: 'Ctrl+G',
        icon: <GitFork size={15} />,
        action: () => {},
      },
      {
        id: 'canvas:new',
        name: t('commands.canvas.new'),
        icon: <Grid2X2 size={15} />,
        action: () => {},
      },
      {
        id: 'daily-notes:today',
        name: t('commands.dailyNotes.today'),
        icon: <Calendar size={15} />,
        action: () => {},
      },
      {
        id: 'templates:insert',
        name: t('commands.templates.insert'),
        icon: <Copy size={15} />,
        action: () => {},
      },
      {
        id: 'workspace:toggle-left-sidebar',
        name: t('commands.workspace.toggleLeftSidebar'),
        shortcut: 'Ctrl+B',
        icon: <PanelLeft size={15} />,
        action: () => {},
      },
      {
        id: 'workspace:toggle-backlinks',
        name: t('commands.workspace.toggleBacklinks'),
        shortcut: 'Ctrl+Shift+B',
        icon: <ArrowLeftRight size={15} />,
        action: () => {},
      },
      {
        id: 'file-explorer:new-folder',
        name: t('commands.fileExplorer.newFolder'),
        icon: <FolderPlus size={15} />,
        action: () => {},
      },
      {
        id: 'file-explorer:refresh',
        name: t('commands.fileExplorer.refresh'),
        icon: <RotateCw size={15} />,
        action: () => {},
      },
      {
        id: 'sync:now',
        name: t('commands.sync.now'),
        icon: <RefreshCw size={15} />,
        action: () => {},
      },
      {
        id: 'app:open-vault',
        name: t('commands.app.openVault'),
        icon: <FolderOpen size={15} />,
        action: () => {},
      },
      {
        id: 'app:open-settings',
        name: t('commands.app.openSettings'),
        shortcut: 'Ctrl+,',
        icon: <Settings size={15} />,
        action: () => {},
      },
      {
        id: 'markdown:toggle-preview',
        name: t('commands.editor.toggleReadingView', { defaultValue: 'Markdown: Alternar vista de lectura' }),
        shortcut: 'Ctrl+E',
        icon: <BookOpen size={15} />,
        action: () => {},
      },
      {
        id: 'editor:toggle-source',
        name: t('commands.editor.toggleSourceMode', {
          defaultValue: 'Editor: Alternar código fuente / vista previa en vivo',
        }),
        icon: <Code size={15} />,
        action: () => {},
      },
    ],
    [t]
  );

  return (
    <div className="urano-app mod-settings-window flex flex-col">
      {settings.windowFrameStyle !== 'native' && (
        <div
          className="titlebar"
          data-tauri-drag-region
          onDoubleClick={async () => {
            try {
              const { getCurrentWindow } = await import('@tauri-apps/api/window');
              await getCurrentWindow().toggleMaximize();
            } catch {
              await invoke('toggle_maximize_window').catch(() => {});
            }
          }}
        >
          <div className="titlebar-inner" data-tauri-drag-region>
            <div className="titlebar-text" data-tauri-drag-region>
              {settingsWindowTitle}
            </div>
            <WindowControls />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-hidden relative">
        <SettingsModal
          standalone={true}
          commands={commands}
          onOpenHelp={handleHelpClick}
          onOpenSyncLogs={() => setShowLogs(true)}
          onOpenLocalesFolder={handleOpenLocalesFolder}
        />
      </div>
      <SyncLogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} />
      <NoticeContainer />
    </div>
  );
};
