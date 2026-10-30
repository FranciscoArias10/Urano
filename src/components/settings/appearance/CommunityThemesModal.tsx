import React, { useEffect, useState, useMemo } from 'react';
import { Search, X, Download, Check, Palette, Loader2, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore, useT } from '../../../stores/settingsStore';
import { themeService } from '../../../services/themeService';
import { useNoticeStore } from '../../common/Notice';
import type { CommunityTheme, InstalledTheme } from '../../../types/theme';

const COMMUNITY_THEMES_URL =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json';

interface CommunityThemesModalProps {
  vaultPath: string;
  isOpen: boolean;
  onClose: () => void;
  onThemeInstalled?: (name: string) => void;
}

export const CommunityThemesModal: React.FC<CommunityThemesModalProps> = ({
  vaultPath,
  isOpen,
  onClose,
  onThemeInstalled,
}) => {
  const t = useT();
  const { showNotice } = useNoticeStore();
  const cssTheme = useSettingsStore((s) => s.settings.cssTheme);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const [themes, setThemes] = useState<CommunityTheme[]>([]);
  const [installed, setInstalled] = useState<InstalledTheme[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [installingTheme, setInstallingTheme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cargar catálogo de temas e instalados
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [themesRes, installedList] = await Promise.all([
        fetch(COMMUNITY_THEMES_URL).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<CommunityTheme[]>;
        }),
        vaultPath ? themeService.listThemes(vaultPath) : Promise.resolve([]),
      ]);
      setThemes(themesRes);
      setInstalled(installedList);
    } catch (err: unknown) {
      console.error('Error al cargar temas de la comunidad:', err);
      setError('No se pudo descargar el catálogo de temas de Obsidian. Verifique su conexión.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, vaultPath]);

  // Manejar tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledTheme>();
    for (const item of installed) {
      map.set(item.name.toLowerCase(), item);
    }
    return map;
  }, [installed]);

  const filteredThemes = useMemo(() => {
    if (!query.trim()) return themes;
    const q = query.toLowerCase();
    return themes.filter(
      (th) =>
        th.name.toLowerCase().includes(q) ||
        th.author.toLowerCase().includes(q) ||
        th.repo.toLowerCase().includes(q)
    );
  }, [themes, query]);

  const handleInstallAndUse = async (th: CommunityTheme) => {
    if (!vaultPath || installingTheme) return;
    setInstallingTheme(th.name);
    try {
      const branch = th.branch || 'HEAD';
      await invoke('install_community_theme', {
        vaultPath,
        repo: th.repo,
        themeName: th.name,
        branch,
      });

      // Recargar instalados
      const updatedInstalled = await themeService.listThemes(vaultPath);
      setInstalled(updatedInstalled);

      // Activar el tema al instante
      setSetting('cssTheme', th.name);
      await themeService.applyThemeByName(vaultPath, th.name);

      showNotice(`${t('appearance.installed')}: ${th.name}`);
      onThemeInstalled?.(th.name);
    } catch (err: unknown) {
      console.error('Error al instalar tema:', err);
      showNotice(`Error al instalar ${th.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstallingTheme(null);
    }
  };

  const handleApplyInstalled = async (name: string) => {
    setSetting('cssTheme', name);
    await themeService.applyThemeByName(vaultPath, name);
    showNotice(`${t('appearance.installed')}: ${name}`);
  };

  if (!isOpen) return null;

  return (
    <div
      className="urano-settings-root modal-container mod-dim"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal modal-community-themes"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '92vw',
          maxWidth: '860px',
          height: '84vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--background-secondary, #1e1e1e)',
          border: '1px solid var(--background-modifier-border, #2a2a2a)',
          borderRadius: '12px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-6 py-4"
          style={{
            borderBottom: '1px solid var(--background-modifier-border, #282828)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <Palette size={20} className="text-[#e06c1b]" />
            <h2 className="text-base font-semibold text-[#dcddde] m-0">
              {t('appearance.communityGallery')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="clickable-icon p-1.5 text-[#888] hover:text-[#dcddde] transition-colors rounded"
              title="Recargar"
              onClick={() => void loadData()}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="clickable-icon p-1.5 text-[#888] hover:text-[#dcddde] transition-colors rounded"
              title={t('general.close') || 'Cerrar'}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 border-b border-[#242424] bg-[var(--background-primary,#161616)] flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('appearance.searchThemes')}
              className="w-full bg-[#202020] text-[#dcddde] text-xs pl-9 pr-3 py-2 rounded-md border border-[#333] focus:border-[#e06c1b] focus:outline-none placeholder-[#666]"
              autoFocus
            />
          </div>
          <span className="text-xs text-[#777] whitespace-nowrap">
            {filteredThemes.length} {t('appearance.themes')}
          </span>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && themes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-[#888]">
              <Loader2 size={32} className="animate-spin text-[#e06c1b]" />
              <p className="text-sm">Cargando temas oficiales de Obsidian...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-[#888] text-center">
              <p className="text-sm text-[#e08a3c]">{error}</p>
              <button
                type="button"
                className="px-4 py-2 bg-[#2a2a2a] text-[#dcddde] text-xs rounded hover:bg-[#333]"
                onClick={() => void loadData()}
              >
                Reintentar
              </button>
            </div>
          ) : filteredThemes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#888] text-center">
              <Palette size={40} className="text-[#444] mb-2" />
              <p className="text-sm">No se encontraron temas coincidentes.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredThemes.map((th) => {
                const isInstalled = installedMap.has(th.name.toLowerCase());
                const isActive = cssTheme.toLowerCase() === th.name.toLowerCase();
                const isInstalling = installingTheme === th.name;

                const branch = th.branch || 'HEAD';
                const screenshotUrl = th.screenshot
                  ? `https://raw.githubusercontent.com/${th.repo}/${branch}/${th.screenshot}`
                  : null;

                return (
                  <div
                    key={th.repo}
                    className={`flex flex-col rounded-xl overflow-hidden bg-[var(--background-primary,#161616)] border transition-all duration-150 ${
                      isActive
                        ? 'border-[#e06c1b] ring-1 ring-[#e06c1b]'
                        : 'border-[#282828] hover:border-[#3a3a3a]'
                    }`}
                  >
                    {/* Screenshot Preview */}
                    <div className="h-36 w-full bg-[#121212] overflow-hidden relative flex items-center justify-center">
                      {screenshotUrl ? (
                        <img
                          src={screenshotUrl}
                          alt={th.name}
                          loading="lazy"
                          className="w-full h-full object-cover object-top"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(15,15,15,0.85)] to-transparent pointer-events-none" />
                      <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between pointer-events-none">
                        <span className="text-xs font-semibold text-white drop-shadow">
                          {th.name}
                        </span>
                        {isActive && (
                          <span className="flex items-center gap-1 text-[11px] bg-[#e06c1b] text-white px-2 py-0.5 rounded-full font-medium shadow">
                            <Check size={12} />
                            En uso
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div className="p-3.5 flex flex-col flex-1 justify-between gap-3">
                      <div>
                        <div className="text-xs text-[#888]">
                          {t('appearance.byAuthor', { author: th.author })}
                        </div>
                        {th.modes && th.modes.length > 0 && (
                          <div className="flex gap-1.5 mt-2">
                            {th.modes.map((mode) => (
                              <span
                                key={mode}
                                className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#242424] text-[#999]"
                              >
                                {mode}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-[#222] flex items-center justify-end">
                        {isActive ? (
                          <span className="text-xs text-[#e06c1b] font-medium py-1 px-2">
                            {t('appearance.installed')}
                          </span>
                        ) : isInstalled ? (
                          <button
                            type="button"
                            className="text-xs px-3 py-1.5 rounded-md bg-[#2a2a2a] hover:bg-[#353535] text-[#dcddde] font-medium transition-colors"
                            onClick={() => void handleApplyInstalled(th.name)}
                          >
                            Usar
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isInstalling}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-[#e06c1b] hover:bg-[#cc5f14] text-white font-medium transition-colors disabled:opacity-50"
                            onClick={() => void handleInstallAndUse(th)}
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                Instalando...
                              </>
                            ) : (
                              <>
                                <Download size={13} />
                                {t('appearance.installAndUse')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
