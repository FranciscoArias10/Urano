/**
 * Type definitions for Obsidian-compatible themes, snippets, and fonts in Urano.
 */

export interface CommunityTheme {
  name: string;
  author: string;
  repo: string;
  screenshot?: string;
  modes?: ('dark' | 'light')[];
  description?: string;
  version?: string;
  branch?: string;
  legacy?: boolean;
}

export interface ThemeManifest {
  name: string;
  version?: string;
  minAppVersion?: string;
  author?: string;
  authorUrl?: string;
  fundingUrl?: string;
}

export interface InstalledTheme {
  name: string;
  version?: string;
  author?: string;
  authorUrl?: string;
  dir: string;
  source: 'urano' | 'obsidian';
  cssPath: string;
}

export interface CssSnippet {
  name: string;
  enabled: boolean;
  source: 'urano' | 'obsidian';
  path: string;
}
