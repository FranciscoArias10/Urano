/**
 * Formato de los archivos `.base` de Urano (JSON).
 * Se conservan las claves desconocidas para no perder datos al guardar.
 */

export type BaseColumnId = 'name' | 'folder' | 'tags' | 'mtime' | 'size';
export type BaseSortField = 'name' | 'folder' | 'mtime' | 'size';
export type BaseSortOrder = 'asc' | 'desc';

export const BASE_COLUMN_IDS: BaseColumnId[] = ['name', 'folder', 'tags', 'mtime', 'size'];
const SORT_FIELDS: BaseSortField[] = ['name', 'folder', 'mtime', 'size'];

export interface BaseConfig {
  title?: string;
  filters: unknown[];
  sort: Array<{ field: BaseSortField; order: BaseSortOrder }>;
  columns: BaseColumnId[];
  /** Texto del filtro rápido de la barra superior. */
  query: string;
  [key: string]: unknown;
}

export function defaultBaseConfig(title?: string): BaseConfig {
  return {
    ...(title ? { title } : {}),
    filters: [],
    sort: [{ field: 'name', order: 'asc' }],
    columns: [...BASE_COLUMN_IDS],
    query: '',
  };
}

/**
 * Parsea el contenido crudo de un `.base`. Contenido vacío => configuración por defecto.
 * Lanza si el JSON es inválido (para que la vista no sobrescriba el archivo).
 */
export function parseBaseConfig(raw: string): BaseConfig {
  if (!raw || !raw.trim()) return defaultBaseConfig();

  const parsed: unknown = JSON.parse(raw);
  const obj: Record<string, unknown> =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const columns = Array.isArray(obj.columns)
    ? (obj.columns.filter((c) => BASE_COLUMN_IDS.includes(c as BaseColumnId)) as BaseColumnId[])
    : [];

  const sort = Array.isArray(obj.sort)
    ? obj.sort
        .filter(
          (s): s is { field: BaseSortField; order?: string } =>
            !!s && typeof s === 'object' && SORT_FIELDS.includes((s as { field: BaseSortField }).field)
        )
        .map((s) => ({ field: s.field, order: (s.order === 'desc' ? 'desc' : 'asc') as BaseSortOrder }))
    : [];

  return {
    ...obj,
    filters: Array.isArray(obj.filters) ? obj.filters : [],
    sort: sort.length > 0 ? sort : [{ field: 'name', order: 'asc' }],
    columns: columns.length > 0 ? columns : [...BASE_COLUMN_IDS],
    query: typeof obj.query === 'string' ? obj.query : '',
  };
}

export function serializeBaseConfig(config: BaseConfig): string {
  return JSON.stringify(config, null, 2);
}
