import { FileItem, GraphData, GraphLink, GraphNode } from '../../types';
import { extractWikilinks } from '../../editor/wikilinks';
import {
  getCleanFileName,
  isPathExcluded,
  normalizePath,
  parseLinkTargetParts,
  resolveVaultLinkTarget,
} from '../../utils/pathUtils';

export type GraphNodeKind = 'note' | 'ghost' | 'tag' | 'attachment';

export interface ViewGraphNode extends GraphNode {
  kind: GraphNodeKind;
  /** Ruta real del archivo (notas y adjuntos existentes). */
  path?: string;
  /** Destino crudo del enlace para nodos fantasma (se usa para crearlos al hacer clic). */
  target?: string;
}

export interface ViewGraphData extends GraphData {
  nodes: ViewGraphNode[];
  links: GraphLink[];
}

export interface GraphModelOptions {
  showTags: boolean;
  showAttachments: boolean;
}

const NOTE_EXT_RE = /\.(md|markdown|canvas|base)$/i;
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu;
const EMBED_WIKI_RE = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const EMBED_MD_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

const lowerKey = (p: string) => normalizePath(p).toLowerCase();

function flattenFiles(items: FileItem[], out: FileItem[] = []): FileItem[] {
  for (const item of items) {
    if (!item.isDir) out.push(item);
    if (item.children?.length) flattenFiles(item.children, out);
  }
  return out;
}

/**
 * Construye el grafo a partir del contenido de las notas.
 * - Los enlaces `[[Nota#Sección]]` / `[[Nota|alias]]` se resuelven a la nota real
 *   (sin crear nodos fantasma por la sección).
 * - Solo los destinos que no existen en la bóveda generan nodos fantasma.
 */
export function buildGraphData(
  notesContentMap: Record<string, string>,
  fileTree: FileItem[],
  activeVault: string | null,
  ignoreFilters: string[],
  options: GraphModelOptions
): ViewGraphData {
  const nodes = new Map<string, ViewGraphNode>();
  const links: GraphLink[] = [];
  const linkKeys = new Set<string>();

  const files = flattenFiles(fileTree);
  const byRelPath = new Map<string, string>();
  const byName = new Map<string, string>();
  const normVault = activeVault ? lowerKey(activeVault) : '';
  for (const f of files) {
    const norm = lowerKey(f.path);
    const rel = normVault && norm.startsWith(`${normVault}/`) ? norm.slice(normVault.length + 1) : norm;
    const relNoExt = rel.replace(NOTE_EXT_RE, '');
    if (!byRelPath.has(rel)) byRelPath.set(rel, f.path);
    if (!byRelPath.has(relNoExt)) byRelPath.set(relNoExt, f.path);
    const name = rel.split('/').pop() || '';
    const nameNoExt = name.replace(NOTE_EXT_RE, '');
    // Las notas tienen prioridad sobre otros archivos con el mismo nombre base
    if (!byName.has(name)) byName.set(name, f.path);
    if (NOTE_EXT_RE.test(name) && !byName.has(nameNoExt)) byName.set(nameNoExt, f.path);
  }

  const resolveCache = new Map<string, string | null>();
  const resolveTarget = (rawTarget: string, targetPath: string): string | null => {
    if (resolveCache.has(rawTarget)) return resolveCache.get(rawTarget) ?? null;
    const key = normalizePath(targetPath).toLowerCase().replace(/^\.?\/+/, '');
    let found: string | null =
      byRelPath.get(key) ?? byRelPath.get(key.replace(NOTE_EXT_RE, '')) ?? null;
    if (!found && !key.includes('/')) found = byName.get(key) ?? null;
    if (!found) {
      const base = key.split('/').pop() || key;
      found = byName.get(base) ?? null;
    }
    if (!found) found = resolveVaultLinkTarget(rawTarget, fileTree, activeVault);
    resolveCache.set(rawTarget, found);
    return found;
  };

  const ensureFileNode = (path: string, kind: 'note' | 'attachment'): ViewGraphNode => {
    const id = lowerKey(path);
    let node = nodes.get(id);
    if (!node) {
      node = { id, name: getCleanFileName(path) || path, val: kind === 'note' ? 1 : 0.8, kind, path };
      nodes.set(id, node);
    }
    return node;
  };

  const addLink = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}\u0000${target}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ source, target });
    const t = nodes.get(target);
    if (t) t.val += 0.8;
  };

  for (const [filePath, content] of Object.entries(notesContentMap)) {
    if (isPathExcluded(filePath, ignoreFilters)) continue;
    const source = ensureFileNode(filePath, 'note');

    // Enlaces internos
    for (const raw of extractWikilinks(content)) {
      const { targetPath, isExternalUrl } = parseLinkTargetParts(raw);
      if (!targetPath || isExternalUrl) continue; // [[#Sección]] (misma nota) o URL

      const resolved = resolveTarget(raw, targetPath);
      if (resolved) {
        if (isPathExcluded(resolved, ignoreFilters)) continue;
        const target = ensureFileNode(resolved, 'note');
        addLink(source.id, target.id);
      } else {
        const ghostName = getCleanFileName(targetPath) || targetPath;
        const id = `ghost:${normalizePath(targetPath).toLowerCase().replace(NOTE_EXT_RE, '')}`;
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: ghostName, val: 0.8, kind: 'ghost', target: targetPath });
        }
        addLink(source.id, id);
      }
    }

    // Etiquetas
    if (options.showTags) {
      const seen = new Set<string>();
      TAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG_RE.exec(content)) !== null) {
        const tag = m[1];
        const id = `tag:${tag.toLowerCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!nodes.has(id)) nodes.set(id, { id, name: `#${tag}`, val: 0.8, kind: 'tag' });
        addLink(source.id, id);
      }
    }

    // Archivos adjuntos (imágenes, PDF, etc. incrustados)
    if (options.showAttachments) {
      const targets = new Set<string>();
      for (const re of [EMBED_WIKI_RE, EMBED_MD_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) targets.add(m[1].trim());
      }
      for (const raw of targets) {
        const { targetPath, isExternalUrl } = parseLinkTargetParts(raw);
        if (!targetPath || isExternalUrl) continue;
        const resolved = resolveTarget(raw, targetPath);
        if (!resolved || NOTE_EXT_RE.test(resolved) || isPathExcluded(resolved, ignoreFilters)) continue;
        const att = ensureFileNode(resolved, 'attachment');
        att.name = resolved.replace(/\\/g, '/').split('/').pop() || att.name;
        addLink(source.id, att.id);
      }
    }
  }

  return { nodes: Array.from(nodes.values()), links };
}

/** Aplica ocultar huérfanos y la búsqueda por nombre. */
export function filterGraphData(
  data: ViewGraphData,
  query: string,
  showOrphans: boolean
): ViewGraphData {
  let nodes = data.nodes;
  let links = data.links;

  if (!showOrphans) {
    const connected = new Set<string>();
    for (const l of links) {
      connected.add(String(l.source));
      connected.add(String(l.target));
    }
    nodes = nodes.filter((n) => connected.has(n.id));
  }

  const q = query.trim().toLowerCase();
  if (q) {
    nodes = nodes.filter((n) => n.name.toLowerCase().includes(q));
  }

  if (nodes !== data.nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    links = links.filter((l) => ids.has(String(l.source)) && ids.has(String(l.target)));
  }

  return { nodes, links };
}
