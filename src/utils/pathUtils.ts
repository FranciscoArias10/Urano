import { FileItem } from '../types';

/**
 * Utilidades para normalización y manejo multiplataforma (Windows / Linux / macOS)
 * de rutas de archivos dentro de la bóveda de Urano.
 */

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

  // Comparación case-insensitive para letras de unidad en Windows (C: vs c:)
  if (normVault && normFull.toLowerCase().startsWith(normVault.toLowerCase())) {
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
  return last.replace(/\.(md|canvas|base)$/i, '') || last;
}

/**
 * Determina si una ruta de archivo coincide con alguna de las reglas de exclusión
 * de Urano/Urano (rutas de carpeta, prefijos, sufijos wildcard o expresiones regulares).
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

  // Extract extensions if present
  const matchA = normA.match(/\.([a-z0-9_-]+)$/i);
  const matchB = normB.match(/\.([a-z0-9_-]+)$/i);
  const extA = matchA ? matchA[1] : null;
  const extB = matchB ? matchB[1] : null;

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

  const noExtA = normA.replace(/\.(md|markdown|canvas|base)$/i, '');
  const noExtB = normB.replace(/\.(md|markdown|canvas|base)$/i, '');

  if (noExtA === noExtB) return true;
  return noExtA.endsWith('/' + noExtB) || noExtB.endsWith('/' + noExtA);
}

/**
 * Resuelve una ruta de archivo dentro de la bóveda buscando primero en el árbol de archivos
 * (usando isSamePath) o uniéndola con activeVault si es una ruta relativa.
 */
export function resolveFilePathInVault(
  filePath: string,
  fileTree: FileItem[],
  activeVault?: string | null
): string {
  if (!filePath) return '';

  const findInTree = (items: FileItem[]): string | null => {
    for (const item of items) {
      if (!item.isDir && isSamePath(item.path, filePath)) {
        return item.path;
      }
      if (item.children) {
        const found = findInTree(item.children);
        if (found) return found;
      }
    }
    return null;
  };

  const found = findInTree(fileTree || []);
  if (found) return found;

  const normPath = normalizePath(filePath);
  if (activeVault) {
    const normVault = normalizePath(activeVault);
    if (normPath.toLowerCase().startsWith(normVault.toLowerCase())) {
      return normPath;
    }
    return `${normVault}/${normPath.replace(/^\/+/, '')}`;
  }

  return normPath;
}
