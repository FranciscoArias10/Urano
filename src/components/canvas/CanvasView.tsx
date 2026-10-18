import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Trash2,
  Move,
  Palette,
} from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';

export interface CanvasNode {
  id: string;
  type: 'text' | 'file';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string; // 1: red/orange, 2: amber, 3: green, 4: cyan, 5: purple, 6: dark
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface CanvasViewProps {
  filePath: string;
}

const COLOR_MAP: Record<string, { bg: string; border: string }> = {
  '1': { bg: 'rgba(234, 88, 12, 0.15)', border: '#ea580c' }, // Urano orange
  '2': { bg: 'rgba(217, 119, 6, 0.15)', border: '#d97706' }, // Amber
  '3': { bg: 'rgba(22, 163, 74, 0.15)', border: '#16a34a' }, // Green
  '4': { bg: 'rgba(2, 132, 199, 0.15)', border: '#0284c7' }, // Blue
  '5': { bg: 'rgba(147, 51, 234, 0.15)', border: '#9333ea' }, // Purple
  '6': { bg: '#1c1c1c', border: '#383838' }, // Neutral dark
};

export const CanvasView: React.FC<CanvasViewProps> = ({ filePath }) => {
  const { fileContent, updateContent } = useVaultStore();

  const [canvasData, setCanvasData] = useState<CanvasData>({ nodes: [], edges: [] });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Parse canvas JSON on load
  useEffect(() => {
    try {
      if (fileContent.trim()) {
        const parsed = JSON.parse(fileContent);
        setCanvasData({
          nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
          edges: Array.isArray(parsed.edges) ? parsed.edges : [],
        });
      } else {
        const defaultData: CanvasData = {
          nodes: [
            {
              id: 'node-1',
              type: 'text',
              text: '# Bienvenido al Lienzo (Canvas)\n\nPuedes arrastrar tarjetas, cambiar su color o crear más.',
              x: 100,
              y: 100,
              width: 320,
              height: 180,
              color: '1',
            },
          ],
          edges: [],
        };
        setCanvasData(defaultData);
        updateContent(JSON.stringify(defaultData, null, 2));
      }
    } catch (e) {
      console.warn('Error al parsear archivo .canvas:', e);
    }
  }, [filePath]);

  // Synchronize state changes back to vault content
  const syncChanges = (updated: CanvasData) => {
    setCanvasData(updated);
    updateContent(JSON.stringify(updated, null, 2));
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((prev) => Math.max(0.2, Math.min(3, prev * zoomFactor)));
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Canvas Pan (middle click or drag on background)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('canvas-background')) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
      return;
    }

    if (draggingNodeId) {
      const newX = (e.clientX - pan.x) / zoom - dragOffset.x;
      const newY = (e.clientY - pan.y) / zoom - dragOffset.y;

      setCanvasData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === draggingNodeId ? { ...n, x: Math.round(newX), y: Math.round(newY) } : n
        ),
      }));
      return;
    }

    if (resizingNodeId) {
      const deltaX = (e.clientX - resizeStart.x) / zoom;
      const deltaY = (e.clientY - resizeStart.y) / zoom;
      const newW = Math.max(160, resizeStart.w + deltaX);
      const newH = Math.max(100, resizeStart.h + deltaY);

      setCanvasData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === resizingNodeId ? { ...n, width: Math.round(newW), height: Math.round(newH) } : n
        ),
      }));
    }
  };

  const handleMouseUp = () => {
    if (isPanning) setIsPanning(false);
    if (draggingNodeId) {
      setDraggingNodeId(null);
      syncChanges(canvasData);
    }
    if (resizingNodeId) {
      setResizingNodeId(null);
      syncChanges(canvasData);
    }
  };

  // Add new card
  const handleAddCard = () => {
    const id = `node-${Date.now()}`;
    const newNode: CanvasNode = {
      id,
      type: 'text',
      text: 'Nueva tarjeta',
      x: Math.round((-pan.x + 200) / zoom),
      y: Math.round((-pan.y + 200) / zoom),
      width: 280,
      height: 160,
      color: '6',
    };
    const updated = {
      ...canvasData,
      nodes: [...canvasData.nodes, newNode],
    };
    syncChanges(updated);
  };

  // Delete card
  const handleDeleteNode = (nodeId: string) => {
    const updated = {
      nodes: canvasData.nodes.filter((n) => n.id !== nodeId),
      edges: canvasData.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
    };
    syncChanges(updated);
  };

  // Change color
  const handleCycleColor = (nodeId: string) => {
    const colors = ['1', '2', '3', '4', '5', '6'];
    const updated = {
      ...canvasData,
      nodes: canvasData.nodes.map((n) => {
        if (n.id === nodeId) {
          const currentIdx = colors.indexOf(n.color || '6');
          const nextColor = colors[(currentIdx + 1) % colors.length];
          return { ...n, color: nextColor };
        }
        return n;
      }),
    };
    syncChanges(updated);
  };

  // Update card text
  const handleUpdateText = (nodeId: string, text: string) => {
    const updated = {
      ...canvasData,
      nodes: canvasData.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)),
    };
    syncChanges(updated);
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative w-full h-full overflow-hidden bg-[#121212] select-none cursor-default"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* Floating Canvas Controls Top Center */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 bg-[#1a1a1a]/95 border border-[#333333] px-3 py-1.5 rounded-lg shadow-xl backdrop-blur-md">
        <button
          onClick={handleAddCard}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 rounded border border-orange-500/40 transition-colors"
          title="Añadir tarjeta de texto"
        >
          <Plus size={13} />
          <span>Añadir Tarjeta</span>
        </button>

        <div className="w-[1px] h-4 bg-stone-700/60 mx-1" />

        <button
          onClick={() => setZoom((z) => Math.min(3, z * 1.15))}
          className="p-1 hover:bg-stone-800 rounded text-stone-300 hover:text-white"
          title="Acercar (Zoom In)"
        >
          <ZoomIn size={14} />
        </button>
        <span className="text-[11px] font-mono text-stone-400 px-1 min-w-[36px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.max(0.2, z * 0.85))}
          className="p-1 hover:bg-stone-800 rounded text-stone-300 hover:text-white"
          title="Alejar (Zoom Out)"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="p-1 hover:bg-stone-800 rounded text-stone-300 hover:text-white"
          title="Restablecer vista (100%)"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Canvas Elements Space */}
      <div
        className="absolute top-0 left-0 w-full h-full pointer-events-none origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* Render Edges (arrows) */}
        <svg className="absolute top-0 left-0 w-[10000px] h-[10000px] overflow-visible pointer-events-none">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#888" />
            </marker>
          </defs>
          {canvasData.edges.map((edge) => {
            const from = canvasData.nodes.find((n) => n.id === edge.fromNode);
            const to = canvasData.nodes.find((n) => n.id === edge.toNode);
            if (!from || !to) return null;

            const x1 = from.x + from.width / 2;
            const y1 = from.y + from.height / 2;
            const x2 = to.x + to.width / 2;
            const y2 = to.y + to.height / 2;

            return (
              <line
                key={edge.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#666"
                strokeWidth="2"
                strokeDasharray="4 4"
                markerEnd="url(#arrow)"
              />
            );
          })}
        </svg>

        {/* Render Cards / Nodes */}
        {canvasData.nodes.map((node) => {
          const colorStyles = COLOR_MAP[node.color || '6'] || COLOR_MAP['6'];

          return (
            <div
              key={node.id}
              style={{
                transform: `translate(${node.x}px, ${node.y}px)`,
                width: `${node.width}px`,
                height: `${node.height}px`,
                backgroundColor: colorStyles.bg,
                borderColor: colorStyles.border,
              }}
              className="absolute pointer-events-auto rounded-lg border shadow-lg flex flex-col overflow-hidden group/card backdrop-blur-sm transition-shadow hover:shadow-2xl"
            >
              {/* Card Header (Drag Handle) */}
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggingNodeId(node.id);
                  setDragOffset({
                    x: (e.clientX - pan.x) / zoom - node.x,
                    y: (e.clientY - pan.y) / zoom - node.y,
                  });
                }}
                className="px-2.5 py-1.5 flex items-center justify-between border-b border-white/5 cursor-grab active:cursor-grabbing bg-black/20"
              >
                <div className="flex items-center gap-1.5 text-stone-400">
                  <Move size={12} className="opacity-60" />
                  <span className="text-[11px] font-medium text-stone-300">Tarjeta</span>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCycleColor(node.id);
                    }}
                    className="p-1 hover:bg-white/10 rounded text-stone-400 hover:text-white"
                    title="Cambiar color de tarjeta"
                  >
                    <Palette size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteNode(node.id);
                    }}
                    className="p-1 hover:bg-red-500/20 rounded text-stone-400 hover:text-red-400"
                    title="Eliminar tarjeta"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Card Content Editable */}
              <div className="flex-1 p-3 overflow-y-auto select-text cursor-text">
                <textarea
                  value={node.text}
                  onChange={(e) => handleUpdateText(node.id, e.target.value)}
                  placeholder="Escribe aquí..."
                  className="w-full h-full bg-transparent text-sm text-stone-200 outline-none resize-none placeholder-stone-500 font-sans"
                />
              </div>

              {/* Resize Handle bottom-right */}
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setResizingNodeId(node.id);
                  setResizeStart({
                    x: e.clientX,
                    y: e.clientY,
                    w: node.width,
                    h: node.height,
                  });
                }}
                className="absolute bottom-1 right-1 w-3 h-3 cursor-nwse-resize opacity-40 group-hover/card:opacity-100"
              >
                <svg viewBox="0 0 10 10" className="w-full h-full fill-stone-400">
                  <path d="M9 1 L1 9 L9 9 Z" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
