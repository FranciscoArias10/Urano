import React, { useState } from 'react';
import {
  Trash2,
  Palette,
  Edit2,
  FilePlus,
  ArrowRight,
  ArrowLeftRight,
  Type,
} from 'lucide-react';
import { CANVAS_COLORS, DEFAULT_COLOR } from './canvasMath';
import { Tooltip } from '../common/Tooltip';
import { CanvasNode, CanvasEdge } from '../../types/canvas';

interface CanvasFloatingMenuProps {
  selectedNode?: CanvasNode | null;
  selectedEdge?: CanvasEdge | null;
  position: { x: number; y: number };
  onDelete: () => void;
  onSetColor: (colorKey?: string) => void;
  onEdit: () => void;
  onConvertToFile?: () => void;
  onToggleEdgeArrow?: () => void;
  onEditEdgeLabel?: () => void;
}

export const CanvasFloatingMenu: React.FC<CanvasFloatingMenuProps> = ({
  selectedNode,
  selectedEdge,
  position,
  onDelete,
  onSetColor,
  onEdit,
  onConvertToFile,
  onToggleEdgeArrow,
  onEditEdgeLabel,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const currentColor = selectedNode?.color || selectedEdge?.color;

  return (
    <div
      className="canvas-menu animate-fadeIn"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%) translateY(-10px)',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Edit button */}
      <Tooltip content="Editar contenido" position="top">
        <button onClick={onEdit} className="canvas-menu-button">
          <Edit2 size={14} />
        </button>
      </Tooltip>

      {/* Edge label button (if edge) */}
      {selectedEdge && onEditEdgeLabel && (
        <Tooltip content="Editar etiqueta" position="top">
          <button onClick={onEditEdgeLabel} className="canvas-menu-button">
            <Type size={14} />
          </button>
        </Tooltip>
      )}

      {/* Edge direction toggle (if edge) */}
      {selectedEdge && onToggleEdgeArrow && (
        <Tooltip content="Alternar flecha / dirección" position="top">
          <button onClick={onToggleEdgeArrow} className="canvas-menu-button">
            {selectedEdge.fromEnd === 'arrow' ? <ArrowLeftRight size={14} /> : <ArrowRight size={14} />}
          </button>
        </Tooltip>
      )}

      {/* Convert to file (for text cards) */}
      {selectedNode && selectedNode.type === 'text' && onConvertToFile && (
        <Tooltip content="Convertir en nota del Vault (.md)" position="top">
          <button onClick={onConvertToFile} className="canvas-menu-button">
            <FilePlus size={14} />
          </button>
        </Tooltip>
      )}

      {/* Color picker */}
      <div className="relative">
        <Tooltip content="Cambiar color" position="top">
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className={`canvas-menu-button ${showColorPicker ? 'is-active' : ''}`}
          >
            <Palette size={14} />
          </button>
        </Tooltip>

        {showColorPicker && (
          <div className="canvas-submenu animate-fadeIn">
            {/* Default neutral */}
            <div
              onClick={() => {
                onSetColor(undefined);
                setShowColorPicker(false);
              }}
              style={{ backgroundColor: DEFAULT_COLOR.hex }}
              className={`canvas-color-dot ${!currentColor ? 'is-active ring-2 ring-white' : ''}`}
              title={DEFAULT_COLOR.name}
            />
            {/* 6 Obsidian colors */}
            {Object.entries(CANVAS_COLORS).map(([key, col]) => (
              <div
                key={key}
                onClick={() => {
                  onSetColor(key);
                  setShowColorPicker(false);
                }}
                style={{ backgroundColor: col.hex }}
                className={`canvas-color-dot ${currentColor === key ? 'is-active ring-2 ring-white' : ''}`}
                title={col.name}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete button */}
      <Tooltip content="Eliminar" position="top">
        <button onClick={onDelete} className="canvas-menu-button hover:text-red-400">
          <Trash2 size={14} />
        </button>
      </Tooltip>
    </div>
  );
};
