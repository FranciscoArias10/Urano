import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  type PagePreviewContextKey,
  useSettingsStore,
} from '../../stores/settingsStore';
import { useVaultStore } from '../../stores/vaultStore';
import { useT } from '../../stores/localeStore';
import { ReadingView } from '../editor/ReadingView';
import { isImagePath } from '../../services/storageAdapter';
import { getSyncImageUrl, resolveImageBlobUrl } from '../../editor/imageExtension';
import { parseBaseConfig } from '../base/baseConfig';
import type { FileItem } from '../../types';
import {
  getCleanFileName,
  isSamePath,
  parseLinkTargetParts,
  resolveFilePathInVault,
  resolveVaultLinkTarget,
} from '../../utils/pathUtils';

export const PAGE_PREVIEW_HOVER_EVENT = 'urano:page-preview-hover';

export interface PreviewTriggerInfo {
  context: PagePreviewContextKey;
  target: string;
  rect: DOMRect;
  element: HTMLElement | null;
}

export interface PagePreviewCustomHoverDetail {
  context: PagePreviewContextKey;
  target: string;
  clientX: number;
  clientY: number;
  ctrlKey?: boolean;
}

export type PreviewFileKind = 'markdown' | 'canvas' | 'base' | 'image' | 'binary';

export interface ResolvedPreviewTarget {
  rawTarget: string;
  resolvedPath: string | null;
  displayTitle: string;
  isExisting: boolean;
  isMarkdown: boolean;
  fileKind: PreviewFileKind;
  ext: string;
}

export interface PagePreviewPopoverProps {
  onOpenNote: (target: string) => void;
}

const VALID_PREVIEW_CONTEXTS: ReadonlySet<string> = new Set<PagePreviewContextKey>([
  'search',
  'preview',
  'editor',
  'tabHeader',
  'fileExplorer',
  'properties',
  'bookmarks',
  'outline',
  'bases',
  'graph',
]);

export function isValidPreviewContext(value: string | null): value is PagePreviewContextKey {
  return value !== null && VALID_PREVIEW_CONTEXTS.has(value);
}

function extractPreviewExtension(pathStr: string): string {
  const base = pathStr.replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function resolvePreviewTarget(
  rawTarget: string,
  fileTree: FileItem[],
  activeVault: string | null,
  allFiles?: FileItem[]
): ResolvedPreviewTarget {
  const { targetPath, isExternalUrl } = parseLinkTargetParts(rawTarget);

  if (!targetPath || isExternalUrl) {
    return {
      rawTarget,
      resolvedPath: null,
      displayTitle: '',
      isExisting: false,
      isMarkdown: false,
      fileKind: 'markdown',
      ext: '',
    };
  }

  const searchPool = allFiles && allFiles.length > 0 ? allFiles : fileTree;
  const resolvedFromTree = resolveVaultLinkTarget(rawTarget, searchPool, activeVault);
  const resolvedPath =
    resolvedFromTree || resolveFilePathInVault(targetPath, searchPool, activeVault) || null;
  const checkTarget = (resolvedFromTree || targetPath).toLowerCase();
  const ext = extractPreviewExtension(checkTarget);

  let fileKind: PreviewFileKind = 'markdown';
  if (ext === 'canvas') {
    fileKind = 'canvas';
  } else if (ext === 'base') {
    fileKind = 'base';
  } else if (isImagePath(checkTarget)) {
    fileKind = 'image';
  } else if (ext && ext !== 'md' && ext !== 'markdown') {
    fileKind = 'binary';
  }

  return {
    rawTarget,
    resolvedPath,
    displayTitle: getCleanFileName(resolvedFromTree || targetPath) || targetPath,
    isExisting: Boolean(resolvedFromTree),
    isMarkdown: fileKind === 'markdown',
    fileKind,
    ext,
  };
}

/**
 * Extracts a previewable target and its Obsidian context category from the hovered DOM element.
 */
export function detectPreviewTrigger(
  targetEl: HTMLElement | null
): PreviewTriggerInfo | null {
  if (!targetEl) return null;

  const explicitTrigger = targetEl.closest<HTMLElement>('[data-page-preview-target]');
  if (explicitTrigger) {
    const rawTarget = explicitTrigger.getAttribute('data-page-preview-target')?.trim() || '';
    const explicitCtx = explicitTrigger.getAttribute('data-page-preview-context');
    if (rawTarget && isValidPreviewContext(explicitCtx)) {
      return {
        context: explicitCtx,
        target: rawTarget,
        rect: explicitTrigger.getBoundingClientRect(),
        element: explicitTrigger,
      };
    }
  }

  // Fallback: Reading View internal link or frontmatter property link
  const readingLink = targetEl.closest<HTMLElement>('.markdown-reading-view a.internal-link');
  if (readingLink) {
    const linkTarget =
      readingLink.getAttribute('title')?.trim() || readingLink.textContent?.trim() || '';
    if (linkTarget) {
      const inProperties = Boolean(readingLink.closest('.metadata-container'));
      return {
        context: inProperties ? 'properties' : 'preview',
        target: linkTarget,
        rect: readingLink.getBoundingClientRect(),
        element: readingLink,
      };
    }
  }

  // Fallback: CodeMirror Live Preview / Source wikilink
  const cmWikilink = targetEl.closest<HTMLElement>('.cm-editor .cm-wikilink');
  if (cmWikilink) {
    const rawText = (cmWikilink.textContent || '')
      .replace(/^\[\[/, '')
      .replace(/\]\]$/, '')
      .split('|')[0]
      .trim();
    if (rawText) {
      return {
        context: 'editor',
        target: rawText,
        rect: cmWikilink.getBoundingClientRect(),
        element: cmWikilink,
      };
    }
  }

  return null;
}

export interface ActiveHoverTriggerState {
  triggerKey: string;
  context: PagePreviewContextKey;
  target: string;
  rect: DOMRect;
}

const AUTOMATIC_OPEN_DELAY_MS = 300;
const CTRL_OPEN_DELAY_MS = 100;
const CLOSE_GRACE_DELAY_MS = 200;
const POPOVER_WIDTH = 420;
const POPOVER_MAX_HEIGHT = 360;
const VIEWPORT_MARGIN = 12;

export function computePopoverCoords(anchorRect: DOMRect): {
  top: number;
  left: number;
} {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = anchorRect.left;
  if (left + POPOVER_WIDTH > vw - VIEWPORT_MARGIN) {
    left = vw - POPOVER_WIDTH - VIEWPORT_MARGIN;
  }
  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  let top = anchorRect.bottom + 8;
  if (top + POPOVER_MAX_HEIGHT > vh - VIEWPORT_MARGIN) {
    const aboveTop = anchorRect.top - POPOVER_MAX_HEIGHT - 8;
    if (aboveTop >= VIEWPORT_MARGIN) {
      top = aboveTop;
    } else {
      top = Math.max(VIEWPORT_MARGIN, vh - POPOVER_MAX_HEIGHT - VIEWPORT_MARGIN);
    }
  }

  return { top, left };
}

function readContentFromCache(
  resolvedPath: string,
  notesContentMap: Record<string, string>
): string | null {
  if (resolvedPath in notesContentMap) {
    return notesContentMap[resolvedPath];
  }
  for (const [candidatePath, content] of Object.entries(notesContentMap)) {
    if (isSamePath(candidatePath, resolvedPath)) {
      return content;
    }
  }
  return null;
}

function isOverlayBlockingTrigger(el: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false;
  const hasOpenOverlay = Boolean(document.querySelector('.modal, .prompt'));
  if (!hasOpenOverlay) return false;
  if (!el) return true;
  return !el.closest('.modal, .prompt');
}

interface ParsedCanvasPreview {
  nodeCount: number;
  edgeCount: number;
  snippets: Array<{ kind: 'text' | 'file' | 'group' | 'link'; label: string }>;
}

function parseCanvasPreview(raw: string): ParsedCanvasPreview | null {
  if (!raw || !raw.trim()) {
    return { nodeCount: 0, edgeCount: 0, snippets: [] };
  }
  try {
    const data = JSON.parse(raw) as { nodes?: unknown; edges?: unknown };
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const edges = Array.isArray(data?.edges) ? data.edges : [];
    const snippets: ParsedCanvasPreview['snippets'] = [];

    for (const rawNode of nodes) {
      if (snippets.length >= 6) break;
      if (!rawNode || typeof rawNode !== 'object') continue;
      const node = rawNode as Record<string, unknown>;
      if (node.type === 'text' && typeof node.text === 'string' && node.text.trim()) {
        const clean = node.text.trim().replace(/\s+/g, ' ');
        snippets.push({
          kind: 'text',
          label: clean.length > 90 ? `${clean.slice(0, 87)}...` : clean,
        });
      } else if (node.type === 'file' && typeof node.file === 'string' && node.file.trim()) {
        snippets.push({ kind: 'file', label: node.file.trim() });
      } else if (node.type === 'group' && typeof node.label === 'string' && node.label.trim()) {
        snippets.push({ kind: 'group', label: node.label.trim() });
      } else if (node.type === 'link' && typeof node.url === 'string' && node.url.trim()) {
        snippets.push({ kind: 'link', label: node.url.trim() });
      }
    }

    return { nodeCount: nodes.length, edgeCount: edges.length, snippets };
  } catch {
    return null;
  }
}

export const PagePreviewPopover: React.FC<PagePreviewPopoverProps> = ({
  onOpenNote,
}) => {
  const t = useT();
  const isPluginEnabled = useSettingsStore((s) =>
    Boolean(s.settings.corePlugins['page-preview'])
  );
  const pagePreviewRequireCtrl = useSettingsStore(
    (s) => s.settings.pagePreviewRequireCtrl
  );
  const strictLineBreaks = useSettingsStore((s) => s.settings.strictLineBreaks);
  const showIndentationGuides = useSettingsStore(
    (s) => s.settings.showIndentationGuides ?? s.settings.indentGuides
  );

  const fileTree = useVaultStore((s) => s.fileTree);
  const vaultFiles = useVaultStore((s) => s.files);
  const activeVault = useVaultStore((s) => s.activeVault);
  const activeFile = useVaultStore((s) => s.activeFile);
  const fileContent = useVaultStore((s) => s.fileContent);
  const notesContentMap = useVaultStore((s) => s.notesContentMap);

  const [activeTrigger, setActiveTrigger] =
    useState<ActiveHoverTriggerState | null>(null);
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  const hoveredTriggerRef = useRef<PreviewTriggerInfo | null>(null);
  const isCtrlHeldRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isPointerInsidePopoverRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const activeTriggerRef = useRef<ActiveHoverTriggerState | null>(null);
  activeTriggerRef.current = activeTrigger;

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closePopover = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    isPointerInsidePopoverRef.current = false;
    setActiveTrigger(null);
  }, [clearOpenTimer, clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      if (!isPointerInsidePopoverRef.current && !hoveredTriggerRef.current) {
        setActiveTrigger(null);
      }
    }, CLOSE_GRACE_DELAY_MS);
  }, [clearCloseTimer]);

  const activateTrigger = useCallback((trigger: PreviewTriggerInfo) => {
    const triggerKey = `${trigger.context}::${trigger.target}`;
    setActiveTrigger({
      triggerKey,
      context: trigger.context,
      target: trigger.target,
      rect: trigger.rect,
    });
  }, []);

  const scheduleOpenForTrigger = useCallback(
    (trigger: PreviewTriggerInfo, delayMs: number) => {
      clearOpenTimer();
      clearCloseTimer();
      const triggerKey = `${trigger.context}::${trigger.target}`;
      if (activeTriggerRef.current?.triggerKey === triggerKey) {
        return;
      }
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        if (hoveredTriggerRef.current?.target !== trigger.target) {
          return;
        }
        if (trigger.element && !trigger.element.isConnected) {
          return;
        }
        if (isOverlayBlockingTrigger(trigger.element)) {
          return;
        }
        const needsCtrl = pagePreviewRequireCtrl?.[trigger.context] ?? true;
        if (needsCtrl && !isCtrlHeldRef.current) {
          return;
        }
        activateTrigger(trigger);
      }, delayMs);
    },
    [activateTrigger, clearCloseTimer, clearOpenTimer, pagePreviewRequireCtrl]
  );

  useEffect(() => {
    if (!isPluginEnabled) {
      hoveredTriggerRef.current = null;
      isCtrlHeldRef.current = false;
      closePopover();
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      isCtrlHeldRef.current = Boolean(e.ctrlKey || e.metaKey);
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('.popover.hover-popover')) {
        isPointerInsidePopoverRef.current = true;
        clearCloseTimer();
        return;
      }

      isPointerInsidePopoverRef.current = false;
      const trigger = detectPreviewTrigger(targetEl);
      if (!trigger || isOverlayBlockingTrigger(trigger.element)) {
        if (hoveredTriggerRef.current && hoveredTriggerRef.current.context !== 'graph') {
          hoveredTriggerRef.current = null;
          clearOpenTimer();
          scheduleClose();
        } else if (trigger && isOverlayBlockingTrigger(trigger.element)) {
          clearOpenTimer();
        }
        return;
      }

      hoveredTriggerRef.current = trigger;
      const needsCtrl = pagePreviewRequireCtrl?.[trigger.context] ?? true;
      const ctrlHeld = e.ctrlKey || e.metaKey;

      if (!needsCtrl) {
        scheduleOpenForTrigger(trigger, AUTOMATIC_OPEN_DELAY_MS);
      } else if (ctrlHeld) {
        scheduleOpenForTrigger(trigger, CTRL_OPEN_DELAY_MS);
      } else {
        clearOpenTimer();
        if (
          activeTriggerRef.current &&
          activeTriggerRef.current.triggerKey !== `${trigger.context}::${trigger.target}`
        ) {
          scheduleClose();
        }
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest('.popover.hover-popover')) {
        return;
      }
      if (!related) {
        isPointerInsidePopoverRef.current = false;
        hoveredTriggerRef.current = null;
        clearOpenTimer();
        scheduleClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTriggerRef.current) {
        hoveredTriggerRef.current = null;
        isCtrlHeldRef.current = false;
        closePopover();
        return;
      }

      if (e.key === 'Control' || e.key === 'Meta') {
        if (e.repeat || e.altKey || e.shiftKey) return;
        isCtrlHeldRef.current = true;
        const trigger = hoveredTriggerRef.current;
        if (trigger && !isOverlayBlockingTrigger(trigger.element)) {
          const needsCtrl = pagePreviewRequireCtrl?.[trigger.context] ?? true;
          if (needsCtrl) {
            scheduleOpenForTrigger(trigger, CTRL_OPEN_DELAY_MS);
          }
        }
        return;
      }

      // Any non-modifier key (e.g. P in Ctrl+P, S in Ctrl+S, typing) cancels pending Ctrl-hover trigger
      clearOpenTimer();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        isCtrlHeldRef.current = false;
        if (activeTriggerRef.current && !isPointerInsidePopoverRef.current) {
          closePopover();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
        isCtrlHeldRef.current = false;
        clearOpenTimer();
      }
    };

    const handleWindowBlur = () => {
      isCtrlHeldRef.current = false;
      clearOpenTimer();
    };

    const handleDocumentMouseDown = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl?.closest('.popover.hover-popover')) {
        clearOpenTimer();
        if (activeTriggerRef.current) {
          closePopover();
        }
      }
    };

    const handleCustomHover = (e: Event) => {
      const detail = (e as CustomEvent<PagePreviewCustomHoverDetail | null>).detail;
      if (!detail) {
        if (hoveredTriggerRef.current?.context === 'graph') {
          hoveredTriggerRef.current = null;
          clearOpenTimer();
          scheduleClose();
        }
        return;
      }
      isCtrlHeldRef.current = Boolean(detail.ctrlKey);
      const trigger: PreviewTriggerInfo = {
        context: detail.context,
        target: detail.target,
        rect: new DOMRect(detail.clientX - 8, detail.clientY - 8, 16, 16),
        element: null,
      };
      hoveredTriggerRef.current = trigger;
      const needsCtrl = pagePreviewRequireCtrl?.[detail.context] ?? true;
      if (!needsCtrl) {
        scheduleOpenForTrigger(trigger, AUTOMATIC_OPEN_DELAY_MS);
      } else if (detail.ctrlKey) {
        scheduleOpenForTrigger(trigger, CTRL_OPEN_DELAY_MS);
      } else {
        clearOpenTimer();
      }
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener(PAGE_PREVIEW_HOVER_EVENT, handleCustomHover);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener(PAGE_PREVIEW_HOVER_EVENT, handleCustomHover);
    };
  }, [
    isPluginEnabled,
    pagePreviewRequireCtrl,
    clearCloseTimer,
    clearOpenTimer,
    closePopover,
    scheduleClose,
    scheduleOpenForTrigger,
  ]);

  const resolvedTarget = useMemo(() => {
    if (!activeTrigger) return null;
    return resolvePreviewTarget(activeTrigger.target, fileTree, activeVault, vaultFiles);
  }, [activeTrigger, fileTree, activeVault, vaultFiles]);

  useEffect(() => {
    if (!isPluginEnabled || !activeTrigger || !resolvedTarget) {
      setLoadedContent(null);
      setImagePreviewUrl(null);
      setIsLoadingContent(false);
      return;
    }

    if (!resolvedTarget.isExisting || !resolvedTarget.resolvedPath) {
      setLoadedContent(null);
      setImagePreviewUrl(null);
      setIsLoadingContent(false);
      return;
    }

    const targetPath = resolvedTarget.resolvedPath;

    if (resolvedTarget.fileKind === 'binary') {
      setLoadedContent(null);
      setImagePreviewUrl(null);
      setIsLoadingContent(false);
      return;
    }

    if (resolvedTarget.fileKind === 'image') {
      setLoadedContent(null);
      const syncUrl = getSyncImageUrl(targetPath, targetPath);
      if (syncUrl) {
        setImagePreviewUrl(syncUrl);
        setIsLoadingContent(false);
        return;
      }

      let cancelled = false;
      setImagePreviewUrl(null);
      setIsLoadingContent(true);
      resolveImageBlobUrl(targetPath)
        .then((url) => {
          if (!cancelled) {
            setImagePreviewUrl(url || null);
            setIsLoadingContent(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setImagePreviewUrl(null);
            setIsLoadingContent(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setImagePreviewUrl(null);
    if (activeFile && isSamePath(activeFile, targetPath)) {
      setLoadedContent(fileContent);
      setIsLoadingContent(false);
      return;
    }

    const cached = readContentFromCache(targetPath, notesContentMap);
    if (cached !== null) {
      setLoadedContent(cached);
      setIsLoadingContent(false);
      return;
    }

    let cancelled = false;
    setIsLoadingContent(true);
    invoke<string>('read_file', { filePath: targetPath })
      .then((raw) => {
        if (!cancelled) {
          setLoadedContent(raw ?? '');
          setIsLoadingContent(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedContent(null);
          setIsLoadingContent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    isPluginEnabled,
    activeTrigger,
    resolvedTarget,
    activeFile,
    fileContent,
    notesContentMap,
  ]);

  const coords = useMemo(() => {
    if (!activeTrigger) return null;
    return computePopoverCoords(activeTrigger.rect);
  }, [activeTrigger]);

  const parsedCanvas = useMemo(() => {
    if (!resolvedTarget || resolvedTarget.fileKind !== 'canvas') return null;
    return parseCanvasPreview(loadedContent ?? '');
  }, [resolvedTarget, loadedContent]);

  const parsedBase = useMemo(() => {
    if (!resolvedTarget || resolvedTarget.fileKind !== 'base') return null;
    try {
      return parseBaseConfig(loadedContent ?? '');
    } catch {
      return null;
    }
  }, [resolvedTarget, loadedContent]);

  if (!isPluginEnabled || !activeTrigger || !resolvedTarget || !coords) {
    return null;
  }

  const contentString = loadedContent ?? '';
  const hasContent = contentString.trim().length > 0;
  const openCurrentTarget = () => {
    const targetToOpen = resolvedTarget.resolvedPath || activeTrigger.target;
    closePopover();
    onOpenNote(targetToOpen);
  };

  return (
    <div
      ref={popoverRef}
      className="popover hover-popover"
      role="dialog"
      aria-label={resolvedTarget.displayTitle || activeTrigger.target}
      data-preview-target={resolvedTarget.resolvedPath || activeTrigger.target}
      data-preview-context={activeTrigger.context}
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
      }}
      onMouseEnter={() => {
        isPointerInsidePopoverRef.current = true;
        clearCloseTimer();
      }}
      onMouseLeave={() => {
        isPointerInsidePopoverRef.current = false;
        scheduleClose();
      }}
    >
      <div className="markdown-embed is-loaded">
        <div className="markdown-embed-content">
          {!resolvedTarget.isExisting ? (
            <div className="page-preview-empty-state">
              <div className="page-preview-empty-title">
                {resolvedTarget.displayTitle || activeTrigger.target}
              </div>
              <p className="page-preview-empty-desc">
                {t('pagePreview.notFound', {
                  name: resolvedTarget.displayTitle || activeTrigger.target,
                })}
              </p>
              <button
                type="button"
                className="page-preview-open-button"
                onClick={() => {
                  const targetToOpen = activeTrigger.target;
                  closePopover();
                  onOpenNote(targetToOpen);
                }}
              >
                {t('pagePreview.openNote')}
              </button>
            </div>
          ) : isLoadingContent && loadedContent === null && imagePreviewUrl === null ? (
            <div className="page-preview-loading">
              <div className="page-preview-spinner" />
            </div>
          ) : resolvedTarget.fileKind === 'image' ? (
            <div className="page-preview-empty-state">
              <div className="page-preview-empty-title">
                {resolvedTarget.displayTitle || activeTrigger.target}
              </div>
              {imagePreviewUrl && (
                <img
                  src={imagePreviewUrl}
                  alt={resolvedTarget.displayTitle || activeTrigger.target}
                  className="max-w-full max-h-[240px] object-contain rounded mx-auto block my-2"
                />
              )}
              <button
                type="button"
                className="page-preview-open-button"
                onClick={openCurrentTarget}
              >
                {t('pagePreview.openFile')}
              </button>
            </div>
          ) : resolvedTarget.fileKind === 'canvas' ? (
            <div className="page-preview-empty-state">
              <div className="flex items-center justify-between gap-2">
                <span className="page-preview-empty-title truncate">
                  {resolvedTarget.displayTitle || activeTrigger.target}
                </span>
                <span className="nav-file-tag shrink-0">CANVAS</span>
              </div>
              <p className="page-preview-empty-desc">
                {parsedCanvas && parsedCanvas.nodeCount > 0
                  ? t('pagePreview.canvasSummary', {
                      nodes: parsedCanvas.nodeCount,
                      edges: parsedCanvas.edgeCount,
                    })
                  : t('pagePreview.canvasEmpty')}
              </p>
              {parsedCanvas && parsedCanvas.snippets.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-urano-muted">
                  {parsedCanvas.snippets.map((snippet, idx) => (
                    <li key={idx} className="truncate">
                      • {snippet.label}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="page-preview-open-button mt-3"
                onClick={openCurrentTarget}
              >
                {t('pagePreview.openFile')}
              </button>
            </div>
          ) : resolvedTarget.fileKind === 'base' ? (
            <div className="page-preview-empty-state">
              <div className="flex items-center justify-between gap-2">
                <span className="page-preview-empty-title truncate">
                  {parsedBase?.title || resolvedTarget.displayTitle || activeTrigger.target}
                </span>
                <span className="nav-file-tag shrink-0">BASE</span>
              </div>
              <p className="page-preview-empty-desc">
                {t('pagePreview.baseSummary', {
                  columns: parsedBase ? parsedBase.columns.length : 0,
                })}
              </p>
              {parsedBase && parsedBase.columns.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {parsedBase.columns.map((col) => (
                    <span key={col} className="nav-file-tag">
                      {t(`base.columns.${col === 'mtime' ? 'modified' : col}`)}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="page-preview-open-button mt-3"
                onClick={openCurrentTarget}
              >
                {t('pagePreview.openFile')}
              </button>
            </div>
          ) : resolvedTarget.fileKind === 'binary' ? (
            <div className="page-preview-empty-state">
              <div className="flex items-center justify-between gap-2">
                <span className="page-preview-empty-title truncate">
                  {resolvedTarget.displayTitle || activeTrigger.target}
                </span>
                {resolvedTarget.ext && (
                  <span className="nav-file-tag shrink-0 uppercase">
                    {resolvedTarget.ext.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="page-preview-empty-desc">
                {t('pagePreview.binaryDesc', {
                  ext: (resolvedTarget.ext || 'FILE').toUpperCase(),
                })}
              </p>
              <button
                type="button"
                className="page-preview-open-button mt-2"
                onClick={openCurrentTarget}
              >
                {t('pagePreview.openFile')}
              </button>
            </div>
          ) : (
            <ReadingView
              content={contentString}
              title={resolvedTarget.displayTitle}
              showInlineTitle={true}
              readableLineLength={false}
              strictLineBreaks={strictLineBreaks}
              showIndentationGuides={Boolean(showIndentationGuides)}
              onWikilinkClick={(target) => {
                closePopover();
                onOpenNote(target);
              }}
              footerContent={
                !hasContent ? (
                  <p className="page-preview-empty-note">{t('pagePreview.emptyNote')}</p>
                ) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
};
