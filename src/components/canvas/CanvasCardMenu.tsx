import React from 'react';
import { StickyNote, FileText, Image } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';

export type CanvasCardMenuType = 'text' | 'note' | 'media';

interface CanvasCardMenuProps {
  onAddTextCard: () => void;
  onAddNoteCard: () => void;
  onAddMediaCard: () => void;
  onDragStartType: (type: CanvasCardMenuType, e: React.DragEvent) => void;
}

/**
 * Barra inferior `.canvas-card-menu` — 1:1 con Obsidian.
 * Tres botones, sin divisores verticales, que funcionan con clic y también
 * arrastrándose sobre el lienzo.
 */
export const CanvasCardMenu: React.FC<CanvasCardMenuProps> = ({
  onAddTextCard,
  onAddNoteCard,
  onAddMediaCard,
  onDragStartType,
}) => {
  return (
    <div className="canvas-card-menu">
      <Tooltip content="Añadir tarjeta (clic o arrastrar al lienzo)" position="top">
        <div
          onClick={onAddTextCard}
          draggable
          onDragStart={(e) => onDragStartType('text', e)}
          className="canvas-card-menu-button mod-draggable"
          title="Añadir tarjeta"
        >
          <StickyNote size={18} />
        </div>
      </Tooltip>

      <Tooltip content="Añadir nota de la bóveda (clic o arrastrar al lienzo)" position="top">
        <div
          onClick={onAddNoteCard}
          draggable
          onDragStart={(e) => onDragStartType('note', e)}
          className="canvas-card-menu-button mod-draggable"
          title="Añadir nota de la bóveda"
        >
          <FileText size={18} />
        </div>
      </Tooltip>

      <Tooltip content="Añadir multimedia de la bóveda (clic o arrastrar al lienzo)" position="top">
        <div
          onClick={onAddMediaCard}
          draggable
          onDragStart={(e) => onDragStartType('media', e)}
          className="canvas-card-menu-button mod-draggable"
          title="Añadir multimedia de la bóveda"
        >
          <Image size={18} />
        </div>
      </Tooltip>
    </div>
  );
};
