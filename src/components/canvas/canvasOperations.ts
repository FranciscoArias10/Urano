import {
  CanvasData,
  CanvasEdge,
  CanvasNode,
  CanvasNodeSide,
} from '../../types/canvas';
import { FileItem } from '../../types';
import { isImagePath } from '../../services/storageAdapter';
import {
  isSamePath,
  normalizePath,
  resolveFilePathInVault,
  resolveVaultLinkTarget,
} from '../../utils/pathUtils';
import { facingSide, generateCanvasId, getNodeBBox } from './canvasMath';

/**
 * Parses JSON Canvas 1.0 text safely.
 * Distinguishes an empty/new file from corrupted/non-Canvas text (e.g. Markdown)
 * so callers never overwrite an unreadable file with `{ nodes: [], edges: [] }`.
 */
export function parseCanvasContent(raw: string): {
  data: CanvasData;
  isInvalidNonEmptyJson: boolean;
} {
  if (!raw || !raw.trim()) {
    return { data: { nodes: [], edges: [] }, isInvalidNonEmptyJson: false };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: { nodes: [], edges: [] }, isInvalidNonEmptyJson: true };
    }
    return {
      data: {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      },
      isInvalidNonEmptyJson: false,
    };
  } catch {
    return { data: { nodes: [], edges: [] }, isInvalidNonEmptyJson: true };
  }
}

/**
 * Converts a vault file path to a portable JSON Canvas 1.0 forward-slash vault-relative path,
 * preserving the full file extension (e.g. `Docs/Roadmap.md`, `Assets/diagram.png`).
 */
export function toCanvasVaultPath(filePath: string, activeVault?: string | null): string {
  if (!filePath) return '';
  const normFile = normalizePath(filePath);
  if (activeVault) {
    const normVault = normalizePath(activeVault);
    if (normVault) {
      const lowerPrefix = `${normVault.toLowerCase()}/`;
      if (normFile.toLowerCase().startsWith(lowerPrefix)) {
        return normFile.slice(normVault.length + 1);
      }
    }
  }
  return normFile.replace(/^\/+/, '');
}

/**
 * Resolves a Canvas `node.file` reference (relative `/` path, Windows `\` path, or absolute path)
 * to the real OS path inside the active vault.
 */
export function resolveCanvasVaultFile(
  rawFile: string,
  fileTree: FileItem[],
  files: FileItem[],
  activeVault?: string | null
): string {
  if (!rawFile) return '';
  const combined = files && files.length > 0 ? [...fileTree, ...files] : fileTree;
  const fromLink = resolveVaultLinkTarget(rawFile, combined, activeVault);
  if (fromLink) return fromLink;
  if (activeVault) {
    const fromVault = resolveFilePathInVault(rawFile, combined, activeVault);
    if (fromVault) return fromVault;
  }
  return rawFile;
}

/**
 * Finds note markdown content in `notesContentMap` regardless of `/` vs `\` or relative vs absolute key.
 */
export function findNoteContentInMap(
  notesContentMap: Record<string, string>,
  resolvedPath: string,
  rawFile?: string
): string {
  if (resolvedPath && Object.prototype.hasOwnProperty.call(notesContentMap, resolvedPath)) {
    return notesContentMap[resolvedPath];
  }
  if (rawFile && Object.prototype.hasOwnProperty.call(notesContentMap, rawFile)) {
    return notesContentMap[rawFile];
  }
  const target = resolvedPath || rawFile || '';
  if (!target) return '';
  for (const [key, val] of Object.entries(notesContentMap)) {
    if (isSamePath(key, target)) {
      return val;
    }
  }
  return '';
}

/**
 * Computes the effective node selection for a right-click on `clickedNodeId`:
 * preserves multi-selection if `clickedNodeId` is already selected, otherwise selects only `clickedNodeId`.
 */
export function resolveContextMenuSelection(
  currentSelected: ReadonlySet<string>,
  clickedNodeId: string
): Set<string> {
  if (currentSelected.has(clickedNodeId)) {
    return new Set(currentSelected);
  }
  return new Set([clickedNodeId]);
}

/**
 * Atomically appends `newNode` and, if `pendingEdge` is present, connects `sourceNodeId -> newNode.id`.
 */
export function appendNodeWithPendingEdge(
  prev: CanvasData,
  newNode: CanvasNode,
  pendingEdge: { sourceNodeId: string; sourceSide: CanvasNodeSide } | null
): { data: CanvasData; createdEdgeId: string | null } {
  const nextNodes = [...prev.nodes, newNode];
  if (!pendingEdge) {
    return {
      data: { ...prev, nodes: nextNodes },
      createdEdgeId: null,
    };
  }

  const source = prev.nodes.find((n) => n.id === pendingEdge.sourceNodeId);
  if (!source || source.id === newNode.id) {
    return {
      data: { ...prev, nodes: nextNodes },
      createdEdgeId: null,
    };
  }

  const newEdge: CanvasEdge = {
    id: generateCanvasId(),
    fromNode: source.id,
    fromSide: pendingEdge.sourceSide,
    toNode: newNode.id,
    toSide: facingSide(getNodeBBox(source), getNodeBBox(newNode)),
    toEnd: 'arrow',
  };

  return {
    data: {
      nodes: nextNodes,
      edges: [...prev.edges, newEdge],
    },
    createdEdgeId: newEdge.id,
  };
}

/**
 * Returns true only for Canvas node types that have inline editable text/label (`text`, `.md` `file`, `group`).
 * Image `file` nodes and external `link` nodes cannot enter text edit mode.
 */
export function isCanvasNodeEditable(node: CanvasNode): boolean {
  if (node.type === 'text' || node.type === 'group') return true;
  if (node.type === 'file') return !isImagePath(node.file);
  return false;
}
