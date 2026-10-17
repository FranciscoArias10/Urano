import React, { useEffect, useRef, useMemo } from 'react';
import ForceGraph from 'force-graph';
import { extractWikilinks } from '../../editor/wikilinks';
import { useVaultStore } from '../../stores/vaultStore';
import { GraphData, GraphNode, GraphLink } from '../../types';
import { Network, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface GraphViewProps {
  onSelectNote: (notePath: string) => void;
  onClose?: () => void;
}

export const GraphView: React.FC<GraphViewProps> = ({ onSelectNote, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphInstance = useRef<any>(null);

  const { notesContentMap, activeFile } = useVaultStore();

  // Compute graph nodes and links from notesContentMap
  const graphData: GraphData = useMemo(() => {
    const nodesMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    // 1. Create nodes for all notes
    for (const [filePath, content] of Object.entries(notesContentMap)) {
      const fileName = filePath.replace(/\\/g, '/').split('/').pop() || '';
      const baseName = fileName.replace(/\.md$/i, '');
      const id = baseName.toLowerCase();

      if (!nodesMap.has(id)) {
        nodesMap.set(id, {
          id,
          name: baseName,
          val: 1,
          color: activeFile === filePath ? '#ea580c' : '#fb923c',
        });
      }

      // 2. Extract wikilinks and build connections
      const targetLinks = extractWikilinks(content);
      for (const target of targetLinks) {
        const targetId = target.toLowerCase();
        
        // Add target node if it doesn't exist yet (uncreated note)
        if (!nodesMap.has(targetId)) {
          nodesMap.set(targetId, {
            id: targetId,
            name: target,
            val: 0.8,
            color: '#78716c', // Grey for ghost/uncreated notes
          });
        }

        // Increase weight of target node
        const targetNode = nodesMap.get(targetId);
        if (targetNode) {
          targetNode.val += 0.8;
        }

        links.push({
          source: id,
          target: targetId,
        });
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      links,
    };
  }, [notesContentMap, activeFile]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize ForceGraph with Uranium amber theme
    const fg = (ForceGraph as any)()(containerRef.current)
      .graphData(graphData)
      .backgroundColor('#141312')
      .nodeId('id')
      .nodeLabel('name')
      .nodeVal('val')
      .nodeColor('color')
      .linkColor(() => '#2c2723')
      .linkWidth(1.2)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleColor(() => '#ea580c')
      .nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const label = node.name;
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px Inter, sans-serif`;
        
        const r = Math.sqrt(Math.max(0, node.val || 1)) * 4;

        // Outer Uranium Glow
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI, false);
        ctx.fillStyle = node.color ? `${node.color}33` : '#ea580c33';
        ctx.fill();

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = node.color || '#ea580c';
        ctx.fill();

        // Label
        if (globalScale > 1.2 || node.val > 2) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#e2dfda';
          ctx.fillText(label, node.x, node.y + r + fontSize);
        }
      })
      .onNodeClick((node: any) => {
        // Find matching note path
        for (const filePath of Object.keys(notesContentMap)) {
          const fileName = filePath.replace(/\\/g, '/').split('/').pop() || '';
          if (fileName.replace(/\.md$/i, '').toLowerCase() === node.id) {
            onSelectNote(filePath);
            if (onClose) onClose();
            return;
          }
        }
      });

    graphInstance.current = fg;

    // Resize listener
    const handleResize = () => {
      if (containerRef.current && fg) {
        fg.width(containerRef.current.clientWidth);
        fg.height(containerRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (graphInstance.current) {
        graphInstance.current._destructor?.();
      }
    };
  }, [graphData]);

  const handleZoomIn = () => {
    if (graphInstance.current) {
      graphInstance.current.zoom(graphInstance.current.zoom() * 1.3, 400);
    }
  };

  const handleZoomOut = () => {
    if (graphInstance.current) {
      graphInstance.current.zoom(graphInstance.current.zoom() / 1.3, 400);
    }
  };

  const handleResetZoom = () => {
    if (graphInstance.current) {
      graphInstance.current.zoomToFit(400, 50);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-obsidian-bg relative overflow-hidden select-none">
      {/* Graph Toolbar */}
      <div className="absolute top-4 left-6 z-10 flex items-center gap-2 bg-obsidian-sidebar/80 backdrop-blur px-3 py-1.5 rounded-lg border border-obsidian-border text-xs text-obsidian-text shadow-lg">
        <Network className="w-4 h-4 text-orange-400" />
        <span className="font-medium">Grafo de Conexiones</span>
        <span className="text-obsidian-muted">({graphData.nodes.length} notas, {graphData.links.length} enlaces)</span>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-1.5 bg-obsidian-sidebar/90 backdrop-blur p-1 rounded-lg border border-obsidian-border shadow-lg">
        <button
          onClick={handleZoomIn}
          title="Acercar"
          className="p-2 hover:bg-obsidian-hover text-obsidian-muted hover:text-white rounded transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          title="Alejar"
          className="p-2 hover:bg-obsidian-hover text-obsidian-muted hover:text-white rounded transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetZoom}
          title="Restablecer vista"
          className="p-2 hover:bg-obsidian-hover text-obsidian-muted hover:text-white rounded transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Graph Canvas Container */}
      <div ref={containerRef} className="w-full h-full flex-1" />
    </div>
  );
};
