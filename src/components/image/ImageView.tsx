import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Copy,
  Trash2,
} from 'lucide-react';
import {
  getStorageAdapter,
  getImageFormatTag,
} from '../../services/storageAdapter';
import {
  loadImageBlobFromSource,
  copyImageBlobToClipboard,
} from '../../editor/imageExtension';
import { isSamePath } from '../../utils/pathUtils';
import {
  computeWheelZoomState,
  clampImagePan,
  ZoomViewState,
  ZoomBoundsInput,
} from '../../utils/imageZoomUtils';
import { useVaultStore } from '../../stores/vaultStore';
import { useNoticeStore } from '../common/Notice';
import { useT } from '../../stores/localeStore';
import { UranoMenu, MenuItemData } from '../common/UranoMenu';
import { Tooltip } from '../common/Tooltip';
import { FileItem } from '../../types';

interface ImageViewProps {
  filePath: string;
}

export const ImageView: React.FC<ImageViewProps> = ({ filePath }) => {
  const { fileTree, deleteItem } = useVaultStore();
  const { showNotice } = useNoticeStore();
  const t = useT();

  const [imageUrl, setImageUrl] = useState<string>('');
  const [viewState, setViewState] = useState<ZoomViewState>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });
  const scale = viewState.scale;
  const pan = viewState.offset;
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const fileName = filePath.split(/[/\\]/).pop() || t('image.defaultName');
  const formatTag = getImageFormatTag(fileName) || 'IMG';

  const getZoomBounds = useCallback((): ZoomBoundsInput | undefined => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      baseWidth: imgRef.current?.offsetWidth || dimensions?.width,
      baseHeight: imgRef.current?.offsetHeight || dimensions?.height,
      minScale: 0.1,
      maxScale: 10,
    };
  }, [dimensions]);

  // 1. Resolve image url through StorageAdapter
  useEffect(() => {
    let active = true;
    const loadUrl = async () => {
      try {
        const url = await getStorageAdapter().getResourcePath(filePath);
        if (active) {
          setImageUrl(url);
        }
      } catch (err) {
        console.error('Error loading image in ImageView:', err);
      }
    };
    loadUrl();

    // Reset dimensions, pan & zoom when file changes
    setDimensions(null);
    setViewState({ scale: 1, offset: { x: 0, y: 0 } });

    return () => {
      active = false;
    };
  }, [filePath]);

  // 2. Find file metadata (size) from fileTree
  useEffect(() => {
    const findSize = (items: FileItem[]): number | null => {
      for (const item of items) {
        if (isSamePath(item.path, filePath) && item.size !== undefined) {
          return item.size;
        }
        if (item.children) {
          const res = findSize(item.children);
          if (res !== null) return res;
        }
      }
      return null;
    };
    const size = findSize(fileTree);
    setFileSizeBytes(size);
  }, [fileTree, filePath]);

  const formatFileSize = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Image load event to measure natural dimensions
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  };

  // Pan controls (window listeners keep drag active even outside container)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      setIsDragging(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const bounds = getZoomBounds();
      const raw = {
        x: panStartRef.current.ox + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.oy + (e.clientY - panStartRef.current.y),
      };
      setViewState((prev) => ({
        ...prev,
        offset: clampImagePan(raw, prev.scale, bounds),
      }));
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, getZoomBounds]);

  // Non-passive wheel zoom centered towards cursor without drift at scale limits
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const bounds = getZoomBounds();
      setViewState((prev) => computeWheelZoomState(prev, e.deltaY, mouseX, mouseY, bounds));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [getZoomBounds]);

  const handleZoomIn = () =>
    setViewState((prev) => computeWheelZoomState(prev, -1, 0, 0, getZoomBounds(), 1.25, 0.8));
  const handleZoomOut = () =>
    setViewState((prev) => computeWheelZoomState(prev, 1, 0, 0, getZoomBounds(), 1.25, 0.8));
  const handleResetZoom = () => setViewState({ scale: 1, offset: { x: 0, y: 0 } });
  const handleFitZoom = () => {
    if (containerRef.current && dimensions) {
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = (rect.width - 80) / dimensions.width;
      const scaleY = (rect.height - 80) / dimensions.height;
      const fit = Math.min(Math.min(scaleX, scaleY), 1);
      setViewState({ scale: Math.max(fit, 0.1), offset: { x: 0, y: 0 } });
    }
  };

  // Context menu actions
  const handleCopyImage = async () => {
    try {
      const blob = await loadImageBlobFromSource(imageUrl, filePath);
      await copyImageBlobToClipboard(blob);
      showNotice(t('image.notices.copied'), 2000, 'success');
    } catch (err) {
      console.error('Error copying image:', err);
      showNotice(t('image.notices.copyError'), 2500, 'error');
    }
  };

  const menuItems: MenuItemData[] = [
    {
      title: t('image.copyImage'),
      icon: <Copy size={14} />,
      action: handleCopyImage,
    },
    { type: 'separator' },
    {
      title: t('image.resetZoom'),
      icon: <RotateCcw size={14} />,
      action: handleResetZoom,
    },
    {
      title: t('image.zoomToFit'),
      icon: <Maximize2 size={14} />,
      action: handleFitZoom,
    },
    { type: 'separator' },
    {
      title: t('image.deleteFile'),
      icon: <Trash2 size={14} />,
      isWarning: true,
      action: async () => {
        await deleteItem(filePath);
        showNotice(t('image.notices.deleted'), 2000, 'info');
      },
    },
  ];

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      className="relative w-full h-full bg-urano-sidebar overflow-hidden select-none flex items-center justify-center cursor-grab active:cursor-grabbing"
      style={{
        backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Centered Image */}
      {imageUrl && (
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.08s ease-out',
            transformOrigin: 'center center',
          }}
          className="flex items-center justify-center max-w-none max-h-none pointer-events-none"
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt={fileName}
            onLoad={handleImageLoad}
            draggable={false}
            className="shadow-2xl rounded-sm object-contain select-none max-w-none max-h-none"
            style={{
              imageRendering: scale > 2 ? 'pixelated' : 'auto',
            }}
          />
        </div>
      )}

      {/* Floating Controls Top-Right */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1 bg-urano-sidebar/90 backdrop-blur-md border border-urano-border rounded-lg p-1 shadow-xl z-20"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Tooltip content={t('image.zoomIn')} position="bottom">
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-urano-text hover:text-urano-text hover:bg-urano-active rounded transition-colors"
          >
            <ZoomIn size={16} />
          </button>
        </Tooltip>
        <Tooltip content={t('image.zoomOut')} position="bottom">
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-urano-text hover:text-urano-text hover:bg-urano-active rounded transition-colors"
          >
            <ZoomOut size={16} />
          </button>
        </Tooltip>
        <div className="w-[1px] h-4 bg-[var(--interactive-normal)] mx-0.5" />
        <Tooltip content={t('image.resetZoom')} position="bottom">
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 text-xs font-mono text-urano-text hover:text-urano-text hover:bg-urano-active rounded transition-colors"
          >
            {Math.round(scale * 100)}%
          </button>
        </Tooltip>
        <Tooltip content={t('image.zoomToFit')} position="bottom">
          <button
            onClick={handleFitZoom}
            className="p-1.5 text-urano-text hover:text-urano-text hover:bg-urano-active rounded transition-colors"
          >
            <Maximize2 size={15} />
          </button>
        </Tooltip>
      </div>

      {/* Status Bar Floating Bottom-Center */}
      <div
        className="absolute bottom-4 flex items-center gap-3 bg-urano-bg/90 backdrop-blur-md border border-urano-border rounded-full px-4 py-1.5 text-xs text-urano-text shadow-xl z-20 select-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded text-[10px] tracking-wider uppercase border border-orange-500/20">
          {formatTag}
        </span>
        <span className="truncate max-w-[200px] text-urano-text" title={fileName}>
          {fileName}
        </span>
        {dimensions && (
          <span className="text-urano-muted font-mono">
            {dimensions.width} × {dimensions.height} px
          </span>
        )}
        {fileSizeBytes !== null && (
          <span className="text-urano-muted font-mono">
            {formatFileSize(fileSizeBytes)}
          </span>
        )}
        <span className="text-urano-faint">|</span>
        <span className="text-urano-muted font-mono">
          {Math.round(scale * 100)}%
        </span>
      </div>

      {/* Right Click Context Menu */}
      {contextMenu && (
        <UranoMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
