import React, { useState, useEffect, useRef } from 'react';
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
import { useVaultStore } from '../../stores/vaultStore';
import { useNoticeStore } from '../common/Notice';
import { useT } from '../../stores/localeStore';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';
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
  const [scale, setScale] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const fileName = filePath.split(/[/\\]/).pop() || t('image.defaultName');
  const formatTag = getImageFormatTag(fileName) || 'IMG';

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

    // Reset pan & zoom when file changes
    setScale(1);
    setPan({ x: 0, y: 0 });

    return () => {
      active = false;
    };
  }, [filePath]);

  // 2. Find file metadata (size) from fileTree
  useEffect(() => {
    const findSize = (items: FileItem[]): number | null => {
      for (const item of items) {
        if (item.path === filePath && item.size !== undefined) {
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

  // Pan controls
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom centered towards cursor
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const newScale = Math.min(Math.max(scale * factor, 0.1), 10);

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      // Compensate pan
      const newPanX = pan.x - mouseX * (factor - 1);
      const newPanY = pan.y - mouseY * (factor - 1);

      setPan({ x: newPanX, y: newPanY });
    }

    setScale(newScale);
  };

  const handleZoomIn = () => setScale((s) => Math.min(s * 1.25, 10));
  const handleZoomOut = () => setScale((s) => Math.max(s * 0.8, 0.1));
  const handleResetZoom = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  const handleFitZoom = () => {
    if (containerRef.current && dimensions) {
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = (rect.width - 80) / dimensions.width;
      const scaleY = (rect.height - 80) / dimensions.height;
      const fit = Math.min(Math.min(scaleX, scaleY), 1);
      setScale(Math.max(fit, 0.1));
      setPan({ x: 0, y: 0 });
    }
  };

  // Context menu actions
  const handleCopyImage = async () => {
    try {
      const blob = await getStorageAdapter().readBinary(filePath);
      let pngBlob = blob;

      if (blob.type !== 'image/png') {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = url;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        const converted = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, 'image/png')
        );
        if (converted) pngBlob = converted;
      }

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
      ]);
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
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      className="relative w-full h-full bg-obsidian-sidebar overflow-hidden select-none flex items-center justify-center cursor-grab active:cursor-grabbing"
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
        className="absolute top-4 right-4 flex items-center gap-1 bg-obsidian-sidebar/90 backdrop-blur-md border border-obsidian-border rounded-lg p-1 shadow-xl z-20"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Tooltip content={t('image.zoomIn')} position="bottom">
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-obsidian-text hover:text-obsidian-text hover:bg-obsidian-active rounded transition-colors"
          >
            <ZoomIn size={16} />
          </button>
        </Tooltip>
        <Tooltip content={t('image.zoomOut')} position="bottom">
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-obsidian-text hover:text-obsidian-text hover:bg-obsidian-active rounded transition-colors"
          >
            <ZoomOut size={16} />
          </button>
        </Tooltip>
        <div className="w-[1px] h-4 bg-[var(--interactive-normal)] mx-0.5" />
        <Tooltip content={t('image.resetZoom')} position="bottom">
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 text-xs font-mono text-obsidian-text hover:text-obsidian-text hover:bg-obsidian-active rounded transition-colors"
          >
            {Math.round(scale * 100)}%
          </button>
        </Tooltip>
        <Tooltip content={t('image.zoomToFit')} position="bottom">
          <button
            onClick={handleFitZoom}
            className="p-1.5 text-obsidian-text hover:text-obsidian-text hover:bg-obsidian-active rounded transition-colors"
          >
            <Maximize2 size={15} />
          </button>
        </Tooltip>
      </div>

      {/* Status Bar Floating Bottom-Center */}
      <div
        className="absolute bottom-4 flex items-center gap-3 bg-obsidian-bg/90 backdrop-blur-md border border-obsidian-border rounded-full px-4 py-1.5 text-xs text-obsidian-text shadow-xl z-20 select-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="font-semibold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded text-[10px] tracking-wider uppercase border border-orange-500/20">
          {formatTag}
        </span>
        <span className="truncate max-w-[200px] text-obsidian-text" title={fileName}>
          {fileName}
        </span>
        {dimensions && (
          <span className="text-obsidian-muted font-mono">
            {dimensions.width} × {dimensions.height} px
          </span>
        )}
        {fileSizeBytes !== null && (
          <span className="text-obsidian-muted font-mono">
            {formatFileSize(fileSizeBytes)}
          </span>
        )}
        <span className="text-obsidian-faint">|</span>
        <span className="text-obsidian-muted font-mono">
          {Math.round(scale * 100)}%
        </span>
      </div>

      {/* Right Click Context Menu */}
      {contextMenu && (
        <ObsidianMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
