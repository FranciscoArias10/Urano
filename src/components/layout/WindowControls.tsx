import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';

/**
 * Native window controls backed by the Tauri window API.
 * The window is frameless (decorations: false), so Urano draws the
 * minimise / maximise / close buttons itself.
 */
export const WindowControls: React.FC = () => {
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
        title="Minimizar"
        aria-label="Minimizar"
        onClick={handleMinimize}
      >
        <Minus size={14} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="window-control-button mod-maximize"
        title={isMaximized ? 'Restaurar' : 'Maximizar'}
        aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
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
        title="Cerrar"
        aria-label="Cerrar"
        onClick={handleClose}
      >
        <X size={14} strokeWidth={1.6} />
      </button>
    </div>
  );
};
