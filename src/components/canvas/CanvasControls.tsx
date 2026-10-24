import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Minus,
  RotateCw,
  Maximize2,
  Settings,
  Undo2,
  Redo2,
  HelpCircle,
  Check,
} from 'lucide-react';
import { Tooltip } from '../common/Tooltip';
import { useT } from '../../stores/localeStore';

interface CanvasControlsProps {
  zoom: number;
  readonly: boolean;
  snapToGrid: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  onResetZoom: () => void;
  onToggleReadonly: () => void;
  onToggleSnapToGrid: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  onClose: () => void;
}

/** Popover anclado al botón que lo abre (estilo Obsidian). */
const Popover: React.FC<PopoverProps> = ({ anchorRef, children, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="canvas-control-popover"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
};

/**
 * Controles flotantes `.canvas-controls` — 1:1 con Obsidian.
 *  1. Ajustes del Canvas (snap to grid / solo lectura)
 *  2. Grupo de zoom: + / ↻ / ⛶ / —
 *  3. Grupo de historial: ↶ / ↷
 *  4. Ayuda del Canvas
 */
export const CanvasControls: React.FC<CanvasControlsProps> = ({
  zoom,
  readonly,
  snapToGrid,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
  onResetZoom,
  onToggleReadonly,
  onToggleSnapToGrid,
  onUndo,
  onRedo,
}) => {
  const t = useT();
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSettings(false);
        setShowHelp(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="canvas-controls">
      {/* 1. Ajustes del Canvas */}
      <div className="canvas-control-group">
        <Tooltip content={t('canvas.controls.settings')} position="left">
          <button
            ref={settingsRef}
            onClick={() => {
              setShowSettings((v) => !v);
              setShowHelp(false);
            }}
            className={`canvas-control-item ${showSettings ? 'is-active' : ''}`}
            title={t('canvas.controls.settings')}
          >
            <Settings size={16} />
          </button>
        </Tooltip>
        {showSettings && (
          <Popover anchorRef={settingsRef} onClose={() => setShowSettings(false)}>
            <div
              className="canvas-control-popover-item"
              onClick={() => {
                onToggleSnapToGrid();
              }}
            >
              <span className="canvas-control-popover-label">{t('canvas.controls.snapToGrid')}</span>
              {snapToGrid && <Check size={14} className="canvas-control-popover-check" />}
            </div>
            <div
              className="canvas-control-popover-item"
              onClick={() => {
                onToggleReadonly();
              }}
            >
              <span className="canvas-control-popover-label">{t('canvas.controls.readonly')}</span>
              {readonly && <Check size={14} className="canvas-control-popover-check" />}
            </div>
          </Popover>
        )}
      </div>

      {/* 2. Zoom */}
      <div className="canvas-control-group">
        <Tooltip content={t('canvas.controls.zoomIn')} position="left">
          <button onClick={onZoomIn} className="canvas-control-item" title={t('canvas.controls.zoomIn')}>
            <Plus size={16} />
          </button>
        </Tooltip>

        <Tooltip content={t('canvas.controls.resetZoom')} position="left">
          <button onClick={onResetZoom} className="canvas-control-item" title={t('canvas.controls.resetZoom')}>
            <RotateCw size={15} />
          </button>
        </Tooltip>

        <Tooltip content={t('canvas.controls.zoomToFitHint')} position="left">
          <button onClick={onZoomToFit} className="canvas-control-item" title={t('canvas.controls.zoomToFit')}>
            <Maximize2 size={15} />
          </button>
        </Tooltip>

        <Tooltip content={t('canvas.controls.zoomOut')} position="left">
          <button onClick={onZoomOut} className="canvas-control-item" title={t('canvas.controls.zoomOut')}>
            <Minus size={16} />
          </button>
        </Tooltip>

        {/* Indicador de zoom en vivo (clic = volver al 100 %) */}
        <Tooltip content={t('canvas.controls.zoomLevelHint')} position="left">
          <button
            onClick={onResetZoom}
            className="canvas-control-item canvas-control-zoom-level"
            title={t('canvas.controls.zoomLevel')}
            aria-live="polite"
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
      </div>

      {/* 3. Historial */}
      <div className="canvas-control-group">
        <Tooltip content={t('canvas.controls.undo')} position="left">
          <button
            onClick={onUndo}
            className={`canvas-control-item ${canUndo ? '' : 'is-disabled'}`}
            disabled={!canUndo}
            title={t('canvas.controls.undo')}
          >
            <Undo2 size={15} />
          </button>
        </Tooltip>

        <Tooltip content={t('canvas.controls.redoHint')} position="left">
          <button
            onClick={onRedo}
            className={`canvas-control-item ${canRedo ? '' : 'is-disabled'}`}
            disabled={!canRedo}
            title={t('canvas.controls.redo')}
          >
            <Redo2 size={15} />
          </button>
        </Tooltip>
      </div>

      {/* 4. Ayuda */}
      <div className="canvas-control-group">
        <Tooltip content={t('canvas.controls.help')} position="left">
          <button
            ref={helpRef}
            onClick={() => {
              setShowHelp((v) => !v);
              setShowSettings(false);
            }}
            className={`canvas-control-item ${showHelp ? 'is-active' : ''}`}
            title={t('canvas.controls.help')}
          >
            <HelpCircle size={16} />
          </button>
        </Tooltip>
        {showHelp && (
          <Popover anchorRef={helpRef} onClose={() => setShowHelp(false)}>
            <div className="canvas-control-popover-title">{t('canvas.help.title')}</div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.createCard')}</span>
              <kbd>Ctrl+V</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.undo')}</span>
              <kbd>Ctrl+Z</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.redo')}</span>
              <kbd>Ctrl+Y</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.selectAll')}</span>
              <kbd>Ctrl+A</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('common.delete')}</span>
              <kbd>{t('canvas.keys.delete')}</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.zoomToFit')}</span>
              <kbd>Shift+1</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.zoom')}</span>
              <kbd>{t('canvas.keys.ctrlWheel')}</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.pan')}</span>
              <kbd>{t('canvas.keys.space')}</kbd>
            </div>
            <div className="canvas-control-popover-item is-static">
              <span className="canvas-control-popover-label">{t('canvas.help.currentZoom')}</span>
              <kbd>{Math.round(zoom * 100)}%</kbd>
            </div>
          </Popover>
        )}
      </div>
    </div>
  );
};
