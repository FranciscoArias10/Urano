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

