import React, { useState } from 'react';
import { CanvasEdge, CanvasNode } from '../../types/canvas';
import {
  getNodeBBox,
  getSideCoordinates,
  getBezierPath,
  getBezierMidpoint,
  resolveCanvasColor,
} from './canvasMath';

interface CanvasEdgeViewProps {
  edge: CanvasEdge;
  fromNode: CanvasNode;
  toNode: CanvasNode;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onUpdateLabel?: (edgeId: string, label: string) => void;
  isEditingLabel?: boolean;
  setIsEditingLabel?: (editing: boolean) => void;
}

export const CanvasEdgeView: React.FC<CanvasEdgeViewProps> = ({
  edge,
  fromNode,
  toNode,
  isSelected,
  onSelect,
  onContextMenu,
  onUpdateLabel,
  isEditingLabel: parentIsEditing,
  setIsEditingLabel: parentSetIsEditing,
}) => {
  const [localIsEditing, setLocalIsEditing] = useState(false);
  const isEditing = parentIsEditing !== undefined ? parentIsEditing : localIsEditing;
  const setIsEditing = parentSetIsEditing || setLocalIsEditing;
  const [labelText, setLabelText] = useState(edge.label || '');

  // Anclajes exactos sobre el borde exterior de cada tarjeta (2px de margen).
  const fromBbox = getNodeBBox(fromNode);
  const toBbox = getNodeBBox(toNode);

  const fromPoint = getSideCoordinates(fromBbox, edge.fromSide);
  const toPoint = getSideCoordinates(toBbox, edge.toSide);

  const bezier = getBezierPath(fromPoint, edge.fromSide, toPoint, edge.toSide);
  const midpoint = getBezierMidpoint(0.5, bezier);

  const colorScheme = resolveCanvasColor(edge.color);
  // Una arista coloreada conserva su color incluso al seleccionarla.
  const strokeColor = edge.color
    ? colorScheme.hex
    : isSelected
      ? 'var(--color-accent)'
      : colorScheme.hex;

  const handleLabelBlur = () => {
    setIsEditing(false);
    if (onUpdateLabel) {
      onUpdateLabel(edge.id, labelText);
    }
  };

  return (
    <g
      className={`canvas-edge-group ${isSelected ? 'is-focused' : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {/* Invisible thick path for comfortable mouse interaction */}
      <path
        d={bezier.path}
        className="canvas-interaction-path"
      />

      {/* Visible styled SVG curve. La punta de flecha es un `<marker>` del
          lienzo (`#canvas-arrow`): queda apoyada en el borde exterior y la
          base del triángulo se solapa con la línea, sin hueco. */}
      <path
        d={bezier.path}
        className="canvas-display-path"
        style={{
          stroke: strokeColor,
          color: strokeColor,
          strokeWidth: isSelected ? '3.5px' : '2px',
        }}
        markerEnd={edge.toEnd !== 'none' ? 'url(#canvas-arrow)' : undefined}
        markerStart={edge.fromEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}
      />

      {/* Edge label at midpoint */}
      {(edge.label || isEditing) && (
        <foreignObject
          x={midpoint.x - 75}
          y={midpoint.y - 15}
          width="150"
          height="30"
          className="overflow-visible pointer-events-auto"
        >
          {isEditing ? (
            <input
              type="text"
              autoFocus
              value={labelText}
              onChange={(e) => setLabelText(e.target.value)}
              onBlur={handleLabelBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLabelBlur();
              }}
              className="canvas-path-label bg-obsidian-bg text-obsidian-text border border-orange-500 text-[11px] px-2 py-0.5 rounded outline-none w-full text-center"
            />
          ) : (
            <div
              className="canvas-path-label"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
            >
              {edge.label}
            </div>
          )}
        </foreignObject>
      )}
    </g>
  );
};
