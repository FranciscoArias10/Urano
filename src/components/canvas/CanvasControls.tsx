import React from 'react';
import { Plus, Minus, RotateCcw, Maximize, Lock, Unlock } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';

interface CanvasControlsProps {
  zoom: number;
  readonly: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  onResetZoom: () => void;
  onToggleReadonly: () => void;
}

export const CanvasControls: React.FC<CanvasControlsProps> = ({
  zoom,
  readonly,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
  onResetZoom,
  onToggleReadonly,
}) => {
  return (
    <div className="canvas-controls">
      {/* Group 1: Read-only toggle */}
      <div className="canvas-control-group">
        <Tooltip content={readonly ? 'Modo solo lectura activado' : 'Hacer solo lectura'} position="left">
          <button
            onClick={onToggleReadonly}
            className={`canvas-control-item ${readonly ? 'is-active text-orange-500' : ''}`}
            title={readonly ? 'Solo lectura' : 'Editable'}
          >
            {readonly ? <Lock size={15} /> : <Unlock size={15} />}
          </button>
        </Tooltip>
      </div>

      {/* Group 2: Zoom controls */}
      <div className="canvas-control-group">
        <Tooltip content="Acercar (Zoom In)" position="left">
          <button onClick={onZoomIn} className="canvas-control-item">
            <Plus size={15} />
          </button>
        </Tooltip>

        <Tooltip content="Restablecer zoom (100%)" position="left">
          <button onClick={onResetZoom} className="canvas-control-item">
            <RotateCcw size={14} />
          </button>
        </Tooltip>

        <Tooltip content="Ajustar vista a los elementos (Zoom to fit)" position="left">
          <button onClick={onZoomToFit} className="canvas-control-item">
            <Maximize size={15} />
          </button>
        </Tooltip>

        <Tooltip content="Alejar (Zoom Out)" position="left">
          <button onClick={onZoomOut} className="canvas-control-item">
            <Minus size={15} />
          </button>
        </Tooltip>
      </div>

      {/* Zoom percentage indicator */}
      <div className="bg-[#1e1e1e] border border-[#333333] px-2 py-1 rounded text-[11px] font-mono text-stone-400 text-center shadow-lg">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
};
