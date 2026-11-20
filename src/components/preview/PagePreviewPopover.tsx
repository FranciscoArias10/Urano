import React from 'react';
import type { PagePreviewContextKey } from '../../stores/settingsStore';
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

export const PagePreviewPopover: React.FC<PagePreviewPopoverProps> = () => {
  return null;
};
