import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Globe } from 'lucide-react';
import { CanvasNode, CanvasNodeSide } from '../../types/canvas';
import {
  DEFAULT_COLOR,
  isCustomCanvasColor,
  resolveCanvasColor,
} from './canvasMath';
import { useVaultStore } from '../../stores/vaultStore';
import { isImagePath } from '../../services/storageAdapter';
import { resolveImageBlobUrl } from '../../editor/imageExtension';
import { CanvasMarkdown } from './CanvasMarkdown';
import { CanvasFloatingMenu } from './CanvasFloatingMenu';

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
  /** Abre un wikilink embebido en el contenido de una nota. */
  onOpenLink?: (target: string) => void;
  isEditingText?: boolean;
  setIsEditingText?: (editing: boolean) => void;
  /** Elimina el nodo (botón "Eliminar" de la barra flotante). */
  onDeleteNode?: (nodeId: string) => void;
  /** Aplica uno de los 6 colores del Canvas (botón "Color"). */
  onSetNodeColor?: (nodeId: string, colorKey?: string) => void;
  /** Centra la cámara y ajusta el zoom para encuadrar el nodo. */
  onZoomToNode?: (nodeId: string) => void;
}

/** Extrae el nombre del archivo (con extensión) a partir de la ruta absoluta. */
function baseName(filePath: string): string {
  if (!filePath) return '';
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** Título legible de una nota (nombre sin extensión). */
function noteTitle(filePath: string): string {
  return baseName(filePath).replace(/\.md$/i, '');
}

/**
 * Controles que deben conservar su comportamiento nativo: nunca inician el
 * arrastre del nodo. El cuerpo de la tarjeta (texto, markdown, imagen) no está
 * incluido a propósito, para que un clic simple siempre pueda mover el nodo.
 */
function isInteractiveCanvasTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'textarea, input, select, button, a, [contenteditable="true"], .canvas-menu, .canvas-node-resizer, .canvas-node-connection'
    )
  );
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
  onOpenLink,
  isEditingText: parentIsEditing,
  setIsEditingText: parentSetIsEditing,
  onDeleteNode,
  onSetNodeColor,
  onZoomToNode,
}) => {
  const [localIsEditing, setLocalIsEditing] = useState(false);
  const isEditing = parentIsEditing !== undefined ? parentIsEditing : localIsEditing;
  const setIsEditing = parentSetIsEditing || setLocalIsEditing;

  const [editText, setEditText] = useState(node.type === 'text' ? node.text : '');
  const [groupLabelEdit, setGroupLabelEdit] = useState(
    node.type === 'group' ? node.label || 'Grupo' : ''
  );
  const [isEditingGroupLabel, setIsEditingGroupLabel] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { notesContentMap, updateNoteContent } = useVaultStore();

  // Un nodo sin color propio usa el estilo por defecto de Obsidian:
  // borde `1px solid #3a3a3a` y fondo `#1e1e1e` (definidos en canvasStyles.css).
  // Los colores personalizados (`#rrggbb`) también participan del tema.
  const hasTheme = Boolean(node.color);
  const colorScheme = resolveCanvasColor(node.color);
  const hasCustomColor = isCustomCanvasColor(node.color);

  const isFileNode = node.type === 'file';
  const isTextNode = node.type === 'text';
  const filePath = isFileNode ? node.file : '';
  const textContent = isTextNode ? node.text : '';
  const isImageFile = isFileNode && isImagePath(filePath);
  const isNoteFile = isFileNode && !isImageFile;

  /* ---------------------------------------------------------------- */
  /* Imagen del vault (cargador BlobURL compartido)                    */
  /* ---------------------------------------------------------------- */
  const [fileImageUrl, setFileImageUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    if (isImageFile) {
      resolveImageBlobUrl(filePath).then((url) => {
        if (!cancelled) setFileImageUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [filePath, isImageFile]);

  /* ---------------------------------------------------------------- */
  /* Contenido de la nota del vault                                    */
  /* ---------------------------------------------------------------- */
  const noteContent = isNoteFile ? notesContentMap[filePath] ?? '' : '';
  const [noteDraft, setNoteDraft] = useState<string>('');
  const noteDraftRef = useRef<string>('');

  useEffect(() => {
    if (isNoteFile && !isEditing) {
      setNoteDraft(noteContent);
      noteDraftRef.current = noteContent;
    }
  }, [noteContent, isNoteFile, isEditing]);

  useEffect(() => {
    if (isTextNode) {
      setEditText(textContent);
    }
  }, [node, isTextNode, textContent]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const handleTextBlur = useCallback(() => {
    setIsEditing(false);
    onUpdateText(node.id, editText);
  }, [editText, node.id, onUpdateText, setIsEditing]);

  const handleNoteBlur = useCallback(() => {
    setIsEditing(false);
    if (isNoteFile && noteDraftRef.current !== noteContent) {
      updateNoteContent(filePath, noteDraftRef.current);
    }
  }, [isNoteFile, filePath, noteContent, updateNoteContent]);

  const handleGroupLabelBlur = () => {
    setIsEditingGroupLabel(false);
    if (onUpdateGroupLabel) {
      onUpdateGroupLabel(node.id, groupLabelEdit);
    }
  };

  const isGroup = node.type === 'group';

  /* ---------------------------------------------------------------- */
  /* Punto de conexión único                                           */
  /* ---------------------------------------------------------------- */
  // El punto se muestra en el borde más cercano al mouse. Si el nodo está
  // seleccionado y el mouse no está encima, se usa el borde inferior.
  const [hoverSide, setHoverSide] = useState<CanvasNodeSide | null>(null);
  const connectionSide: CanvasNodeSide = hoverSide ?? 'bottom';
  const showConnectionPoint =
    !readonly && !isGroup && !isEditing && (isSelected || hoverSide !== null);

  const handleNodeMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (readonly || isGroup || isEditing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const distances: Array<[CanvasNodeSide, number]> = [
      ['top', e.clientY - rect.top],
      ['right', rect.right - e.clientX],
      ['bottom', rect.bottom - e.clientY],
      ['left', e.clientX - rect.left],
    ];
    const nearest = distances.reduce((best, current) =>
      current[1] < best[1] ? current : best
    )[0];
    setHoverSide((prev) => (prev === nearest ? prev : nearest));
  };

  const connectionPointStyle: React.CSSProperties = {
    position: 'absolute',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: hasCustomColor ? colorScheme.hex : '#e06c1b',
    border: '3.5px solid #2f2f2f',
    boxSizing: 'border-box',
    cursor: 'crosshair',
    zIndex: 120,
    ...(connectionSide === 'top' && {
      top: '-9px',
      left: '50%',
      transform: 'translateX(-50%)',
    }),
    ...(connectionSide === 'right' && {
      right: '-9px',
      top: '50%',
      transform: 'translateY(-50%)',
    }),
    ...(connectionSide === 'bottom' && {
      bottom: '-9px',
      left: '50%',
      transform: 'translateX(-50%)',
    }),
    ...(connectionSide === 'left' && {
      left: '-9px',
      top: '50%',
      transform: 'translateY(-50%)',
    }),
  };

  /* ---------------------------------------------------------------- */
  /* Barra flotante del nodo (.canvas-menu)                            */
  /* ---------------------------------------------------------------- */
  // Solo los nodos de texto, las notas del vault y los grupos tienen algo que
  // editar; en los grupos "Editar" edita la etiqueta del grupo.
  const canEdit = isTextNode || isNoteFile || isGroup;

  const handleMenuEdit = useCallback(() => {
    if (!canEdit) return;
    if (isGroup) {
      setIsEditingGroupLabel(true);
      return;
    }
    setIsEditing(true);
    // El menú sigue visible mientras se edita; al pulsar "Editar" devolvemos
    // el foco al editor aunque ya estuviera abierto.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [canEdit, isGroup, setIsEditing]);

  /* ---------------------------------------------------------------- */
  /* Render                                                             */
  /* ---------------------------------------------------------------- */
  const renderTextNode = () => {
    if (isEditing) {
      return (
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleTextBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleTextBlur();
          }}
          className="canvas-node-textarea"
          placeholder=""
          spellCheck={false}
        />
      );
    }
    return (
      <div className="canvas-node-body canvas-node-text-body">
        {textContent?.trim() ? (
          <CanvasMarkdown content={textContent} onOpenLink={onOpenLink} />
        ) : null}
      </div>
    );
  };

  const renderNoteNode = () => {
    if (isEditing) {
      return (
        <textarea
          ref={textareaRef}
          value={noteDraft}
          onChange={(e) => {
            noteDraftRef.current = e.target.value;
            setNoteDraft(e.target.value);
          }}
          onBlur={handleNoteBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleNoteBlur();
          }}
          className="canvas-node-textarea canvas-node-note-textarea"
          placeholder=""
          spellCheck={false}
        />
      );
    }
    return (
      <div className="canvas-node-body canvas-node-note-body">
        <h1 className="canvas-node-note-title">{noteTitle(filePath)}</h1>
        <CanvasMarkdown content={noteContent} onOpenLink={onOpenLink} />
      </div>
    );
  };

  const renderImageNode = () => {
    return (
      <div className="canvas-node-body canvas-node-image-body">
        {fileImageUrl ? (
          <img
            src={fileImageUrl}
            alt={baseName(filePath)}
            className="canvas-node-image"
            draggable={false}
          />
        ) : (
          <div className="canvas-node-image-loading">Cargando imagen…</div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`canvas-node ${isGroup ? 'canvas-node-group' : ''} ${
        isSelected ? 'is-selected' : ''
      } ${isDragging ? 'is-dragging' : ''} ${isEditing ? 'is-editing' : ''}`}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: `${node.width}px`,
        height: `${node.height}px`,
        zIndex: isGroup ? 1 : isSelected || isDragging ? 10 : 3,
        // La barra flotante y el círculo de conexión viven fuera de la tarjeta.
        overflow: 'visible',
      }}
      onClick={readonly ? onSelect : undefined}
      onMouseDown={(e) => {
        if (readonly) return;
        // En edición (o sobre un control nativo) no se arrastra el nodo, pero
        // tampoco dejamos que el canvas interprete el clic como fondo.
        if (isEditing || isEditingGroupLabel || isInteractiveCanvasTarget(e.target)) {
          e.stopPropagation();
          return;
        }
        // Un clic simple selecciona e inicia el arrastre al instante, incluso
        // si la tarjeta ya estaba seleccionada. Editar requiere doble clic.
        onStartDrag(e);
      }}
      onMouseMove={handleNodeMouseMove}
      onMouseLeave={() => setHoverSide(null)}
    >
      {/* Etiqueta del archivo FUERA de la tarjeta, sobre la esquina superior izquierda */}
      {isFileNode && (
        <div className="canvas-node-label" onDoubleClick={(e) => e.stopPropagation()}>
          {baseName(filePath)}
        </div>
      )}

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
        className={`canvas-node-container ${
          node.type === 'text' ? 'is-text' : node.type === 'file' ? 'is-file' : ''
        } ${isImageFile ? 'is-image' : ''}`}
        style={{
          // Caja 1:1 con Obsidian: fondo liso, borde fino y sin resplandor.
          // Con color (preset o personalizado) el borde y el fondo se tiñen.
          background: isGroup
            ? 'transparent'
            : hasTheme
              ? `color-mix(in srgb, ${colorScheme.hex} 12%, #1e1e1e)`
              : '#1e1e1e',
          border: hasTheme
            ? `${isSelected || hasCustomColor ? '2px' : '1px'} solid ${colorScheme.border}`
            : isSelected
              ? '2px solid #e06c1b'
              : '1px solid #363636',
          borderRadius: '10px',
          boxShadow: 'none',
          cursor: isSelected && !isEditing ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (readonly) return;
          // Solo el doble clic (nunca el clic simple) entra en edición.
          if (node.type === 'text' || isNoteFile) {
            setIsEditing(true);
          }
        }}
      >
        {/* Node Content based on type */}
        <div className="canvas-node-content">
          {node.type === 'text' && renderTextNode()}

          {isFileNode && (isImageFile ? renderImageNode() : renderNoteNode())}

          {/* TYPE: LINK */}
          {node.type === 'link' && (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-2">
              {node.url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) ? (
                <img
                  src={node.url}
                  alt="Link media"
                  className="max-w-full max-h-full object-contain rounded select-none"
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

      {/* 8 Resizers (4 lados + 4 esquinas) */}
      {!readonly && !isGroup && (
        <>
          {(['n', 'e', 's', 'w'] as const).map((side) => (
            <div
              key={side}
              className="canvas-node-resizer"
              data-resize={side}
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                e.stopPropagation();
                onStartResize(e, side);
              }}
            />
          ))}
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <div
              key={corner}
              className="canvas-node-resizer is-corner"
              data-resize={corner}
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                e.stopPropagation();
                onStartResize(e, corner);
              }}
            />
          ))}
        </>
      )}

      {/* Único círculo de conexión: en el borde más cercano al mouse o, por
          defecto, en el borde inferior cuando el nodo está seleccionado. */}
      {showConnectionPoint && (
        <div
          className="canvas-node-connection"
          data-side={connectionSide}
          title="Conectar"
          style={connectionPointStyle}
          onMouseDown={(e) => {
            e.stopPropagation();
            onStartConnect(e, connectionSide);
          }}
        />
      )}

      {/* Barra flotante de acciones: FUERA y ARRIBA de la tarjeta, centrada.
          Vive dentro de `.canvas-node` (overflow visible) para no recortarse. */}
      {isSelected && !readonly && (
        <CanvasFloatingMenu
          node={node}
          onDelete={() => onDeleteNode?.(node.id)}
          onSetColor={(colorKey) => onSetNodeColor?.(node.id, colorKey)}
          onZoomToSelection={() => onZoomToNode?.(node.id)}
          onEdit={handleMenuEdit}
        />
      )}
    </div>
  );
};
