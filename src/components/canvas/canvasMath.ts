import {
  CanvasNode,
  CanvasNodeSide,
  CanvasPoint,
  CanvasBBox,
  BezierCurve,
  CanvasGroupNode,
} from '../../types/canvas';

// Official Obsidian Canvas 6 palette colors + default neutral
export const CANVAS_COLORS: Record<
  string,
  { name: string; hex: string; bg: string; border: string; text: string }
> = {
  '1': {
    name: 'Rojo',
    hex: '#fb464c',
    bg: 'rgba(251, 70, 76, 0.12)',
    border: '#fb464c',
    text: '#ff8591',
  },
  '2': {
    name: 'Naranja',
    hex: '#e9973f',
    bg: 'rgba(233, 151, 63, 0.12)',
    border: '#e9973f',
    text: '#ffbe7a',
  },
  '3': {
    name: 'Amarillo',
    hex: '#e0de71',
    bg: 'rgba(224, 222, 113, 0.12)',
    border: '#e0de71',
    text: '#f0eea0',
  },
  '4': {
    name: 'Verde',
    hex: '#44cf6e',
    bg: 'rgba(68, 207, 110, 0.12)',
    border: '#44cf6e',
    text: '#7fe4a0',
  },
  '5': {
    name: 'Cian',
    hex: '#53dfdd',
    bg: 'rgba(83, 223, 221, 0.12)',
    border: '#53dfdd',
    text: '#8aebea',
  },
  '6': {
    name: 'Púrpura',
    hex: '#a882ff',
    bg: 'rgba(168, 130, 255, 0.12)',
    border: '#a882ff',
    text: '#c5adff',
  },
};

// Default styling when no color is assigned
export const DEFAULT_COLOR = {
  name: 'Por defecto',
  hex: '#7e7e7e',
  bg: '#1e1e1e',
  border: '#383838',
  text: '#d4d4d4',
};

/** Círculo gris del selector de color (restablece el color del nodo/arista). */
export const RESET_COLOR = '#808080';

export type CanvasColorScheme = typeof DEFAULT_COLOR;

/** ¿Es un color hexadecimal personalizado (`#rrggbb`)? */
export function isCustomCanvasColor(color?: string): boolean {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);
}

/**
 * Resuelve tanto las claves de la paleta de Obsidian (`"1"`..`"6"`) como los
 * colores hexadecimales personalizados elegidos con la rueda de color.
 */
export function resolveCanvasColor(color?: string): CanvasColorScheme {
  if (color && CANVAS_COLORS[color]) return CANVAS_COLORS[color];
  if (isCustomCanvasColor(color)) {
    return {
      name: 'Personalizado',
      hex: color as string,
      bg: `color-mix(in srgb, ${color} 12%, #1e1e1e)`,
      border: color as string,
      text: '#ffffff',
    };
  }
  return DEFAULT_COLOR;
}

/** Lado de `to` que mira hacia `from` (lado opuesto al origen de la flecha). */
export function facingSide(from: CanvasBBox, to: CanvasBBox): CanvasNodeSide {
  const fromX = (from.minX + from.maxX) / 2;
  const fromY = (from.minY + from.maxY) / 2;
  const toX = (to.minX + to.maxX) / 2;
  const toY = (to.minY + to.maxY) / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right';
  return dy >= 0 ? 'top' : 'bottom';
}

// Generate 16-hex alphanumeric id (Obsidian standard)
export function generateCanvasId(): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// Bounding box of a single node
export function getNodeBBox(node: CanvasNode): CanvasBBox {
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + node.width,
    maxY: node.y + node.height,
  };
}

// Global Bounding box of multiple nodes
export function getBoundingBox(nodes: CanvasNode[]): CanvasBBox | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  return { minX, minY, maxX, maxY };
}

// Get center point of a side on a bounding box (Reverse-engineered Wee function)
export function getSideCenter(bbox: CanvasBBox, side: CanvasNodeSide): CanvasPoint {
  switch (side) {
    case 'top':
      return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.minY };
    case 'right':
      return { x: bbox.maxX, y: (bbox.minY + bbox.maxY) / 2 };
    case 'bottom':
      return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.maxY };
    case 'left':
      return { x: bbox.minX, y: (bbox.minY + bbox.maxY) / 2 };
  }
}

// Offset point outwards by 7px for arrowhead / connection line clearance (Reverse-engineered jee function)
export function offsetSidePoint(point: CanvasPoint, side: CanvasNodeSide, offset = 7): CanvasPoint {
  const p = { ...point };
  switch (side) {
    case 'top':
      p.y -= offset;
      break;
    case 'bottom':
      p.y += offset;
      break;
    case 'left':
      p.x -= offset;
      break;
    case 'right':
      p.x += offset;
      break;
  }
  return p;
}

// Control point vector along side normal (Reverse-engineered Uee function)
export function getControlPoint(side: CanvasNodeSide, point: CanvasPoint, dist: number): CanvasPoint {
  switch (side) {
    case 'left':
      return { x: point.x - dist, y: point.y };
    case 'right':
      return { x: point.x + dist, y: point.y };
    case 'top':
      return { x: point.x, y: point.y - dist };
    case 'bottom':
      return { x: point.x, y: point.y + dist };
  }
}

// Exact Obsidian cubic Bézier curve calculation (Reverse-engineered _ee function)
export function calculateBezier(
  fromPoint: CanvasPoint,
  fromSide: CanvasNodeSide,
  toPoint: CanvasPoint,
  toSide: CanvasNodeSide
): BezierCurve {
  const dist = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  const offset = Math.min(Math.max(dist / 2, 70), 150);
  const cp1 = getControlPoint(fromSide, fromPoint, offset);
  const cp2 = getControlPoint(toSide, toPoint, offset);
  return {
    from: fromPoint,
    to: toPoint,
    cp1,
    cp2,
    path: `M${fromPoint.x},${fromPoint.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${toPoint.x},${toPoint.y}`,
  };
}

// Bézier midpoint for edge labels at parameter t (default 0.5)
export function getBezierMidpoint(t: number, b: BezierCurve): CanvasPoint {
  const a = 1 - t;
  const a3 = a * a * a;
  const a2_3 = 3 * t * a * a;
  const a_3 = 3 * t * t * a;
  const t3 = t * t * t;
  return {
    x: a3 * b.from.x + a2_3 * b.cp1.x + a_3 * b.cp2.x + t3 * b.to.x,
    y: a3 * b.from.y + a2_3 * b.cp1.y + a_3 * b.cp2.y + t3 * b.to.y,
  };
}

// Determine best connecting side between two bounding boxes automatically (Reverse-engineered qee function)
export function autoSide(fromBbox: CanvasBBox, toBbox: CanvasBBox): CanvasNodeSide {
  const fromCenter = {
    x: (fromBbox.minX + fromBbox.maxX) / 2,
    y: (fromBbox.minY + fromBbox.maxY) / 2,
  };
  const toCenter = {
    x: (toBbox.minX + toBbox.maxX) / 2,
    y: (toBbox.minY + toBbox.maxY) / 2,
  };
  const angle = Math.atan2(toCenter.y - fromCenter.y, toCenter.x - fromCenter.x);
  const aspectAngle = Math.atan2(fromBbox.maxY - fromBbox.minY, fromBbox.maxX - fromBbox.minX);

  if (angle > -aspectAngle && angle <= aspectAngle) return 'right';
  if (angle > aspectAngle && angle <= Math.PI - aspectAngle) return 'bottom';
  if (angle > Math.PI - aspectAngle || angle <= -(Math.PI - aspectAngle)) return 'left';
  return 'top';
}

// Check if a point is inside a bounding box
export function isPointInBBox(p: CanvasPoint, bbox: CanvasBBox): boolean {
  return p.x >= bbox.minX && p.x <= bbox.maxX && p.y >= bbox.minY && p.y <= bbox.maxY;
}

/**
 * Devuelve el lado del bbox más cercano a un punto.
 * Se usa al soltar una flecha cerca de cualquiera de los 4 lados de un nodo.
 */
export function closestSide(bbox: CanvasBBox, point: CanvasPoint): CanvasNodeSide {
  const sides: CanvasNodeSide[] = ['top', 'right', 'bottom', 'left'];
  let best: CanvasNodeSide = 'top';
  let bestDistance = Infinity;
  for (const side of sides) {
    const center = getSideCenter(bbox, side);
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = side;
    }
  }
  return best;
}

// Check if two bounding boxes intersect
export function doBBoxesIntersect(a: CanvasBBox, b: CanvasBBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// Check if a node is geometrically contained within a group node
export function isNodeInGroup(node: CanvasNode, group: CanvasGroupNode): boolean {
  if (node.id === group.id) return false;
  return (
    node.x >= group.x &&
    node.y >= group.y &&
    node.x + node.width <= group.x + group.width &&
    node.y + node.height <= group.y + group.height
  );
}

// Rotate angle in degrees for arrowheads based on side
export const SIDE_ANGLES: Record<CanvasNodeSide, number> = {
  top: 180,
  right: 270,
  bottom: 0,
  left: 90,
};
