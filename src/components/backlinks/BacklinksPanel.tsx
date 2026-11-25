import React, { useState, useMemo } from 'react';
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight, FileText, ChevronRight, PlusCircle, X } from 'lucide-react';
import { useT } from '../../stores/localeStore';
import { useVaultStore } from '../../stores/vaultStore';
import { FileItem } from '../../types';
import {
  createVaultLinkResolver,
  getRelativeVaultPath,
  isSamePath,
  parseLinkTargetParts,
} from '../../utils/pathUtils';
import { useDebouncedValue, useStableNotesContent } from './useStableNotes';

export interface IncomingBacklinkItem {
  path: string;
  name: string;
  snippet: string;
}

export interface OutgoingLinkItem {
  targetName: string;
  resolvedPath: string | null;
}

export function computeIncomingBacklinks(params: {
  activeFile: string | null;
  activeFileName: string | null;
  notesContentMap: Record<string, string>;
  fileTree: FileItem[];
  activeVault: string | null;
  fallbackSnippet?: string;
}): IncomingBacklinkItem[] {
  const { activeFile, activeFileName, notesContentMap, fileTree, activeVault, fallbackSnippet } = params;
  const activeBaseName = activeFileName ? activeFileName.replace(/\.(md|markdown)$/i, '') : '';
  if (!activeFile || !activeBaseName) return [];

  const results: IncomingBacklinkItem[] = [];
  const targetLower = activeBaseName.toLowerCase();
  const activeRelPathLower = getRelativeVaultPath(activeFile, activeVault || '').toLowerCase();

  // El árbol se aplana una sola vez y los destinos repetidos se resuelven desde caché
  const resolveLink = createVaultLinkResolver(fileTree, activeVault);

  const targetMatchesActive = (rawTarget: string): boolean => {
    const { targetPath, isExternalUrl } = parseLinkTargetParts(rawTarget);
    if (!targetPath || isExternalUrl) return false;
    const resolved = resolveLink(rawTarget);
    if (resolved) {
      return isSamePath(resolved, activeFile);
    }
    const normRel = targetPath
      .replace(/^(\.\/)+/, '')
      .replace(/^\/+/, '')
      .replace(/\.(md|markdown)$/i, '')
      .toLowerCase();
    if (activeRelPathLower && normRel === activeRelPathLower) return true;
    return !normRel.includes('/') && normRel === targetLower;
  };

  for (const [path, content] of Object.entries(notesContentMap)) {
    if (isSamePath(path, activeFile)) continue;

    const lines = content.split('\n');
    let inCodeFence = false;
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.trim().startsWith('```')) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;

      let foundInLine = false;
      const wikiMatch = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = wikiMatch.exec(line)) !== null) {
        if (targetMatchesActive(match[1])) {
          foundInLine = true;
          break;
        }
      }

      if (!foundInLine) {
        const mdMatchRe = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
        while ((match = mdMatchRe.exec(line)) !== null) {
          const href = match[1].trim().replace(/^<|>$/g, '').split(/\s+/)[0] || '';
          if (targetMatchesActive(href)) {
            foundInLine = true;
            break;
          }
        }
      }

      if (foundInLine) {
        const parts = path.replace(/\\/g, '/').split('/');
        const name = parts[parts.length - 1].replace(/\.(md|markdown)$/i, '');
        results.push({
          path,
          name,
          snippet: line.trim() || fallbackSnippet || `[[${activeBaseName}]]`,
        });
        break; // One entry per file
      }
    }
  }

  return results;
}

export function computeOutgoingLinks(params: {
  fileContent: string;
  notesContentMap: Record<string, string>;
  fileTree: FileItem[];
  activeVault: string | null;
}): OutgoingLinkItem[] {
  const { fileContent, notesContentMap, fileTree, activeVault } = params;
  if (!fileContent) return [];

  const linksMap = new Map<string, OutgoingLinkItem>();
  const resolveLink = createVaultLinkResolver(fileTree, activeVault);
  const sanitized = fileContent.replace(/```[\s\S]*?```/g, '');
  const wikiRegex = /(?<!!)\[\[([^\]|#\r\n]+)(?:#[^\]|\r\n]+)?(?:\|[^\]\r\n]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = wikiRegex.exec(sanitized)) !== null) {
    const targetName = match[1].trim();
    const targetLower = targetName.toLowerCase();
    if (!targetName || linksMap.has(targetLower)) continue;

    let resolvedPath = resolveLink(targetName);
    if (!resolvedPath) {
      const cleanTarget = targetName
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\.(md|markdown)$/i, '')
        .toLowerCase();
      for (const candidatePath of Object.keys(notesContentMap)) {
        const rel = getRelativeVaultPath(candidatePath, activeVault || '').toLowerCase();
        if (
          rel === cleanTarget ||
          (!cleanTarget.includes('/') && rel.split('/').pop() === cleanTarget)
        ) {
          resolvedPath = candidatePath;
          break;
        }
      }
    }

    linksMap.set(targetLower, { targetName, resolvedPath });
  }

  return Array.from(linksMap.values());
}

interface BacklinksPanelProps {
  activeFile: string | null;
  activeFileName: string | null;
  fileContent: string;
  notesContentMap: Record<string, string>;
  fileTree?: FileItem[];
  activeVault?: string | null;
  /** Abre/crea una nota a partir de un nombre de wikilink (puede no existir aún). */
  onOpenNote: (pathOrName: string) => void;
  /** Abre un archivo existente a partir de su ruta real (sin interpretarla como enlace). */
  onOpenPath?: (filePath: string) => void;
  onClose: () => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  activeFile,
  activeFileName,
  fileContent,
  notesContentMap: rawNotesContentMap,
  fileTree: propFileTree,
  activeVault: propActiveVault,
  onOpenNote,
  onOpenPath,
  onClose,
}) => {
  const t = useT();
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>('incoming');
  const storeFileTree = useVaultStore((s) => s.fileTree);
  const storeActiveVault = useVaultStore((s) => s.activeVault);
  const fileTree = propFileTree ?? storeFileTree;
  const selectFile = useVaultStore((s) => s.selectFile);

  // Escribir en la nota activa no debe re-escanear toda la bóveda ni recalcular enlaces por tecla
  const notesContentMap = useStableNotesContent(rawNotesContentMap, activeFile);
  const debouncedFileContent = useDebouncedValue(fileContent, 250);

  // Las rutas reales de archivo no deben pasar por el parser de enlaces (`#`, `%`, `|` en nombres)
  const openExistingPath = (filePath: string) => {
    if (onOpenPath) onOpenPath(filePath);
    else void selectFile(filePath);
  };
  const activeVault = propActiveVault !== undefined ? propActiveVault : storeActiveVault;

  const activeBaseName = useMemo(() => {
    if (!activeFileName) return '';
    return activeFileName.replace(/\.(md|markdown)$/i, '');
  }, [activeFileName]);

  const fallbackSnippet = activeBaseName ? t('backlinks.linkTo', { name: activeBaseName }) : '';

  const incomingLinks = useMemo(
    () =>
      computeIncomingBacklinks({
        activeFile,
        activeFileName,
        notesContentMap,
        fileTree,
        activeVault,
        fallbackSnippet,
      }),
    [activeFile, activeFileName, notesContentMap, fileTree, activeVault, fallbackSnippet]
  );

  const outgoingLinks = useMemo(
    () =>
      computeOutgoingLinks({
        fileContent: debouncedFileContent,
        notesContentMap,
        fileTree,
        activeVault,
      }),
    [debouncedFileContent, notesContentMap, fileTree, activeVault]
  );

  // Empty states embed a styled <code> element: split the sentence around the placeholder
  const [noIncomingBefore, noIncomingAfter] = t('backlinks.noIncoming').split('{link}');
  const [noOutgoingBefore, noOutgoingAfter] = t('backlinks.noOutgoing').split('{link}');

  if (!activeFile) {
    return (
      <aside className="w-72 bg-urano-sidebar border-l border-urano-border flex flex-col p-4 text-center text-urano-muted text-xs">
        <span>{t('backlinks.selectNote')}</span>
      </aside>
    );
  }

  return (
    <aside className="w-72 bg-urano-sidebar border-l border-urano-border flex flex-col h-full select-none shrink-0 z-10">
      {/* Panel Top Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-urano-border">
        <div className="flex items-center gap-2 text-urano-text">
          <ArrowLeftRight size={14} className="text-orange-500" />
          <span className="text-xs font-semibold">{t('backlinks.title')}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-urano-muted hover:text-urano-text hover:bg-urano-hover rounded transition-colors"
          title={t('backlinks.closePanel')}
        >
          <X size={13} />
        </button>
      </div>

      {/* Active Note Name */}
      <div className="px-3 py-1.5 bg-urano-sidebar text-[11px] text-urano-muted border-b border-urano-border flex items-center gap-1.5 truncate">
        <FileText size={12} className="text-orange-400 shrink-0" />
        <span className="text-urano-text font-medium truncate">{activeBaseName}</span>
      </div>

      {/* Tabs: Incoming (Backlinks) vs Outgoing */}
      <div className="grid grid-cols-2 p-1 gap-1 border-b border-urano-border bg-urano-sidebar">
        <button
          onClick={() => setActiveTab('incoming')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
            activeTab === 'incoming'
              ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
              : 'text-urano-muted hover:text-urano-text'
          }`}
        >
          <ArrowDownLeft size={12} className="text-orange-400" />
          <span>{t('backlinks.incoming', { count: incomingLinks.length })}</span>
        </button>
        <button
          onClick={() => setActiveTab('outgoing')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
            activeTab === 'outgoing'
              ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
              : 'text-urano-muted hover:text-urano-text'
          }`}
        >
          <ArrowUpRight size={12} className="text-sky-400" />
          <span>{t('backlinks.outgoing', { count: outgoingLinks.length })}</span>
        </button>
      </div>

      {/* Link Items List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {activeTab === 'incoming' ? (
          incomingLinks.length === 0 ? (
            <div className="p-4 text-center text-urano-muted text-[11px] italic">
              {noIncomingBefore}
              <code className="text-orange-400">[[{activeBaseName}]]</code>
              {noIncomingAfter}
            </div>
          ) : (
            incomingLinks.map((item) => (
              <div
                key={item.path}
                data-page-preview-context="search"
                data-page-preview-target={item.path}
                onClick={() => openExistingPath(item.path)}
                className="p-2 rounded-lg bg-urano-bg border border-urano-border hover:border-orange-500/40 cursor-pointer group transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-urano-text group-hover:text-orange-300">
                  <FileText size={12} className="text-orange-400 shrink-0" />
                  <span className="truncate">{item.name}</span>
                  <ChevronRight size={12} className="ml-auto text-urano-muted group-hover:text-orange-400 shrink-0" />
                </div>
                <p className="mt-1 text-[10px] text-urano-muted line-clamp-2 leading-relaxed">
                  {item.snippet}
                </p>
              </div>
            ))
          )
        ) : outgoingLinks.length === 0 ? (
          <div className="p-4 text-center text-urano-muted text-[11px] italic">
            {noOutgoingBefore}
            <code className="text-orange-400">{t('backlinks.noOutgoingExample')}</code>
            {noOutgoingAfter}
          </div>
        ) : (
          outgoingLinks.map((item) => (
            <div
              key={item.targetName}
              data-page-preview-context="search"
              data-page-preview-target={item.resolvedPath || item.targetName}
              onClick={() =>
                item.resolvedPath ? openExistingPath(item.resolvedPath) : onOpenNote(item.targetName)
              }
              className="flex items-center justify-between p-2 rounded-lg bg-urano-bg border border-urano-border hover:border-orange-500/40 cursor-pointer text-xs transition-colors"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.resolvedPath ? 'bg-emerald-400' : 'bg-stone-500'
                  }`}
                  title={item.resolvedPath ? t('backlinks.existingNote') : t('backlinks.notCreatedYet')}
                />
                <span className={`truncate font-medium ${item.resolvedPath ? 'text-urano-text' : 'text-urano-muted'}`}>
                  {item.targetName}
                </span>
              </div>
              {!item.resolvedPath && (
                <span className="text-[10px] text-orange-400 flex items-center gap-1 shrink-0 ml-2">
                  <PlusCircle size={10} /> {t('backlinks.create')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
