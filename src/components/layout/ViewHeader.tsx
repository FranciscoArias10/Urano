import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Pencil,
  MoreVertical,
  Columns,
  Rows,
  FolderInput,
  Copy,
  Trash2,
  TextCursorInput,
  Link,
  FileText,
} from 'lucide-react';
import { ObsidianMenu, MenuItemData } from '../common/ObsidianMenu';

export type ViewMode = 'live-preview' | 'reading' | 'source';

interface ViewHeaderProps {
  /** Clean file name (without extension) */
  title: string;
  /** Full path of the active file, used to build the folder breadcrumb */
  filePath?: string;
  /** Folder breadcrumb segments (without the file name) */
  parentPath?: string[];
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  viewMode: ViewMode;
  onToggleViewMode: () => void;
  onRename?: (newTitle: string) => void | Promise<void>;
  onMoveFile?: () => void;
  onDuplicateFile?: () => void;
  onDeleteFile?: () => void;
  onCopyLink?: () => void;
  onCopyPath?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
}

export const ViewHeader: React.FC<ViewHeaderProps> = ({
  title,
  parentPath,
  canGoBack,
  canGoForward,
  onNavigateBack,
  onNavigateForward,
  viewMode,
  onToggleViewMode,
  onRename,
  onMoveFile,
  onDuplicateFile,
  onDeleteFile,
  onCopyLink,
  onCopyPath,
  onSplitRight,
  onSplitDown,
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  /* --------------------------------------------------------------- *
   * Inline rename
   * --------------------------------------------------------------- */
  const commitRename = () => {
    const next = draft.trim();
    setIsRenaming(false);
    if (!next || next === title) return;
    onRename?.(next);
  };

  const cancelRename = () => {
    setDraft(title);
    setIsRenaming(false);
  };

  /* --------------------------------------------------------------- *
   * View actions menu (⋮)
   * --------------------------------------------------------------- */
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.left - 170, y: rect.bottom + 6 });
  };

  const menuItems: MenuItemData[] = [
    {
      title: 'Dividir a la derecha',
      icon: <Columns size={14} />,
      action: () => onSplitRight?.(),
    },
    {
      title: 'Dividir abajo',
      icon: <Rows size={14} />,
      action: () => onSplitDown?.(),
    },
    { type: 'separator' },
    {
      title: 'Cambiar nombre...',
      icon: <TextCursorInput size={14} />,
      action: () => setIsRenaming(true),
    },
    {
      title: 'Mover archivo a...',
      icon: <FolderInput size={14} />,
      action: () => onMoveFile?.(),
    },
    {
      title: 'Hacer una copia',
      icon: <Copy size={14} />,
      action: () => onDuplicateFile?.(),
    },
    { type: 'separator' },
    {
      title: 'Copiar enlace de Urano',
      icon: <Link size={14} />,
      action: () => onCopyLink?.(),
    },
    {
      title: 'Copiar ruta de archivo',
      icon: <FileText size={14} />,
      action: () => onCopyPath?.(),
    },
    { type: 'separator' },
    {
      title: 'Eliminar archivo',
      icon: <Trash2 size={14} />,
      isWarning: true,
      action: () => onDeleteFile?.(),
    },
  ];

  const isReading = viewMode === 'reading';

  return (
    <div className="view-header">
      {/* Left: navigation arrows -------------------------------------- */}
      <div className="view-header-left">
        <div className="view-header-nav-buttons">
          <button
            type="button"
            className="view-header-nav-button"
            title="Atrás (Alt+←)"
            aria-label="Atrás"
            aria-disabled={!canGoBack}
            disabled={!canGoBack}
            onClick={() => canGoBack && onNavigateBack()}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="view-header-nav-button"
            title="Adelante (Alt+→)"
            aria-label="Adelante"
            aria-disabled={!canGoForward}
            disabled={!canGoForward}
            onClick={() => canGoForward && onNavigateForward()}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* Title (click to rename inline) -------------------------------- */}
      <div className="view-header-title-container">
        {parentPath && parentPath.length > 0 && (
          <div className="view-header-title-parent">
            {parentPath.map((segment, index) => (
              <React.Fragment key={`${segment}-${index}`}>
                {index > 0 && <span className="view-header-breadcrumb-separator">/</span>}
                <span className="view-header-breadcrumb">{segment}</span>
              </React.Fragment>
            ))}
            <span className="view-header-breadcrumb-separator">/</span>
          </div>
        )}

        {isRenaming ? (
          <input
            ref={inputRef}
            className="view-header-title-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="view-header-title"
            title="Haz clic para renombrar"
            onClick={() => setIsRenaming(true)}
          >
            {title}
          </div>
        )}
      </div>

      {/* Right: view actions ------------------------------------------- */}
      <div className="view-actions">
        <button
          type="button"
          className="view-action"
          title={
            isReading
              ? 'Cambiar a Live Preview (Ctrl+E)'
              : 'Alternar Vista de Lectura (Ctrl+E)'
          }
          aria-label={isReading ? 'Cambiar a Live Preview' : 'Alternar Vista de Lectura'}
          onClick={onToggleViewMode}
        >
          {isReading ? <Pencil size={16} /> : <BookOpen size={16} />}
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          className="view-action"
          title="Más opciones"
          aria-label="Más opciones"
          onClick={openMenu}
        >
          <MoreVertical size={16} />
        </button>
      </div>

      {menu && (
        <ObsidianMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
};
