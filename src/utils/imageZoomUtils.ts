export interface Point2D {
  x: number;
  y: number;
}

export interface ZoomViewState {
  scale: number;
  offset: Point2D;
}

export interface ZoomBoundsInput {
  viewportWidth: number;
  viewportHeight: number;
  baseWidth?: number;
  baseHeight?: number;
  minScale?: number;
  maxScale?: number;
}

export const DEFAULT_MIN_IMAGE_SCALE = 0.1;
export const DEFAULT_MAX_IMAGE_SCALE = 10;

/**
 * Clamps a pan offset so at least a usable portion of the image remains visible
 * inside the viewport (never lost off-screen even when zoomed in or out).
 */
export function clampImagePan(
  offset: Point2D,
  scale: number,
  bounds?: ZoomBoundsInput
): Point2D {
  if (!bounds || bounds.viewportWidth <= 0 || bounds.viewportHeight <= 0) {
    return offset;
  }

  const computeAxisLimit = (viewportSize: number, baseSize?: number): number => {
    if (baseSize && baseSize > 0) {
      const scaledSize = baseSize * scale;
      const minVisible = Math.min(scaledSize * 0.5, viewportSize * 0.5, 64);
      return Math.max(0, (viewportSize + scaledSize) / 2 - minVisible);
    }
    return Math.max(viewportSize * 0.5, (viewportSize * scale) / 2);
  };

  const maxX = computeAxisLimit(bounds.viewportWidth, bounds.baseWidth);
  const maxY = computeAxisLimit(bounds.viewportHeight, bounds.baseHeight);

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

/**
 * Computes next scale + pan offset when zooming toward `(pointerX, pointerY)`
 * relative to the container's center, assuming `transform: translate(x, y) scale(s)`
 * with `transform-origin: center center`.
 */
export function computeWheelZoomState(
  prev: ZoomViewState,
  deltaY: number,
  pointerX: number,
  pointerY: number,
  bounds?: ZoomBoundsInput,
  zoomInFactor = 1.15,
  zoomOutFactor = 1 / 1.15
): ZoomViewState {
  const minScale = bounds?.minScale ?? DEFAULT_MIN_IMAGE_SCALE;
  const maxScale = bounds?.maxScale ?? DEFAULT_MAX_IMAGE_SCALE;
  const factor = deltaY < 0 ? zoomInFactor : zoomOutFactor;
  const nextScale = Math.min(maxScale, Math.max(minScale, prev.scale * factor));
  const ratio = prev.scale > 0 ? nextScale / prev.scale : 1;

  const rawOffset: Point2D = {
    x: pointerX - (pointerX - prev.offset.x) * ratio,
    y: pointerY - (pointerY - prev.offset.y) * ratio,
  };

  return {
    scale: nextScale,
    offset: clampImagePan(rawOffset, nextScale, bounds),
  };
}

