import React from 'react';
import { StickyNote, FileText, Image } from 'lucide-react';
import { Tooltip } from '../common/Tooltip';
import { useT } from '../../stores/localeStore';

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
  const t = useT();
  return (
    <div className="canvas-card-menu">
      <Tooltip content={t('canvas.cardMenu.addCardHint')} position="top">
        <div
          onClick={onAddTextCard}
          draggable
          onDragStart={(e) => onDragStartType('text', e)}
          className="canvas-card-menu-button mod-draggable"
          title={t('canvas.menu.addCard')}
        >
          <StickyNote size={18} />
        </div>
      </Tooltip>

      <Tooltip content={t('canvas.cardMenu.addNoteHint')} position="top">
        <div
          onClick={onAddNoteCard}
          draggable
          onDragStart={(e) => onDragStartType('note', e)}
          className="canvas-card-menu-button mod-draggable"
          title={t('canvas.menu.addNote')}
        >
          <FileText size={18} />
        </div>
      </Tooltip>

      <Tooltip content={t('canvas.cardMenu.addMediaHint')} position="top">
        <div
          onClick={onAddMediaCard}
          draggable
          onDragStart={(e) => onDragStartType('media', e)}
          className="canvas-card-menu-button mod-draggable"
          title={t('canvas.menu.addMedia')}
        >
          <Image size={18} />
        </div>
      </Tooltip>
    </div>
  );
};
