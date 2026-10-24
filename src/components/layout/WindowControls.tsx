import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useT } from '../../stores/localeStore';

/**
 * Native window controls backed by the Tauri window API.
 * The window is frameless (decorations: false), so Urano draws the
 * minimise / maximise / close buttons itself.
 */
export const WindowControls: React.FC = () => {
  const t = useT();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      appWindow = getCurrentWindow();
    } catch {
      /* Not running inside Tauri (e.g. plain browser preview) */
      return;
    }

    let disposed = false;
    let unlistenFn: (() => void) | undefined;

    const sync = async () => {
      try {
        const maximized = await appWindow!.isMaximized();
        if (!disposed) setIsMaximized(maximized);
      } catch {
        /* window API unavailable */
      }
    };

    sync();

    appWindow!
      .onResized(() => {
        sync();
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      /* noop */
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch {
      /* noop */
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* noop */
    }
  };

  return (
    <div className="titlebar-button-container">
      <button
        type="button"
        className="window-control-button mod-minimize"
        title={t('window.minimize')}
        aria-label={t('window.minimize')}
        onClick={handleMinimize}
      >
        <Minus size={14} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="window-control-button mod-maximize"
        title={isMaximized ? t('window.restore') : t('window.maximize')}
        aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
        onClick={handleToggleMaximize}
      >
        {isMaximized ? (
          <Copy size={12} strokeWidth={1.6} />
        ) : (
          <Square size={12} strokeWidth={1.6} />
        )}
      </button>
      <button
        type="button"
        className="window-control-button mod-close"
        title={t('common.close')}
        aria-label={t('common.close')}
        onClick={handleClose}
      >
        <X size={14} strokeWidth={1.6} />
      </button>
    </div>
  );
};
