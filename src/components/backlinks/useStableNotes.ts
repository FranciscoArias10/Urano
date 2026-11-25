import { useEffect, useRef, useState } from 'react';
import { isSamePath } from '../../utils/pathUtils';

function sameExceptActive(
  prev: Record<string, string>,
  next: Record<string, string>,
  activeFile: string | null
): boolean {
  const prevKeys = Object.keys(prev);
  if (prevKeys.length !== Object.keys(next).length) return false;
  for (const key of prevKeys) {
    if (activeFile && isSamePath(key, activeFile)) continue;
    if (!(key in next) || prev[key] !== next[key]) return false;
  }
  return true;
}

/**
 * Devuelve el mapa de contenido de notas con referencia estable mientras solo cambie la
 * nota activa. Los backlinks ignoran la nota activa, así que escribir en ella no debe
 * volver a escanear toda la bóveda en cada pulsación de tecla.
 */
export function useStableNotesContent(
  notesContentMap: Record<string, string>,
  activeFile: string | null
): Record<string, string> {
  const ref = useRef<{
    map: Record<string, string>;
    activeFile: string | null;
  }>({ map: notesContentMap, activeFile });

  const current = ref.current;
  if (
    current.map !== notesContentMap &&
    (current.activeFile !== activeFile || !sameExceptActive(current.map, notesContentMap, activeFile))
  ) {
    ref.current = { map: notesContentMap, activeFile };
  }
  return ref.current.map;
}

/** Valor con retardo: útil para cálculos costosos que dependen del texto que se está escribiendo. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
