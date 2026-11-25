import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, FileText, FileImage, X } from 'lucide-react';
import { useVaultStore } from '../../stores/vaultStore';
import { FileItem } from '../../types';
import { isImagePath } from '../../services/storageAdapter';
import { useT } from '../../stores/localeStore';
import { normalizePath } from '../../utils/pathUtils';
import { toCanvasVaultPath } from './canvasOperations';

export type VaultFileModalMode = 'note' | 'image';

interface VaultFileModalProps {
  isOpen: boolean;
  mode?: VaultFileModalMode;
  onClose: () => void;
  onSelectFile: (filePath: string, fileName: string) => void;
}

/**
 * Modal buscador de archivos del Vault.
 *  - mode="note"  -> solo notas `.md`
 *  - mode="image" -> solo imágenes (png/jpg/webp/gif/svg/…)
 */
export const VaultFileModal: React.FC<VaultFileModalProps> = ({
  isOpen,
  mode = 'note',
  onClose,
  onSelectFile,
}) => {
  const t = useT();
  const { fileTree, files: allVaultFiles, activeVault } = useVaultStore();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Collect markdown files or images from both fileTree and full vault files list
  const files = useMemo(() => {
    const collected: { path: string; name: string; folder: string }[] = [];
    const seen = new Set<string>();

    const computeFolderLabel = (fullPath: string): string => {
      const rel = toCanvasVaultPath(fullPath, activeVault);
      const parts = normalizePath(rel).split('/').filter(Boolean);
      parts.pop();
      return parts.join('/') || t('canvas.vaultModal.root');
    };

    const collect = (items: FileItem[]) => {
      for (const item of items) {
        if (!item.isDir) {
          const canon = normalizePath(item.path).toLowerCase();
          if (!seen.has(canon)) {
            const isNote = item.name.toLowerCase().endsWith('.md');
            const isImg = isImagePath(item.name);
            if (mode === 'note' && isNote) {
              seen.add(canon);
              collected.push({
                path: item.path,
                name: item.name.replace(/\.md$/i, ''),
                folder: computeFolderLabel(item.path),
              });
            } else if (mode === 'image' && isImg) {
              seen.add(canon);
              collected.push({
                path: item.path,
                name: item.name,
                folder: computeFolderLabel(item.path),
              });
            }
          }
        }
        if (item.children) collect(item.children);
      }
    };
    collect(fileTree);
    if (allVaultFiles?.length) {
      collect(allVaultFiles);
    }
    return collected;
  }, [fileTree, allVaultFiles, activeVault, mode, t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)
    );
  }, [files, search]);

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

  const isImageMode = mode === 'image';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-[var(--background-modifier-cover)] backdrop-blur-sm animate-fadeIn">
      <div
        className="relative w-full max-w-lg bg-urano-bg border border-urano-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Search */}
        <div className="flex items-center px-3 py-2.5 border-b border-urano-border gap-2">
          <Search size={16} className="text-urano-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isImageMode
                ? t('canvas.vaultModal.selectImage')
                : t('canvas.vaultModal.selectNote')
            }
            className="w-full bg-transparent text-sm text-urano-text placeholder-stone-500 outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 text-urano-muted hover:text-urano-text rounded hover:bg-urano-active"
          >
            <X size={15} />
          </button>
        </div>

        {/* Files list */}
        <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-urano-faint">
              {isImageMode
                ? t('canvas.vaultModal.noImages')
                : t('canvas.vaultModal.noNotes')}
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
                    : 'text-urano-text hover:bg-[var(--interactive-hover)] hover:text-urano-text'
                }`}
              >
                {isImageMode ? (
                  <FileImage size={14} className="shrink-0 opacity-70" />
                ) : (
                  <FileText size={14} className="shrink-0 opacity-70" />
                )}
                <span className="truncate flex-1 font-medium">{file.name}</span>
                <span className="text-[10px] text-urano-faint truncate max-w-[150px]">
                  {file.folder}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
