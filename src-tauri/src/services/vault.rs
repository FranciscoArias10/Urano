use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileItem {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileItem>>,
    pub mtime: Option<u64>,
    pub size: Option<u64>,
}

pub struct VaultService;

impl VaultService {
    /// Opens a vault and returns the tree of markdown files and directories
    pub fn open_vault(vault_path: &Path) -> Result<Vec<FileItem>, String> {
        if !vault_path.exists() {
            return Err("La ruta de la bóveda no existe".to_string());
        }

        // Ensure internal config directory .urano exists
        let urano_dir = vault_path.join(".urano");
        if !urano_dir.exists() {
            let _ = fs::create_dir_all(&urano_dir);
        }

        Self::list_files_recursive(vault_path, vault_path)
    }

    /// Recursively lists files in a vault, skipping hidden directories like .urano or .git
    pub fn list_files_recursive(dir: &Path, _root: &Path) -> Result<Vec<FileItem>, String> {
        let mut items = Vec::new();

        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files and directories (e.g. .git, .urano, .obsidian)
            if file_name.starts_with('.') {
                continue;
            }

            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_dir = metadata.is_dir();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            let size = if is_dir { None } else { Some(metadata.len()) };

            if is_dir {
                let children = Self::list_files_recursive(&path, _root).unwrap_or_default();
                items.push(FileItem {
                    path: path.to_string_lossy().to_string(),
                    name: file_name,
                    is_dir: true,
                    children: Some(children),
                    mtime,
                    size,
                });
            } else {
                // Include markdown files (.md, .markdown), canvas files (.canvas), and base files (.base)
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext.eq_ignore_ascii_case("md")
                    || ext.eq_ignore_ascii_case("markdown")
                    || ext.eq_ignore_ascii_case("canvas")
                    || ext.eq_ignore_ascii_case("base")
                {
                    items.push(FileItem {
                        path: path.to_string_lossy().to_string(),
                        name: file_name,
                        is_dir: false,
                        children: None,
                        mtime,
                        size,
                    });
                }
            }
        }

        // Sort: folders first alphabetically, then files alphabetically
        items.sort_by(|a, b| {
            if a.is_dir == b.is_dir {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        Ok(items)
    }

    /// Reads UTF-8 content of a file
    pub fn read_file(path: &Path) -> Result<String, String> {
        fs::read_to_string(path).map_err(|e| format!("Error al leer archivo: {}", e))
    }

    /// Writes content to a file atomically
    pub fn write_file(path: &Path, content: &str) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        fs::write(path, content).map_err(|e| format!("Error al escribir archivo: {}", e))
    }

    /// Creates a new empty file
    pub fn create_file(path: &Path) -> Result<(), String> {
        if path.exists() {
            return Err("El archivo ya existe".to_string());
        }
        Self::write_file(path, "")
    }

    /// Creates a new directory
    pub fn create_folder(path: &Path) -> Result<(), String> {
        if path.exists() {
            return Err("La carpeta ya existe".to_string());
        }
        fs::create_dir_all(path).map_err(|e| format!("Error al crear carpeta: {}", e))
    }

    /// Deletes a file or directory
    pub fn delete_item(path: &Path) -> Result<(), String> {
        if !path.exists() {
            return Ok(());
        }
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|e| format!("Error al eliminar carpeta: {}", e))
        } else {
            fs::remove_file(path).map_err(|e| format!("Error al eliminar archivo: {}", e))
        }
    }

    /// Renames or moves a file/folder
    pub fn rename_item(old_path: &Path, new_path: &Path) -> Result<(), String> {
        fs::rename(old_path, new_path).map_err(|e| format!("Error al renombrar: {}", e))
    }

    /// Reads content of all markdown notes in the vault for fast graph view generation
    pub fn get_vault_notes_content(vault_path: &Path) -> Result<HashMap<String, String>, String> {
        let mut map = HashMap::new();
        for entry in walkdir::WalkDir::new(vault_path)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.')
            })
            .flatten()
        {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") {
                    if let Ok(content) = fs::read_to_string(path) {
                        map.insert(path.to_string_lossy().to_string(), content);
                    }
                }
            }
        }
        Ok(map)
    }
}
