import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  StickyNote,
  FileText,
  FileImage,
  FolderPlus,
  Maximize,
  Copy,
  Trash2,
  Edit2,
  FilePlus,
  Palette,
  CheckSquare,
  Link2,
  Frame,
  Image as ImageIcon,
} from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { useNoticeStore } from '../common/Notice';
import {
  CanvasNode,
  CanvasEdge,
  CanvasData,
  CanvasNodeSide,
  CanvasPoint,
  CanvasGroupNode,
} from '../../types/canvas';
import {
  generateCanvasId,
  getNodeBBox,
  getBoundingBox,
  doBBoxesIntersect,
  isNodeInGroup,
  getBezierPath,
  getSideCoordinates,
  getSideCenter,
  autoSide,
  closestSide,
  CANVAS_COLORS,
  facingSide,
} from './canvasMath';
import { CanvasControls } from './CanvasControls';
import { CanvasCardMenu, CanvasCardMenuType } from './CanvasCardMenu';
import { CanvasFloatingMenu } from './CanvasFloatingMenu';
import { CanvasNodeView } from './CanvasNodeView';
import { CanvasEdgeView } from './CanvasEdgeView';
import { VaultFileModal, VaultFileModalMode } from './VaultFileModal';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import { isImagePath, toUint8Array } from '../../services/storageAdapter';
import { resolveImageBlobUrl, saveClipboardImageToVault } from '../../editor/imageExtension';
import './canvasStyles.css';

interface CanvasViewProps {
  filePath: string;
}

/** Tamaño de la cuadrícula used por "Snap to grid". */
const GRID_SIZE = 20;

/** Límites de zoom del Canvas (1 = 100 %). */
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4.0;

/**
 * Sensibilidad del zoom por rueda (factor exponencial `exp(-deltaY * k)`).
 * Obsidian (obsidian.asar/app.js, Canvas.onWheel) usa `-deltaY / 300` en
 * espacio log2 con `deltaMode` normalizado (LINE ×40, PAGE ×800); aquí el
 * pellizco de trackpad (ctrlKey) es más fino y la rueda discreta del ratón más gruesa.
 */
const WHEEL_ZOOM_SENSITIVITY_PINCH = 0.012;

/** Dimensiones por defecto de los nodos (1:1 con Obsidian). */
const DEFAULT_TEXT_NODE_SIZE = { width: 250, height: 100 };
const DEFAULT_FILE_NODE_SIZE = { width: 400, height: 300 };
const DEFAULT_IMAGE_NODE_SIZE = { width: 400, height: 300 };

const snap = (value: number): number => Math.round(value / GRID_SIZE) * GRID_SIZE;

/** Obtiene el tamaño natural de una imagen a partir de su URL. */
function getImageNaturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export const CanvasView: React.FC<CanvasViewProps> = ({ filePath }) => {
  const {
    fileContent,
    updateContent,
    selectFile,
    refreshTree,
    activeVault,
    openOrCreateWikilink,
    fileTree,
  } = useVaultStore();
  const { showNotice } = useNoticeStore();

  const [canvasData, setCanvasData] = useState<CanvasData>({ nodes: [], edges: [] });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [readonly, setReadonly] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);

  // Selection
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Dragging Canvas (Panning)
  const [isPanning, setIsPanning] = useState(false);
  const [isHoldingSpace, setIsHoldingSpace] = useState(false);
  const startPanRef = useRef<CanvasPoint>({ x: 0, y: 0 });

  // Node Dragging
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartMouseRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const initialNodesStateRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragOriginDataRef = useRef<CanvasData | null>(null);
  const dragMovedRef = useRef(false);

  // Node Resizing
  const [resizingHandle, setResizingHandle] = useState<string | null>(null);
  const resizeStartMouseRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const resizeStartNodeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const resizeOriginDataRef = useRef<CanvasData | null>(null);

  // Connection Dragging (Creating an edge)
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    side: CanvasNodeSide;
  } | null>(null);
  const [connectingMouseWorld, setConnectingMouseWorld] = useState<CanvasPoint | null>(null);

  // Flecha temporal congelada sobre el lienzo vacío: mantiene la punta en el
  // punto de soltado y abre el menú de creación de Obsidian.
  const [pendingEdgeDrop, setPendingEdgeDrop] = useState<{
    sourceNodeId: string;
    sourceSide: CanvasNodeSide;
    world: CanvasPoint;
  } | null>(null);
  const pendingEdgeDropRef = useRef<{
    sourceNodeId: string;
    sourceSide: CanvasNodeSide;
    world: CanvasPoint;
  } | null>(null);
  const [edgeDropMenu, setEdgeDropMenu] = useState<{ x: number; y: number } | null>(null);
  const keepPendingOnMenuCloseRef = useRef(false);
  const vaultSelectionCommittedRef = useRef(false);

  // Selection box (dragging rectangle in empty canvas)
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Vault file picker modal
  const [vaultModal, setVaultModal] = useState<{ open: boolean; mode: VaultFileModalMode }>({
    open: false,
    mode: 'note',
  });
  const pendingDropPosRef = useRef<CanvasPoint | null>(null);

  // Editing state
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItemData[];
  } | null>(null);

  // Undo / Redo history
  const historyRef = useRef<{ past: CanvasData[]; future: CanvasData[] }>({ past: [], future: [] });
  const [, forceHistoryRender] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------------------ */
  /* Viewport (zoom + pan) con escritura coalescida por frame            */
  /* ------------------------------------------------------------------ */

  // Último viewport conocido. Los listeners nativos (wheel / gesture / touch)
  // leen de aquí para no quedarse con un closure obsoleto entre renders.
  const viewportRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const viewportFrameRef = useRef<number>(0);

  // Mantener el ref en sincronía con el estado React (drag-pan, zoom-to-fit, etc.)
  // salvo que haya un frame pendiente con un valor más reciente.
  useEffect(() => {
    if (viewportFrameRef.current) return;
    viewportRef.current = { zoom, panX: pan.x, panY: pan.y };
  }, [zoom, pan]);

  /** Aplica el viewport acumulado una sola vez por frame (varios `wheel` por frame → 1 render). */
  const commitViewport = useCallback(() => {
    if (viewportFrameRef.current) return;
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = 0;
      const v = viewportRef.current;
      setZoom(v.zoom);
      setPan({ x: v.panX, y: v.panY });
    });
  }, []);

  useEffect(() => () => {
    if (viewportFrameRef.current) cancelAnimationFrame(viewportFrameRef.current);
  }, []);

  /**
   * Zoom anclado al punto (clientX, clientY): la coordenada del mundo que hay
   * bajo el cursor / entre los dos dedos permanece fija en pantalla.
   */
  const zoomAtPoint = useCallback(
    (newZoom: number, clientX: number, clientY: number) => {
      if (!containerRef.current) return;
      const clampedZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      const { zoom: curZoom, panX, panY } = viewportRef.current;

      // Coordenada del mundo bajo el cursor antes de cambiar el zoom
      const worldX = (mouseX - panX) / curZoom;
      const worldY = (mouseY - panY) / curZoom;

      // Nuevo pan para que (worldX, worldY) siga exactamente bajo (mouseX, mouseY)
      viewportRef.current = {
        zoom: clampedZoom,
        panX: mouseX - worldX * clampedZoom,
        panY: mouseY - worldY * clampedZoom,
      };
      commitViewport();
    },
    [commitViewport]
  );

  /** Desplaza la cámara en píxeles de pantalla (scroll de dos dedos / rueda). */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = viewportRef.current;
      viewportRef.current = { ...v, panX: v.panX - dx, panY: v.panY - dy };
      commitViewport();
    },
    [commitViewport]
  );

  /* ------------------------------------------------------------------ */
  /* Persistencia                                                         */
  /* ------------------------------------------------------------------ */

  // 1. Load and parse JSON Canvas 1.0 from fileContent or disk
  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      try {
        let contentToParse = fileContent;
        if (!contentToParse || !contentToParse.trim()) {
          try {
            contentToParse = await invoke<string>('read_file', { filePath });
          } catch (e) {
            contentToParse = '{"nodes":[],"edges":[]}';
          }
        }
        if (mounted && contentToParse) {
          const parsed = JSON.parse(contentToParse);
          setCanvasData({
            nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
            edges: Array.isArray(parsed.edges) ? parsed.edges : [],
          });
          historyRef.current = { past: [], future: [] };
          forceHistoryRender((v) => v + 1);
        }
      } catch (err) {
        console.warn('Error al parsear archivo .canvas:', err);
        setCanvasData({ nodes: [], edges: [] });
      }
    };
    loadData();
    return () => {
      mounted = false;
    };
  }, [filePath]);

  // 2. Persist with Debounce (300ms)
  const persistCanvas = useCallback(
    (newData: CanvasData) => {
      canvasDataRef.current = newData;
      setCanvasData(newData);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const serialized = JSON.stringify(newData, null, 2);
          updateContent(serialized);
          await invoke('write_file', { filePath, content: serialized });
        } catch (e) {
          console.error('Error al guardar canvas en disco:', e);
        }
      }, 300);
    },
    [filePath, updateContent]
  );

  /* ------------------------------------------------------------------ */
  /* Historial (Deshacer / Rehacer)                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Espejo del estado actual del lienzo.
   * Permite que las operaciones asíncronas (pegar, cargar imágenes...) apliquen
   * sus cambios sobre el estado más reciente y no sobre una copia obsoleta.
   */
  const canvasDataRef = useRef<CanvasData>(canvasData);
  canvasDataRef.current = canvasData;

  const pushHistory = useCallback((snapshot: CanvasData) => {
    historyRef.current.past.push(snapshot);
    if (historyRef.current.past.length > 100) historyRef.current.past.shift();
    historyRef.current.future = [];
    forceHistoryRender((v) => v + 1);
  }, []);

  /**
   * Aplica un cambio al lienzo registrándolo en el historial.
   * Admite tanto un estado concreto como una función sobre el estado actual.
   */
  const applyChange = useCallback(
    (next: CanvasData | ((prev: CanvasData) => CanvasData)) => {
      const prev = canvasDataRef.current;
      const resolved = typeof next === 'function' ? next(prev) : next;
      pushHistory(prev);
      canvasDataRef.current = resolved;
      persistCanvas(resolved);
    },
    [persistCanvas, pushHistory]
  );

  /* ------------------------------------------------------------------ */
  /* Flecha pendiente sobre lienzo vacío (menú de creación)               */
  /* ------------------------------------------------------------------ */

  const updatePendingEdgeDrop = useCallback(
    (drop: { sourceNodeId: string; sourceSide: CanvasNodeSide; world: CanvasPoint } | null) => {
      pendingEdgeDropRef.current = drop;
      setPendingEdgeDrop(drop);
    },
    []
  );

  const cancelPendingEdgeDrop = useCallback(() => {
    pendingEdgeDropRef.current = null;
    setPendingEdgeDrop(null);
    setEdgeDropMenu(null);
    keepPendingOnMenuCloseRef.current = false;
  }, []);

  /**
   * Conecta el nodo recién creado con el nodo origen de la flecha pendiente.
   * Se usa el lado de la nueva tarjeta que mira hacia el origen (lado opuesto
   * a la dirección en la que se arrastró la flecha).
   */
  const connectPendingEdge = useCallback(
    (newNodeId: string) => {
      const pending = pendingEdgeDropRef.current;
      if (!pending) return;
      const source = canvasDataRef.current.nodes.find((n) => n.id === pending.sourceNodeId);
      const target = canvasDataRef.current.nodes.find((n) => n.id === newNodeId);

      if (source && target) {
        const newEdge: CanvasEdge = {
          id: generateCanvasId(),
          fromNode: source.id,
          fromSide: pending.sourceSide,
          toNode: target.id,
          toSide: facingSide(getNodeBBox(source), getNodeBBox(target)),
          toEnd: 'arrow',
        };
        applyChange((prev) => ({ ...prev, edges: [...prev.edges, newEdge] }));
      }

      cancelPendingEdgeDrop();
    },
    [applyChange, cancelPendingEdgeDrop]
  );

  const handleUndo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    historyRef.current.past = past.slice(0, -1);
    historyRef.current.future = [canvasDataRef.current, ...future].slice(0, 100);
    canvasDataRef.current = previous;
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    persistCanvas(previous);
    forceHistoryRender((v) => v + 1);
  }, [persistCanvas]);

  const handleRedo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (future.length === 0) return;
    const next = future[0];
    historyRef.current.future = future.slice(1);
    historyRef.current.past = [...past, canvasDataRef.current].slice(-100);
    canvasDataRef.current = next;
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    persistCanvas(next);
    forceHistoryRender((v) => v + 1);
  }, [persistCanvas]);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  /* ------------------------------------------------------------------ */
  /* Coordenadas                                                          */
  /* ------------------------------------------------------------------ */

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): CanvasPoint => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  // Center of the currently visible screen in world coordinates
  const getVisibleCenter = useCallback((): CanvasPoint => {
    if (!containerRef.current) return { x: 200, y: 200 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (rect.width / 2 - pan.x) / zoom,
      y: (rect.height / 2 - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // Zoom to fit all nodes
  const handleZoomToFit = useCallback(() => {
    if (canvasData.nodes.length === 0 || !containerRef.current) return;
    const bbox = getBoundingBox(canvasData.nodes);
    if (!bbox) return;

    const rect = containerRef.current.getBoundingClientRect();
    const margin = 80;
    const contentW = bbox.maxX - bbox.minX + margin * 2;
    const contentH = bbox.maxY - bbox.minY + margin * 2;

    const newZoom = Math.max(0.15, Math.min(2.5, Math.min(rect.width / contentW, rect.height / contentH)));
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;

    setZoom(newZoom);
    setPan({
      x: rect.width / 2 - centerX * newZoom,
      y: rect.height / 2 - centerY * newZoom,
    });
  }, [canvasData.nodes]);

  // Zoom a la selección: centra la cámara y ajusta el zoom para encuadrar
  // el nodo indicado. Equivale a `zoomToBbox` de Obsidian, que nunca amplía
  // más allá del 100 %: factor = min(W / (1.1 * ancho), H / (1.1 * alto)).
  const handleZoomToNode = useCallback((nodeId: string) => {
    const node = canvasDataRef.current.nodes.find((n) => n.id === nodeId);
    if (!node || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const w = Math.max(node.width, 1);
    const h = Math.max(node.height, 1);

    const factor = Math.min(rect.width / (1.1 * w), rect.height / (1.1 * h));
    const newZoom = Math.max(MIN_ZOOM, Math.min(1, factor));

    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;

    setZoom(newZoom);
    setPan({
      x: rect.width / 2 - centerX * newZoom,
      y: rect.height / 2 - centerY * newZoom,
    });
  }, []);

  // Elimina un nodo concreto (botón "Eliminar" de la barra flotante del nodo).
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(null);
      setEditingNodeId(null);
      applyChange((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
      }));
    },
    [applyChange]
  );

  // Aplica uno de los 6 colores del Canvas a un nodo (botón "Color").
  const handleSetNodeColor = useCallback(
    (nodeId: string, colorKey?: string) => {
      applyChange((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const { color: _oldColor, ...rest } = n;
          return colorKey ? { ...rest, color: colorKey } : rest;
        }),
      }));
    },
    [applyChange]
  );

  // Reset zoom to 100%
  const handleResetZoom = useCallback(() => {
    setZoom(1);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (canvasData.nodes.length > 0) {
        const bbox = getBoundingBox(canvasData.nodes);
        if (bbox) {
          const centerX = (bbox.minX + bbox.maxX) / 2;
          const centerY = (bbox.minY + bbox.maxY) / 2;
          setPan({
            x: rect.width / 2 - centerX,
            y: rect.height / 2 - centerY,
          });
          return;
        }
      }
      setPan({ x: 0, y: 0 });
    }
  }, [canvasData.nodes]);

  /* ------------------------------------------------------------------ */
  /* Atajos de teclado                                                    */
  /* ------------------------------------------------------------------ */

  // Delete currently selected nodes and/or edge
  const deleteSelected = useCallback(() => {
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    applyChange((prev) => ({
      nodes: prev.nodes.filter((n) => !selectedNodeIds.has(n.id)),
      edges: prev.edges.filter(
        (e) =>
          !selectedNodeIds.has(e.fromNode) &&
          !selectedNodeIds.has(e.toNode) &&
          e.id !== selectedEdgeId
      ),
    }));
  }, [selectedNodeIds, selectedEdgeId, applyChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inEditable =
        active?.tagName === 'INPUT' ||
        active?.tagName === 'TEXTAREA' ||
        active?.getAttribute('contenteditable') === 'true';

      // Space for panning
      if (e.code === 'Space' && !isHoldingSpace) {
        if (inEditable) return;
        setIsHoldingSpace(true);
      }

      // Deshacer / Rehacer
      if ((e.ctrlKey || e.metaKey) && !inEditable) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (inEditable) return;
        if (selectedNodeIds.size > 0 || selectedEdgeId) {
          e.preventDefault();
          deleteSelected();
        }
      }

      // Ctrl + A (Select all)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setSelectedNodeIds(new Set(canvasData.nodes.map((n) => n.id)));
      }

      // Shift + 1 (Zoom to fit)
      if (e.shiftKey && e.key === '!') {
        e.preventDefault();
        handleZoomToFit();
      }

      // Escape (Deselect / Close context menu)
      if (e.key === 'Escape') {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
        setConnectingFrom(null);
        setConnectingMouseWorld(null);
        cancelPendingEdgeDrop();
        setContextMenu(null);
        setVaultModal({ open: false, mode: 'note' });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsHoldingSpace(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    isHoldingSpace,
    selectedNodeIds,
    selectedEdgeId,
    canvasData.nodes,
    handleUndo,
    handleRedo,
    handleZoomToFit,
    deleteSelected,
    cancelPendingEdgeDrop,
  ]);

  /* ------------------------------------------------------------------ */
  /* Zoom / rueda                                                        */
  /* ------------------------------------------------------------------ */

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY_PINCH);
      zoomAtPoint(viewportRef.current.zoom * zoomFactor, e.clientX, e.clientY);
    } else {
      panBy(e.deltaX, e.deltaY);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Creación de nodos                                                   */
  /* ------------------------------------------------------------------ */

  /** Inserta un nodo de texto (vacío y en modo edición). */
  const createTextNode = useCallback(
    (pos: CanvasPoint, text = '', autoEdit = true) => {
      const id = generateCanvasId();
      const newNode: CanvasNode = {
        id,
        type: 'text',
        text,
        x: pos.x - DEFAULT_TEXT_NODE_SIZE.width / 2,
        y: pos.y - DEFAULT_TEXT_NODE_SIZE.height / 2,
        width: DEFAULT_TEXT_NODE_SIZE.width,
        height: DEFAULT_TEXT_NODE_SIZE.height,
      };
      applyChange((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
      setSelectedNodeIds(new Set([id]));
      setSelectedEdgeId(null);
      if (autoEdit) setEditingNodeId(id);
      return id;
    },
    [applyChange]
  );

  /** Inserta un nodo de archivo (nota o imagen) respetando el tamaño natural. */
  const createFileNode = useCallback(
    async (filePath: string, pos: CanvasPoint) => {
      const id = generateCanvasId();
      let width = DEFAULT_FILE_NODE_SIZE.width;
      let height = DEFAULT_FILE_NODE_SIZE.height;

      if (isImagePath(filePath)) {
        const url = await resolveImageBlobUrl(filePath);
        const natural = await getImageNaturalSize(url);
        if (natural && natural.width > 0 && natural.height > 0) {
          // Respeta la proporción original de la imagen al insertarla
          const scale = Math.min(
            DEFAULT_IMAGE_NODE_SIZE.width / natural.width,
            DEFAULT_IMAGE_NODE_SIZE.height / natural.height,
            1
          );
          width = Math.max(60, Math.round(natural.width * scale));
          height = Math.max(60, Math.round(natural.height * scale));
        }
      }

      const newNode: CanvasNode = {
        id,
        type: 'file',
        file: filePath,
        x: pos.x - width / 2,
        y: pos.y - height / 2,
        width,
        height,
      };
      applyChange((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
      setSelectedNodeIds(new Set([id]));
      setSelectedEdgeId(null);
      return id;
    },
    [applyChange]
  );

  const handleAddTextCard = useCallback(
    (customPos?: CanvasPoint) => {
      createTextNode(customPos || getVisibleCenter());
    },
    [createTextNode, getVisibleCenter]
  );

  const handleAddNoteCard = useCallback(
    (customPos?: CanvasPoint) => {
      pendingDropPosRef.current = customPos || getVisibleCenter();
      setVaultModal({ open: true, mode: 'note' });
    },
    [getVisibleCenter]
  );

  const handleAddMediaCard = useCallback(
    (customPos?: CanvasPoint) => {
      pendingDropPosRef.current = customPos || getVisibleCenter();
      setVaultModal({ open: true, mode: 'image' });
    },
    [getVisibleCenter]
  );

  const handleSelectVaultFile = useCallback(
    async (vaultFilePath: string) => {
      // La selección del modal es válida aunque el modal se cierre justo
      // después: conservamos la flecha pendiente hasta terminar de crear el nodo.
      vaultSelectionCommittedRef.current = true;
      const pos = pendingDropPosRef.current || getVisibleCenter();
      pendingDropPosRef.current = null;
      const newNodeId = await createFileNode(vaultFilePath, pos);
      if (pendingEdgeDropRef.current) {
        connectPendingEdge(newNodeId);
      }
    },
    [createFileNode, getVisibleCenter, connectPendingEdge]
  );

  /* ------------------------------------------------------------------ */
  /* Acciones del menú al soltar una flecha en el lienzo vacío            */
  /* ------------------------------------------------------------------ */

  const handleEdgeDropAddCard = useCallback(() => {
    const pending = pendingEdgeDropRef.current;
    if (!pending) return;
    const newCardId = createTextNode(pending.world);
    connectPendingEdge(newCardId);
  }, [createTextNode, connectPendingEdge]);

  const handleEdgeDropAddNote = useCallback(() => {
    const pending = pendingEdgeDropRef.current;
    if (!pending) return;
    keepPendingOnMenuCloseRef.current = true;
    vaultSelectionCommittedRef.current = false;
    pendingDropPosRef.current = pending.world;
    setVaultModal({ open: true, mode: 'note' });
  }, []);

  const handleEdgeDropAddMedia = useCallback(() => {
    const pending = pendingEdgeDropRef.current;
    if (!pending) return;
    keepPendingOnMenuCloseRef.current = true;
    vaultSelectionCommittedRef.current = false;
    pendingDropPosRef.current = pending.world;
    setVaultModal({ open: true, mode: 'image' });
  }, []);

  const handleEdgeDropMenuClose = useCallback(() => {
    setEdgeDropMenu(null);
    if (keepPendingOnMenuCloseRef.current) {
      // Se abrió el selector del Vault: la flecha debe seguir visible.
      keepPendingOnMenuCloseRef.current = false;
      return;
    }
    cancelPendingEdgeDrop();
  }, [cancelPendingEdgeDrop]);

  const handleAddLinkCard = useCallback(
    (customPos?: CanvasPoint) => {
      const url = prompt('Introduce la URL web o enlace multimedia:');
      if (!url) return;
      const pos = customPos || getVisibleCenter();
      const id = generateCanvasId();
      const newNode: CanvasNode = {
        id,
        type: 'link',
        url,
        x: pos.x - 175,
        y: pos.y - 125,
        width: 350,
        height: 250,
      };
      applyChange((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
      setSelectedNodeIds(new Set([id]));
    },
    [applyChange, getVisibleCenter]
  );

  const handleAddGroup = useCallback(
    (customPos?: CanvasPoint) => {
      const pos = customPos || getVisibleCenter();
      const id = generateCanvasId();
      const newGroup: CanvasGroupNode = {
        id,
        type: 'group',
        label: 'Nuevo Grupo',
        x: pos.x - 250,
        y: pos.y - 200,
        width: 500,
        height: 400,
      };
      applyChange((prev) => ({ ...prev, nodes: [...prev.nodes, newGroup] }));
      setSelectedNodeIds(new Set([id]));
      return id;
    },
    [applyChange, getVisibleCenter]
  );

  const handleEdgeDropAddGroup = useCallback(() => {
    const pending = pendingEdgeDropRef.current;
    if (!pending) return;
    const newGroupId = handleAddGroup(pending.world);
    connectPendingEdge(newGroupId);
  }, [handleAddGroup, connectPendingEdge]);

  // Convert selected text card to real Markdown note in vault
  const handleConvertTextCardToFile = async (node: CanvasNode) => {
    if (node.type !== 'text') return;
    const noteName = prompt('Nombre para la nueva nota:', 'Nota desde Lienzo');
    if (!noteName) return;

    try {
      const cleanName = noteName.endsWith('.md') ? noteName : `${noteName}.md`;
      const fullPath = `${activeVault}/${cleanName}`.replace(/\/+/g, '/');

      await invoke('create_file', { filePath: fullPath });
      await invoke('write_file', { filePath: fullPath, content: node.text });
      await refreshTree();

      // Transform node to file type
      applyChange((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === node.id
            ? {
                id: n.id,
                type: 'file',
                file: fullPath,
                x: n.x,
                y: n.y,
                width: Math.max(350, n.width),
                height: Math.max(300, n.height),
                color: n.color,
              }
            : n
        ),
      }));
      showNotice(`Nota "${cleanName}" creada en el Vault`, 2500, 'success');
    } catch (err) {
      console.error('Error al convertir tarjeta a nota:', err);
      showNotice('Error al crear la nota', 3000, 'error');
    }
  };

  // Group selected nodes
  const handleGroupSelection = () => {
    if (selectedNodeIds.size === 0) return;
    const selectedNodes = canvasData.nodes.filter((n) => selectedNodeIds.has(n.id));
    const bbox = getBoundingBox(selectedNodes);
    if (!bbox) return;

    const pad = 35;
    const id = generateCanvasId();
    const newGroup: CanvasGroupNode = {
      id,
      type: 'group',
      label: 'Grupo',
      x: bbox.minX - pad,
      y: bbox.minY - pad,
      width: bbox.maxX - bbox.minX + pad * 2,
      height: bbox.maxY - bbox.minY + pad * 2,
    };

    applyChange((prev) => ({ ...prev, nodes: [newGroup, ...prev.nodes] }));
    setSelectedNodeIds(new Set([id]));
  };

  // Duplicate selection
  const handleDuplicateSelection = () => {
    if (selectedNodeIds.size === 0) return;
    const offset = 40;
    const duplicatedNodes: CanvasNode[] = [];
    const duplicatedEdges: CanvasEdge[] = [];

    applyChange((prev) => {
      const idMap = new Map<string, string>();

      for (const node of prev.nodes) {
        if (selectedNodeIds.has(node.id)) {
          const newId = generateCanvasId();
          idMap.set(node.id, newId);
          duplicatedNodes.push({
            ...node,
            id: newId,
            x: node.x + offset,
            y: node.y + offset,
          });
        }
      }

      // Duplicate connecting edges between duplicated nodes
      for (const edge of prev.edges) {
        if (idMap.has(edge.fromNode) && idMap.has(edge.toNode)) {
          duplicatedEdges.push({
            ...edge,
            id: generateCanvasId(),
            fromNode: idMap.get(edge.fromNode)!,
            toNode: idMap.get(edge.toNode)!,
          });
        }
      }

      return {
        nodes: [...prev.nodes, ...duplicatedNodes],
        edges: [...prev.edges, ...duplicatedEdges],
      };
    });
    setSelectedNodeIds(new Set(duplicatedNodes.map((n) => n.id)));
  };

  /* ------------------------------------------------------------------ */
  /* Interacción con el lienzo                                            */
  /* ------------------------------------------------------------------ */

  // Double click on canvas background creates text card
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (readonly) return;
    const target = e.target as HTMLElement;
    if (target !== containerRef.current && !target.classList.contains('canvas-background') && target.tagName !== 'svg') {
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);
    createTextNode(pos);
  };

  // Pointer Down on Canvas
  const handlePointerDown = (e: React.MouseEvent) => {
    setContextMenu(null);
    containerRef.current?.focus({ preventScroll: true });
    const isTargetCanvasBg =
      e.target === containerRef.current ||
      (e.target as HTMLElement).classList.contains('canvas-background') ||
      (e.target as HTMLElement).tagName === 'svg';

    // 1. Middle click or Space+LeftClick or holding Space -> Canvas Pan
    if (e.button === 1 || (e.button === 0 && isHoldingSpace)) {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }

    // 2. Left click on background -> selection rectangle or clear selection
    if (e.button === 0 && isTargetCanvasBg) {
      if (!e.shiftKey) {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
      }
      const rect = containerRef.current!.getBoundingClientRect();
      setSelectionBox({
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      });
    }
  };

  // Pointer Move on Canvas
  const handlePointerMove = (e: React.MouseEvent) => {
    // 1. Panning canvas
    if (isPanning) {
      setPan({
        x: e.clientX - startPanRef.current.x,
        y: e.clientY - startPanRef.current.y,
      });
      return;
    }

    // 2. Multi-selection rectangle
    if (selectionBox && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      setSelectionBox((prev) => (prev ? { ...prev, currentX: curX, currentY: curY } : null));

      // Compute intersecting nodes in world coordinates
      const boxMinX = (Math.min(selectionBox.startX, curX) - pan.x) / zoom;
      const boxMaxX = (Math.max(selectionBox.startX, curX) - pan.x) / zoom;
      const boxMinY = (Math.min(selectionBox.startY, curY) - pan.y) / zoom;
      const boxMaxY = (Math.max(selectionBox.startY, curY) - pan.y) / zoom;

      const intersecting = new Set<string>();
      for (const node of canvasData.nodes) {
        if (
          doBBoxesIntersect(
            { minX: boxMinX, minY: boxMinY, maxX: boxMaxX, maxY: boxMaxY },
            getNodeBBox(node)
          )
        ) {
          intersecting.add(node.id);
        }
      }
      setSelectedNodeIds(intersecting);
      return;
    }

    // 3. Node dragging (moves selected nodes + contained children if group)
    if (draggingNodeId) {
      const currentWorld = screenToWorld(e.clientX, e.clientY);
      const deltaX = currentWorld.x - dragStartMouseRef.current.x;
      const deltaY = currentWorld.y - dragStartMouseRef.current.y;
      if (deltaX !== 0 || deltaY !== 0) {
        dragMovedRef.current = true;
      }

      setCanvasData((prev) => {
        const next: CanvasData = {
          ...prev,
          nodes: prev.nodes.map((n) => {
            const init = initialNodesStateRef.current.get(n.id);
            if (init) {
              const nx = init.x + deltaX;
              const ny = init.y + deltaY;
              return {
                ...n,
                x: snapToGrid ? snap(nx) : Math.round(nx),
                y: snapToGrid ? snap(ny) : Math.round(ny),
              };
            }
            return n;
          }),
        };
        canvasDataRef.current = next;
        return next;
      });
      return;
    }

    // 4. Node resizing
    if (resizingHandle && resizeStartNodeRef.current) {
      const currentWorld = screenToWorld(e.clientX, e.clientY);
      const startMouse = resizeStartMouseRef.current;
      const dx = currentWorld.x - startMouse.x;
      const dy = currentWorld.y - startMouse.y;
      const init = resizeStartNodeRef.current;

      let newX = init.x;
      let newY = init.y;
      let newW = init.w;
      let newH = init.h;

      const minDim = 50;

      if (resizingHandle.includes('e')) {
        newW = Math.max(minDim, init.w + dx);
      }
      if (resizingHandle.includes('w')) {
        const potentialW = init.w - dx;
        if (potentialW >= minDim) {
          newX = init.x + dx;
          newW = potentialW;
        }
      }
      if (resizingHandle.includes('s')) {
        newH = Math.max(minDim, init.h + dy);
      }
      if (resizingHandle.includes('n')) {
        const potentialH = init.h - dy;
        if (potentialH >= minDim) {
          newY = init.y + dy;
          newH = potentialH;
        }
      }

      if (snapToGrid) {
        newW = snap(newW);
        newH = snap(newH);
      }

      setCanvasData((prev) => {
        const next: CanvasData = {
          ...prev,
          nodes: prev.nodes.map((n) =>
            selectedNodeIds.has(n.id)
              ? {
                  ...n,
                  x: snapToGrid ? snap(newX) : Math.round(newX),
                  y: snapToGrid ? snap(newY) : Math.round(newY),
                  width: Math.round(newW),
                  height: Math.round(newH),
                }
              : n
          ),
        };
        canvasDataRef.current = next;
        return next;
      });
      return;
    }

    // 5. Connection curve dragging
    if (connectingFrom) {
      setConnectingMouseWorld(screenToWorld(e.clientX, e.clientY));
    }
  };

  // Pointer Up on Canvas
  const handlePointerUp = (e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
    }

    if (selectionBox) {
      setSelectionBox(null);
    }

    if (draggingNodeId) {
      const moved = dragMovedRef.current;
      dragMovedRef.current = false;
      setDraggingNodeId(null);
      if (moved) {
        if (dragOriginDataRef.current) {
          pushHistory(dragOriginDataRef.current);
        }
        // Usar el espejo síncrono: evita guardar/restaurar una posición obsoleta
        // si el último `mousemove` aún no había provocado un render.
        persistCanvas(canvasDataRef.current);
      }
      dragOriginDataRef.current = null;
    }

    if (resizingHandle) {
      setResizingHandle(null);
      resizeStartNodeRef.current = null;
      if (resizeOriginDataRef.current) {
        pushHistory(resizeOriginDataRef.current);
        resizeOriginDataRef.current = null;
      }
      persistCanvas(canvasDataRef.current);
    }

    // Releasing connection point
    if (connectingFrom) {
      const dropWorld = screenToWorld(e.clientX, e.clientY);

      // Check if dropped on a node (or near any of its 4 sides)
      let targetNode: CanvasNode | null = null;
      let targetSide: CanvasNodeSide | null = null;
      let bestDistance = Infinity;

      for (const node of canvasData.nodes) {
        if (node.id === connectingFrom.nodeId || node.type === 'group') continue;
        const bbox = getNodeBBox(node);
        const margin = 28;
        const inside =
          dropWorld.x >= bbox.minX - margin &&
          dropWorld.x <= bbox.maxX + margin &&
          dropWorld.y >= bbox.minY - margin &&
          dropWorld.y <= bbox.maxY + margin;
        if (!inside) continue;

        const side = closestSide(bbox, dropWorld);
        const center = getSideCenter(bbox, side);
        const distance = Math.hypot(center.x - dropWorld.x, center.y - dropWorld.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          targetNode = node;
          targetSide = side;
        }
      }

      const sourceNode = canvasData.nodes.find((n) => n.id === connectingFrom.nodeId);

      if (targetNode && sourceNode) {
        // Connect to target node
        const toSide = targetSide || autoSide(getNodeBBox(sourceNode), getNodeBBox(targetNode));
        const newEdge: CanvasEdge = {
          id: generateCanvasId(),
          fromNode: sourceNode.id,
          fromSide: connectingFrom.side,
          toNode: targetNode.id,
          toSide,
          toEnd: 'arrow',
        };
        applyChange((prev) => ({ ...prev, edges: [...prev.edges, newEdge] }));
        setSelectedEdgeId(newEdge.id);
      } else if (sourceNode) {
        // Soltado sobre el lienzo vacío: congelar la punta de la flecha y
        // preguntar qué nodo crear (Obsidian no crea nada sin elección).
        updatePendingEdgeDrop({
          sourceNodeId: sourceNode.id,
          sourceSide: connectingFrom.side,
          world: dropWorld,
        });
        setEdgeDropMenu({ x: e.clientX, y: e.clientY });
      }

      setConnectingFrom(null);
      setConnectingMouseWorld(null);
    }
  };

  // Node Drag Initiation
  const handleStartDragNode = (node: CanvasNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (readonly) return;

    let newSelected = new Set(selectedNodeIds);
    if (!newSelected.has(node.id)) {
      if (e.shiftKey) {
        newSelected.add(node.id);
      } else {
        newSelected = new Set([node.id]);
      }
      setSelectedNodeIds(newSelected);
    }
    setSelectedEdgeId(null);

    // If node is a group, automatically collect all contained nodes to drag together
    const allMovingNodes = new Set(newSelected);
    for (const id of newSelected) {
      const n = canvasData.nodes.find((item) => item.id === id);
      if (n && n.type === 'group') {
        const grp = n as CanvasGroupNode;
        for (const child of canvasData.nodes) {
          if (isNodeInGroup(child, grp)) {
            allMovingNodes.add(child.id);
          }
        }
      }
    }

    setDraggingNodeId(node.id);
    dragStartMouseRef.current = screenToWorld(e.clientX, e.clientY);
    dragOriginDataRef.current = canvasDataRef.current;
    dragMovedRef.current = false;

    const map = new Map<string, { x: number; y: number }>();
    for (const id of allMovingNodes) {
      const item = canvasData.nodes.find((x) => x.id === id);
      if (item) map.set(item.id, { x: item.x, y: item.y });
    }
    initialNodesStateRef.current = map;
  };

  // Node Resize Initiation
  const handleStartResize = (node: CanvasNode, handle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (readonly) return;
    setResizingHandle(handle);
    resizeStartMouseRef.current = screenToWorld(e.clientX, e.clientY);
    resizeStartNodeRef.current = { x: node.x, y: node.y, w: node.width, h: node.height };
    resizeOriginDataRef.current = canvasData;
    setSelectedNodeIds(new Set([node.id]));
  };

  // Node Connect Initiation
  const handleStartConnect = (nodeId: string, side: CanvasNodeSide, e: React.MouseEvent) => {
    e.stopPropagation();
    if (readonly) return;
    setConnectingFrom({ nodeId, side });
    setConnectingMouseWorld(screenToWorld(e.clientX, e.clientY));
  };

  /* ------------------------------------------------------------------ */
  /* Arrastrar y soltar (Explorador lateral -> Canvas)                    */
  /* ------------------------------------------------------------------ */

  /** Busca una ruta del vault en el árbol (coincidencia exacta o por sufijo). */
  const resolveVaultPath = useCallback(
    (rawPath: string): string | null => {
      if (!rawPath) return null;
      const normalized = rawPath.replace(/\\/g, '/');
      let found: string | null = null;
      const traverse = (items: typeof fileTree) => {
        for (const item of items) {
          if (!item.isDir) {
            const itemPath = item.path.replace(/\\/g, '/');
            if (itemPath === normalized || itemPath.endsWith(`/${normalized}`)) {
              found = item.path;
              return;
            }
          }
          if (item.children) {
            traverse(item.children);
            if (found) return;
          }
        }
      };
      traverse(fileTree);
      return found;
    },
    [fileTree]
  );

  const handleDragOver = (e: React.DragEvent) => {
    if (readonly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    if (readonly) return;
    e.preventDefault();
    e.stopPropagation();

    const pos = screenToWorld(e.clientX, e.clientY);

    // 1. Nodo arrastrado desde la barra inferior de tarjetas
    const cardType = e.dataTransfer.getData('text/canvas-type') as CanvasCardMenuType | '';
    if (cardType === 'text') {
      createTextNode(pos);
      return;
    }
    if (cardType === 'note') {
      pendingDropPosRef.current = pos;
      setVaultModal({ open: true, mode: 'note' });
      return;
    }
    if (cardType === 'media') {
      pendingDropPosRef.current = pos;
      setVaultModal({ open: true, mode: 'image' });
      return;
    }

    // 2. Archivo arrastrado desde el Explorador lateral
    const rawPath =
      e.dataTransfer.getData('application/x-urano-path') || e.dataTransfer.getData('text/plain');
    if (!rawPath) return;

    const vaultPath = resolveVaultPath(rawPath);
    if (!vaultPath) return;

    const isNote = vaultPath.toLowerCase().endsWith('.md');
    const isImg = isImagePath(vaultPath);
    if (!isNote && !isImg) return;

    createFileNode(vaultPath, pos);
  };

  /* ------------------------------------------------------------------ */
  /* Pegar (Ctrl+V)                                                      */
  /* ------------------------------------------------------------------ */

  const handlePasteEvent = useCallback(
    async (e: ClipboardEvent) => {
      if (readonly) return;

      const data = e.clipboardData;
      let file: File | null = null;

      const items = data?.items;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            file = item.getAsFile();
            if (file) break;
          }
        }
      }
      if (!file && data?.files && data.files.length > 0) {
        for (const f of Array.from(data.files)) {
          if (f.type.startsWith('image/') || isImagePath(f.name)) {
            file = f;
            break;
          }
        }
      }

      const text = data?.getData('text/plain') ?? '';

      if (file) {
        e.preventDefault();
        const savedName = await saveClipboardImageToVault(file);
        if (!savedName) return;
        const { activeVault: vault } = useVaultStore.getState();
        const separator = vault?.includes('\\') ? '\\' : '/';
        const cleanVault = vault ? vault.replace(/[\\/]+$/, '') : '';
        const fullPath = cleanVault ? `${cleanVault}${separator}${savedName}` : savedName;
        await createFileNode(fullPath, getVisibleCenter());
        showNotice(`Imagen añadida al lienzo: ${savedName}`, 2500, 'success');
        return;
      }

      if (text.trim()) {
        e.preventDefault();
        createTextNode(getVisibleCenter(), text, false);
        return;
      }

      // Sin imagen ni texto en el portapapeles: se consulta el portapapeles nativo
      // (capturas de pantalla en WebKitGTK no exponen items de imagen).
      try {
        const raw = await invoke<ArrayBuffer | number[] | null>('read_clipboard_image');
        const nativeBytes = raw ? toUint8Array(raw) : null;
        if (nativeBytes && nativeBytes.length > 0) {
          e.preventDefault();
          const nativeFile = new File([nativeBytes], 'pasted_image.png', { type: 'image/png' });
          const savedName = await saveClipboardImageToVault(nativeFile);
          if (!savedName) return;
          const { activeVault: vault } = useVaultStore.getState();
          const separator = vault?.includes('\\') ? '\\' : '/';
          const cleanVault = vault ? vault.replace(/[\\/]+$/, '') : '';
          const fullPath = cleanVault ? `${cleanVault}${separator}${savedName}` : savedName;
          await createFileNode(fullPath, getVisibleCenter());
        }
      } catch {
        /* sin imagen nativa disponible */
      }
    },
    [readonly, createTextNode, createFileNode, getVisibleCenter, showNotice]
  );

  // Escucha global de pegado: sólo actúa si el Canvas tiene el foco.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!containerRef.current) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }
      if (active && active !== document.body && !containerRef.current.contains(active)) {
        return;
      }
      handlePasteEvent(e);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handlePasteEvent]);

  /* ------------------------------------------------------------------ */
  /* Menú contextual                                                      */
  /* ------------------------------------------------------------------ */

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const worldPos = screenToWorld(e.clientX, e.clientY);
    const clickedNode = canvasData.nodes.find((n) => {
      const b = getNodeBBox(n);
      return worldPos.x >= b.minX && worldPos.x <= b.maxX && worldPos.y >= b.minY && worldPos.y <= b.maxY;
    });

    const items: MenuItemData[] = [];

    if (clickedNode) {
      if (!selectedNodeIds.has(clickedNode.id)) {
        setSelectedNodeIds(new Set([clickedNode.id]));
      }

      items.push(
        {
          title: 'Editar',
          icon: <Edit2 size={14} />,
          action: () => setEditingNodeId(clickedNode.id),
        },
        {
          title: 'Color',
          icon: <Palette size={14} />,
          submenu: [
            {
              title: 'Por defecto (Gris)',
              action: () => {
                applyChange((prev) => ({
                  ...prev,
                  nodes: prev.nodes.map((n) =>
                    selectedNodeIds.has(n.id) ? { ...n, color: undefined } : n
                  ),
                }));
              },
            },
            ...Object.entries(CANVAS_COLORS).map(([k, col]) => ({
              title: col.name,
              icon: (
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: col.hex }}
                />
              ),
              action: () => {
                applyChange((prev) => ({
                  ...prev,
                  nodes: prev.nodes.map((n) =>
                    selectedNodeIds.has(n.id) ? { ...n, color: k } : n
                  ),
                }));
              },
            })),
          ],
        }
      );

      if (clickedNode.type === 'text') {
        items.push({
          title: 'Convertir en archivo...',
          icon: <FilePlus size={14} />,
          action: () => handleConvertTextCardToFile(clickedNode),
        });
      }

      items.push(
        {
          title: 'Crear grupo con la selección',
          icon: <FolderPlus size={14} />,
          action: handleGroupSelection,
        },
        {
          title: 'Duplicar',
          shortcut: 'Ctrl+D',
          icon: <Copy size={14} />,
          action: handleDuplicateSelection,
        },
        { type: 'separator' },
        {
          title: 'Eliminar',
          shortcut: 'Supr',
          icon: <Trash2 size={14} />,
          isWarning: true,
          action: deleteSelected,
        }
      );
    } else {
      // Background Context Menu
      items.push(
        {
          title: 'Nueva tarjeta',
          icon: <StickyNote size={14} />,
          action: () => handleAddTextCard(worldPos),
        },
        {
          title: 'Nueva nota de la bóveda',
          icon: <FileText size={14} />,
          action: () => handleAddNoteCard(worldPos),
        },
        {
          title: 'Nuevo multimedia de la bóveda',
          icon: <FileImage size={14} />,
          action: () => handleAddMediaCard(worldPos),
        },
        {
          title: 'Nuevo grupo',
          icon: <FolderPlus size={14} />,
          action: () => handleAddGroup(worldPos),
        },
        {
          title: 'Nuevo enlace web',
          icon: <Link2 size={14} />,
          action: () => handleAddLinkCard(worldPos),
        },
        { type: 'separator' },
        {
          title: 'Seleccionar todo',
          shortcut: 'Ctrl+A',
          icon: <CheckSquare size={14} />,
          action: () => setSelectedNodeIds(new Set(canvasData.nodes.map((n) => n.id))),
        },
        {
          title: 'Ajustar vista (Zoom to fit)',
          shortcut: 'Shift+1',
          icon: <Maximize size={14} />,
          action: handleZoomToFit,
        }
      );
    }

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  /* ------------------------------------------------------------------ */
  /* Derivados                                                           */
  /* ------------------------------------------------------------------ */

  // Nodo seleccionado: la barra de acciones se renderiza dentro del propio
  // nodo (`CanvasNodeView`), flotando encima de la tarjeta.
  const selectedEdge = selectedEdgeId
    ? canvasData.edges.find((e) => e.id === selectedEdgeId)
    : null;

  // La barra de la arista sigue anclada a coordenadas del canvas.
  let floatingMenuPos: { x: number; y: number } | null = null;
  if (selectedEdge) {
    const fn = canvasData.nodes.find((n) => n.id === selectedEdge.fromNode);
    const tn = canvasData.nodes.find((n) => n.id === selectedEdge.toNode);
    if (fn && tn) {
      const fb = getNodeBBox(fn);
      const tb = getNodeBBox(tn);
      const fc = getSideCenter(fb, selectedEdge.fromSide);
      const tc = getSideCenter(tb, selectedEdge.toSide);
      const midX = (fc.x + tc.x) / 2;
      const midY = (fc.y + tc.y) / 2;
      floatingMenuPos = {
        x: midX * zoom + pan.x,
        y: midY * zoom + pan.y,
      };
    }
  }

  // Active connecting preview curve
  let connectingBezierPath: string | null = null;
  if (connectingFrom && connectingMouseWorld) {
    const srcNode = canvasData.nodes.find((n) => n.id === connectingFrom.nodeId);
    if (srcNode) {
      const bbox = getNodeBBox(srcNode);
      const fromPoint = getSideCoordinates(bbox, connectingFrom.side);
      const toSide = autoSide(bbox, {
        minX: connectingMouseWorld.x,
        minY: connectingMouseWorld.y,
        maxX: connectingMouseWorld.x,
        maxY: connectingMouseWorld.y,
      });
      const bez = getBezierPath(fromPoint, connectingFrom.side, connectingMouseWorld, toSide);
      connectingBezierPath = bez.path;
    }
  }

  const sortedNodes = useMemo(
    () =>
      [...canvasData.nodes].sort((a, b) => {
        if (a.type === 'group' && b.type !== 'group') return -1;
        if (a.type !== 'group' && b.type === 'group') return 1;
        return 0;
      }),
    [canvasData.nodes]
  );

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onWheel={handleWheel}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`canvas-wrapper ${isPanning || isHoldingSpace ? 'is-dragging-canvas' : ''} ${
        readonly ? 'mod-readonly' : ''
      } ${snapToGrid ? 'mod-snap-to-grid' : ''}`}
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
        backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* 1. Multi-Selection Box */}
      {selectionBox && (
        <div
          className="canvas-selection"
          style={{
            left: `${Math.min(selectionBox.startX, selectionBox.currentX)}px`,
            top: `${Math.min(selectionBox.startY, selectionBox.currentY)}px`,
            width: `${Math.abs(selectionBox.currentX - selectionBox.startX)}px`,
            height: `${Math.abs(selectionBox.currentY - selectionBox.startY)}px`,
          }}
        />
      )}

      {/* 2. Top-Right Controls (.canvas-controls) */}
      <CanvasControls
        zoom={zoom}
        readonly={readonly}
        snapToGrid={snapToGrid}
        canUndo={canUndo}
        canRedo={canRedo}
        onZoomIn={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.15))}
        onZoomOut={() => setZoom((z) => Math.max(MIN_ZOOM, z * 0.85))}
        onZoomToFit={handleZoomToFit}
        onResetZoom={handleResetZoom}
        onToggleReadonly={() => setReadonly(!readonly)}
        onToggleSnapToGrid={() => setSnapToGrid((v) => !v)}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* 3. Floating Bottom Creation Pill (.canvas-card-menu) */}
      {!readonly && (
        <CanvasCardMenu
          onAddTextCard={() => handleAddTextCard()}
          onAddNoteCard={() => handleAddNoteCard()}
          onAddMediaCard={() => handleAddMediaCard()}
          onDragStartType={(type, e) => {
            e.dataTransfer.setData('text/canvas-type', type);
            e.dataTransfer.effectAllowed = 'copy';
          }}
        />
      )}

      {/* 4. Floating Action Bar de la arista (.canvas-menu.is-anchored).
          La barra de los nodos se renderiza dentro de `CanvasNodeView`. */}
      {floatingMenuPos && !readonly && selectedEdge && (
        <CanvasFloatingMenu
          edge={selectedEdge}
          position={floatingMenuPos}
          onDelete={deleteSelected}
          onSetColor={(colorKey) => {
            applyChange((prev) => ({
              ...prev,
              edges: prev.edges.map((e) =>
                e.id === selectedEdge.id ? { ...e, color: colorKey } : e
              ),
            }));
          }}
          onToggleEdgeArrow={
            selectedEdge
              ? () => {
                  const nextFromEnd = selectedEdge.fromEnd === 'arrow' ? 'none' : 'arrow';
                  applyChange((prev) => ({
                    ...prev,
                    edges: prev.edges.map((e) =>
                      e.id === selectedEdge.id ? { ...e, fromEnd: nextFromEnd } : e
                    ),
                  }));
                }
              : undefined
          }
          onEditEdgeLabel={
            selectedEdge
              ? () => {
                  setEditingEdgeId(selectedEdge.id);
                }
              : undefined
          }
        />
      )}

      {/* 5. Transformed Canvas Space (Nodes & Edges) */}
      <div
        className="absolute top-0 left-0 w-full h-full pointer-events-none origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* SVG Edges Layer */}
        <svg className="canvas-edges">
          <defs>
            <marker
              id="canvas-arrow"
              viewBox="0 0 12 12"
              refX="9"
              refY="6"
              markerWidth="10"
              markerHeight="10"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path
                className="canvas-arrow-head"
                d="M 0 1.5 L 10 6 L 0 10.5 z"
                fill="currentColor"
              />
            </marker>
          </defs>

          {canvasData.edges.map((edge) => {
            const from = canvasData.nodes.find((n) => n.id === edge.fromNode);
            const to = canvasData.nodes.find((n) => n.id === edge.toNode);
            if (!from || !to) return null;

            return (
              <CanvasEdgeView
                key={edge.id}
                edge={edge}
                fromNode={from}
                toNode={to}
                isSelected={selectedEdgeId === edge.id}
                onSelect={(e) => {
                  e.stopPropagation();
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeIds(new Set());
                }}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeIds(new Set());
                }}
                onUpdateLabel={(edgeId, label) => {
                  applyChange((prev) => ({
                    ...prev,
                    edges: prev.edges.map((eg) =>
                      eg.id === edgeId ? { ...eg, label } : eg
                    ),
                  }));
                }}
                isEditingLabel={editingEdgeId === edge.id}
                setIsEditingLabel={(editing) => {
                  if (!editing) setEditingEdgeId(null);
                }}
              />
            );
          })}

          {/* Active Connecting Curve Drag Preview */}
          {connectingBezierPath && (
            <path
              d={connectingBezierPath}
              className="canvas-display-path is-connecting"
              markerEnd="url(#canvas-arrow)"
            />
          )}

          {/* Flecha temporal congelada al soltar sobre lienzo vacío */}
          {pendingEdgeDrop && (() => {
            const srcNode = canvasData.nodes.find((n) => n.id === pendingEdgeDrop.sourceNodeId);
            if (!srcNode) return null;
            const bbox = getNodeBBox(srcNode);
            const fromPoint = getSideCoordinates(bbox, pendingEdgeDrop.sourceSide);
            const toSide = facingSide(bbox, {
              minX: pendingEdgeDrop.world.x,
              minY: pendingEdgeDrop.world.y,
              maxX: pendingEdgeDrop.world.x,
              maxY: pendingEdgeDrop.world.y,
            });
            const bez = getBezierPath(fromPoint, pendingEdgeDrop.sourceSide, pendingEdgeDrop.world, toSide);
            return (
              <path
                d={bez.path}
                className="canvas-display-path is-connecting"
                markerEnd="url(#canvas-arrow)"
              />
            );
          })()}
        </svg>

        {/* Nodes Layer (Groups are sorted behind regular cards) */}
        {sortedNodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            node={node}
            isSelected={selectedNodeIds.has(node.id)}
            isDragging={draggingNodeId === node.id}
            readonly={readonly}
            onSelect={(e) => {
              e.stopPropagation();
              if (e.shiftKey) {
                const next = new Set(selectedNodeIds);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                setSelectedNodeIds(next);
              } else {
                setSelectedNodeIds(new Set([node.id]));
              }
              setSelectedEdgeId(null);
            }}
            onStartDrag={(e) => handleStartDragNode(node, e)}
            onStartResize={(e, handle) => handleStartResize(node, handle, e)}
            onStartConnect={(e, side) => handleStartConnect(node.id, side, e)}
            onUpdateText={(nodeId, text) => {
              applyChange((prev) => ({
                ...prev,
                nodes: prev.nodes.map((n) =>
                  n.id === nodeId ? { ...n, text } : n
                ),
              }));
            }}
            onUpdateGroupLabel={(nodeId, label) => {
              applyChange((prev) => ({
                ...prev,
                nodes: prev.nodes.map((n) =>
                  n.id === nodeId ? { ...n, label } : n
                ),
              }));
            }}
            onOpenFile={(filePath) => selectFile(filePath)}
            onOpenLink={(target) => {
              openOrCreateWikilink(target);
            }}
            isEditingText={editingNodeId === node.id}
            setIsEditingText={(editing) => {
              setEditingNodeId(editing ? node.id : null);
            }}
            onDeleteNode={handleDeleteNode}
            onSetNodeColor={handleSetNodeColor}
            onZoomToNode={handleZoomToNode}
          />
        ))}
      </div>

      {/* 6. Vault File Picker Modal */}
      <VaultFileModal
        isOpen={vaultModal.open}
        mode={vaultModal.mode}
        onClose={() => {
          const wasPending = Boolean(pendingEdgeDropRef.current);
          if (wasPending && !vaultSelectionCommittedRef.current) {
            // El usuario cerró el selector sin elegir nada: cancelar todo.
            cancelPendingEdgeDrop();
          } else if (wasPending) {
            // Ya se creó el nodo desde handleSelectVaultFile.
            cancelPendingEdgeDrop();
          }
          vaultSelectionCommittedRef.current = false;
          keepPendingOnMenuCloseRef.current = false;
          setVaultModal({ open: false, mode: 'note' });
          pendingDropPosRef.current = null;
        }}
        onSelectFile={handleSelectVaultFile}
      />

      {/* Menú al soltar una flecha en el lienzo vacío */}
      {edgeDropMenu && pendingEdgeDrop && !readonly && (
        <ObsidianMenu
          x={edgeDropMenu.x}
          y={edgeDropMenu.y}
          items={[
            {
              title: 'Añadir tarjeta',
              icon: <StickyNote size={14} />,
              action: handleEdgeDropAddCard,
            },
            {
              title: 'Añadir nota de la bóveda...',
              icon: <FileText size={14} />,
              action: handleEdgeDropAddNote,
            },
            {
              title: 'Añadir multimedia de la bóveda...',
              icon: <ImageIcon size={14} />,
              action: handleEdgeDropAddMedia,
            },
            {
              title: 'Añadir grupo',
              icon: <Frame size={14} />,
              action: handleEdgeDropAddGroup,
            },
          ]}
          onClose={handleEdgeDropMenuClose}
        />
      )}

      {/* 7. Obsidian Context Menu */}
      {contextMenu && (
        <ObsidianMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
