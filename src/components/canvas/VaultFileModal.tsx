import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, X } from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { FileItem } from '../../types';

interface VaultFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (filePath: string, fileName: string) => void;
}

export const VaultFileModal: React.FC<VaultFileModalProps> = ({
  isOpen,
  onClose,
  onSelectFile,
}) => {
  const { fileTree } = useVaultStore();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flatten markdown files from fileTree
  const files: { path: string; name: string }[] = [];
  const collectFiles = (items: FileItem[]) => {
    for (const item of items) {
      if (!item.isDir && item.name.toLowerCase().endsWith('.md')) {
        files.push({
          path: item.path,
          name: item.name.replace(/\.md$/i, ''),
        });
      }
      if (item.children) collectFiles(item.children);
    }
  };
  collectFiles(fileTree);

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelectFile(filtered[selectedIndex].path, filtered[selectedIndex].name);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="relative w-full max-w-lg bg-[#1e1e1e] border border-[#333333] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Search */}
        <div className="flex items-center px-3 py-2.5 border-b border-[#2e2e2e] gap-2">
          <Search size={16} className="text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Seleccionar una nota de la bóveda..."
            className="w-full bg-transparent text-sm text-stone-100 placeholder-stone-500 outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-white rounded hover:bg-white/10"
          >
            <X size={15} />
          </button>
        </div>

        {/* Files list */}
        <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-stone-500">
              No se encontraron notas en la bóveda
            </div>
          ) : (
            filtered.map((file, idx) => (
              <div
                key={file.path}
                onClick={() => {
                  onSelectFile(file.path, file.name);
                  onClose();
                }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                  idx === selectedIndex
                    ? 'bg-orange-600/20 text-orange-400 border border-orange-500/40'
                    : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                }`}
              >
                <FileText size={14} className="shrink-0 opacity-70" />
                <span className="truncate flex-1 font-medium">{file.name}</span>
                <span className="text-[10px] text-stone-500 truncate max-w-[150px]">
                  {file.path.split('/').slice(-2, -1)[0] || 'Raíz'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
