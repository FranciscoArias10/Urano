use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico",
];

pub const MAX_FILENAME_CHARS: usize = 250;

const FORBIDDEN_FILENAME_CHARS: &[char] = &['*', '"', '\\', '/', '<', '>', ':', '|', '?'];

const INTERNAL_ALLOWED_DOT_DIRS: &[&str] = &[".urano", ".trash", ".obsidian"];

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

/// Public entry point re-exported from `lib.rs` to validate vault create/rename paths before touching disk.
pub fn validate_vault_path(path: &Path, allow_internal_dot_dir: bool) -> Result<(), String> {
    VaultService::validate_vault_path(path, allow_internal_dot_dir)
}

pub struct VaultService;

impl VaultService {
    /// Returns true if `ext` is a native Urano note, canvas, base, PDF, or image extension.
    pub fn is_supported_vault_extension(ext: &str) -> bool {
        ext.eq_ignore_ascii_case("md")
            || ext.eq_ignore_ascii_case("markdown")
            || ext.eq_ignore_ascii_case("canvas")
            || ext.eq_ignore_ascii_case("base")
            || ext.eq_ignore_ascii_case("pdf")
            || IMAGE_EXTENSIONS.iter().any(|&ie| ext.eq_ignore_ascii_case(ie))
    }

    /// 1:1 with Obsidian (`hh(o)` in `app.js`): any file or directory starting with `.` is hidden from the vault index.
    pub fn is_hidden_vault_entry(file_name: &str, _is_dir: bool) -> bool {
        file_name.starts_with('.')
    }

    /// Returns true if `name` is an explicit internal configuration or trash directory (`.urano`, `.trash`, `.obsidian`).
    pub fn is_allowed_internal_dot_dir(name: &str) -> bool {
        INTERNAL_ALLOWED_DOT_DIRS.contains(&name)
    }

    /// Returns true if `stem` matches a Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`).
    pub fn is_windows_reserved_stem(stem: &str) -> bool {
        let upper = stem.trim().to_ascii_uppercase();
        matches!(
            upper.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    }

    /// Checks whether a filename or folder name matches a Windows reserved device name (with or without extensions).
    pub fn is_windows_reserved_name(name: &str) -> bool {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return false;
        }
        if Self::is_windows_reserved_stem(trimmed) {
            return true;
        }
        if let Some((without_last_ext, _)) = trimmed.rsplit_once('.') {
            if !without_last_ext.is_empty() && Self::is_windows_reserved_stem(without_last_ext) {
                return true;
            }
        }
        if let Some((primary_stem, _)) = trimmed.split_once('.') {
            if !primary_stem.is_empty() && Self::is_windows_reserved_stem(primary_stem) {
                return true;
            }
        }
        false
    }

    /// Validates an individual file or folder segment according to Obsidian's 1:1 rules.
    pub fn validate_entry_name(
        raw_name: &str,
        allow_internal_dot_dir: bool,
        check_stem_trailing_dot: bool,
    ) -> Result<(), String> {
        if raw_name.trim().is_empty() {
            return Err("El nombre de archivo no puede estar vacío.".to_string());
        }

        if raw_name == "." || raw_name == ".." {
            return Err("El nombre de archivo no debe empezar con un punto.".to_string());
        }

        if raw_name
            .chars()
            .any(|c| FORBIDDEN_FILENAME_CHARS.contains(&c) || c.is_control())
        {
            return Err(
                "El nombre de archivo no puede contener ninguno de los siguientes caracteres: * \" \\ / < > : | ?"
                    .to_string(),
            );
        }

        if raw_name.starts_with('.') {
            if !(allow_internal_dot_dir && Self::is_allowed_internal_dot_dir(raw_name)) {
                return Err("El nombre de archivo no debe empezar con un punto.".to_string());
            }
            return Ok(());
        }

        if raw_name.ends_with('.') || raw_name.ends_with(' ') {
            return Err(
                "El nombre de archivo no puede terminar con un punto o un espacio.".to_string(),
            );
        }

        if check_stem_trailing_dot {
            if let Some((stem, _ext)) = raw_name.rsplit_once('.') {
                if stem.is_empty() {
                    return Err("El nombre de archivo no debe empezar con un punto.".to_string());
                }
                if stem.ends_with('.') || stem.ends_with(' ') {
                    return Err(
                        "El nombre de archivo no puede terminar con un punto o un espacio."
                            .to_string(),
                    );
                }
            }
        }

        if Self::is_windows_reserved_name(raw_name) {
            let display_stem = raw_name
                .rsplit_once('.')
                .map(|(s, _)| s)
                .filter(|s| !s.is_empty())
                .unwrap_or(raw_name);
            return Err(format!(
                "El nombre de archivo no está permitido: {}",
                display_stem
            ));
        }

        if raw_name.chars().count() > MAX_FILENAME_CHARS {
            return Err(format!(
                "El nombre de archivo no puede superar los {} caracteres.",
                MAX_FILENAME_CHARS
            ));
        }

        Ok(())
    }

    /// Rejects empty paths and any `..` traversal component across the entire path.
    pub fn ensure_no_traversal(path: &Path) -> Result<(), String> {
        let raw = path.to_string_lossy();
        if raw.trim().is_empty() {
            return Err("El nombre de archivo no puede estar vacío.".to_string());
        }

        for seg in raw.split(['/', '\\']) {
            if seg == ".." {
                return Err("Ruta no permitida: contiene navegación '..'.".to_string());
            }
        }

        for comp in path.components() {
            if matches!(comp, Component::ParentDir) {
                return Err("Ruta no permitida: contiene navegación '..'.".to_string());
            }
        }

        Ok(())
    }

    /// Extracts the raw leaf segment directly from the path string before Win32 strips trailing dots/spaces.
    fn extract_raw_leaf(path: &Path, allow_trailing_sep: bool) -> Result<String, String> {
        let raw = path.to_string_lossy();
        let trimmed_all = raw.trim();
        if trimmed_all.is_empty() {
            return Err("El nombre de archivo no puede estar vacío.".to_string());
        }

        let working: &str = if allow_trailing_sep {
            raw.trim_end_matches(['/', '\\'])
        } else {
            if raw.ends_with('/') || raw.ends_with('\\') {
                return Err("El nombre de archivo no puede estar vacío.".to_string());
            }
            &raw
        };

        let leaf = working.rsplit(['/', '\\']).next().unwrap_or("");
        // Reject bare drive roots like `C:` as a file/folder leaf
        if leaf.is_empty() || (leaf.len() == 2 && leaf.ends_with(':')) {
            return Err("El nombre de archivo no puede estar vacío.".to_string());
        }

        Ok(leaf.to_string())
    }

    /// Validates a target path (leaf + any non-existing parent folders that would be created on disk).
    pub fn validate_vault_path(
        path: &Path,
        allow_internal_dot_dir: bool,
    ) -> Result<(), String> {
        Self::ensure_no_traversal(path)?;

        let raw_leaf = Self::extract_raw_leaf(path, allow_internal_dot_dir)?;
        Self::validate_entry_name(
            &raw_leaf,
            allow_internal_dot_dir,
            !allow_internal_dot_dir,
        )?;

        // Also validate any non-existing ancestor folders that `create_dir_all` would newly create,
        // without rejecting existing OS home path segments (e.g. `/home/user/.local/share/Vault`).
        let mut cursor = path.parent();
        while let Some(dir) = cursor {
            if dir.as_os_str().is_empty() || dir.exists() {
                break;
            }
            if let Some(dir_name) = dir.file_name().and_then(|n| n.to_str()) {
                Self::validate_entry_name(dir_name, true, false)?;
            }
            cursor = dir.parent();
        }

        Ok(())
    }

    fn normalize_path_key(path: &Path) -> String {
        path.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    }

    /// Resolves the vault's hidden configuration directory (defaults to `.urano`).
    pub fn resolve_config_dir(vault_path: &Path, config_dir: Option<&str>) -> PathBuf {
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
                !Self::is_hidden_vault_entry(&name, e.file_type().is_dir())
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
    pub fn open_vault(
        vault_path: &Path,
        detect_all: bool,
        config_dir: Option<&str>,
    ) -> Result<Vec<FileItem>, String> {
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

    /// Recursively lists files in a vault, skipping any dot-prefixed entries (`.urano`, `.git`, `.trash`, dotfiles) 1:1 with Obsidian
    pub fn list_files_recursive(
        dir: &Path,
        _root: &Path,
        detect_all: bool,
    ) -> Result<Vec<FileItem>, String> {
        let mut items = Vec::new();

        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();

            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_dir = metadata.is_dir();

            if Self::is_hidden_vault_entry(&file_name, is_dir) {
                continue;
            }

            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            let size = if is_dir { None } else { Some(metadata.len()) };

            if is_dir {
                let children =
                    Self::list_files_recursive(&path, _root, detect_all).unwrap_or_default();
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
                let is_supported = detect_all || Self::is_supported_vault_extension(ext);

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
        Self::ensure_no_traversal(path)?;
        fs::read_to_string(path).map_err(|e| format!("Error al leer archivo: {}", e))
    }

    /// Writes content to a file atomically after validating target name & traversal
    pub fn write_file(path: &Path, content: &str) -> Result<(), String> {
        Self::ensure_no_traversal(path)?;
        let raw_leaf = Self::extract_raw_leaf(path, false)?;
        Self::validate_entry_name(&raw_leaf, false, false)?;

        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        fs::write(path, content).map_err(|e| format!("Error al escribir archivo: {}", e))
    }

    /// Reads binary content of a file
    pub fn read_file_binary(path: &Path) -> Result<Vec<u8>, String> {
        Self::ensure_no_traversal(path)?;
        fs::read(path).map_err(|e| format!("Error al leer binario: {}", e))
    }

    /// Writes binary content to a file after validating target name & traversal
    pub fn write_file_binary(path: &Path, data: &[u8]) -> Result<(), String> {
        Self::validate_vault_path(path, false)?;
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        fs::write(path, data).map_err(|e| format!("Error al escribir binario: {}", e))
    }

    /// Creates a new empty file with full Obsidian 1:1 validation
    pub fn create_file(path: &Path) -> Result<(), String> {
        Self::validate_vault_path(path, false)?;
        if let Some(parent_name) = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
        {
            if parent_name.starts_with('.') {
                return Err("El nombre de archivo no debe empezar con un punto.".to_string());
            }
        }
        if path.exists() {
            return Err("Ya hay un archivo con ese nombre".to_string());
        }
        Self::write_file(path, "")
    }

    /// Creates a new directory with full Obsidian 1:1 validation (allowing explicit internal `.urano`/`.trash`/`.obsidian`)
    pub fn create_folder(path: &Path) -> Result<(), String> {
        Self::validate_vault_path(path, true)?;
        if path.exists() {
            let leaf = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if Self::is_allowed_internal_dot_dir(leaf) {
                return Ok(());
            }
            return Err("Ya hay un archivo con ese nombre".to_string());
        }
        fs::create_dir_all(path).map_err(|e| format!("Error al crear carpeta: {}", e))
    }

    /// Deletes a file or directory
    pub fn delete_item(path: &Path) -> Result<(), String> {
        Self::ensure_no_traversal(path)?;
        if !path.exists() {
            return Ok(());
        }
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|e| format!("Error al eliminar carpeta: {}", e))
        } else {
            fs::remove_file(path).map_err(|e| format!("Error al eliminar archivo: {}", e))
        }
    }

    /// Renames or moves a file/folder, enforcing validation & allowing case-only rename of the same item
    pub fn rename_item(old_path: &Path, new_path: &Path) -> Result<(), String> {
        Self::ensure_no_traversal(old_path)?;
        Self::ensure_no_traversal(new_path)?;

        if !old_path.exists() {
            return Err("El archivo o carpeta de origen no existe.".to_string());
        }

        let is_moving_to_trash = new_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            == Some(".trash");

        if !is_moving_to_trash {
            Self::validate_vault_path(new_path, false)?;
            if let Some(parent_name) = new_path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
            {
                if parent_name.starts_with('.') {
                    return Err("El nombre de archivo no debe empezar con un punto.".to_string());
                }
            }
        }

        let same_case_insensitive =
            Self::normalize_path_key(old_path) == Self::normalize_path_key(new_path);

        if !same_case_insensitive && new_path.exists() {
            return Err("Ya hay un archivo con ese nombre".to_string());
        }

        match fs::rename(old_path, new_path) {
            Ok(()) => Ok(()),
            Err(primary_err) if same_case_insensitive => {
                // Fallback 2-step rename for case-insensitive filesystems (e.g. FAT32/exFAT)
                let nanos = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let parent = old_path.parent().unwrap_or_else(|| Path::new("."));
                let tmp_path = parent.join(format!("__urano_case_rename_{}", nanos));
                fs::rename(old_path, &tmp_path)
                    .map_err(|_| format!("Error al renombrar: {}", primary_err))?;
                if let Err(second_err) = fs::rename(&tmp_path, new_path) {
                    let _ = fs::rename(&tmp_path, old_path);
                    return Err(format!("Error al renombrar: {}", second_err));
                }
                Ok(())
            }
            Err(e) => Err(format!("Error al renombrar: {}", e)),
        }
    }

    /// Reads content of all markdown notes in the vault for fast graph view generation
    pub fn get_vault_notes_content(vault_path: &Path) -> Result<HashMap<String, String>, String> {
        let mut map = HashMap::new();
        for entry in walkdir::WalkDir::new(vault_path)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                !Self::is_hidden_vault_entry(&name, e.file_type().is_dir())
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

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("urano_vault_test_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn welcome_status_detects_empty_and_persists_lock() {
        let dir = make_temp_dir("empty_lock");
        let status = VaultService::get_vault_welcome_status(&dir, None).unwrap();
        assert!(!status.welcome_created);
        assert!(!status.has_documents);

        let welcome_path = dir.join("Bienvenido.md");
        VaultService::write_file(&welcome_path, "Hola").unwrap();
        VaultService::mark_vault_welcome_created(&dir, None).unwrap();

        let status_after = VaultService::get_vault_welcome_status(&dir, None).unwrap();
        assert!(status_after.welcome_created);
        assert!(status_after.has_documents);

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

    #[test]
    fn dotfiles_and_dotfolders_are_hidden_and_blocked_like_obsidian() {
        let dir = make_temp_dir("dotfiles_blocked");

        // External dotfiles already on disk must be hidden from open_vault & get_vault_notes_content
        fs::write(dir.join(".net.png"), [137u8, 80, 78, 71]).unwrap();
        fs::write(dir.join(".secreto.md"), "# oculto").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git").join("HEAD.md"), "ignored").unwrap();
        VaultService::create_file(&dir.join("Visible.md")).unwrap();

        let items = VaultService::open_vault(&dir, true, None).unwrap();
        let names: Vec<String> = items.into_iter().map(|i| i.name).collect();
        assert_eq!(names, vec!["Visible.md".to_string()]);

        let notes_map = VaultService::get_vault_notes_content(&dir).unwrap();
        assert_eq!(notes_map.len(), 1);
        assert!(notes_map.keys().any(|k| k.ends_with("Visible.md")));

        // Creating or renaming to leading-dot names must be rejected
        assert!(VaultService::create_file(&dir.join(".nota.md")).is_err());
        assert!(VaultService::write_file_binary(&dir.join(".net2.png"), &[1, 2, 3]).is_err());
        assert!(VaultService::create_folder(&dir.join(".carpeta")).is_err());
        assert!(VaultService::rename_item(&dir.join("Visible.md"), &dir.join(".oculta.md")).is_err());

        // Explicit internal `.urano` and `.trash` folders remain allowed
        assert!(VaultService::create_folder(&dir.join(".urano")).is_ok());
        assert!(VaultService::create_folder(&dir.join(".trash")).is_ok());
        assert!(VaultService::write_file(&dir.join(".urano").join("settings.json"), "{}").is_ok());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_traversal_forbidden_chars_trailing_dots_and_windows_reserved_names() {
        let dir = make_temp_dir("validation_hardening");

        // Path traversal
        let traversal = PathBuf::from(format!("{}/../escape.md", dir.to_string_lossy()));
        assert!(VaultService::create_file(&traversal).is_err());

        // Forbidden characters
        for bad in ["a*b.md", "a?b.md", "a:b.md", "a|b.md", "a<b.md", "a>b.md", "a\"b.md"] {
            assert!(
                VaultService::create_file(&dir.join(bad)).is_err(),
                "Expected forbidden char failure for {bad}"
            );
        }

        // Trailing dots and spaces
        assert!(VaultService::create_folder(&dir.join("carpeta.")).is_err());
        assert!(VaultService::create_folder(&dir.join("carpeta ")).is_err());
        assert!(VaultService::create_file(&dir.join("nota..md")).is_err());

        // Windows reserved device names (with or without extensions, case-insensitive)
        for reserved in ["CON", "con.md", "PRN.canvas", "AUX.png", "NUL.md", "COM1.md", "LPT9.txt.md"] {
            assert!(
                VaultService::create_file(&dir.join(reserved)).is_err(),
                "Expected Windows reserved failure for {reserved}"
            );
        }

        // Link-unsafe chars (# ^ [ ]) are allowed by OS/Rust layer (Obsidian only warns in UI)
        let unsafe_link_note = dir.join("Nota [borrador] #1 ^ref.md");
        assert!(VaultService::create_file(&unsafe_link_note).is_ok());

        // Case-only rename of the same file succeeds while colliding with another file fails
        let lower_note = dir.join("titulo.md");
        let upper_note = dir.join("Titulo.md");
        let other_note = dir.join("Otra.md");
        VaultService::create_file(&lower_note).unwrap();
        VaultService::create_file(&other_note).unwrap();

        assert!(VaultService::rename_item(&lower_note, &upper_note).is_ok());
        assert!(VaultService::rename_item(&upper_note, &other_note).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
