import { FileItem } from '../types';

/**
 * Utilidades para normalización y manejo multiplataforma (Windows / Linux / macOS)
 * de rutas de archivos dentro de la bóveda de Urano.
 */

const NOTE_EXT_RE = /\.(md|markdown|canvas|base)$/i;
const MD_EXT_RE = /\.(md|markdown)$/i;
const FILE_EXT_RE = /\.([a-z][a-z0-9_-]*)$/i;

/**
 * Normaliza separadores de ruta (\ -> /), colapsa barras consecutivas y elimina barra final.
 */
export function normalizePath(p: string): string {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

/**
 * Obtiene la ruta relativa de un archivo con respecto a la raíz de la bóveda,
 * eliminando la extensión .md y manejando comparación case-insensitive para letras de unidad en Windows.
 */
export function getRelativeVaultPath(fullPath: string, vaultPath: string): string {
  if (!fullPath) return '';
  const normFull = normalizePath(fullPath);
  const normVault = normalizePath(vaultPath);
  const lowerFull = normFull.toLowerCase();
  const lowerVault = normVault.toLowerCase();

  // Comparación case-insensitive con límite de directorio para evitar colisiones (C:/Vault vs C:/Vault2)
  if (
    normVault &&
    (lowerFull === lowerVault || lowerFull.startsWith(`${lowerVault}/`))
  ) {
    const rel = normFull.slice(normVault.length).replace(/^\/+/, '');
    return rel.replace(/\.(md|canvas|base|markdown)$/i, '');
  }
  // Fallback: si sigue teniendo letra de unidad o ruta absoluta, tomar solo el nombre del archivo sin extensión
  const parts = normFull.split('/');
  return (parts[parts.length - 1] || normFull).replace(/\.(md|canvas|base|markdown)$/i, '');
}

/**
 * Obtiene únicamente los segmentos de carpetas relativas dentro de la bóveda
 * (excluyendo el nombre del archivo y la ruta absoluta de la bóveda).
 */
export function getRelativeVaultFolderSegments(fullPath: string, vaultPath: string): string[] {
  if (!fullPath) return [];
  const rel = getRelativeVaultPath(fullPath, vaultPath);
  const parts = rel.split('/').filter(Boolean);
  parts.pop(); // descarta el nombre de la nota
  return parts;
}

/**
 * Obtiene el nombre del archivo limpio (sin carpetas padre y sin extensiones .md, .canvas o .base).
 */
export function getCleanFileName(filePath: string): string {
  if (!filePath) return '';
  const norm = normalizePath(filePath);
  const parts = norm.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || '';
  return last.replace(NOTE_EXT_RE, '') || last;
}

/**
 * Determina si una ruta de archivo coincide con alguna de las reglas de exclusión
 * de Urano (rutas de carpeta, prefijos, sufijos wildcard o expresiones regulares).
 */
export function isPathExcluded(filePath: string, filters: string[]): boolean {
  if (!filePath || !filters || filters.length === 0) return false;
  const norm = normalizePath(filePath).toLowerCase();
  const fileName = norm.split('/').pop() || '';

  return filters.some((filter) => {
    const clean = (filter || '').trim().toLowerCase();
    if (!clean) return false;

    // Sintaxis de expresión regular: /patrón/
    if (clean.startsWith('/') && clean.endsWith('/') && clean.length > 2) {
      try {
        const regex = new RegExp(clean.slice(1, -1));
        return regex.test(norm) || regex.test(fileName);
      } catch {
        return false;
      }
    }

    // Ruta de carpeta: termina con '/'
    if (clean.endsWith('/')) {
      const folder = clean.slice(0, -1);
      return (
        norm.includes(`/${folder}/`) ||
        norm.startsWith(`${folder}/`) ||
        norm.endsWith(`/${folder}`) ||
        norm === folder
      );
    }

    // Wildcard: p. ej. *.excalidraw.md
    if (clean.startsWith('*')) {
      const suffix = clean.slice(1);
      return norm.endsWith(suffix) || fileName.endsWith(suffix);
    }

    return norm.includes(clean) || fileName === clean;
  });
}

function extractTrailingExt(normPath: string): string | null {
  const base = normPath.split('/').pop() || '';
  const lastDot = base.lastIndexOf('.');
  // A single leading dot (e.g. `[[.net]]`) is part of the base name, not a file extension
  if (lastDot <= 0) return null;
  const match = base.slice(lastDot).match(FILE_EXT_RE);
  return match ? match[1] : null;
}

/**
 * Compara dos rutas de archivo para determinar si representan el mismo archivo,
 * independientemente de separadores de ruta (\ vs /), mayúsculas/minúsculas en Windows,
 * o si una ruta es relativa y la otra absoluta.
 * Garantiza que archivos con diferentes extensiones (como .md vs .canvas) nunca colisionen.
 */
export function isSamePath(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const normA = a.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
  const normB = b.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();

  if (normA === normB) return true;

  const extA = extractTrailingExt(normA);
  const extB = extractTrailingExt(normB);

  // If BOTH paths have an explicit extension and they differ, they CANNOT be the same file
  if (extA && extB && extA !== extB) {
    return false;
  }

  // If one has an extension other than markdown (e.g. canvas, base, images) and the other has no extension,
  // they cannot match (bare names only resolve to markdown)
  if (extA && !['md', 'markdown'].includes(extA) && !extB) return false;
  if (extB && !['md', 'markdown'].includes(extB) && !extA) return false;

  // Suffix matching for relative vs absolute paths (e.g. "subfolder/note.md" vs "C:/vault/subfolder/note.md")
  if (normA.endsWith('/' + normB) || normB.endsWith('/' + normA)) return true;

  const noExtA = normA.replace(NOTE_EXT_RE, '');
  const noExtB = normB.replace(NOTE_EXT_RE, '');

  if (noExtA === noExtB) return true;
  return noExtA.endsWith('/' + noExtB) || noExtB.endsWith('/' + noExtA);
}

/**
 * Extracts normalized target path, `#heading`/`^block` subpath, and scheme URL status
 * from any wikilink or markdown link target (e.g. `[[Folder/Note#Sec|Alias]]` or `Sub/Note%20Dos.md`).
 */
export function parseLinkTargetParts(rawTarget: string): {
  targetPath: string;
  subpath: string;
  isExternalUrl: boolean;
} {
  const trimmed = (rawTarget || '').trim();
  if (!trimmed) {
    return { targetPath: '', subpath: '', isExternalUrl: false };
  }

  const withoutAlias = trimmed.split('|')[0].trim();
  const hashIdx = withoutAlias.indexOf('#');
  const rawPathPart = (hashIdx !== -1 ? withoutAlias.slice(0, hashIdx) : withoutAlias).trim();
  const subpath = hashIdx !== -1 ? withoutAlias.slice(hashIdx) : '';

  const isWinAbs = /^[a-zA-Z]:[/\\]/.test(rawPathPart);
  const isSchemeUrl = !isWinAbs && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPathPart);
  if (isSchemeUrl || rawPathPart.startsWith('//')) {
    return { targetPath: rawPathPart, subpath, isExternalUrl: true };
  }

  let decoded = rawPathPart;
  if (/%[0-9a-fA-F]{2}/.test(rawPathPart)) {
    try {
      decoded = decodeURIComponent(rawPathPart);
    } catch {
      decoded = rawPathPart;
    }
  }

  return {
    targetPath: normalizePath(decoded),
    subpath,
    isExternalUrl: false,
  };
}

/**
 * Resolves a wikilink target, relative subpath, or full vault file path against `fileTree`.
 * Respects folder qualifiers (never cross-matching another folder when `/` is present),
 * `%20` URI encoding, `#heading` anchors, `|aliases`, and Windows separators.
 */
export function resolveVaultLinkTarget(
  rawTarget: string,
  fileTree: FileItem[],
  activeVault?: string | null
): string | null {
  return resolveLinkAgainstFiles(rawTarget, flattenTreeFiles(fileTree), activeVault);
}

function flattenTreeFiles(fileTree: FileItem[]): FileItem[] {
  const allFiles: FileItem[] = [];
  const walk = (items: FileItem[]) => {
    for (const item of items) {
      if (!item.isDir) allFiles.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(fileTree || []);
  return allFiles;
}

/**
 * Crea un resolvedor de enlaces que aplana el árbol una sola vez y cachea los resultados.
 * Úsalo cuando haya que resolver muchos enlaces contra el mismo árbol (backlinks, grafo, etc.).
 */
export function createVaultLinkResolver(
  fileTree: FileItem[],
  activeVault?: string | null
): (rawTarget: string) => string | null {
  const allFiles = flattenTreeFiles(fileTree);
  const cache = new Map<string, string | null>();
  return (rawTarget: string) => {
    if (cache.has(rawTarget)) return cache.get(rawTarget) ?? null;
    const resolved = resolveLinkAgainstFiles(rawTarget, allFiles, activeVault);
    cache.set(rawTarget, resolved);
    return resolved;
  };
}

function resolveLinkAgainstFiles(
  rawTarget: string,
  allFiles: FileItem[],
  activeVault?: string | null
): string | null {
  const { targetPath, isExternalUrl } = parseLinkTargetParts(rawTarget);
  if (!targetPath || isExternalUrl) return null;
  if (allFiles.length === 0) return null;

  const lowerFullTarget = targetPath.toLowerCase();

  // 1. Exact full path match
  const exactFull = allFiles.find(
    (f) => normalizePath(f.path).toLowerCase() === lowerFullTarget
  );
  if (exactFull) return exactFull.path;

  const normVault = activeVault ? normalizePath(activeVault) : '';
  const lowerVault = normVault.toLowerCase();
  let relSource = targetPath;
  if (lowerVault && lowerFullTarget.startsWith(`${lowerVault}/`)) {
    relSource = targetPath.slice(normVault.length + 1);
  }

  const relTarget = relSource.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!relTarget) return null;

  const lowerRelTarget = relTarget.toLowerCase();
  const baseTarget = lowerRelTarget.split('/').pop() || '';
  const hasExt = FILE_EXT_RE.test(baseTarget);
  const hasDir = lowerRelTarget.includes('/');

  const getRelPath = (filePath: string): string => {
    const norm = normalizePath(filePath);
    if (lowerVault && norm.toLowerCase().startsWith(`${lowerVault}/`)) {
      return norm.slice(lowerVault.length + 1);
    }
    return norm;
  };

  // 2. Exact vault-relative path match
  if (normVault) {
    if (hasExt) {
      const exactRel = allFiles.find((f) => getRelPath(f.path).toLowerCase() === lowerRelTarget);
      if (exactRel) return exactRel.path;
    } else {
      const exactRelMd = allFiles.find(
        (f) => getRelPath(f.path).replace(MD_EXT_RE, '').toLowerCase() === lowerRelTarget
      );
      if (exactRelMd) return exactRelMd.path;

      const exactRelAny = allFiles.find(
        (f) => getRelPath(f.path).replace(NOTE_EXT_RE, '').toLowerCase() === lowerRelTarget
      );
      if (exactRelAny) return exactRelAny.path;
    }
  }

  // 3. Relative subpath suffix match when target includes a folder qualifier
  if (hasDir) {
    if (hasExt) {
      const suffixMatch = allFiles.find((f) =>
        normalizePath(f.path).toLowerCase().endsWith(`/${lowerRelTarget}`)
      );
      if (suffixMatch) return suffixMatch.path;
    } else {
      const suffixMd = allFiles.find((f) => {
        const normNoMd = normalizePath(f.path).replace(MD_EXT_RE, '').toLowerCase();
        return normNoMd === lowerRelTarget || normNoMd.endsWith(`/${lowerRelTarget}`);
      });
      if (suffixMd) return suffixMd.path;

      const suffixAny = allFiles.find((f) => {
        const normNoExt = normalizePath(f.path).replace(NOTE_EXT_RE, '').toLowerCase();
        return normNoExt === lowerRelTarget || normNoExt.endsWith(`/${lowerRelTarget}`);
      });
      if (suffixAny) return suffixAny.path;
    }
    return null;
  }

  // 4. Shortest bare-name match when target contains no '/'
  if (hasExt) {
    const byName = allFiles.find((f) => f.name.toLowerCase() === lowerRelTarget);
    if (byName) return byName.path;
  } else {
    const byMdBase = allFiles.find(
      (f) => f.name.replace(MD_EXT_RE, '').toLowerCase() === lowerRelTarget
    );
    if (byMdBase) return byMdBase.path;

    const byAnyBase = allFiles.find(
      (f) => f.name.replace(NOTE_EXT_RE, '').toLowerCase() === lowerRelTarget
    );
    if (byAnyBase) return byAnyBase.path;
  }

  return null;
}

/**
 * Resuelve una ruta de archivo dentro de la bóveda buscando primero en el árbol de archivos
 * o uniéndola con activeVault si es una ruta relativa.
 */
export function resolveFilePathInVault(
  filePath: string,
  fileTree: FileItem[],
  activeVault?: string | null
): string {
  if (!filePath) return '';

  const resolved = resolveVaultLinkTarget(filePath, fileTree || [], activeVault);
  if (resolved) return resolved;

  const normPath = normalizePath(filePath);
  if (activeVault) {
    const normVault = normalizePath(activeVault);
    const lowerPath = normPath.toLowerCase();
    const lowerVault = normVault.toLowerCase();
    if (lowerPath === lowerVault || lowerPath.startsWith(`${lowerVault}/`)) {
      return normPath;
    }
    return `${normVault}/${normPath.replace(/^\/+/, '')}`;
  }

  return normPath;
}
