import React, { useState } from 'react';
import { CanvasEdge, CanvasNode } from '../../types/canvas';
import {
  getNodeBBox,
  getSideCenter,
  offsetSidePoint,
  calculateBezier,
  getBezierMidpoint,
  CANVAS_COLORS,
  DEFAULT_COLOR,
  SIDE_ANGLES,
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

  // Calculate coordinates using exact Obsidian geometry
  const fromBbox = getNodeBBox(fromNode);
  const toBbox = getNodeBBox(toNode);

  const fromCenter = getSideCenter(fromBbox, edge.fromSide);
  const toCenter = getSideCenter(toBbox, edge.toSide);

  const fromOffset = offsetSidePoint(fromCenter, edge.fromSide, 4);
  const toOffset = offsetSidePoint(toCenter, edge.toSide, 8);

  const bezier = calculateBezier(fromOffset, edge.fromSide, toOffset, edge.toSide);
  const midpoint = getBezierMidpoint(0.5, bezier);

  const colorScheme = edge.color && CANVAS_COLORS[edge.color] ? CANVAS_COLORS[edge.color] : DEFAULT_COLOR;
  const strokeColor = isSelected ? 'var(--color-accent)' : colorScheme.hex;

  // Arrowhead at destination
  const toAngle = SIDE_ANGLES[edge.toSide];
  // Arrowhead at source if fromEnd === 'arrow'
  const fromAngle = (SIDE_ANGLES[edge.fromSide] + 180) % 360;

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

      {/* Visible styled SVG curve */}
      <path
        d={bezier.path}
        className="canvas-display-path"
        style={{
          stroke: strokeColor,
          strokeWidth: isSelected ? '3.5px' : '2px',
        }}
      />

      {/* Destination Arrowhead */}
      {edge.toEnd !== 'none' && (
        <polygon
          points="-5,0 5,0 0,-10"
          className="canvas-path-end"
          style={{
            fill: strokeColor,
            stroke: strokeColor,
            transform: `translate(${toCenter.x}px, ${toCenter.y}px) rotate(${toAngle}deg)`,
            transformOrigin: '0 0',
          }}
        />
      )}

      {/* Source Arrowhead (if bidirectional) */}
      {edge.fromEnd === 'arrow' && (
        <polygon
          points="-5,0 5,0 0,-10"
          className="canvas-path-end"
          style={{
            fill: strokeColor,
            stroke: strokeColor,
            transform: `translate(${fromCenter.x}px, ${fromCenter.y}px) rotate(${fromAngle}deg)`,
            transformOrigin: '0 0',
          }}
        />
      )}

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
              className="canvas-path-label bg-[#1e1e1e] text-white border border-orange-500 text-[11px] px-2 py-0.5 rounded outline-none w-full text-center"
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
