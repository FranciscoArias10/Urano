import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronsUpDown } from 'lucide-react';
import type { FileItem } from '../../types';
import { useVaultStore } from '../../stores/vaultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { normalizePath } from '../../utils/pathUtils';

export interface VaultNoteInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

function collectMarkdownNotes(items: FileItem[], vaultRoot: string, out: string[] = []): string[] {
  const normRoot = normalizePath(vaultRoot).replace(/\/+$/, '');
  for (const item of items) {
    const normItem = normalizePath(item.path);
    let rel = normItem;
    if (normRoot && normItem.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)) {
      rel = normItem.slice(normRoot.length + 1);
    }
    // Skip hidden dot-folders / files
    if (rel.split('/').some((seg) => seg.startsWith('.'))) {
      continue;
    }
    if (item.isDir) {
      if (item.children?.length) {
        collectMarkdownNotes(item.children, vaultRoot, out);
      }
      continue;
    }
    if (item.name.toLowerCase().endsWith('.md')) {
      out.push(rel.replace(/\.md$/i, ''));
    }
  }
  return out;
}

/** Dropdown selector of Markdown notes inside the active vault (matches Obsidian Note Composer template picker). */
export const VaultNoteInput: React.FC<VaultNoteInputProps> = ({
  value,
  onChange,
  placeholder = '',
  disabled,
  ariaLabel,
}) => {
  const fileTree = useVaultStore((s) => s.fileTree);
  const activeVault = useVaultStore((s) => s.activeVault);
  const settingsVaultPath = useSettingsStore((s) => s.vaultPath);
  const detectAll = useSettingsStore((s) => s.settings.detectAllFileExtensions);
  const configDir = useSettingsStore((s) => s.settings.configFolderOverride) || '.urano';

  const resolvedVaultPath = settingsVaultPath || activeVault || '';
  const [fallbackTree, setFallbackTree] = useState<FileItem[]>([]);

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

  const notes = useMemo(() => {
    const collected = collectMarkdownNotes(effectiveTree, resolvedVaultPath);
    return Array.from(new Set(collected)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [effectiveTree, resolvedVaultPath]);

  const normalizedValue = useMemo(() => {
    const clean = normalizePath(value).trim().replace(/^\/+/, '').replace(/\.md$/i, '');
    if (!clean) return '';
    const match = notes.find((n) => n.toLowerCase() === clean.toLowerCase());
    return match ?? clean;
  }, [value, notes]);

  const options = useMemo(() => {
    if (!normalizedValue || notes.includes(normalizedValue)) return notes;
    return [normalizedValue, ...notes];
  }, [notes, normalizedValue]);

  return (
    <div className="dropdown-container vault-note-dropdown">
      <select
        className={`dropdown vault-note-select${!normalizedValue ? ' is-placeholder' : ''}`}
        value={normalizedValue}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((noteRelPath) => (
          <option key={noteRelPath} value={noteRelPath}>
            {noteRelPath}
          </option>
        ))}
      </select>
      <span className="dropdown-icon" aria-hidden="true">
        <ChevronsUpDown size={14} strokeWidth={2} />
      </span>
    </div>
  );
};

