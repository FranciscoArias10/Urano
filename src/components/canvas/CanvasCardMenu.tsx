import React from 'react';
import { StickyNote, FileText, Globe } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';

interface CanvasCardMenuProps {
  onAddTextCard: () => void;
  onAddFileCard: () => void;
  onAddLinkCard: () => void;
  onDragStartType: (type: 'text' | 'file' | 'link', e: React.DragEvent) => void;
}

export const CanvasCardMenu: React.FC<CanvasCardMenuProps> = ({
  onAddTextCard,
  onAddFileCard,
  onAddLinkCard,
  onDragStartType,
}) => {
  return (
    <div className="canvas-card-menu">
      <Tooltip content="Añadir tarjeta de texto (clic o arrastrar al lienzo)" position="top">
        <div
          onClick={onAddTextCard}
          draggable
          onDragStart={(e) => onDragStartType('text', e)}
          className="canvas-card-menu-button mod-draggable group"
        >
          <StickyNote size={18} className="group-hover:text-orange-500 transition-colors" />
        </div>
      </Tooltip>

      <div className="canvas-card-menu-divider" />

      <Tooltip content="Añadir nota de la bóveda (clic o arrastrar al lienzo)" position="top">
        <div
          onClick={onAddFileCard}
          draggable
          onDragStart={(e) => onDragStartType('file', e)}
          className="canvas-card-menu-button mod-draggable group"
        >
          <FileText size={18} className="group-hover:text-orange-500 transition-colors" />
        </div>
      </Tooltip>

      <div className="canvas-card-menu-divider" />

      <Tooltip content="Añadir enlace web o media (clic o arrastrar al lienzo)" position="top">
        <div
          onClick={onAddLinkCard}
          draggable
          onDragStart={(e) => onDragStartType('link', e)}
          className="canvas-card-menu-button mod-draggable group"
        >
          <Globe size={18} className="group-hover:text-orange-500 transition-colors" />
        </div>
      </Tooltip>
    </div>
  );
};
