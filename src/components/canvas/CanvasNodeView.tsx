import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  ExternalLink,
  CheckSquare,
  Square,
  Globe,
} from 'lucide-react';
import { CanvasNode, CanvasNodeSide } from '../../types/canvas';
import { CANVAS_COLORS, DEFAULT_COLOR } from './canvasMath';
import { useVaultStore } from '../../stores/vaultStore';

interface CanvasNodeViewProps {
  node: CanvasNode;
  isSelected: boolean;
  isDragging: boolean;
  readonly: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onStartDrag: (e: React.MouseEvent) => void;
  onStartResize: (e: React.MouseEvent, handle: string) => void;
  onStartConnect: (e: React.MouseEvent, side: CanvasNodeSide) => void;
  onUpdateText: (nodeId: string, text: string) => void;
  onUpdateGroupLabel?: (nodeId: string, label: string) => void;
  onOpenFile?: (filePath: string) => void;
  isEditingText?: boolean;
  setIsEditingText?: (editing: boolean) => void;
}

export const CanvasNodeView: React.FC<CanvasNodeViewProps> = ({
  node,
  isSelected,
  isDragging,
  readonly,
  onSelect,
  onStartDrag,
  onStartResize,
  onStartConnect,
  onUpdateText,
  onUpdateGroupLabel,
  onOpenFile,
  isEditingText: parentIsEditing,
  setIsEditingText: parentSetIsEditing,
}) => {
  const [localIsEditing, setLocalIsEditing] = useState(false);
  const isEditing = parentIsEditing !== undefined ? parentIsEditing : localIsEditing;
  const setIsEditing = parentSetIsEditing || setLocalIsEditing;

  const [editText, setEditText] = useState(node.type === 'text' ? node.text : '');
  const [groupLabelEdit, setGroupLabelEdit] = useState(node.type === 'group' ? node.label || 'Grupo' : '');
  const [isEditingGroupLabel, setIsEditingGroupLabel] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { notesContentMap } = useVaultStore();

  const colorScheme = node.color && CANVAS_COLORS[node.color] ? CANVAS_COLORS[node.color] : DEFAULT_COLOR;

  useEffect(() => {
    if (node.type === 'text') {
      setEditText(node.text);
    }
  }, [node]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleTextBlur = () => {
    setIsEditing(false);
    onUpdateText(node.id, editText);
  };

  const handleGroupLabelBlur = () => {
    setIsEditingGroupLabel(false);
    if (onUpdateGroupLabel) {
      onUpdateGroupLabel(node.id, groupLabelEdit);
    }
  };

  // Simple clean markdown parser for text nodes
  const renderMarkdown = (text: string) => {
    if (!text.trim()) {
      return <span className="text-stone-500 italic">Doble clic para escribir...</span>;
    }

    const lines = text.split('\n');
    return lines.map((line, i) => {
      // Headings
      if (line.startsWith('# ')) {
        return (
          <h1 key={i} className="text-lg font-bold text-white my-1">
            {line.slice(2)}
          </h1>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h2 key={i} className="text-base font-semibold text-white my-1">
            {line.slice(3)}
          </h2>
        );
      }
      if (line.startsWith('### ')) {
        return (
          <h3 key={i} className="text-sm font-semibold text-stone-200 my-0.5">
            {line.slice(4)}
          </h3>
        );
      }

      // Checklists
      if (line.startsWith('- [ ] ')) {
        return (
          <div key={i} className="flex items-center gap-1.5 my-0.5 text-xs text-stone-300">
            <Square size={13} className="text-stone-500 shrink-0" />
            <span>{line.slice(6)}</span>
          </div>
        );
      }
      if (line.startsWith('- [x] ') || line.startsWith('- [X] ')) {
        return (
          <div key={i} className="flex items-center gap-1.5 my-0.5 text-xs text-stone-500 line-through">
            <CheckSquare size={13} className="text-orange-500 shrink-0" />
            <span>{line.slice(6)}</span>
          </div>
        );
      }

      // Bullet lists
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <div key={i} className="flex items-start gap-1.5 ml-2 my-0.5 text-xs text-stone-300">
            <span className="text-stone-500 mt-1">•</span>
            <span>{line.slice(2)}</span>
          </div>
        );
      }

      // Wikilinks, bold, code inside line
      const formatted = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code class="bg-[#2c2c2c] px-1 py-0.5 rounded text-orange-300 font-mono text-[11px]">$1</code>')
        .replace(/\[\[(.*?)\]\]/g, '<span class="text-orange-400 font-medium underline cursor-pointer">$1</span>');

      return (
        <p
          key={i}
          className="my-0.5 min-h-[1.2em]"
          dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }}
        />
      );
    });
  };

  const isGroup = node.type === 'group';

  return (
    <div
      className={`canvas-node ${isGroup ? 'canvas-node-group' : ''} ${
        isSelected ? 'is-selected' : ''
      } ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        zIndex: isGroup ? 1 : isSelected ? 30 : 5,
      }}
      onClick={onSelect}
      onMouseDown={(e) => {
        if (!readonly && !isEditing) {
          onStartDrag(e);
        }
      }}
    >
      {/* Group Title Tab on top-left */}
      {isGroup && (
        <div
          className="canvas-group-label"
          style={{
            borderColor: colorScheme.border,
            backgroundColor: colorScheme.hex !== DEFAULT_COLOR.hex ? colorScheme.hex : '#262626',
            color: colorScheme.hex !== DEFAULT_COLOR.hex ? '#ffffff' : '#b0b0b0',
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!readonly) setIsEditingGroupLabel(true);
          }}
        >
          {isEditingGroupLabel ? (
            <input
              type="text"
              autoFocus
              value={groupLabelEdit}
              onChange={(e) => setGroupLabelEdit(e.target.value)}
              onBlur={handleGroupLabelBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGroupLabelBlur();
              }}
              className="bg-transparent text-white outline-none font-semibold text-xs min-w-[80px]"
            />
          ) : (
            <span>{node.label || 'Grupo'}</span>
          )}
        </div>
      )}

      {/* Main Node Container */}
      <div
        className="canvas-node-container"
        style={{
          borderColor: isSelected ? 'var(--color-accent)' : colorScheme.border,
          backgroundColor: isGroup ? 'transparent' : colorScheme.bg,
        }}
      >
        {/* Node Content based on type */}
        <div
          className="canvas-node-content"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!readonly && node.type === 'text') {
              setIsEditing(true);
            }
          }}
        >
          {/* TYPE: TEXT */}
          {node.type === 'text' && (
            isEditing ? (
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleTextBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleTextBlur();
                }}
                className="w-full h-full bg-transparent text-white text-xs resize-none outline-none font-sans leading-relaxed p-0"
                placeholder="Escribe en Markdown..."
              />
            ) : (
              <div className="w-full h-full select-none cursor-default font-sans text-xs">
                {renderMarkdown(node.text)}
              </div>
            )
          )}

          {/* TYPE: FILE (Vault note) */}
          {node.type === 'file' && (
            <div className="w-full h-full flex flex-col -m-3.5">
              <div className="canvas-file-header flex items-center justify-between px-3 py-1.5 border-b border-[#2e2e2e] bg-[#222222]">
                <div className="flex items-center gap-1.5 truncate">
                  <FileText size={13} className="text-orange-400 shrink-0" />
                  <span className="truncate text-xs font-medium text-stone-200">
                    {node.file.split('/').pop()?.replace(/\.md$/i, '') || node.file}
                  </span>
                </div>
                {onOpenFile && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFile(node.file);
                    }}
                    className="p-1 text-stone-400 hover:text-white rounded hover:bg-stone-700/50"
                    title="Abrir nota en pestaña"
                  >
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>
              <div className="p-3 overflow-y-auto flex-1 text-xs text-stone-300 font-sans">
                {renderMarkdown(notesContentMap[node.file] || 'Cargando nota...')}
              </div>
            </div>
          )}

          {/* TYPE: LINK */}
          {node.type === 'link' && (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-2">
              {node.url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) ? (
                <img
                  src={node.url}
                  alt="Link media"
                  className="max-w-full max-h-full object-contain rounded"
                />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Globe size={32} className="text-orange-400 opacity-80" />
                  <a
                    href={node.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-orange-400 hover:underline break-all max-w-[200px]"
                  >
                    {node.url}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* TYPE: GROUP */}
          {node.type === 'group' && (
            <div className="w-full h-full pointer-events-none" />
          )}
        </div>
      </div>

      {/* 8 Resizers (Active when node is selected and not readonly) */}
      {isSelected && !readonly && (
        <>
          <div
            className="canvas-node-resizer"
            data-resize="top"
            onMouseDown={(e) => onStartResize(e, 'top')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="bottom"
            onMouseDown={(e) => onStartResize(e, 'bottom')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="left"
            onMouseDown={(e) => onStartResize(e, 'left')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="right"
            onMouseDown={(e) => onStartResize(e, 'right')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="topleft"
            onMouseDown={(e) => onStartResize(e, 'topleft')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="topright"
            onMouseDown={(e) => onStartResize(e, 'topright')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="bottomleft"
            onMouseDown={(e) => onStartResize(e, 'bottomleft')}
          />
          <div
            className="canvas-node-resizer"
            data-resize="bottomright"
            onMouseDown={(e) => onStartResize(e, 'bottomright')}
          />
        </>
      )}

      {/* 4 Connection Points (hover to show, drag to connect) */}
      {!readonly && !isGroup && (
        <>
          <div
            className="canvas-node-connection-point"
            data-side="top"
            title="Conectar"
            onMouseDown={(e) => onStartConnect(e, 'top')}
          />
          <div
            className="canvas-node-connection-point"
            data-side="right"
            title="Conectar"
            onMouseDown={(e) => onStartConnect(e, 'right')}
          />
          <div
            className="canvas-node-connection-point"
            data-side="bottom"
            title="Conectar"
            onMouseDown={(e) => onStartConnect(e, 'bottom')}
          />
          <div
            className="canvas-node-connection-point"
            data-side="left"
            title="Conectar"
            onMouseDown={(e) => onStartConnect(e, 'left')}
          />
        </>
      )}
    </div>
  );
};
