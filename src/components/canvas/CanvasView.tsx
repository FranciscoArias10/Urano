import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  StickyNote,
  FileText,
  FolderPlus,
  Maximize,
  Copy,
  Trash2,
  Edit2,
  FilePlus,
  Palette,
  CheckSquare,
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
  calculateBezier,
  offsetSidePoint,
  getSideCenter,
  autoSide,
  CANVAS_COLORS,
} from './canvasMath';
import { CanvasControls } from './CanvasControls';
import { CanvasCardMenu } from './CanvasCardMenu';
import { CanvasFloatingMenu } from './CanvasFloatingMenu';
import { CanvasNodeView } from './CanvasNodeView';
import { CanvasEdgeView } from './CanvasEdgeView';
import { VaultFileModal } from './VaultFileModal';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
import './canvasStyles.css';

interface CanvasViewProps {
  filePath: string;
}

export const CanvasView: React.FC<CanvasViewProps> = ({ filePath }) => {
  const {
    fileContent,
    updateContent,
    selectFile,
    refreshTree,
    activeVault,
  } = useVaultStore();
  const { showNotice } = useNoticeStore();

  const [canvasData, setCanvasData] = useState<CanvasData>({ nodes: [], edges: [] });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [readonly, setReadonly] = useState(false);

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

  // Node Resizing
  const [resizingHandle, setResizingHandle] = useState<string | null>(null);
  const resizeStartMouseRef = useRef<CanvasPoint>({ x: 0, y: 0 });
  const resizeStartNodeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Connection Dragging (Creating an edge)
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    side: CanvasNodeSide;
  } | null>(null);
  const [connectingMouseWorld, setConnectingMouseWorld] = useState<CanvasPoint | null>(null);

  // Selection box (dragging rectangle in empty canvas)
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Vault file picker modal
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
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

  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Convert screen coordinates to world coordinates
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): CanvasPoint => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: Math.round((clientX - rect.left - pan.x) / zoom),
        y: Math.round((clientY - rect.top - pan.y) / zoom),
      };
    },
    [pan, zoom]
  );

  // Center of the currently visible screen in world coordinates
  const getVisibleCenter = useCallback((): CanvasPoint => {
    if (!containerRef.current) return { x: 200, y: 200 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: Math.round((rect.width / 2 - pan.x) / zoom),
      y: Math.round((rect.height / 2 - pan.y) / zoom),
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
      x: Math.round(rect.width / 2 - centerX * newZoom),
      y: Math.round(rect.height / 2 - centerY * newZoom),
    });
  }, [canvasData.nodes]);

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
            x: Math.round(rect.width / 2 - centerX),
            y: Math.round(rect.height / 2 - centerY),
          });
          return;
        }
      }
      setPan({ x: 0, y: 0 });
    }
  }, [canvasData.nodes]);

  // Keyboard navigation & Shortcuts (Space pan, Delete, Ctrl+A, Ctrl+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space for panning
      if (e.code === 'Space' && !isHoldingSpace) {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.getAttribute('contenteditable') === 'true') {
          return;
        }
        setIsHoldingSpace(true);
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.getAttribute('contenteditable') === 'true') {
          return;
        }
        if (selectedNodeIds.size > 0 || selectedEdgeId) {
          e.preventDefault();
          deleteSelected();
        }
      }

      // Ctrl + A (Select all)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setSelectedNodeIds(new Set(canvasData.nodes.map((n) => n.id)));
      }

      // Escape (Deselect / Close context menu)
      if (e.key === 'Escape') {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
        setConnectingFrom(null);
        setConnectingMouseWorld(null);
        setContextMenu(null);
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
  }, [isHoldingSpace, selectedNodeIds, selectedEdgeId, canvasData.nodes]);

  // Delete currently selected nodes and/or edge
  const deleteSelected = () => {
    const nextNodes = canvasData.nodes.filter((n) => !selectedNodeIds.has(n.id));
    const nextEdges = canvasData.edges.filter(
      (e) => !selectedNodeIds.has(e.fromNode) && !selectedNodeIds.has(e.toNode) && e.id !== selectedEdgeId
    );
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    persistCanvas({ nodes: nextNodes, edges: nextEdges });
  };

  // Wheel handling: Ctrl+Wheel -> Zoom to pointer; normal wheel -> Pan
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
      const newZoom = Math.max(0.15, Math.min(3.0, zoom * zoomFactor));

      // Zoom towards mouse pointer
      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      setZoom(newZoom);
      setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
    } else {
      // Pan with trackpad or mouse wheel
      setPan((prev) => ({
        x: Math.round(prev.x - e.deltaX),
        y: Math.round(prev.y - e.deltaY),
      }));
    }
  };

  // Double click on canvas background creates text card
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (readonly) return;
    const target = e.target as HTMLElement;
    if (target !== containerRef.current && !target.classList.contains('canvas-background') && target.tagName !== 'svg') {
      return;
    }

    const pos = screenToWorld(e.clientX, e.clientY);
    const id = generateCanvasId();
    const newNode: CanvasNode = {
      id,
      type: 'text',
      text: '',
      x: pos.x - 125,
      y: pos.y - 35,
      width: 250,
      height: 70,
    };

    const nextData = {
      ...canvasData,
      nodes: [...canvasData.nodes, newNode],
    };
    persistCanvas(nextData);
    setSelectedNodeIds(new Set([id]));
    setEditingNodeId(id);
  };

  // Pointer Down on Canvas
  const handlePointerDown = (e: React.MouseEvent) => {
    setContextMenu(null);
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
        x: Math.round(e.clientX - startPanRef.current.x),
        y: Math.round(e.clientY - startPanRef.current.y),
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

      setCanvasData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const init = initialNodesStateRef.current.get(n.id);
          if (init) {
            return {
              ...n,
              x: Math.round(init.x + deltaX),
              y: Math.round(init.y + deltaY),
            };
          }
          return n;
        }),
      }));
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

      if (resizingHandle.includes('right')) {
        newW = Math.max(minDim, init.w + dx);
      }
      if (resizingHandle.includes('left')) {
        const potentialW = init.w - dx;
        if (potentialW >= minDim) {
          newX = init.x + dx;
          newW = potentialW;
        }
      }
      if (resizingHandle.includes('bottom')) {
        newH = Math.max(minDim, init.h + dy);
      }
      if (resizingHandle.includes('top')) {
        const potentialH = init.h - dy;
        if (potentialH >= minDim) {
          newY = init.y + dy;
          newH = potentialH;
        }
      }

      setCanvasData((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          selectedNodeIds.has(n.id)
            ? { ...n, x: Math.round(newX), y: Math.round(newY), width: Math.round(newW), height: Math.round(newH) }
            : n
        ),
      }));
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
      setDraggingNodeId(null);
      persistCanvas(canvasData);
    }

    if (resizingHandle) {
      setResizingHandle(null);
      resizeStartNodeRef.current = null;
      persistCanvas(canvasData);
    }

    // Releasing connection point
    if (connectingFrom) {
      const dropWorld = screenToWorld(e.clientX, e.clientY);

      // Check if dropped on a node
      let targetNode: CanvasNode | null = null;
      for (const node of canvasData.nodes) {
        if (node.id !== connectingFrom.nodeId) {
          const bbox = getNodeBBox(node);
          if (
            dropWorld.x >= bbox.minX &&
            dropWorld.x <= bbox.maxX &&
            dropWorld.y >= bbox.minY &&
            dropWorld.y <= bbox.maxY
          ) {
            targetNode = node;
            break;
          }
        }
      }

      const sourceNode = canvasData.nodes.find((n) => n.id === connectingFrom.nodeId);

      if (targetNode && sourceNode) {
        // Connect to target node
        const toSide = autoSide(getNodeBBox(sourceNode), getNodeBBox(targetNode));
        const newEdge: CanvasEdge = {
          id: generateCanvasId(),
          fromNode: sourceNode.id,
          fromSide: connectingFrom.side,
          toNode: targetNode.id,
          toSide,
          toEnd: 'arrow',
        };
        const nextData = {
          ...canvasData,
          edges: [...canvasData.edges, newEdge],
        };
        persistCanvas(nextData);
        setSelectedEdgeId(newEdge.id);
      } else if (sourceNode) {
        // Dropped in empty space -> create new connected card automatically! (Obsidian behavior)
        const newCardId = generateCanvasId();
        const newNode: CanvasNode = {
          id: newCardId,
          type: 'text',
          text: '',
          x: dropWorld.x - 125,
          y: dropWorld.y - 40,
          width: 250,
          height: 80,
        };

        const toSide = autoSide(getNodeBBox(sourceNode), getNodeBBox(newNode));
        const newEdge: CanvasEdge = {
          id: generateCanvasId(),
          fromNode: sourceNode.id,
          fromSide: connectingFrom.side,
          toNode: newCardId,
          toSide,
          toEnd: 'arrow',
        };

        const nextData = {
          nodes: [...canvasData.nodes, newNode],
          edges: [...canvasData.edges, newEdge],
        };
        persistCanvas(nextData);
        setSelectedNodeIds(new Set([newCardId]));
        setEditingNodeId(newCardId);
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
    setSelectedNodeIds(new Set([node.id]));
  };

  // Node Connect Initiation
  const handleStartConnect = (nodeId: string, side: CanvasNodeSide, e: React.MouseEvent) => {
    e.stopPropagation();
    if (readonly) return;
    setConnectingFrom({ nodeId, side });
    setConnectingMouseWorld(screenToWorld(e.clientX, e.clientY));
  };

  // Add Cards
  const handleAddTextCard = (customPos?: CanvasPoint) => {
    const pos = customPos || getVisibleCenter();
    const id = generateCanvasId();
    const newNode: CanvasNode = {
      id,
      type: 'text',
      text: '',
      x: pos.x - 125,
      y: pos.y - 50,
      width: 250,
      height: 100,
    };
    persistCanvas({
      ...canvasData,
      nodes: [...canvasData.nodes, newNode],
    });
    setSelectedNodeIds(new Set([id]));
    setEditingNodeId(id);
  };

  const handleAddFileCard = (customPos?: CanvasPoint) => {
    pendingDropPosRef.current = customPos || getVisibleCenter();
    setIsVaultModalOpen(true);
  };

  const handleSelectVaultFile = (vaultFilePath: string) => {
    const pos = pendingDropPosRef.current || getVisibleCenter();
    const id = generateCanvasId();
    const newNode: CanvasNode = {
      id,
      type: 'file',
      file: vaultFilePath,
      x: pos.x - 200,
      y: pos.y - 180,
      width: 400,
      height: 360,
    };
    persistCanvas({
      ...canvasData,
      nodes: [...canvasData.nodes, newNode],
    });
    setSelectedNodeIds(new Set([id]));
  };

  const handleAddLinkCard = (customPos?: CanvasPoint) => {
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
    persistCanvas({
      ...canvasData,
      nodes: [...canvasData.nodes, newNode],
    });
    setSelectedNodeIds(new Set([id]));
  };

  const handleAddGroup = (customPos?: CanvasPoint) => {
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
    persistCanvas({
      ...canvasData,
      nodes: [...canvasData.nodes, newGroup],
    });
    setSelectedNodeIds(new Set([id]));
  };

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
      const nextData: CanvasData = {
        ...canvasData,
        nodes: canvasData.nodes.map((n) =>
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
      };
      persistCanvas(nextData);
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

    persistCanvas({
      ...canvasData,
      nodes: [newGroup, ...canvasData.nodes],
    });
    setSelectedNodeIds(new Set([id]));
  };

  // Duplicate selection
  const handleDuplicateSelection = () => {
    if (selectedNodeIds.size === 0) return;
    const offset = 40;
    const idMap = new Map<string, string>();

    const duplicatedNodes: CanvasNode[] = [];
    for (const node of canvasData.nodes) {
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
    const duplicatedEdges: CanvasEdge[] = [];
    for (const edge of canvasData.edges) {
      if (idMap.has(edge.fromNode) && idMap.has(edge.toNode)) {
        duplicatedEdges.push({
          ...edge,
          id: generateCanvasId(),
          fromNode: idMap.get(edge.fromNode)!,
          toNode: idMap.get(edge.toNode)!,
        });
      }
    }

    persistCanvas({
      nodes: [...canvasData.nodes, ...duplicatedNodes],
      edges: [...canvasData.edges, ...duplicatedEdges],
    });
    setSelectedNodeIds(new Set(duplicatedNodes.map((n) => n.id)));
  };

  // Context Menu Handling
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
                persistCanvas({
                  ...canvasData,
                  nodes: canvasData.nodes.map((n) =>
                    selectedNodeIds.has(n.id) ? { ...n, color: undefined } : n
                  ),
                });
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
                persistCanvas({
                  ...canvasData,
                  nodes: canvasData.nodes.map((n) =>
                    selectedNodeIds.has(n.id) ? { ...n, color: k } : n
                  ),
                });
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
          action: () => handleAddFileCard(worldPos),
        },
        {
          title: 'Nuevo grupo',
          icon: <FolderPlus size={14} />,
          action: () => handleAddGroup(worldPos),
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

  // Find primary selected element for floating menu position
  const selectedNode =
    selectedNodeIds.size === 1
      ? canvasData.nodes.find((n) => selectedNodeIds.has(n.id))
      : null;

  const selectedEdge = selectedEdgeId
    ? canvasData.edges.find((e) => e.id === selectedEdgeId)
    : null;

  let floatingMenuPos: { x: number; y: number } | null = null;
  if (selectedNode) {
    floatingMenuPos = {
      x: selectedNode.x * zoom + pan.x + (selectedNode.width * zoom) / 2,
      y: selectedNode.y * zoom + pan.y,
    };
  } else if (selectedEdge) {
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
      const fromCenter = getSideCenter(bbox, connectingFrom.side);
      const fromOff = offsetSidePoint(fromCenter, connectingFrom.side, 4);
      const toSide = autoSide(bbox, {
        minX: connectingMouseWorld.x,
        minY: connectingMouseWorld.y,
        maxX: connectingMouseWorld.x,
        maxY: connectingMouseWorld.y,
      });
      const bez = calculateBezier(fromOff, connectingFrom.side, connectingMouseWorld, toSide);
      connectingBezierPath = bez.path;
    }
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className={`canvas-wrapper ${isPanning || isHoldingSpace ? 'is-dragging-canvas' : ''}`}
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

      {/* 2. Top-Right Controls */}
      <CanvasControls
        zoom={zoom}
        readonly={readonly}
        onZoomIn={() => setZoom((z) => Math.min(3.0, z * 1.15))}
        onZoomOut={() => setZoom((z) => Math.max(0.15, z * 0.85))}
        onZoomToFit={handleZoomToFit}
        onResetZoom={handleResetZoom}
        onToggleReadonly={() => setReadonly(!readonly)}
      />

      {/* 3. Floating Bottom Creation Pill (.canvas-card-menu) */}
      {!readonly && (
        <CanvasCardMenu
          onAddTextCard={() => handleAddTextCard()}
          onAddFileCard={() => handleAddFileCard()}
          onAddLinkCard={() => handleAddLinkCard()}
          onDragStartType={(type, e) => {
            e.dataTransfer.setData('text/canvas-type', type);
          }}
        />
      )}

      {/* 4. Floating Action Bar (.canvas-menu) */}
      {floatingMenuPos && !readonly && (
        <CanvasFloatingMenu
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          position={floatingMenuPos}
          onDelete={deleteSelected}
          onSetColor={(colorKey) => {
            if (selectedNode) {
              persistCanvas({
                ...canvasData,
                nodes: canvasData.nodes.map((n) =>
                  selectedNodeIds.has(n.id) ? { ...n, color: colorKey } : n
                ),
              });
            } else if (selectedEdge) {
              persistCanvas({
                ...canvasData,
                edges: canvasData.edges.map((e) =>
                  e.id === selectedEdge.id ? { ...e, color: colorKey } : e
                ),
              });
            }
          }}
          onEdit={() => {
            if (selectedNode) setEditingNodeId(selectedNode.id);
            if (selectedEdge) setEditingEdgeId(selectedEdge.id);
          }}
          onConvertToFile={
            selectedNode?.type === 'text'
              ? () => handleConvertTextCardToFile(selectedNode)
              : undefined
          }
          onToggleEdgeArrow={
            selectedEdge
              ? () => {
                  const nextFromEnd = selectedEdge.fromEnd === 'arrow' ? 'none' : 'arrow';
                  persistCanvas({
                    ...canvasData,
                    edges: canvasData.edges.map((e) =>
                      e.id === selectedEdge.id ? { ...e, fromEnd: nextFromEnd } : e
                    ),
                  });
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
                  persistCanvas({
                    ...canvasData,
                    edges: canvasData.edges.map((eg) =>
                      eg.id === edgeId ? { ...eg, label } : eg
                    ),
                  });
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
              className="canvas-display-path"
              style={{
                stroke: 'var(--color-accent)',
                strokeWidth: '2.5px',
                strokeDasharray: '4 4',
              }}
            />
          )}
        </svg>

        {/* Nodes Layer (Groups are sorted behind regular cards) */}
        {[...canvasData.nodes]
          .sort((a, b) => {
            if (a.type === 'group' && b.type !== 'group') return -1;
            if (a.type !== 'group' && b.type === 'group') return 1;
            return 0;
          })
          .map((node) => (
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
                persistCanvas({
                  ...canvasData,
                  nodes: canvasData.nodes.map((n) =>
                    n.id === nodeId ? { ...n, text } : n
                  ),
                });
              }}
              onUpdateGroupLabel={(nodeId, label) => {
                persistCanvas({
                  ...canvasData,
                  nodes: canvasData.nodes.map((n) =>
                    n.id === nodeId ? { ...n, label } : n
                  ),
                });
              }}
              onOpenFile={(filePath) => selectFile(filePath)}
              isEditingText={editingNodeId === node.id}
              setIsEditingText={(editing) => {
                if (!editing) setEditingNodeId(null);
              }}
            />
          ))}
      </div>

      {/* 6. Vault File Picker Modal */}
      <VaultFileModal
        isOpen={isVaultModalOpen}
        onClose={() => setIsVaultModalOpen(false)}
        onSelectFile={handleSelectVaultFile}
      />

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
