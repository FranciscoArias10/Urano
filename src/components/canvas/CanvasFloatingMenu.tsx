import React, { useRef, useState } from 'react';
import {
  Trash2,
  Palette,
  ScanSearch,
  SquarePen,
  Type,
  ArrowRight,
  ArrowLeftRight,
} from 'lucide-react';
import {
  CANVAS_COLORS,
  RESET_COLOR,
  isCustomCanvasColor,
} from './canvasMath';
import { Tooltip } from '../common/Tooltip';
import { CanvasNode, CanvasEdge } from '../../types/canvas';

interface CanvasFloatingMenuProps {
  /** Nodo seleccionado: habilita los botones de nodo (4, en orden fijo). */
  node?: CanvasNode | null;
  /** Arista seleccionada: habilita los botones de arista. */
  edge?: CanvasEdge | null;
  /**
   * Posición absoluta dentro del canvas. Solo se usa para la barra de arista
   * (`.is-anchored`); la barra de nodo se posiciona con CSS respecto al nodo.
   */
  position?: { x: number; y: number };
  onDelete: () => void;
  onSetColor: (colorKey?: string) => void;
  /** Centra la cámara y ajusta el zoom para encuadrar el nodo. */
  onZoomToSelection?: () => void;
  /** Activa el modo de edición de texto dentro de la tarjeta. */
  onEdit?: () => void;
  onToggleEdgeArrow?: () => void;
  onEditEdgeLabel?: () => void;
}

/**
 * Barra flotante de acciones del Canvas.
 *
 * Para nodos muestra exactamente 4 botones, de izquierda a derecha:
 *   1. Eliminar (Trash2)
 *   2. Color (Palette)  -> submenú con los 6 colores del Canvas
 *   3. Zoom a la selección (ScanSearch)
 *   4. Editar (SquarePen)
 */
export const CanvasFloatingMenu: React.FC<CanvasFloatingMenuProps> = ({
  node,
  edge,
  position,
  onDelete,
  onSetColor,
  onZoomToSelection,
  onEdit,
  onToggleEdgeArrow,
  onEditEdgeLabel,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const customColorInputRef = useRef<HTMLInputElement>(null);

  const currentColor = node?.color || edge?.color;
  const isCustomColor = isCustomCanvasColor(currentColor);
  const isAnchored = !!position;

  const chooseColor = (colorKey?: string) => {
    onSetColor(colorKey);
    setShowColorPicker(false);
  };

  return (
    <div
      className={`canvas-menu ${isAnchored ? 'is-anchored' : ''}`}
      style={{
        position: 'absolute',
        ...(isAnchored && position
          ? {
              left: `${position.x}px`,
              top: `${position.y}px`,
              transform: 'translate(-50%, -100%) translateY(-10px)',
            }
          : {
              // Barra del nodo: FUERA y ARRIBA de la tarjeta, centrada.
              bottom: 'calc(100% + 12px)',
              left: '50%',
              transform: 'translateX(-50%)',
            }),
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 6px',
        background: '#242424',
        border: '1px solid #383838',
        borderRadius: '7px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
        zIndex: 100,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 1. Eliminar */}
      <Tooltip content="Eliminar" position="top">
        <button className="canvas-menu-button" onClick={onDelete} aria-label="Eliminar">
          <Trash2 size={16} />
        </button>
      </Tooltip>

      {/* 2. Color */}
      <div className="canvas-menu-color">
        <Tooltip content="Color" position="top">
          <button
            className={`canvas-menu-button ${showColorPicker ? 'is-active' : ''}`}
            onClick={() => setShowColorPicker((v) => !v)}
            aria-label="Color"
          >
            <Palette size={16} />
          </button>
        </Tooltip>

        {showColorPicker && (
          <div className="canvas-color-picker">
            {/* 1. Sin color / por defecto */}
            <button
              type="button"
              className="canvas-color-picker-item canvas-color-picker-reset"
              style={{ backgroundColor: RESET_COLOR }}
              title="Por defecto"
              aria-label="Sin color"
              onClick={(e) => {
                e.stopPropagation();
                chooseColor(undefined);
              }}
            />

            {/* 2-7. Presets oficiales de Obsidian */}
            {Object.entries(CANVAS_COLORS).map(([key, col]) => (
              <button
                type="button"
                key={key}
                className={`canvas-color-picker-item ${
                  currentColor === key ? 'is-active' : ''
                }`}
                style={{ backgroundColor: col.hex }}
                title={col.name}
                aria-label={col.name}
                onClick={(e) => {
                  e.stopPropagation();
                  chooseColor(key);
                }}
              />
            ))}

            {/* 8. Rueda de color personalizado */}
            <div
              className={`canvas-color-picker-item canvas-color-picker-custom ${
                isCustomColor ? 'is-active' : ''
              }`}
              title="Color personalizado"
              onClick={(e) => {
                e.stopPropagation();
                customColorInputRef.current?.click();
              }}
            >
              <input
                ref={customColorInputRef}
                type="color"
                value={isCustomColor ? currentColor ?? '#000000' : '#000000'}
                aria-label="Elegir color personalizado"
                onChange={(e) => {
                  e.stopPropagation();
                  onSetColor(e.target.value);
                  setShowColorPicker(false);
                }}
                onInput={(e) => {
                  e.stopPropagation();
                  // Actualización en vivo mientras se mueve el selector nativo.
                  onSetColor((e.target as HTMLInputElement).value);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. Zoom a la selección (siempre presente en la barra de un nodo) */}
      {node && (
        <Tooltip content="Zoom a la selección" position="top">
          <button
            className="canvas-menu-button"
            onClick={onZoomToSelection}
            aria-label="Zoom a la selección"
          >
            <ScanSearch size={16} />
          </button>
        </Tooltip>
      )}

      {/* 4. Editar (siempre presente en la barra de un nodo) */}
      {node && (
        <Tooltip content="Editar" position="top">
          <button className="canvas-menu-button" onClick={onEdit} aria-label="Editar">
            <SquarePen size={16} />
          </button>
        </Tooltip>
      )}

      {/* Botones exclusivos de arista */}
      {edge && onEditEdgeLabel && (
        <Tooltip content="Editar etiqueta" position="top">
          <button
            className="canvas-menu-button"
            onClick={onEditEdgeLabel}
            aria-label="Editar etiqueta"
          >
            <Type size={16} />
          </button>
        </Tooltip>
      )}

      {edge && onToggleEdgeArrow && (
        <Tooltip content="Alternar flecha / dirección" position="top">
          <button
            className="canvas-menu-button"
            onClick={onToggleEdgeArrow}
            aria-label="Alternar flecha"
          >
            {edge.fromEnd === 'arrow' ? <ArrowLeftRight size={16} /> : <ArrowRight size={16} />}
          </button>
        </Tooltip>
      )}
    </div>
  );
};
