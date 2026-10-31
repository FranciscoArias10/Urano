import React, { useEffect, useRef, useMemo, useState } from 'react';
import ForceGraph from 'force-graph';
import { extractWikilinks } from '../../editor/wikilinks';
import { useVaultStore } from '../../stores/vaultStore';
import { GraphData, GraphNode, GraphLink } from '../../types';
import { Settings, Wand2 } from 'lucide-react';

interface GraphViewProps {
  onSelectNote: (notePath: string) => void;
  onClose?: () => void;
}

export const GraphView: React.FC<GraphViewProps> = ({ onSelectNote, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphInstance = useRef<any>(null);
  const [, setHoverTick] = useState(0);
  const hoveredNodeRef = useRef<any>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  // Detect theme reactive to theme-light class on document.body
  const [isLight, setIsLight] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.body.classList.contains('theme-light') : false
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowFilters(false);
        setShowSettings(false);
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setShowFilters(false);
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsLight(document.body.classList.contains('theme-light'));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

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

    const currentBg = isLight ? '#ffffff' : '#1e1e1e';
    const currentLinkColor = isLight ? '#d4d4d4' : '#363636';
    const currentNodeColor = isLight ? '#666666' : '#999999';
    const currentTextColor = isLight ? '#222222' : '#dcddde';

    // Clear previous graph instance if any
    if (graphInstance.current) {
      graphInstance.current._destructor?.();
      graphInstance.current = null;
    }
    containerRef.current.innerHTML = '';

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    // Initialize ForceGraph 1:1 with Obsidian styling
    const fg = (ForceGraph as any)()(containerRef.current)
      .width(width)
      .height(height)
      .graphData(graphData)
      .backgroundColor(currentBg)
      .nodeId('id')
      .nodeLabel('name')
      .nodeVal('val')
      .linkColor(() => currentLinkColor)
      .linkWidth(1.2)
      .nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const label = node.name;
        const fontSize = 12 / globalScale;
        const r = Math.sqrt(Math.max(0, node.val || 1)) * 4;
        const isHovered = hoveredNodeRef.current && hoveredNodeRef.current.id === node.id;

        // Hover accent halo
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI, false);
          ctx.fillStyle = 'rgba(224, 108, 27, 0.35)';
          ctx.fill();
        }

        // Node circle: gris oscuro #666666 en claro, #999999 en oscuro; acento al hacer hover
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = isHovered ? '#e06c1b' : currentNodeColor;
        ctx.fill();

        // Label con font-family var(--font-interface)
        if (globalScale > 1.2 || node.val > 2 || isHovered) {
          ctx.font = `${fontSize}px var(--font-interface, sans-serif)`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = currentTextColor;
          ctx.fillText(label, node.x, node.y + r + fontSize);
        }
      })
      .onNodeHover((node: any) => {
        hoveredNodeRef.current = node || null;
        setHoverTick((t) => t + 1);
        if (containerRef.current) {
          containerRef.current.style.cursor = node ? 'pointer' : 'default';
        }
      })
      .onNodeClick((node: any) => {
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

    // ResizeObserver connects to container to dynamically fill 100% of the visible area
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0 && fg) {
          fg.width(w);
          fg.height(h);
          const canvas = containerRef.current?.querySelector('canvas');
          if (canvas) {
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
          }
        }
      }
    });

    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (graphInstance.current) {
        graphInstance.current._destructor?.();
        graphInstance.current = null;
      }
    };
  }, [graphData, isLight]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: isLight ? '#ffffff' : '#1e1e1e',
      }}
      className="graph-view select-none"
    >
      {/* Floating Controls Top-Right (1:1 with Obsidian: gear & wand/filters) */}
      <div ref={controlsRef} className="graph-controls absolute top-3 right-4 z-10 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Filtros"
            onClick={() => {
              setShowFilters((v) => !v);
              setShowSettings(false);
            }}
            className={`p-1.5 rounded bg-[var(--background-primary)] hover:bg-[var(--background-modifier-hover)] text-[var(--text-muted)] hover:text-[var(--text-normal)] border border-[var(--background-modifier-border)] shadow-sm backdrop-blur transition-colors cursor-pointer ${
              showFilters ? 'bg-[var(--background-modifier-hover)] text-[var(--text-normal)]' : ''
            }`}
          >
            <Wand2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Ajustes del grafo"
            onClick={() => {
              setShowSettings((v) => !v);
              setShowFilters(false);
            }}
            className={`p-1.5 rounded bg-[var(--background-primary)] hover:bg-[var(--background-modifier-hover)] text-[var(--text-muted)] hover:text-[var(--text-normal)] border border-[var(--background-modifier-border)] shadow-sm backdrop-blur transition-colors cursor-pointer ${
              showSettings ? 'bg-[var(--background-modifier-hover)] text-[var(--text-normal)]' : ''
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Panel de Filtros anclado a la derecha */}
        {showFilters && (
          <div
            className="graph-controls-popover"
            style={{
              position: 'absolute',
              top: '36px',
              right: '0',
              left: 'auto',
              maxHeight: 'calc(100vh - 80px)',
              overflowY: 'auto',
              width: '240px',
              zIndex: 20,
              backgroundColor: 'var(--background-primary)',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
              padding: '12px',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Filtros
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-normal)' }}>
              <input
                type="text"
                placeholder="Buscar..."
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  backgroundColor: 'var(--background-secondary)',
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '4px',
                  color: 'var(--text-normal)',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked />
                <span>Etiquetas</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked />
                <span>Archivos adjuntos</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked />
                <span>Nodos huérfanos</span>
              </label>
            </div>
          </div>
        )}

        {/* Panel de Ajustes anclado a la derecha */}
        {showSettings && (
          <div
            className="graph-controls-popover"
            style={{
              position: 'absolute',
              top: '36px',
              right: '0',
              left: 'auto',
              maxHeight: 'calc(100vh - 80px)',
              overflowY: 'auto',
              width: '240px',
              zIndex: 20,
              backgroundColor: 'var(--background-primary)',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
              padding: '12px',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Ajustes del grafo
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Fuerza de repulsión</span>
                </div>
                <input type="range" min="1" max="100" defaultValue="50" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Distancia de enlace</span>
                </div>
                <input type="range" min="1" max="100" defaultValue="40" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Tamaño de nodo</span>
                </div>
                <input type="range" min="1" max="100" defaultValue="30" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>Grosor de línea</span>
                </div>
                <input type="range" min="1" max="100" defaultValue="20" style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Graph Canvas Container (100% area) */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
      />
    </div>
  );
};
