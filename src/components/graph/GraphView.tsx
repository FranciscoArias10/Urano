import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ForceGraph from 'force-graph';
import { useVaultStore } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useT } from '../../stores/localeStore';
import { Settings, Wand2 } from 'lucide-react';
import {
  PAGE_PREVIEW_HOVER_EVENT,
  type PagePreviewCustomHoverDetail,
} from '../preview/PagePreviewPopover';
import { buildGraphData, filterGraphData, type ViewGraphNode } from './graphModel';

interface GraphViewProps {
  onSelectNote: (notePath: string) => void;
  onClose?: () => void;
}

interface GraphOptions {
  query: string;
  showTags: boolean;
  showAttachments: boolean;
  showOrphans: boolean;
  repel: number;
  linkDistance: number;
  nodeSize: number;
  linkWidth: number;
}

const DEFAULT_OPTIONS: GraphOptions = {
  query: '',
  showTags: false,
  showAttachments: false,
  showOrphans: true,
  repel: 50,
  linkDistance: 40,
  nodeSize: 30,
  linkWidth: 20,
};

const OPTIONS_STORAGE_KEY = 'urano:graph-options';

function loadOptions(): GraphOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<GraphOptions>;
    const num = (v: unknown, d: number) =>
      typeof v === 'number' && v >= 1 && v <= 100 ? v : d;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : DEFAULT_OPTIONS.query,
      showTags: typeof parsed.showTags === 'boolean' ? parsed.showTags : DEFAULT_OPTIONS.showTags,
      showAttachments:
        typeof parsed.showAttachments === 'boolean'
          ? parsed.showAttachments
          : DEFAULT_OPTIONS.showAttachments,
      showOrphans:
        typeof parsed.showOrphans === 'boolean' ? parsed.showOrphans : DEFAULT_OPTIONS.showOrphans,
      repel: num(parsed.repel, DEFAULT_OPTIONS.repel),
      linkDistance: num(parsed.linkDistance, DEFAULT_OPTIONS.linkDistance),
      nodeSize: num(parsed.nodeSize, DEFAULT_OPTIONS.nodeSize),
      linkWidth: num(parsed.linkWidth, DEFAULT_OPTIONS.linkWidth),
    };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

// Con los valores por defecto de los sliders se obtienen los valores originales de force-graph
const chargeStrength = (v: number) => -(v / 50) * 30;
const linkDistanceValue = (v: number) => v * 0.75;
const nodeRelSizeValue = (v: number) => (4 * v) / 30;
const linkWidthValue = (v: number) => (1.2 * v) / 20;

const popoverStyle: React.CSSProperties = {
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
};

const popoverTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  marginBottom: '8px',
};

export const GraphView: React.FC<GraphViewProps> = ({ onSelectNote, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphInstance = useRef<any>(null);
  const [, setHoverTick] = useState(0);
  const hoveredNodeRef = useRef<any>(null);
  const lastPointerRef = useRef({ x: 0, y: 0, ctrlKey: false, hasMoved: false });
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

  const t = useT();
  const { notesContentMap, fileTree, activeVault, openOrCreateWikilink } = useVaultStore();
  const userIgnoreFilters = useSettingsStore((s) => s.settings.userIgnoreFilters);

  const [options, setOptions] = useState<GraphOptions>(loadOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const setOption = useCallback(<K extends keyof GraphOptions>(key: K, value: GraphOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [options]);

  const onSelectNoteRef = useRef(onSelectNote);
  onSelectNoteRef.current = onSelectNote;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openOrCreateRef = useRef(openOrCreateWikilink);
  openOrCreateRef.current = openOrCreateWikilink;

  // Modelo completo (nodos y enlaces) según el contenido de las notas y los filtros de tipo de nodo
  const fullGraph = useMemo(
    () =>
      buildGraphData(notesContentMap, fileTree, activeVault, userIgnoreFilters || [], {
        showTags: options.showTags,
        showAttachments: options.showAttachments,
      }),
    [
      notesContentMap,
      fileTree,
      activeVault,
      userIgnoreFilters,
      options.showTags,
      options.showAttachments,
    ]
  );

  // Aplica búsqueda y ocultar huérfanos
  const graphData = useMemo(
    () => filterGraphData(fullGraph, options.query, options.showOrphans),
    [fullGraph, options.query, options.showOrphans]
  );

  // 1. Crear la instancia de force-graph (solo cambia con el tema)
  useEffect(() => {
    if (!containerRef.current) return;

    const currentBg = isLight ? '#ffffff' : '#1e1e1e';
    const currentLinkColor = isLight ? '#d4d4d4' : '#363636';
    const currentNodeColor = isLight ? '#666666' : '#999999';
    const currentTextColor = isLight ? '#222222' : '#dcddde';
    const tagColor = isLight ? '#4a7bc8' : '#6c9be0';
    const attachmentColor = isLight ? '#b8860b' : '#c9a24a';

    if (graphInstance.current) {
      graphInstance.current._destructor?.();
      graphInstance.current = null;
    }
    containerRef.current.innerHTML = '';

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    const fg = (ForceGraph as any)()(containerRef.current)
      .width(width)
      .height(height)
      .backgroundColor(currentBg)
      .nodeId('id')
      .nodeLabel('name')
      .nodeVal('val')
      .nodeRelSize(nodeRelSizeValue(optionsRef.current.nodeSize))
      .linkColor(() => currentLinkColor)
      .linkWidth(linkWidthValue(optionsRef.current.linkWidth))
      .nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const n = node as ViewGraphNode & { x: number; y: number };
        const fontSize = 12 / globalScale;
        const r =
          Math.sqrt(Math.max(0, n.val || 1)) * nodeRelSizeValue(optionsRef.current.nodeSize);
        const isHovered = hoveredNodeRef.current && hoveredNodeRef.current.id === n.id;

        if (isHovered) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI, false);
          ctx.fillStyle = 'rgba(224, 108, 27, 0.35)';
          ctx.fill();
        }

        const baseColor =
          n.kind === 'tag'
            ? tagColor
            : n.kind === 'attachment'
            ? attachmentColor
            : currentNodeColor;

        ctx.save();
        // Los nodos fantasma (notas aún no creadas) se dibujan atenuados
        if (n.kind === 'ghost') ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI, false);
        ctx.fillStyle = isHovered ? '#e06c1b' : baseColor;
        ctx.fill();
        ctx.restore();

        if (globalScale > 1.2 || n.val > 2 || isHovered) {
          ctx.font = `${fontSize}px var(--font-interface, sans-serif)`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = currentTextColor;
          ctx.fillText(n.name, n.x, n.y + r + fontSize);
        }
      })
      .onNodeHover((node: any) => {
        hoveredNodeRef.current = node || null;
        setHoverTick((v) => v + 1);
        if (containerRef.current) {
          containerRef.current.style.cursor = node ? 'pointer' : 'default';
        }
        const n = node as ViewGraphNode | null;
        if (!n || n.kind === 'tag') {
          window.dispatchEvent(new CustomEvent(PAGE_PREVIEW_HOVER_EVENT, { detail: null }));
          return;
        }
        const rect = containerRef.current?.getBoundingClientRect();
        const detail: PagePreviewCustomHoverDetail = {
          context: 'graph',
          target: n.path || n.target || n.name,
          clientX: lastPointerRef.current.hasMoved
            ? lastPointerRef.current.x
            : rect
            ? rect.left + rect.width / 2
            : 0,
          clientY: lastPointerRef.current.hasMoved
            ? lastPointerRef.current.y
            : rect
            ? rect.top + rect.height / 2
            : 0,
          ctrlKey: lastPointerRef.current.ctrlKey,
        };
        window.dispatchEvent(new CustomEvent(PAGE_PREVIEW_HOVER_EVENT, { detail }));
      })
      .onNodeClick((node: any) => {
        const n = node as ViewGraphNode;
        if (n.kind === 'tag') return;

        if (n.kind === 'ghost' && n.target) {
          // Nota aún no creada: crearla y abrirla
          openOrCreateRef
            .current(n.target)
            .then((createdPath) => {
              if (createdPath) {
                onSelectNoteRef.current(createdPath);
                onCloseRef.current?.();
              }
            })
            .catch((err) => console.error('No se pudo crear la nota del grafo:', n.target, err));
          return;
        }

        if (n.path) {
          onSelectNoteRef.current(n.path);
          onCloseRef.current?.();
        }
      });

    graphInstance.current = fg;

    const containerEl = containerRef.current;
    const handlePointerMove = (e: MouseEvent) => {
      lastPointerRef.current = {
        x: e.clientX,
        y: e.clientY,
        ctrlKey: e.ctrlKey || e.metaKey,
        hasMoved: true,
      };
    };
    containerEl.addEventListener('mousemove', handlePointerMove);

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
    ro.observe(containerEl);

    return () => {
      containerEl.removeEventListener('mousemove', handlePointerMove);
      ro.disconnect();
      window.dispatchEvent(new CustomEvent(PAGE_PREVIEW_HOVER_EVENT, { detail: null }));
      if (graphInstance.current) {
        graphInstance.current._destructor?.();
        graphInstance.current = null;
      }
    };
  }, [isLight]);

  // 2. Actualizar los datos sin recrear el grafo (conserva posiciones de los nodos existentes)
  useEffect(() => {
    const fg = graphInstance.current;
    if (!fg) return;

    const previous = new Map<string, any>();
    for (const n of fg.graphData().nodes as any[]) previous.set(n.id, n);

    // force-graph muta los objetos que recibe: se le pasan copias
    const nodes = graphData.nodes.map((n) => {
      const prev = previous.get(n.id);
      return prev
        ? { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, fx: prev.fx, fy: prev.fy }
        : { ...n };
    });
    const links = graphData.links.map((l) => ({ source: l.source, target: l.target }));
    fg.graphData({ nodes, links });
  }, [graphData, isLight]);

  // 3. Aplicar ajustes de fuerzas, tamaño y grosor en vivo
  useEffect(() => {
    const fg = graphInstance.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(chargeStrength(options.repel));
    fg.d3Force('link')?.distance(linkDistanceValue(options.linkDistance));
    fg.nodeRelSize(nodeRelSizeValue(options.nodeSize));
    fg.linkWidth(linkWidthValue(options.linkWidth));
    fg.d3ReheatSimulation();
  }, [options.repel, options.linkDistance, options.nodeSize, options.linkWidth, isLight]);

  const iconButtonClass = (active: boolean) =>
    `p-1.5 rounded bg-[var(--background-primary)] hover:bg-[var(--background-modifier-hover)] text-[var(--text-muted)] hover:text-[var(--text-normal)] border border-[var(--background-modifier-border)] shadow-sm backdrop-blur transition-colors cursor-pointer ${
      active ? 'bg-[var(--background-modifier-hover)] text-[var(--text-normal)]' : ''
    }`;

  const checkboxRow = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  const sliderRow = (label: string, key: 'repel' | 'linkDistance' | 'nodeSize' | 'linkWidth') => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
        <span>{label}</span>
      </div>
      <input
        type="range"
        min="1"
        max="100"
        value={options[key]}
        onChange={(e) => setOption(key, Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );

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
      <div ref={controlsRef} className="graph-controls absolute top-3 right-4 z-10 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title={t('graph.filters')}
            onClick={() => {
              setShowFilters((v) => !v);
              setShowSettings(false);
            }}
            className={iconButtonClass(showFilters)}
          >
            <Wand2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={t('graph.settings')}
            onClick={() => {
              setShowSettings((v) => !v);
              setShowFilters(false);
            }}
            className={iconButtonClass(showSettings)}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {showFilters && (
          <div
            className="graph-controls-popover"
            style={popoverStyle}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={popoverTitleStyle}>{t('graph.filters')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-normal)' }}>
              <input
                type="text"
                placeholder={t('graph.search')}
                value={options.query}
                onChange={(e) => setOption('query', e.target.value)}
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
              {checkboxRow(t('graph.tags'), options.showTags, (v) => setOption('showTags', v))}
              {checkboxRow(t('graph.attachments'), options.showAttachments, (v) =>
                setOption('showAttachments', v)
              )}
              {checkboxRow(t('graph.orphans'), options.showOrphans, (v) =>
                setOption('showOrphans', v)
              )}
            </div>
          </div>
        )}

        {showSettings && (
          <div
            className="graph-controls-popover"
            style={popoverStyle}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={popoverTitleStyle}>{t('graph.settings')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
              {sliderRow(t('graph.repel'), 'repel')}
              {sliderRow(t('graph.linkDistance'), 'linkDistance')}
              {sliderRow(t('graph.nodeSize'), 'nodeSize')}
              {sliderRow(t('graph.linkWidth'), 'linkWidth')}
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
