//! Idiomas personalizados de la comunidad: `<bóveda>/.urano/locales/<code>.json`.
//!
//! Equivalente al "language pack" externo de Obsidian (en `app.js`, si la ruta del idioma
//! contiene `/` se lee con `readFileSync` y se superpone al paquete embebido). Urano los
//! lee todos de la carpeta y el frontend (`localeStore`) los superpone al idioma activo,
//! de modo que se pueden corregir o añadir traducciones sin recompilar la app.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const LOCALES_DIR: &str = ".urano/locales";

#[derive(Serialize)]
pub struct CustomLocaleFile {
    /// Código de idioma = nombre del archivo sin extensión, en minúsculas (`es`, `pt-br`).
    pub code: String,
    /// Contenido JSON crudo; el frontend lo valida y lo aplana.
    pub content: String,
}

fn locales_dir(vault_path: &str) -> PathBuf {
    Path::new(vault_path).join(LOCALES_DIR)
}

/// Lista y lee `.urano/locales/*.json`. Crea la carpeta si no existe para que el usuario
/// sepa dónde dejar sus archivos.
#[tauri::command]
pub fn list_custom_locales(vault_path: String) -> Result<Vec<CustomLocaleFile>, String> {
    let dir = locales_dir(&vault_path);
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;

    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let code = stem.trim().replace('_', "-").to_lowercase();
        if code.is_empty() || code.starts_with('.') {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(content) => out.push(CustomLocaleFile { code, content }),
            Err(e) => log::warn!("No se pudo leer {}: {e}", path.display()),
        }
    }
    out.sort_by(|a, b| a.code.cmp(&b.code));
    Ok(out)
}

/// Ruta absoluta de la carpeta de idiomas de la bóveda (creándola si hace falta).
#[tauri::command]
pub fn get_custom_locales_dir(vault_path: String) -> Result<String, String> {
    let dir = locales_dir(&vault_path);
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Abre una carpeta o archivo con la aplicación predeterminada del sistema.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that_detached(&path).map_err(|e| format!("No se pudo abrir {path}: {e}"))
}
