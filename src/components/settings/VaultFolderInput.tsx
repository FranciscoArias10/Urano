import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Folder, Search, X } from 'lucide-react';
import type { FileItem } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { normalizePath } from '../../utils/pathUtils';

export interface VaultFolderInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  emptyText?: string;
}

const normalizeSearch = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

function collectFolderPaths(items: FileItem[], vaultRoot: string, out: string[] = []): string[] {
  const normRoot = normalizePath(vaultRoot);
  for (const item of items) {
    if (!item.isDir) continue;
    const normItem = normalizePath(item.path);
    let rel = normItem;
    if (normRoot && normItem.toLowerCase().startsWith(normRoot.toLowerCase())) {
      rel = normItem.slice(normRoot.length).replace(/^\/+/, '');
    }
    if (rel && !rel.startsWith('.')) {
      out.push(rel);
    }
    if (item.children?.length) {
      collectFolderPaths(item.children, vaultRoot, out);
    }
  }
  return out;
}

/** Input con buscador interactivo de carpetas dentro de la bóveda activa. */
export const VaultFolderInput: React.FC<VaultFolderInputProps> = ({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
  emptyText = 'No folders found.',
}) => {
  const fileTree = useVaultStore((s) => s.fileTree);
  const activeVault = useVaultStore((s) => s.activeVault);
  const settingsVaultPath = useSettingsStore((s) => s.vaultPath);
  const detectAll = useSettingsStore((s) => s.settings.detectAllFileExtensions);
  const configDir = useSettingsStore((s) => s.settings.configFolderOverride) || '.urano';

  const resolvedVaultPath = settingsVaultPath || activeVault || '';
  const [fallbackTree, setFallbackTree] = useState<FileItem[]>([]);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // En ventana independiente de Ajustes `vaultStore.fileTree` puede venir vacío; cargamos carpetas bajo demanda.
  useEffect(() => {
    if (fileTree.length > 0 || !resolvedVaultPath) return;
    let cancelled = false;
    invoke<FileItem[]>('list_vault_files', {
      vaultPath: resolvedVaultPath,
      detectAll,
      configDir,
    })
      .then((items) => {
        if (!cancelled && Array.isArray(items)) setFallbackTree(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileTree.length, resolvedVaultPath, detectAll, configDir]);

  const effectiveTree = fileTree.length > 0 ? fileTree : fallbackTree;

  const folders = useMemo(() => {
    const collected = collectFolderPaths(effectiveTree, resolvedVaultPath);
    return Array.from(new Set(collected)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [effectiveTree, resolvedVaultPath]);

  const filteredFolders = useMemo(() => {
    const q = normalizeSearch(draft.trim().replace(/\/+$/, ''));
    if (!q) return folders;
    return folders.filter((folder) => normalizeSearch(folder).includes(q));
  }, [folders, draft]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filteredFolders.length, draft]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const commitValue = (next: string) => {
    const cleaned = next.trim().replace(/^\/+/, '');
    setDraft(cleaned);
    if (cleaned !== value) onChange(cleaned);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="vault-folder-input-container">
      <span className="vault-folder-input-icon" aria-hidden="true">
        <Search size={13} strokeWidth={2} />
      </span>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        spellCheck={false}
        disabled={disabled}
        value={draft}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          if (draft !== value) onChange(draft.trim().replace(/^\/+/, ''));
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else if (filteredFolders.length > 0) {
              setActiveIndex((idx) => (idx + 1) % filteredFolders.length);
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filteredFolders.length > 0) {
              setActiveIndex((idx) => (idx - 1 + filteredFolders.length) % filteredFolders.length);
            }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filteredFolders[activeIndex]) {
              commitValue(filteredFolders[activeIndex]);
            } else {
              commitValue(draft);
            }
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {draft && !disabled && (
        <button
          type="button"
          className="vault-folder-input-clear"
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft('');
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <X size={11} strokeWidth={2.25} />
        </button>
      )}
      {open && (
        <div className="vault-folder-suggestions" role="listbox">
          {filteredFolders.length === 0 ? (
            <div className="vault-folder-suggestion-empty">{emptyText}</div>
          ) : (
            filteredFolders.map((folder, idx) => (
              <button
                type="button"
                key={folder}
                role="option"
                aria-selected={idx === activeIndex}
                className={`vault-folder-suggestion-item${idx === activeIndex ? ' is-selected' : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitValue(folder);
                }}
              >
                <Folder size={13} strokeWidth={1.75} />
                <span>{folder}/</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
