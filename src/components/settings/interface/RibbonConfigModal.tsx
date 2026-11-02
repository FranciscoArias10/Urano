import React, { useEffect, useState } from 'react';
import {
  X,
  GripVertical,
  ChevronUp,
  ChevronDown,
  FileSearch,
  GitFork,
  Grid2X2,
  Calendar,
  Copy,
  Terminal,
  LayoutList,
  RefreshCw,
  SlidersVertical,
} from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useT } from '../../../stores/localeStore';
import { Toggle } from '../SettingControls';

export interface RibbonConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RibbonItemMeta {
  id: string;
  nameKey: string;
  icon: React.ReactNode;
}

const RIBBON_META: Record<string, RibbonItemMeta> = {
  switcher: {
    id: 'switcher',
    nameKey: 'app.ribbon.openQuickSwitcher',
    icon: <FileSearch size={18} />,
  },
  graph: {
    id: 'graph',
    nameKey: 'app.ribbon.openGraphView',
    icon: <GitFork size={18} />,
  },
  canvas: {
    id: 'canvas',
    nameKey: 'app.ribbon.createNewCanvas',
    icon: <Grid2X2 size={18} />,
  },
  'daily-notes': {
    id: 'daily-notes',
    nameKey: 'app.ribbon.openDailyNote',
    icon: <Calendar size={18} />,
  },
  templates: {
    id: 'templates',
    nameKey: 'app.ribbon.insertTemplate',
    icon: <Copy size={18} />,
  },
  'command-palette': {
    id: 'command-palette',
    nameKey: 'app.ribbon.openCommandPalette',
    icon: <Terminal size={18} />,
  },
  bases: {
    id: 'bases',
    nameKey: 'app.ribbon.createNewBase',
    icon: <LayoutList size={18} />,
  },
  sync: {
    id: 'sync',
    nameKey: 'app.ribbon.syncNow',
    icon: <RefreshCw size={18} />,
  },
};

export const RibbonConfigModal: React.FC<RibbonConfigModalProps> = ({
  isOpen,
  onClose,
}) => {
  const t = useT();
  const ribbonItems = useSettingsStore((s) => s.settings.ribbonItems);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleToggle = (id: string, visible: boolean) => {
    const updated = ribbonItems.map((item) =>
      item.id === id ? { ...item, visible } : item
    );
    setSetting('ribbonItems', updated);
  };

  const moveItem = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= ribbonItems.length || toIdx >= ribbonItems.length) {
      return;
    }
    const updated = [...ribbonItems];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setSetting('ribbonItems', updated);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      moveItem(draggedIndex, targetIndex);
    }
    setDraggedIndex(null);
  };

  const activeItems = ribbonItems
    .map((item, index) => ({ ...item, originalIndex: index }))
    .filter((item) => item.visible);

  const inactiveItems = ribbonItems
    .map((item, index) => ({ ...item, originalIndex: index }))
    .filter((item) => !item.visible);

  return (
    <div
      className="urano-settings-root modal-container mod-dim"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal modal-sub-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90vw',
          maxWidth: '580px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--background-secondary, var(--background-primary))',
          border: '1px solid var(--background-modifier-border)',
          borderRadius: '12px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-5 py-4 shrink-0"
          style={{
            borderBottom: '1px solid var(--background-modifier-border)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <SlidersVertical size={18} className="text-[var(--interactive-accent)]" />
            <div>
              <h2 className="text-base font-semibold text-[var(--text-normal)] m-0">
                {t('settings.interface.ribbonModalTitle')}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="clickable-icon p-1.5 text-[var(--text-muted)] hover:text-[var(--text-normal)] transition-colors rounded"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Description Subtitle */}
        <div className="px-5 py-3 border-b border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] text-xs text-[var(--text-muted)] leading-relaxed">
          {t('settings.interface.ribbonModalDesc')}
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Active Items Section */}
          <div className="setting-items-card rounded-lg overflow-hidden border border-[var(--background-modifier-border)] bg-[var(--background-primary)]">
            {activeItems.map((item, idx) => {
              const meta = RIBBON_META[item.id];
              const title = meta ? t(meta.nameKey) : item.id;
              const isFirst = idx === 0;
              const isLast = idx === activeItems.length - 1;

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.originalIndex)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, item.originalIndex)}
                  onDragEnd={() => setDraggedIndex(null)}
                  className={`flex items-center justify-between px-3 py-2.5 gap-2 transition-colors border-b last:border-b-0 border-[var(--background-modifier-border)] hover:bg-[var(--background-modifier-hover)] ${
                    draggedIndex === item.originalIndex ? 'opacity-40 bg-[var(--background-modifier-active-hover)]' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="text-[var(--text-faint)] cursor-grab active:cursor-grabbing hover:text-[var(--text-normal)] transition-colors p-1"
                      title={t('common.dragToRearrange') || 'Arrastra para reordenar'}
                    >
                      <GripVertical size={16} />
                    </span>
                    <span className="text-[var(--text-muted)] shrink-0">
                      {meta?.icon}
                    </span>
                    <span className="text-[13px] font-medium text-[var(--text-normal)] truncate">
                      {title}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={isFirst}
                      onClick={() => {
                        const targetItem = activeItems[idx - 1];
                        if (targetItem) moveItem(item.originalIndex, targetItem.originalIndex);
                      }}
                      className="clickable-icon p-1 text-[var(--text-muted)] hover:text-[var(--text-normal)] disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                      title="Subir"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => {
                        const targetItem = activeItems[idx + 1];
                        if (targetItem) moveItem(item.originalIndex, targetItem.originalIndex);
                      }}
                      className="clickable-icon p-1 text-[var(--text-muted)] hover:text-[var(--text-normal)] disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                      title="Bajar"
                    >
                      <ChevronDown size={16} />
                    </button>
                    <div className="ml-2">
                      <Toggle
                        value={item.visible}
                        onChange={(visible) => handleToggle(item.id, visible)}
                        ariaLabel={title}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inactive Items Section */}
          {inactiveItems.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1 m-0">
                {t('settings.interface.otherRibbonItems')}
              </h3>
              <div className="setting-items-card rounded-lg overflow-hidden border border-[var(--background-modifier-border)] bg-[var(--background-primary)] opacity-85">
                {inactiveItems.map((item) => {
                  const meta = RIBBON_META[item.id];
                  const title = meta ? t(meta.nameKey) : item.id;

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-3 py-2.5 gap-2 transition-colors border-b last:border-b-0 border-[var(--background-modifier-border)] hover:bg-[var(--background-modifier-hover)]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[var(--text-faint)] shrink-0 ml-1">
                          {meta?.icon}
                        </span>
                        <span className="text-[13px] text-[var(--text-muted)] truncate">
                          {title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Toggle
                          value={item.visible}
                          onChange={(visible) => handleToggle(item.id, visible)}
                          ariaLabel={title}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
