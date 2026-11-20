import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  type PagePreviewContextKey,
  useSettingsStore,
} from '../../stores/settingsStore';
import type { FileItem } from '../../types';
import {
  getCleanFileName,
  isSamePath,
  resolveFilePathInVault,
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

export interface ResolvedPreviewTarget {
  rawTarget: string;
  resolvedPath: string | null;
  displayTitle: string;
  isExisting: boolean;
  isMarkdown: boolean;
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

function findExistingFileInTree(target: string, items: FileItem[]): FileItem | null {
  for (const item of items) {
    if (!item.isDir && isSamePath(item.path, target)) {
      return item;
    }
    if (item.children) {
      const found = findExistingFileInTree(target, item.children);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolves a wikilink note name or vault file path into an existing vault file (if present)
 * and a clean display title for the popover header.
 */
export function resolvePreviewTarget(
  rawTarget: string,
  fileTree: FileItem[],
  activeVault: string | null
): ResolvedPreviewTarget {
  const withoutAlias = rawTarget.split('|')[0].trim();
  const [noteTarget] = withoutAlias.split('#');
  const cleanTarget = noteTarget.trim();

  if (!cleanTarget) {
    return {
      rawTarget,
      resolvedPath: null,
      displayTitle: '',
      isExisting: false,
      isMarkdown: false,
    };
  }

  const matchedItem = findExistingFileInTree(cleanTarget, fileTree);
  const candidatePath = matchedItem
    ? matchedItem.path
    : resolveFilePathInVault(cleanTarget, fileTree, activeVault);
  const resolvedPath = matchedItem ? matchedItem.path : candidatePath || null;
  const checkTarget = (matchedItem?.path || cleanTarget).toLowerCase();
  const hasNonMdExt = /\.(canvas|base|png|jpe?g|gif|webp|svg|bmp|ico|pdf|mp3|mp4|wav|webm)$/i.test(
    checkTarget
  );

  return {
    rawTarget,
    resolvedPath,
    displayTitle: getCleanFileName(matchedItem?.path || cleanTarget) || cleanTarget,
    isExisting: Boolean(matchedItem),
    isMarkdown: !hasNonMdExt,
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

export const PagePreviewPopover: React.FC<PagePreviewPopoverProps> = () => {
  const isPluginEnabled = useSettingsStore((s) =>
    Boolean(s.settings.corePlugins['page-preview'])
  );
  const pagePreviewRequireCtrl = useSettingsStore(
    (s) => s.settings.pagePreviewRequireCtrl
  );

  const [activeTrigger, setActiveTrigger] =
    useState<ActiveHoverTriggerState | null>(null);

  const hoveredTriggerRef = useRef<PreviewTriggerInfo | null>(null);
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
        if (hoveredTriggerRef.current?.target === trigger.target) {
          activateTrigger(trigger);
        }
      }, delayMs);
    },
    [activateTrigger, clearCloseTimer, clearOpenTimer]
  );

  useEffect(() => {
    if (!isPluginEnabled) {
      hoveredTriggerRef.current = null;
      closePopover();
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('.popover.hover-popover')) {
        isPointerInsidePopoverRef.current = true;
        clearCloseTimer();
        return;
      }

      isPointerInsidePopoverRef.current = false;
      const trigger = detectPreviewTrigger(targetEl);
      if (!trigger) {
        if (hoveredTriggerRef.current && hoveredTriggerRef.current.context !== 'graph') {
          hoveredTriggerRef.current = null;
          clearOpenTimer();
          scheduleClose();
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
        closePopover();
        return;
      }
      if ((e.key === 'Control' || e.key === 'Meta') && hoveredTriggerRef.current) {
        const trigger = hoveredTriggerRef.current;
        const needsCtrl = pagePreviewRequireCtrl?.[trigger.context] ?? true;
        if (needsCtrl) {
          scheduleOpenForTrigger(trigger, CTRL_OPEN_DELAY_MS);
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
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(PAGE_PREVIEW_HOVER_EVENT, handleCustomHover);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      window.removeEventListener('keydown', handleKeyDown);
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

  if (!isPluginEnabled || !activeTrigger) {
    return null;
  }

  return (
    <div
      ref={popoverRef}
      data-preview-target={activeTrigger.target}
      data-preview-context={activeTrigger.context}
      style={{ display: 'none' }}
    />
  );
};
