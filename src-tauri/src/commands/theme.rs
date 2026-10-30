//! Manejo de temas y fragmentos (snippets) compatibles con Obsidian y Urano.
//!
//! Soporta doble ruta en la bóveda:
//! - `<vault>/.urano/themes/<name>/theme.css` + `manifest.json`
//! - `<vault>/.obsidian/themes/<name>/theme.css` + `manifest.json`
//! - `<vault>/.urano/snippets/*.css`
//! - `<vault>/.obsidian/snippets/*.css`

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct InstalledTheme {
    pub name: String,
    pub version: Option<String>,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub dir: String,
    pub source: String,
    pub css_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SnippetInfo {
    pub name: String,
    pub source: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
struct RawManifest {
    name: Option<String>,
    version: Option<String>,
    author: Option<String>,
    #[serde(rename = "authorUrl")]
    author_url: Option<String>,
}

fn get_theme_dirs(vault_path: &str) -> Vec<(PathBuf, &'static str)> {
    vec![
        (Path::new(vault_path).join(".urano").join("themes"), "urano"),
        (Path::new(vault_path).join(".obsidian").join("themes"), "obsidian"),
    ]
}

fn get_snippet_dirs(vault_path: &str) -> Vec<(PathBuf, &'static str)> {
    vec![
        (Path::new(vault_path).join(".urano").join("snippets"), "urano"),
        (Path::new(vault_path).join(".obsidian").join("snippets"), "obsidian"),
    ]
}

/// Lista todos los temas instalados en `.urano/themes` y `.obsidian/themes`.
#[tauri::command]
pub fn list_installed_themes(vault_path: String) -> Result<Vec<InstalledTheme>, String> {
    let mut themes = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (dir, source) in get_theme_dirs(&vault_path) {
        if !dir.exists() {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let theme_css = path.join("theme.css");
            if !theme_css.is_file() {
                continue;
            }

            let folder_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };

            if seen.contains(&folder_name) {
                continue;
            }

            let manifest_path = path.join("manifest.json");
            let mut name = folder_name.clone();
            let mut version = None;
            let mut author = None;
            let mut author_url = None;

            if manifest_path.is_file() {
                if let Ok(raw_str) = fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) = serde_json::from_str::<RawManifest>(&raw_str) {
                        if let Some(n) = manifest.name {
                            if !n.trim().is_empty() {
                                name = n;
                            }
                        }
                        version = manifest.version;
                        author = manifest.author;
                        author_url = manifest.author_url;
                    }
                }
            }

            seen.insert(folder_name);
            themes.push(InstalledTheme {
                name,
                version,
                author,
                author_url,
                dir: path.to_string_lossy().into_owned(),
                source: source.to_string(),
                css_path: theme_css.to_string_lossy().into_owned(),
            });
        }
    }

    themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(themes)
}

/// Lee el contenido de `theme.css` para el tema especificado.
#[tauri::command]
pub fn read_theme_css(vault_path: String, theme_name: String) -> Result<String, String> {
    for (dir, _) in get_theme_dirs(&vault_path) {
        let css_file = dir.join(&theme_name).join("theme.css");
        if css_file.is_file() {
            return fs::read_to_string(&css_file).map_err(|e| e.to_string());
        }
        // También intentar coincidir por el nombre de la carpeta si es diferente
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let manifest_file = p.join("manifest.json");
                        if manifest_file.is_file() {
                            if let Ok(str_data) = fs::read_to_string(&manifest_file) {
                                if let Ok(m) = serde_json::from_str::<RawManifest>(&str_data) {
                                    if m.name.as_deref() == Some(&theme_name) {
                                        let c = p.join("theme.css");
                                        if c.is_file() {
                                            return fs::read_to_string(&c).map_err(|e| e.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Err(format!("No se encontró el tema: {theme_name}"))
}

/// Desinstala un tema eliminando su carpeta de la bóveda.
#[tauri::command]
pub fn uninstall_theme(vault_path: String, theme_name: String) -> Result<(), String> {
    for (dir, _) in get_theme_dirs(&vault_path) {
        let theme_folder = dir.join(&theme_name);
        if theme_folder.is_dir() {
            fs::remove_dir_all(&theme_folder).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Ok(())
}

/// Abre la carpeta `themes` en el explorador de archivos nativo del SO.
#[tauri::command]
pub fn open_themes_folder(vault_path: String) -> Result<(), String> {
    let dir = Path::new(&vault_path).join(".urano").join("themes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that_detached(&dir).map_err(|e| format!("No se pudo abrir la carpeta de temas: {e}"))
}

/// Lista todos los archivos `.css` de snippets en `.urano/snippets` y `.obsidian/snippets`.
#[tauri::command]
pub fn list_css_snippets(vault_path: String) -> Result<Vec<SnippetInfo>, String> {
    let mut snippets = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for (dir, source) in get_snippet_dirs(&vault_path) {
        if !dir.exists() {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("css") {
                continue;
            }

            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            if stem.starts_with('.') {
                continue;
            }

            if seen.contains(stem) {
                continue;
            }
            seen.insert(stem.to_string());

            snippets.push(SnippetInfo {
                name: stem.to_string(),
                source: source.to_string(),
                path: path.to_string_lossy().into_owned(),
            });
        }
    }

    snippets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(snippets)
}

/// Lee el contenido CSS de un snippet.
#[tauri::command]
pub fn read_snippet_css(vault_path: String, snippet_name: String) -> Result<String, String> {
    let filename = format!("{snippet_name}.css");
    for (dir, _) in get_snippet_dirs(&vault_path) {
        let file = dir.join(&filename);
        if file.is_file() {
            return fs::read_to_string(&file).map_err(|e| e.to_string());
        }
    }
    Err(format!("No se encontró el snippet: {snippet_name}"))
}

/// Abre la carpeta de snippets en el explorador nativo.
#[tauri::command]
pub fn open_snippets_folder(vault_path: String) -> Result<(), String> {
    let dir = Path::new(&vault_path).join(".urano").join("snippets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that_detached(&dir).map_err(|e| format!("No se pudo abrir la carpeta de fragmentos: {e}"))
}
