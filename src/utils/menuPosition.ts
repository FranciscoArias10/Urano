import { useState, useLayoutEffect, RefObject } from 'react';

/**
 * Utilidad global de Viewport Clamping (1:1 con Urano).
 * Garantiza que cualquier menú contextual o popover posicionado por coordenadas (x, y)
 * jamás se salga por el borde derecho, izquierdo, superior o inferior de la ventana.
 */
export function clampToViewport(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  margin = 8
): { left: number; top: number } {
  const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuHeight - margin);
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop),
  };
}

export interface ClampedPositionOptions {
  margin?: number;
  align?: 'left' | 'right';
}

/**
 * Hook para medir el elemento de un menú o popover mediante useLayoutEffect
 * y ajustar automáticamente sus coordenadas (left, top) antes del pintado
 * para evitar parpadeos y desbordamientos en cualquier resolución.
 */
export function useViewportClampedPosition(
  menuRef: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  options?: ClampedPositionOptions
): { left: number; top: number } {
  const margin = options?.margin ?? 8;
  const align = options?.align ?? 'left';

  const [coords, setCoords] = useState<{ left: number; top: number }>(() => {
    const estimatedWidth = 200;
    const estimatedHeight = 180;
    const initialTargetX = align === 'right' ? x - estimatedWidth : x;
    return clampToViewport(initialTargetX, y, estimatedWidth, estimatedHeight, margin);
  });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const targetX = align === 'right' ? x - rect.width : x;
    const clamped = clampToViewport(targetX, y, rect.width, rect.height, margin);

    setCoords(clamped);
  }, [menuRef, x, y, margin, align]);

  return coords;
}
