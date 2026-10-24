import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useT } from '../../stores/localeStore';

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
 * Full-screen image viewer (Obsidian's `.lightbox`).
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
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const activeImage = images[index];

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
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

  // Wheel zoom: scale around the pointer so the pixel under the cursor stays put
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2;

    setScale((prev) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const ratio = next / prev;
      setOffset((o) => ({ x: px - (px - o.x) * ratio, y: py - (py - o.y) * ratio }));
      return next;
    });
  };

  const handleDoubleClick = () => {
    if (scale === 1) {
      setScale(2);
    } else {
      reset();
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  // Panning listeners live on window so the drag survives leaving the image
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const { x, y, ox, oy } = panStartRef.current;
      setOffset({ x: ox + (e.clientX - x), y: oy + (e.clientY - y) });
    };
    const onUp = () => setIsPanning(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning]);

  if (!activeImage) return null;

  const handleOpenInNewTab = () => {
    const path = activeImage.filePath;
    if (path && onOpenInNewTab) {
      onOpenInNewTab(path);
      onClose();
    }
  };

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onWheel={handleWheel}
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
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.25))}
        >
          <ZoomOut size={16} />
        </button>
        <span className="image-lightbox-zoom">{Math.round(scale * 100)}%</span>
        <button
          className="image-lightbox-action"
          title={t('lightbox.zoomIn')}
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.25))}
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
            // Ctrl/Cmd + click opens the file in a new leaf (Obsidian behaviour)
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
