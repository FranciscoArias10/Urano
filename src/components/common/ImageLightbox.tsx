import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useT } from '../../stores/localeStore';
import {
  computeWheelZoomState,
  clampImagePan,
  ZoomViewState,
  ZoomBoundsInput,
} from '../../utils/imageZoomUtils';

export function shouldCloseLightboxOnBackdropClick(
  backdropMouseDown: boolean,
  suppressAfterPan: boolean
): boolean {
  return backdropMouseDown && !suppressAfterPan;
}

export interface LightboxImage {
  src: string;
  alt?: string;
  /** Absolute file path inside the vault (used by "Open in new tab"). */
  filePath?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  activeIndex: number;
  onClose: () => void;
  /** Ctrl/Cmd + click (or the toolbar button) opens the file in a new leaf. */
  onOpenInNewTab?: (filePath: string) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

/**
 * Full-screen image viewer (Urano's `.lightbox`).
 *
 * Interaction model:
 * - mouse wheel zooms towards the cursor, clamped to [MIN_SCALE, MAX_SCALE]
 * - drag to pan once zoomed in
 * - double click toggles between fit and 2x
 * - click on the background or Escape closes the overlay
 * - Ctrl/Cmd + click (or the toolbar button) opens the file in a new tab
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  images,
  activeIndex,
  onClose,
  onOpenInNewTab,
}) => {
  const t = useT();
  const [index, setIndex] = useState(activeIndex);
  const [viewState, setViewState] = useState<ZoomViewState>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });
  const scale = viewState.scale;
  const offset = viewState.offset;
  const [isPanning, setIsPanning] = useState(false);

  const lightboxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const backdropMouseDownRef = useRef(false);
  const suppressNextBackdropClickRef = useRef(false);
  const activeImage = images[index];

  const reset = useCallback(() => {
    setViewState({ scale: 1, offset: { x: 0, y: 0 } });
  }, []);

  const getZoomBounds = useCallback((): ZoomBoundsInput | undefined => {
    const rect = lightboxRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      baseWidth: imgRef.current?.offsetWidth || undefined,
      baseHeight: imgRef.current?.offsetHeight || undefined,
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
    };
  }, []);

  // Keep the rendered index in sync when the caller opens a different image
  useEffect(() => {
    setIndex(activeIndex);
    reset();
  }, [activeIndex, reset]);

  // Escape closes, arrow keys navigate between sibling images
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        e.preventDefault();
        setIndex((prev) => (prev + 1) % images.length);
        reset();
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        e.preventDefault();
        setIndex((prev) => (prev - 1 + images.length) % images.length);
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [images.length, onClose, reset]);

  // Non-passive wheel zoom: single atomic state update prevents StrictMode double-pan
  useEffect(() => {
    const el = lightboxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const bounds = getZoomBounds();
      setViewState((prev) => computeWheelZoomState(prev, e.deltaY, px, py, bounds));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [getZoomBounds, activeImage]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    if (viewState.scale === 1) {
      const rect = lightboxRef.current?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left - rect.width / 2 : 0;
      const py = rect ? e.clientY - rect.top - rect.height / 2 : 0;
      setViewState((prev) =>
        computeWheelZoomState(prev, -1, px, py, getZoomBounds(), 2, 0.5)
      );
    } else {
      reset();
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.stopPropagation();
    backdropMouseDownRef.current = false;
    suppressNextBackdropClickRef.current = true;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  // Panning listeners live on window so the drag survives leaving the image
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const bounds = getZoomBounds();
      const { x, y, ox, oy } = panStartRef.current;
      const raw = { x: ox + (e.clientX - x), y: oy + (e.clientY - y) };
      setViewState((prev) => ({
        ...prev,
        offset: clampImagePan(raw, prev.scale, bounds),
      }));
    };
    const onUp = () => setIsPanning(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning, getZoomBounds]);

  if (!activeImage) return null;

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isBackdrop =
      target === e.currentTarget ||
      target.classList.contains('image-lightbox-bg') ||
      target.classList.contains('image-lightbox-media');
    backdropMouseDownRef.current = isBackdrop;
    if (isBackdrop) {
      suppressNextBackdropClickRef.current = false;
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const shouldClose = shouldCloseLightboxOnBackdropClick(
      backdropMouseDownRef.current,
      suppressNextBackdropClickRef.current
    );
    backdropMouseDownRef.current = false;
    suppressNextBackdropClickRef.current = false;
    if (shouldClose && e.target !== imgRef.current) {
      onClose();
    }
  };

  const handleOpenInNewTab = () => {
    const path = activeImage.filePath;
    if (path && onOpenInNewTab) {
      onOpenInNewTab(path);
      onClose();
    }
  };

  return (
    <div
      ref={lightboxRef}
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div className="image-lightbox-bg" />

      {/* Titlebar (filename) */}
      <div className="image-lightbox-titlebar">
        <span className="image-lightbox-title">
          {activeImage.alt || activeImage.filePath?.split(/[/\\]/).pop() || t('lightbox.defaultName')}
        </span>
      </div>

      {/* Controls */}
      <div className="image-lightbox-controls" onClick={(e) => e.stopPropagation()}>
        <button
          className="image-lightbox-action"
          title={t('lightbox.zoomOut')}
          onClick={() =>
            setViewState((prev) =>
              computeWheelZoomState(prev, 1, 0, 0, getZoomBounds(), 1.25, 1 / 1.25)
            )
          }
        >
          <ZoomOut size={16} />
        </button>
        <span className="image-lightbox-zoom">{Math.round(scale * 100)}%</span>
        <button
          className="image-lightbox-action"
          title={t('lightbox.zoomIn')}
          onClick={() =>
            setViewState((prev) =>
              computeWheelZoomState(prev, -1, 0, 0, getZoomBounds(), 1.25, 1 / 1.25)
            )
          }
        >
          <ZoomIn size={16} />
        </button>
        <button className="image-lightbox-action" title={t('lightbox.reset')} onClick={reset}>
          <Maximize2 size={16} />
        </button>
        <button className="image-lightbox-action" title={t('lightbox.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {/* Media */}
      <div className="image-lightbox-media">
        <img
          ref={imgRef}
          src={activeImage.src}
          alt={activeImage.alt || ''}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: isPanning ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
            transition: isPanning ? 'none' : 'transform 0.12s ease-out',
          }}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          onClick={(e) => {
            e.stopPropagation();
            // Ctrl/Cmd + click opens the file in a new leaf (Urano behaviour)
            if ((e.ctrlKey || e.metaKey) && activeImage.filePath) {
              handleOpenInNewTab();
            }
          }}
        />
      </div>

      {/* Pager for documents with several images */}
      {images.length > 1 && (
        <div className="image-lightbox-pager" onClick={(e) => e.stopPropagation()}>
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
};
