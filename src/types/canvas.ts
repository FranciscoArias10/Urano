// JSON Canvas 1.0 Specification types (compatible with Obsidian Canvas)

export type CanvasNodeSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEdgeEnd = 'none' | 'arrow';

export interface CanvasBaseNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string; // "1" to "6" or hex
}

export interface CanvasTextNode extends CanvasBaseNode {
  type: 'text';
  text: string;
}

export interface CanvasFileNode extends CanvasBaseNode {
  type: 'file';
  file: string; // vault relative path
  subpath?: string;
}

export interface CanvasLinkNode extends CanvasBaseNode {
  type: 'link';
  url: string;
}

export interface CanvasGroupNode extends CanvasBaseNode {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: CanvasNodeSide;
  fromEnd?: CanvasEdgeEnd;
  toNode: string;
  toSide: CanvasNodeSide;
  toEnd?: CanvasEdgeEnd;
  color?: string; // "1" to "6" or hex
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BezierCurve {
  from: CanvasPoint;
  to: CanvasPoint;
  cp1: CanvasPoint;
  cp2: CanvasPoint;
  path: string;
}
