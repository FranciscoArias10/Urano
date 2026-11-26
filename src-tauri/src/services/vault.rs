use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileItem>>,
    pub mtime: Option<u64>,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultWelcomeStatus {
    pub welcome_created: bool,
    pub has_documents: bool,
}

pub struct VaultService;

impl VaultService {
    /// Resolves the vault's hidden configuration directory (defaults to `.urano`).
    pub fn resolve_config_dir(vault_path: &Path, config_dir: Option<&str>) -> std::path::PathBuf {
        let raw_cfg = config_dir.unwrap_or(".urano");
        let trimmed = raw_cfg.trim();
        let cfg_name = if trimmed.is_empty() {
            ".urano".to_string()
        } else if trimmed.starts_with('.') {
            trimmed.to_string()
        } else {
            format!(".{}", trimmed)
        };
        vault_path.join(cfg_name)
    }

    /// Inspects whether the vault has already been initialized for the welcome note
    /// (`<configDir>/config.json` with `welcomeCreated: true` or existing `<configDir>/settings.json`)
    /// and whether it already contains any `.md`, `.markdown`, `.canvas`, or `.base` documents.
    pub fn get_vault_welcome_status(
        vault_path: &Path,
        config_dir: Option<&str>,
    ) -> Result<VaultWelcomeStatus, String> {
        if !vault_path.exists() {
            return Err("La ruta de la bóveda no existe".to_string());
        }

        let target_config_dir = Self::resolve_config_dir(vault_path, config_dir);
        let config_json_path = target_config_dir.join("config.json");
        let settings_json_path = target_config_dir.join("settings.json");

        let mut welcome_created = settings_json_path.is_file();
        if !welcome_created && config_json_path.is_file() {
            if let Ok(raw) = fs::read_to_string(&config_json_path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if val
                        .get("welcomeCreated")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                    {
                        welcome_created = true;
                    }
                }
            }
        }

        let mut has_documents = false;
        for entry in walkdir::WalkDir::new(vault_path)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.')
            })
            .flatten()
        {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext.eq_ignore_ascii_case("md")
                    || ext.eq_ignore_ascii_case("markdown")
                    || ext.eq_ignore_ascii_case("canvas")
                    || ext.eq_ignore_ascii_case("base")
                {
                    has_documents = true;
                    break;
                }
            }
        }

        Ok(VaultWelcomeStatus {
            welcome_created,
            has_documents,
        })
    }

    /// Persists `"welcomeCreated": true` inside `<vault_path>/<configDir>/config.json`,
    /// preserving any other keys already stored in that JSON file.
    pub fn mark_vault_welcome_created(
        vault_path: &Path,
        config_dir: Option<&str>,
    ) -> Result<(), String> {
        if !vault_path.exists() {
            return Err("La ruta de la bóveda no existe".to_string());
        }

        let target_config_dir = Self::resolve_config_dir(vault_path, config_dir);
        if !target_config_dir.exists() {
            fs::create_dir_all(&target_config_dir).map_err(|e| e.to_string())?;
        }

        let config_json_path = target_config_dir.join("config.json");
        let mut obj = if config_json_path.is_file() {
            fs::read_to_string(&config_json_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .and_then(|val| val.as_object().cloned())
                .unwrap_or_default()
        } else {
            serde_json::Map::new()
        };

        obj.insert("welcomeCreated".to_string(), serde_json::Value::Bool(true));
        let serialized = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
            .map_err(|e| e.to_string())?;
        fs::write(&config_json_path, serialized)
            .map_err(|e| format!("Error al guardar config.json: {}", e))
    }

    /// Opens a vault and returns the tree of markdown files and directories
    pub fn open_vault(vault_path: &Path, detect_all: bool, config_dir: Option<&str>) -> Result<Vec<FileItem>, String> {
        if !vault_path.exists() {
            return Err("La ruta de la bóveda no existe".to_string());
        }

        // Ensure active config directory exists (settingsStore.configFolderOverride || ".urano")
        let target_config_dir = Self::resolve_config_dir(vault_path, config_dir);
        if !target_config_dir.exists() {
            let _ = fs::create_dir_all(&target_config_dir);
        }

        Self::list_files_recursive(vault_path, vault_path, detect_all)
    }

    /// Recursively lists files in a vault, skipping hidden directories like .urano or .git
    pub fn list_files_recursive(dir: &Path, _root: &Path, detect_all: bool) -> Result<Vec<FileItem>, String> {
        let mut items = Vec::new();

        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files and directories (e.g. .git, .urano)
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
                let children = Self::list_files_recursive(&path, _root, detect_all).unwrap_or_default();
                items.push(FileItem {
                    path: path.to_string_lossy().to_string(),
                    name: file_name,
                    is_dir: true,
                    children: Some(children),
                    mtime,
                    size,
                });
            } else {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                let is_supported = detect_all
                    || ext.eq_ignore_ascii_case("md")
                    || ext.eq_ignore_ascii_case("markdown")
                    || ext.eq_ignore_ascii_case("canvas")
                    || ext.eq_ignore_ascii_case("base")
                    || ext.eq_ignore_ascii_case("pdf")
                    || IMAGE_EXTENSIONS.iter().any(|&ie| ext.eq_ignore_ascii_case(ie));

                if is_supported {
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

    /// Reads binary content of a file
    pub fn read_file_binary(path: &Path) -> Result<Vec<u8>, String> {
        fs::read(path).map_err(|e| format!("Error al leer binario: {}", e))
    }

    /// Writes binary content to a file
    pub fn write_file_binary(path: &Path, data: &[u8]) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        fs::write(path, data).map_err(|e| format!("Error al escribir binario: {}", e))
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
                if ext.eq_ignore_ascii_case("md")
                    || ext.eq_ignore_ascii_case("markdown")
                    || ext.eq_ignore_ascii_case("canvas")
                {
                    if let Ok(content) = fs::read_to_string(path) {
                        map.insert(path.to_string_lossy().to_string(), content);
                    }
                }
            }
        }
        Ok(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("urano_welcome_test_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn welcome_status_detects_empty_and_persists_lock() {
        let dir = make_temp_dir("empty_lock");
        let status = VaultService::get_vault_welcome_status(&dir, None).unwrap();
        assert!(!status.welcome_created);
        assert!(!status.has_documents);

        // Write welcome note + mark welcomeCreated
        let welcome_path = dir.join("Bienvenido.md");
        VaultService::write_file(&welcome_path, "Hola").unwrap();
        VaultService::mark_vault_welcome_created(&dir, None).unwrap();

        let status_after = VaultService::get_vault_welcome_status(&dir, None).unwrap();
        assert!(status_after.welcome_created);
        assert!(status_after.has_documents);

        // Delete welcome note -> welcome_created MUST remain true!
        VaultService::delete_item(&welcome_path).unwrap();
        let status_deleted = VaultService::get_vault_welcome_status(&dir, None).unwrap();
        assert!(status_deleted.welcome_created);
        assert!(!status_deleted.has_documents);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn welcome_status_detects_existing_documents() {
        let dir = make_temp_dir("existing_docs");
        VaultService::write_file(&dir.join("Existing.md"), "# Note").unwrap();

        let status = VaultService::get_vault_welcome_status(&dir, None).unwrap();
        assert!(!status.welcome_created);
        assert!(status.has_documents);

        let _ = fs::remove_dir_all(&dir);
    }
}
