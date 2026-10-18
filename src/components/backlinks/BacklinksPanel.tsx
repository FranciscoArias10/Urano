import React, { useState, useMemo } from 'react';
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight, FileText, ChevronRight, PlusCircle, X } from 'lucide-react';

interface BacklinksPanelProps {
  activeFile: string | null;
  activeFileName: string | null;
  fileContent: string;
  notesContentMap: Record<string, string>;
  onOpenNote: (pathOrName: string) => void;
  onClose: () => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  activeFile,
  activeFileName,
  fileContent,
  notesContentMap,
  onOpenNote,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>('incoming');

  const activeBaseName = useMemo(() => {
    if (!activeFileName) return '';
    return activeFileName.replace(/\.md$/i, '');
  }, [activeFileName]);

  // Compute incoming backlinks
  const incomingLinks = useMemo(() => {
    if (!activeBaseName) return [];
    const results: { path: string; name: string; snippet: string }[] = [];
    const targetLower = activeBaseName.toLowerCase();

    for (const [path, content] of Object.entries(notesContentMap)) {
      if (path === activeFile) continue;

      const lines = content.split('\n');
      for (const line of lines) {
        // Match [[Target...]]
        const wikiMatch = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
        let match;
        let foundInLine = false;
        while ((match = wikiMatch.exec(line)) !== null) {
          if (match[1].trim().toLowerCase() === targetLower) {
            foundInLine = true;
            break;
          }
        }

        if (foundInLine) {
          const parts = path.replace(/\\/g, '/').split('/');
          const name = parts[parts.length - 1].replace(/\.md$/i, '');
          results.push({
            path,
            name,
            snippet: line.trim() || `Enlace a [[${activeBaseName}]]`,
          });
          break; // One entry per file
        }
      }
    }
    return results;
  }, [activeFile, activeBaseName, notesContentMap]);

  // Compute outgoing links from the active file's content
  const outgoingLinks = useMemo(() => {
    if (!fileContent) return [];
    const linksMap = new Map<string, { targetName: string; resolvedPath: string | null }>();
    const wikiRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    let match;

    // Build map of lower-case base name -> path for resolution
    const vaultNotes = new Map<string, string>();
    for (const path of Object.keys(notesContentMap)) {
      const parts = path.replace(/\\/g, '/').split('/');
      const base = parts[parts.length - 1].replace(/\.md$/i, '').toLowerCase();
      vaultNotes.set(base, path);
    }

    while ((match = wikiRegex.exec(fileContent)) !== null) {
      const targetName = match[1].trim();
      const targetLower = targetName.toLowerCase();
      const resolvedPath = vaultNotes.get(targetLower) || null;

      if (!linksMap.has(targetLower)) {
        linksMap.set(targetLower, { targetName, resolvedPath });
      }
    }

    return Array.from(linksMap.values());
  }, [fileContent, notesContentMap]);

  if (!activeFile) {
    return (
      <aside className="w-72 bg-obsidian-sidebar border-l border-obsidian-border flex flex-col p-4 text-center text-obsidian-muted text-xs">
        <span>Selecciona una nota para ver sus enlaces y backlinks</span>
      </aside>
    );
  }

  return (
    <aside className="w-72 bg-obsidian-sidebar border-l border-obsidian-border flex flex-col h-full select-none shrink-0 z-10">
      {/* Panel Top Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-obsidian-border">
        <div className="flex items-center gap-2 text-obsidian-text">
          <ArrowLeftRight size={14} className="text-orange-500" />
          <span className="text-xs font-semibold">Enlaces y Menciones</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-obsidian-muted hover:text-white hover:bg-obsidian-hover rounded transition-colors"
          title="Cerrar panel de backlinks"
        >
          <X size={13} />
        </button>
      </div>

      {/* Active Note Name */}
      <div className="px-3 py-1.5 bg-[#171412] text-[11px] text-obsidian-muted border-b border-obsidian-border flex items-center gap-1.5 truncate">
        <FileText size={12} className="text-orange-400 shrink-0" />
        <span className="text-stone-300 font-medium truncate">{activeBaseName}</span>
      </div>

      {/* Tabs: Incoming (Backlinks) vs Outgoing */}
      <div className="grid grid-cols-2 p-1 gap-1 border-b border-obsidian-border bg-[#141210]">
        <button
          onClick={() => setActiveTab('incoming')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
            activeTab === 'incoming'
              ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
              : 'text-obsidian-muted hover:text-white'
          }`}
        >
          <ArrowDownLeft size={12} className="text-orange-400" />
          <span>Entrantes ({incomingLinks.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('outgoing')}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
            activeTab === 'outgoing'
              ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
              : 'text-obsidian-muted hover:text-white'
          }`}
        >
          <ArrowUpRight size={12} className="text-sky-400" />
          <span>Salientes ({outgoingLinks.length})</span>
        </button>
      </div>

      {/* Link Items List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {activeTab === 'incoming' ? (
          incomingLinks.length === 0 ? (
            <div className="p-4 text-center text-obsidian-muted text-[11px] italic">
              No hay notas que enlacen a esta nota. Escribe <code className="text-orange-400">[[{activeBaseName}]]</code> en otra nota para vincularlas.
            </div>
          ) : (
            incomingLinks.map((item) => (
              <div
                key={item.path}
                onClick={() => onOpenNote(item.path)}
                className="p-2 rounded-lg bg-obsidian-bg border border-obsidian-border hover:border-orange-500/40 cursor-pointer group transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-stone-200 group-hover:text-orange-300">
                  <FileText size={12} className="text-orange-400 shrink-0" />
                  <span className="truncate">{item.name}</span>
                  <ChevronRight size={12} className="ml-auto text-obsidian-muted group-hover:text-orange-400 shrink-0" />
                </div>
                <p className="mt-1 text-[10px] text-obsidian-muted line-clamp-2 leading-relaxed">
                  {item.snippet}
                </p>
              </div>
            ))
          )
        ) : outgoingLinks.length === 0 ? (
          <div className="p-4 text-center text-obsidian-muted text-[11px] italic">
            Esta nota no tiene enlaces salientes. Escribe <code className="text-orange-400">[[NombreNota]]</code> para vincular a otra página.
          </div>
        ) : (
          outgoingLinks.map((item) => (
            <div
              key={item.targetName}
              onClick={() => onOpenNote(item.resolvedPath || item.targetName)}
              className="flex items-center justify-between p-2 rounded-lg bg-obsidian-bg border border-obsidian-border hover:border-orange-500/40 cursor-pointer text-xs transition-colors"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    item.resolvedPath ? 'bg-emerald-400' : 'bg-stone-500'
                  }`}
                  title={item.resolvedPath ? 'Nota existente' : 'Nota no creada aún'}
                />
                <span className={`truncate font-medium ${item.resolvedPath ? 'text-stone-200' : 'text-stone-400'}`}>
                  {item.targetName}
                </span>
              </div>
              {!item.resolvedPath && (
                <span className="text-[10px] text-orange-400 flex items-center gap-1 shrink-0 ml-2">
                  <PlusCircle size={10} /> Crear
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
