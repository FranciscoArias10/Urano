use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use rand::RngCore;
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Response, Server};
use url::Url;
use walkdir::WalkDir;

pub const DEFAULT_CLIENT_ID: &str = "";
pub const DEFAULT_CLIENT_SECRET: &str = "";
pub const ROOT_FOLDER_NAME: &str = "Urano Vaults";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleUserProfile {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub client_id: String,
    pub client_secret: String,
    pub user: Option<GoogleUserProfile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteVaultInfo {
    pub id: String,
    pub name: String,
    pub modified_time: Option<String>,
    pub file_count: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncSummary {
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub conflicts: usize,
    /// Files that failed to upload/download in this pass (the sync keeps going).
    pub errors: usize,
    /// Files tracked in the vault after this pass.
    pub total: usize,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestFileEntry {
    pub drive_id: String,
    pub modified_ms: i64,
    pub hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DriveSyncManifest {
    pub vault_name: String,
    pub remote_folder_id: String,
    pub last_synced_at: i64,
    pub files: HashMap<String, ManifestFileEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DriveItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "md5Checksum")]
    pub md5_checksum: Option<String>,
    #[serde(rename = "modifiedTime")]
    pub modified_time: Option<String>,
    pub trashed: Option<bool>,
    pub parents: Option<Vec<String>>,
}

/// Event emitted to the webview (`drive-sync:log`) for every file operation, so the
/// Settings "Activity log" shows per-file entries like Obsidian's sync log.
/// `kind`: `upload` | `download` | `trash` | `local_trash` | `conflict`.
#[derive(Debug, Serialize, Clone)]
pub struct SyncLogEvent {
    pub kind: String,
    pub file: Option<String>,
    pub detail: Option<String>,
}

fn emit_log(app: &AppHandle, kind: &str, file: Option<&str>, detail: Option<&str>) {
    let _ = app.emit(
        "drive-sync:log",
        SyncLogEvent {
            kind: kind.to_string(),
            file: file.map(|s| s.to_string()),
            detail: detail.map(|s| s.to_string()),
        },
    );
}

/// Live progress emitted to the webview (`drive-sync:progress`) so the Google Drive modal and
/// the status bar can show "Sincronizando… 3/12 · nota.md".
/// `phase`: `scan` | `upload` | `download` | `done`.
#[derive(Debug, Serialize, Clone)]
pub struct SyncProgressEvent {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub file: Option<String>,
}

fn emit_progress(app: &AppHandle, phase: &str, current: usize, total: usize, file: Option<&str>) {
    let _ = app.emit(
        "drive-sync:progress",
        SyncProgressEvent {
            phase: phase.to_string(),
            current,
            total,
            file: file.map(|s| s.to_string()),
        },
    );
}

/// Parses one `KEY=value` line of a `.env` file. Supports `export KEY=value`, inline
/// comments after whitespace and single/double quoted values.
fn parse_dotenv_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let line = line.strip_prefix("export ").unwrap_or(line).trim();
    let (key, value) = line.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    let value = value.trim();
    let value = if let Some(quoted) = value.strip_prefix('"') {
        // Keep spaces inside quotes, stop at the closing quote when a comment follows.
        quoted.split('"').next().unwrap_or(quoted)
    } else if let Some(quoted) = value.strip_prefix('\'') {
        quoted.split('\'').next().unwrap_or(quoted)
    } else {
        value.split(" #").next().unwrap_or(value).trim()
    };
    Some((key.to_string(), value.to_string()))
}

/// Every `.env` the backend should look at, in priority order. `cargo` / `tauri dev`
/// run from `src-tauri/`, so both `src-tauri/.env` and the project root `../.env` are
/// covered (plus the executable folder for bundled builds).
fn dotenv_candidates() -> Vec<PathBuf> {
    fn push_unique(list: &mut Vec<PathBuf>, path: PathBuf) {
        if !list.iter().any(|existing| existing == &path) {
            list.push(path);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        push_unique(&mut candidates, cwd.join(".env"));
        push_unique(&mut candidates, cwd.join("..").join(".env"));
        let mut dir = cwd.parent();
        for _ in 0..3 {
            let Some(d) = dir else { break };
            push_unique(&mut candidates, d.join(".env"));
            dir = d.parent();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            push_unique(&mut candidates, dir.join(".env"));
        }
    }
    candidates
}

/// Loads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and anything else) from every `.env`
/// found for the current working directory. Variables already present in the environment
/// are never overridden. No external crate needed.
pub fn load_dotenv() {
    for path in dotenv_candidates() {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let mut loaded = 0;
        for raw_line in content.lines() {
            let Some((key, value)) = parse_dotenv_line(raw_line) else {
                continue;
            };
            if value.trim().is_empty() || std::env::var_os(&key).is_some() {
                continue;
            }
            std::env::set_var(&key, &value);
            loaded += 1;
        }
        if loaded > 0 {
            log::info!("Cargadas {} variables desde {}", loaded, path.display());
        }
    }
}

/// Reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: first the process environment and,
/// only if missing, the manual `.env` / `../.env` lookup. This keeps `tauri dev`
/// (`cwd = src-tauri/`) and release builds working with the same project-root `.env`.
fn env_or_dotenv(key: &str) -> Option<String> {
    if let Ok(value) = std::env::var(key) {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    for path in dotenv_candidates() {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for raw_line in content.lines() {
            if let Some((found_key, value)) = parse_dotenv_line(raw_line) {
                if found_key == key && !value.trim().is_empty() {
                    let value = value.trim().to_string();
                    std::env::set_var(key, &value);
                    return Some(value);
                }
            }
        }
    }
    None
}


/// Moves a local file to `<vault>/.urano/trash/<rel_path>` instead of deleting it outright.
fn move_to_local_trash(vault_path: &Path, rel_path: &str, abs_path: &Path) {
    let dest = vault_path.join(".urano").join("trash").join(rel_path);
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::rename(abs_path, &dest).is_err() {
        if fs::copy(abs_path, &dest).is_ok() {
            if let Err(err) = fs::remove_file(abs_path) {
                eprintln!(
                    "[Drive Sync Error] No se pudo borrar {} tras moverlo a la papelera: {}",
                    abs_path.display(),
                    err
                );
            }
        } else {
            eprintln!(
                "[Drive Sync Error] No se pudo mover {} a la papelera local",
                abs_path.display()
            );
        }
    }
}

/// `notes/Idea.md` → `notes/Idea (Conflicto 2026-11-03_10-15).md`, keeping the extension.
fn conflict_file_name(rel_path: &str, stamp: &str) -> String {
    match rel_path.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !stem.ends_with('/') && !ext.contains('/') => {
            format!("{} (Conflicto {}).{}", stem, stamp, ext)
        }
        _ => format!("{} (Conflicto {})", rel_path, stamp),
    }
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Dark page with the Urano logo served to the browser once Google redirects back to the
/// loopback server (success: "¡Sesión iniciada en Urano!…"; failure: the OAuth error).
fn oauth_result_page(success: bool, error: Option<&str>) -> String {
    const TEMPLATE: &str = r##"<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Urano · {{TITLE}}</title>
  <style>
    body { background: #141416; color: #e5e5e5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #1c1c1f; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 40px 48px; text-align: center; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6); max-width: 440px; animation: pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
    @keyframes pop { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    .logo { width: 76px; height: 76px; margin: 0 auto 18px; display: block; filter: drop-shadow(0 10px 24px rgba(234, 88, 12, 0.35)); }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 12px; color: #ffffff; }
    p { font-size: 14px; line-height: 1.5; color: #9e9ea7; margin: 0; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 500; margin-top: 24px; background: {{BADGE_BG}}; color: {{BADGE_FG}}; }
  </style>
</head>
<body>
  <div class="card">
    <svg class="logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Urano">
      <defs>
        <linearGradient id="uranoFacetTop" x1="50" y1="8" x2="32" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ff8c42"/><stop offset="100%" stop-color="#ea580c"/></linearGradient>
        <linearGradient id="uranoFacetRight" x1="50" y1="8" x2="78" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fba160"/><stop offset="100%" stop-color="#d9480f"/></linearGradient>
        <linearGradient id="uranoFacetCenter" x1="32" y1="42" x2="68" y2="62" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffd166"/><stop offset="50%" stop-color="#f97316"/><stop offset="100%" stop-color="#c2410c"/></linearGradient>
        <linearGradient id="uranoFacetLeft" x1="16" y1="48" x2="42" y2="78" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ea580c"/><stop offset="100%" stop-color="#9a3412"/></linearGradient>
        <linearGradient id="uranoFacetBottomRight" x1="78" y1="38" x2="52" y2="92" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#d9480f"/><stop offset="100%" stop-color="#7c2d12"/></linearGradient>
        <linearGradient id="uranoFacetBottom" x1="42" y1="78" x2="52" y2="92" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#9a3412"/><stop offset="100%" stop-color="#431407"/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="28" fill="#f97316" opacity="0.22"/>
      <g>
        <polygon points="50,8 24,34 35,46 50,38" fill="url(#uranoFacetTop)" stroke="#ffb27d" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="50,8 50,38 72,42 80,26" fill="url(#uranoFacetRight)" stroke="#ffc49b" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="50,38 35,46 44,66 65,60 72,42" fill="url(#uranoFacetCenter)" stroke="#ffe49e" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="24,34 14,56 30,70 35,46" fill="url(#uranoFacetLeft)" stroke="#f97316" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="80,26 72,42 86,60 88,44" fill="#c2410c" stroke="#f97316" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="72,42 65,60 52,92 86,60" fill="url(#uranoFacetBottomRight)" stroke="#ea580c" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="35,46 30,70 52,92 44,66" fill="#9a3412" stroke="#ea580c" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="44,66 52,92 65,60" fill="url(#uranoFacetBottom)" stroke="#ea580c" stroke-width="0.8" stroke-linejoin="round"/>
        <polygon points="50,42 42,48 48,58 56,52" fill="#fff7ed" opacity="0.65"/>
      </g>
    </svg>
    <h1>{{TITLE}}</h1>
    <p>{{BODY}}</p>
    <div class="badge">{{BADGE}}</div>
  </div>
  {{SCRIPT}}
</body>
</html>"##;

    if success {
        TEMPLATE
            .replace("{{TITLE}}", "¡Sesión iniciada en Urano!")
            .replace(
                "{{BODY}}",
                "Tu cuenta de Google ha sido conectada con éxito. Ya puedes cerrar esta ventana y volver a la aplicación.",
            )
            .replace("{{BADGE}}", "✓ Sesión lista para sincronizar")
            .replace("{{BADGE_BG}}", "rgba(68, 207, 110, 0.12)")
            .replace("{{BADGE_FG}}", "#44cf6e")
            .replace(
                "{{SCRIPT}}",
                "<script>setTimeout(function () { try { window.close(); } catch (e) {} }, 3500);</script>",
            )
    } else {
        let badge = match error {
            Some(code) => format!("✕ {}", html_escape(code)),
            None => "✕ Sin código de autorización".to_string(),
        };
        TEMPLATE
            .replace("{{TITLE}}", "No se pudo iniciar sesión")
            .replace(
                "{{BODY}}",
                "Google no autorizó el acceso a Urano. Cierra esta ventana y vuelve a intentarlo desde la aplicación.",
            )
            .replace("{{BADGE}}", &badge)
            .replace("{{BADGE_BG}}", "rgba(251, 70, 76, 0.12)")
            .replace("{{BADGE_FG}}", "#fb464c")
            .replace("{{SCRIPT}}", "")
    }
}

/* ============================================================================
   Helper Functions (Paths & Credentials)
   ============================================================================ */

fn get_app_data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        return dir;
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".config").join("urano");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn get_auth_file_path(app: &AppHandle) -> PathBuf {
    get_app_data_dir(app).join("google_auth.json")
}

/// OAuth client used for "Sign in with Google". Never shown in the UI: `.env`
/// (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) overrides the client baked into the
/// binary. If the process env does not carry them we read `.env` and `../.env` manually.
fn resolve_credentials() -> (String, String) {
    if let (Some(env_id), Some(env_secret)) = (
        env_or_dotenv("GOOGLE_CLIENT_ID"),
        env_or_dotenv("GOOGLE_CLIENT_SECRET"),
    ) {
        if !env_id.trim().is_empty() && !env_secret.trim().is_empty() {
            return (env_id.trim().to_string(), env_secret.trim().to_string());
        }
    }
    (DEFAULT_CLIENT_ID.to_string(), DEFAULT_CLIENT_SECRET.to_string())
}

fn compute_md5(data: &[u8]) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn generate_pkce() -> (String, String) {
    let mut random_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut random_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(random_bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    (verifier, challenge)
}

fn should_ignore_rel_path(rel_path: &str) -> bool {
    let lower = rel_path.to_lowercase();
    if lower == ".ds_store" || lower.ends_with("/.ds_store") {
        return true;
    }
    if lower == "thumbs.db" || lower.ends_with("/thumbs.db") {
        return true;
    }
    if lower.starts_with(".git/") || lower == ".git" {
        return true;
    }
    if lower.starts_with("node_modules/") || lower.contains("/node_modules/") {
        return true;
    }
    if lower.starts_with(".urano/sync.db")
        || lower.starts_with(".urano/drive_sync_manifest.json")
        || lower.starts_with(".urano/trash/")
    {
        return true;
    }
    if lower.ends_with("~") || lower.ends_with(".tmp") {
        return true;
    }
    false
}

fn get_mime_type(file_name: &str) -> &'static str {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "text/markdown"
    } else if lower.ends_with(".canvas") || lower.ends_with(".json") || lower.ends_with(".base") {
        "application/json"
    } else if lower.ends_with(".txt") {
        "text/plain"
    } else if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

/* ============================================================================
   OAuth Token Management & Silent Refresh
   ============================================================================ */

/// Keeps Google's raw error body readable without dumping megabytes into the UI/log.
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let preview: String = text.chars().take(max).collect();
        format!("{}…", preview)
    }
}

/// Builds an error string that always carries the HTTP status (so callers can detect a
/// 401 and retry after refreshing the token) plus the exact body returned by Google.
async fn response_error(context: &str, resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    let body = body.trim();
    if body.is_empty() {
        format!("{} (HTTP {})", context, status.as_u16())
    } else {
        format!(
            "{} (HTTP {}): {}",
            context,
            status.as_u16(),
            truncate_chars(body, 1200)
        )
    }
}

/// True when Google rejected the access token (expired/revoked) and a refresh + retry is
/// worth attempting. Permission errors (403) are deliberately not retried.
fn is_auth_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    error.contains("(HTTP 401)")
        || lower.contains("401 unauthorized")
        || lower.contains("invalid credentials")
        || lower.contains("invalid authentication credentials")
        || lower.contains("unauthenticated")
}

async fn ensure_valid_token_impl(app: &AppHandle, force_refresh: bool) -> Result<String, String> {
    let auth_path = get_auth_file_path(app);
    if !auth_path.exists() {
        // Fallback: check ~/.config/urano/tokens.json legacy path
        let legacy_path = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
            .join(".config")
            .join("urano")
            .join("tokens.json");
        if legacy_path.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_path) {
                let _ = fs::write(&auth_path, content);
            }
        }
    }

    if !auth_path.exists() {
        let err = "No se ha iniciado sesión en Google Drive".to_string();
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }

    let data = fs::read_to_string(&auth_path).map_err(|e| {
        let err = format!("No se pudo leer el archivo de sesión de Google: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })?;
    let mut stored: StoredTokens = serde_json::from_str(&data).map_err(|e| {
        let err = format!("El archivo de sesión de Google está corrupto: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })?;

    let now = Utc::now().timestamp();
    if !force_refresh && now < stored.expires_at - 60 {
        return Ok(stored.access_token);
    }

    let refresh_token = stored
        .refresh_token
        .as_ref()
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| {
            let err = "No hay refresh token disponible. Inicie sesión nuevamente.".to_string();
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?
        .clone();

    // If the stored client credentials are empty (older login or a changed .env), fall
    // back to the environment / project-root .env.
    if stored.client_id.trim().is_empty() || stored.client_secret.trim().is_empty() {
        let (client_id, client_secret) = resolve_credentials();
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Credenciales de Google OAuth no configuradas. Por favor configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env".to_string());
    }
        stored.client_id = client_id;
        stored.client_secret = client_secret;
    }

    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", stored.client_id.as_str()),
            ("client_secret", stored.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| {
            let err = format!("Error contactando servidor de Google: {}", e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;

    if !resp.status().is_success() {
        let err = response_error("Google rechazó la renovación de sesión", resp).await;
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }

    #[derive(Deserialize)]
    struct RefreshResp {
        access_token: String,
        expires_in: i64,
    }

    let ref_data: RefreshResp = resp.json().await.map_err(|e| {
        let err = format!("Error leyendo la respuesta de renovación de Google: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })?;
    stored.access_token = ref_data.access_token.clone();
    stored.expires_at = now + ref_data.expires_in - 60;

    let _ = fs::write(
        &auth_path,
        serde_json::to_string_pretty(&stored).unwrap_or_default(),
    );

    Ok(stored.access_token)
}

/// Returns a valid access token, refreshing it with the stored refresh token when it has
/// expired (or is about to expire).
pub async fn ensure_valid_token(app: &AppHandle) -> Result<String, String> {
    ensure_valid_token_impl(app, false).await
}

/// Forces a refresh even when `expires_at` still looks valid. Used after a 401: the token
/// can be revoked before its advertised expiry.
pub async fn refresh_access_token(app: &AppHandle) -> Result<String, String> {
    ensure_valid_token_impl(app, true).await
}


/* ============================================================================
   Google Drive API v3 Primitives
   ============================================================================ */

async fn find_or_create_remote_folder(
    client: &reqwest::Client,
    token: &str,
    folder_name: &str,
    parent_id: Option<&str>,
) -> Result<String, String> {
    let mut query = format!(
        "name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        folder_name.replace('\'', "\\'")
    );
    if let Some(parent) = parent_id {
        query.push_str(&format!(" and '{}' in parents", parent));
    }

    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,mimeType)",
        urlencoding::encode(&query)
    );

    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            let err = format!("Error consultando carpetas en Google Drive: {}", e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;

    if !resp.status().is_success() {
        let err = response_error("Error consultando carpetas en Google Drive", resp).await;
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }

    #[derive(Deserialize)]
    struct ListResponse {
        files: Option<Vec<DriveItem>>,
    }

    let list_data: ListResponse = resp.json().await.map_err(|e| {
        let err = format!("Error leyendo la lista de carpetas de Google Drive: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })?;
    if let Some(files) = list_data.files {
        if let Some(first) = files.first() {
            return Ok(first.id.clone());
        }
    }

    // Create folder
    let mut metadata = serde_json::json!({
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder"
    });
    if let Some(parent) = parent_id {
        metadata["parents"] = serde_json::json!([parent]);
    }

    let create_resp = client
        .post("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType")
        .bearer_auth(token)
        .header(CONTENT_TYPE, "application/json")
        .json(&metadata)
        .send()
        .await
        .map_err(|e| {
            let err = format!("Error creando la carpeta «{}» en Google Drive: {}", folder_name, e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;

    if !create_resp.status().is_success() {
        let err = response_error(
            &format!("Error creando la carpeta «{}» en Google Drive", folder_name),
            create_resp,
        )
        .await;
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }

    let created: DriveItem = create_resp.json().await.map_err(|e| {
        let err = format!("Error leyendo la carpeta creada en Google Drive: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })?;
    Ok(created.id)
}

async fn list_folder_children(
    client: &reqwest::Client,
    token: &str,
    parent_id: &str,
) -> Result<Vec<DriveItem>, String> {
    let mut all_items = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let query = format!("'{}' in parents and trashed = false", parent_id);
        let mut url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,trashed,parents)",
            urlencoding::encode(&query)
        );
        if let Some(pt) = &page_token {
            url.push_str(&format!("&pageToken={}", urlencoding::encode(pt)));
        }

        let resp = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                let err = format!("Error listando archivos de Google Drive: {}", e);
                eprintln!("[Drive Sync Error] {}", err);
                err
            })?;

        if !resp.status().is_success() {
            let err = response_error("Error listando archivos de Google Drive", resp).await;
            eprintln!("[Drive Sync Error] {}", err);
            return Err(err);
        }

        #[derive(Deserialize)]
        struct PageResponse {
            files: Option<Vec<DriveItem>>,
            #[serde(rename = "nextPageToken")]
            next_page_token: Option<String>,
        }

        let data: PageResponse = resp.json().await.map_err(|e| {
            let err = format!("Error leyendo la lista de archivos de Google Drive: {}", e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;
        if let Some(files) = data.files {
            all_items.extend(files);
        }
        page_token = data.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    Ok(all_items)
}

/// Walks a Drive folder recursively. Files land in `result_map` keyed by their vault-relative
/// path; every folder found lands in `folder_map` (`"notes/2026" → id`) so the uploader can
/// reuse existing folders instead of querying Drive for each one.
async fn list_all_remote_items_recursive(
    client: &reqwest::Client,
    token: &str,
    folder_id: &str,
    current_rel_prefix: &str,
    result_map: &mut HashMap<String, DriveItem>,
    folder_map: &mut HashMap<String, String>,
) -> Result<(), String> {
    let children = list_folder_children(client, token, folder_id).await?;
    for child in children {
        let child_rel_path = if current_rel_prefix.is_empty() {
            child.name.clone()
        } else {
            format!("{}/{}", current_rel_prefix, child.name)
        };

        if child.mime_type == "application/vnd.google-apps.folder" {
            folder_map.insert(child_rel_path.clone(), child.id.clone());
            Box::pin(list_all_remote_items_recursive(
                client,
                token,
                &child.id,
                &child_rel_path,
                result_map,
                folder_map,
            ))
            .await?;
        } else {
            result_map.insert(child_rel_path, child);
        }
    }
    Ok(())
}

const UPLOAD_FIELDS: &str = "fields=id,name,mimeType,md5Checksum,modifiedTime";

/// Step 1 of the safe upload: create the file record (metadata only) in `parent_id` with
/// `Content-Type: application/json`. Google Drive API v3 rejects `multipart/form-data`
/// against `uploadType=multipart`, so metadata and bytes are sent in separate requests.
async fn create_file_record(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    parent_id: &str,
    mime_type: &str,
) -> Result<DriveItem, String> {
    let metadata = serde_json::json!({
        "name": name,
        "parents": [parent_id],
        "mimeType": mime_type
    });

    let resp = client
        .post("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType")
        .bearer_auth(token)
        .header(CONTENT_TYPE, "application/json")
        .json(&metadata)
        .send()
        .await
        .map_err(|e| {
            let err = format!("Error creando el archivo «{}» en Google Drive: {}", name, e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;

    if !resp.status().is_success() {
        let err = response_error(
            &format!("Error creando el archivo «{}» en Google Drive", name),
            resp,
        )
        .await;
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }

    resp.json().await.map_err(|e| {
        let err = format!("Error leyendo el archivo creado en Google Drive: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })
}

/// Step 2 (new files) and updates: `PATCH .../upload/drive/v3/files/{id}?uploadType=media`
/// with the raw file bytes and `Content-Type: application/octet-stream`.
async fn upload_file_content(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
    content: &[u8],
) -> Result<DriveItem, String> {
    let url = format!(
        "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media&{}",
        urlencoding::encode(file_id),
        UPLOAD_FIELDS
    );

    let mut last_error = String::new();
    for attempt in 1..=3u32 {
        let sent = client
            .patch(&url)
            .bearer_auth(token)
            .header(CONTENT_TYPE, "application/octet-stream")
            .body(content.to_vec())
            .send()
            .await;

        match sent {
            Ok(resp) => {
                if resp.status().is_success() {
                    return resp.json().await.map_err(|e| {
                        let err =
                            format!("Error leyendo la respuesta de subida de Google Drive: {}", e);
                        eprintln!("[Drive Sync Error] {}", err);
                        err
                    });
                }

                let status = resp.status();
                let retryable = status.is_server_error() || status.as_u16() == 429;
                let err = response_error(
                    &format!("Error subiendo contenido del archivo {}", file_id),
                    resp,
                )
                .await;
                eprintln!("[Drive Sync Error] {}", err);
                if !retryable || attempt == 3 {
                    return Err(err);
                }
                last_error = err;
            }
            Err(e) => {
                let err = format!(
                    "Error subiendo contenido a Google Drive (intento {}/3): {}",
                    attempt, e
                );
                eprintln!("[Drive Sync Error] {}", err);
                last_error = err;
            }
        }

        if attempt < 3 {
            tokio::time::sleep(Duration::from_millis(500 * u64::from(attempt))).await;
        }
    }

    Err(last_error)
}

/// Creates a new file in `parent_id` with the real bytes of the local file:
///   1. `POST /drive/v3/files` (JSON metadata) to obtain the Drive file id;
///   2. `PATCH /upload/drive/v3/files/{id}?uploadType=media` with the raw bytes.
async fn upload_new_file(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    parent_id: &str,
    mime_type: &str,
    content: &[u8],
) -> Result<DriveItem, String> {
    let created = create_file_record(client, token, name, parent_id, mime_type).await?;
    upload_file_content(client, token, &created.id, content).await
}

/// `PATCH .../upload/drive/v3/files/{id}?uploadType=media` — replaces the content of an
/// existing Drive file with the current local bytes.
async fn update_file_content(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
    content: &[u8],
) -> Result<DriveItem, String> {
    upload_file_content(client, token, file_id, content).await
}

async fn download_file_bytes(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
) -> Result<Vec<u8>, String> {
    let url = format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id);

    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            let err = format!("Error descargando archivo de Google Drive: {}", e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;

    if !resp.status().is_success() {
        let err = response_error(
            &format!("Error descargando el archivo {} de Google Drive", file_id),
            resp,
        )
        .await;
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }

    let bytes = resp.bytes().await.map_err(|e| {
        let err = format!("Error leyendo el contenido descargado de Google Drive: {}", e);
        eprintln!("[Drive Sync Error] {}", err);
        err
    })?;
    Ok(bytes.to_vec())
}

async fn trash_remote_file(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
) -> Result<(), String> {
    let url = format!("https://www.googleapis.com/drive/v3/files/{}", file_id);
    let resp = client
        .patch(&url)
        .bearer_auth(token)
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({ "trashed": true }))
        .send()
        .await
        .map_err(|e| {
            let err = format!("Error moviendo a papelera un archivo de Google Drive: {}", e);
            eprintln!("[Drive Sync Error] {}", err);
            err
        })?;

    if !resp.status().is_success() {
        let err = response_error(
            &format!("Error moviendo a papelera el archivo {} de Google Drive", file_id),
            resp,
        )
        .await;
        eprintln!("[Drive Sync Error] {}", err);
        return Err(err);
    }
    Ok(())
}

/// Returns the Drive id of the folder `dir_rel` (`""` = vault root, `"a/b"` = nested),
/// creating any missing segment. `folder_cache` is pre-filled with the remote listing so
/// existing folders cost no extra request.
async fn ensure_remote_folder(
    client: &reqwest::Client,
    token: &str,
    root_vault_id: &str,
    dir_rel: &str,
    folder_cache: &mut HashMap<String, String>,
) -> Result<String, String> {
    if dir_rel.is_empty() {
        return Ok(root_vault_id.to_string());
    }
    if let Some(id) = folder_cache.get(dir_rel) {
        return Ok(id.clone());
    }

    let mut current_parent_id = root_vault_id.to_string();
    let mut current_rel = String::new();
    for seg in dir_rel.split('/').filter(|s| !s.is_empty()) {
        if current_rel.is_empty() {
            current_rel = seg.to_string();
        } else {
            current_rel = format!("{}/{}", current_rel, seg);
        }

        if let Some(cached_id) = folder_cache.get(&current_rel) {
            current_parent_id = cached_id.clone();
        } else {
            let new_id =
                find_or_create_remote_folder(client, token, seg, Some(&current_parent_id)).await?;
            folder_cache.insert(current_rel.clone(), new_id.clone());
            current_parent_id = new_id;
        }
    }
    Ok(current_parent_id)
}

/// Drive id of the folder that must hold `rel_file_path` (`notes/a/b.md` → folder `notes/a`).
async fn ensure_remote_parent_folder(
    client: &reqwest::Client,
    token: &str,
    root_vault_id: &str,
    rel_file_path: &str,
    folder_cache: &mut HashMap<String, String>,
) -> Result<String, String> {
    let dir_rel = rel_file_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    ensure_remote_folder(client, token, root_vault_id, dir_rel, folder_cache).await
}

/* ============================================================================
   Tauri Commands
   ============================================================================ */

#[tauri::command]
pub async fn google_oauth_login(app: AppHandle) -> Result<GoogleUserProfile, String> {
    let (client_id, client_secret) = resolve_credentials();
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Credenciales de Google OAuth no configuradas. Por favor configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env".to_string());
    }
    let (verifier, challenge) = generate_pkce();

    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "No se pudo obtener la IP local".to_string())?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let scope = "https://www.googleapis.com/auth/drive.file openid email profile";

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        challenge
    );

    if let Err(e) = open::that(&auth_url) {
        log::warn!("No se pudo abrir el navegador automáticamente: {}", e);
    }

    /// Give the user up to five minutes to finish the consent screen before freeing the port.
    const OAUTH_TIMEOUT_SECS: u64 = 300;

    let auth_code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let request = server
            .recv_timeout(Duration::from_secs(OAUTH_TIMEOUT_SECS))
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                "Tiempo de espera agotado: no se completó el inicio de sesión en el navegador."
                    .to_string()
            })?;
        let url_str = format!("http://127.0.0.1{}", request.url());
        let parsed_url = Url::parse(&url_str).map_err(|e| e.to_string())?;

        let mut code: Option<String> = None;
        let mut oauth_error: Option<String> = None;
        for (k, v) in parsed_url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.to_string()),
                "error" => oauth_error = Some(v.to_string()),
                _ => {}
            }
        }

        let (html, result) = match (code, oauth_error) {
            (Some(c), _) => (oauth_result_page(true, None), Ok(c)),
            (None, Some(e)) => (
                oauth_result_page(false, Some(&e)),
                Err(format!("Google rechazó el inicio de sesión: {}", e)),
            ),
            (None, None) => (
                oauth_result_page(false, None),
                Err("No se encontró el parámetro 'code' en la respuesta de Google".to_string()),
            ),
        };

        let response = Response::from_string(html).with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap(),
        );
        let _ = request.respond(response);

        result
    })
    .await
    .map_err(|e| e.to_string())??;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", auth_code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Error intercambiando código con Google: {}", e))?;

    if !resp.status().is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("Google rechazó la autorización: {}", err_body));
    }

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: i64,
        refresh_token: Option<String>,
    }

    let token_data: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Error deserializando tokens: {}", e))?;

    let user_resp = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&token_data.access_token)
        .send()
        .await
        .map_err(|e| format!("Error obteniendo perfil: {}", e))?;

    #[derive(Deserialize)]
    struct RawUser {
        email: String,
        name: Option<String>,
        picture: Option<String>,
    }

    let raw: RawUser = user_resp
        .json()
        .await
        .map_err(|e| format!("Error leyendo perfil de usuario: {}", e))?;

    let profile = GoogleUserProfile {
        email: raw.email.clone(),
        name: raw.name.unwrap_or_else(|| raw.email.clone()),
        picture: raw.picture,
    };

    let expires_at = Utc::now().timestamp() + token_data.expires_in - 60;
    let stored = StoredTokens {
        access_token: token_data.access_token,
        refresh_token: token_data.refresh_token,
        expires_at,
        client_id,
        client_secret,
        user: Some(profile.clone()),
    };

    let auth_path = get_auth_file_path(&app);
    let _ = fs::write(
        &auth_path,
        serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?,
    );

    Ok(profile)
}

#[tauri::command]
pub async fn google_check_auth(app: AppHandle) -> Result<Option<GoogleUserProfile>, String> {
    match ensure_valid_token(&app).await {
        Ok(token) => {
            let auth_path = get_auth_file_path(&app);
            if let Ok(content) = fs::read_to_string(&auth_path) {
                if let Ok(stored) = serde_json::from_str::<StoredTokens>(&content) {
                    if let Some(user) = stored.user {
                        return Ok(Some(user));
                    }
                }
            }

            // Fetch live profile if missing
            let client = reqwest::Client::new();
            if let Ok(resp) = client
                .get("https://www.googleapis.com/oauth2/v2/userinfo")
                .bearer_auth(token)
                .send()
                .await
            {
                if resp.status().is_success() {
                    #[derive(Deserialize)]
                    struct RawUser {
                        email: String,
                        name: Option<String>,
                        picture: Option<String>,
                    }
                    if let Ok(raw) = resp.json::<RawUser>().await {
                        let profile = GoogleUserProfile {
                            email: raw.email.clone(),
                            name: raw.name.unwrap_or_else(|| raw.email.clone()),
                            picture: raw.picture,
                        };
                        return Ok(Some(profile));
                    }
                }
            }
            Ok(None)
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn google_logout(app: AppHandle) -> Result<(), String> {
    let auth_path = get_auth_file_path(&app);
    if auth_path.exists() {
        let _ = fs::remove_file(auth_path);
    }
    Ok(())
}

async fn list_remote_drive_vaults_impl(
    app: &AppHandle,
    force_refresh: bool,
) -> Result<Vec<RemoteVaultInfo>, String> {
    let token = if force_refresh {
        refresh_access_token(app).await?
    } else {
        ensure_valid_token(app).await?
    };
    let client = reqwest::Client::new();

    let root_vaults_id =
        find_or_create_remote_folder(&client, &token, ROOT_FOLDER_NAME, None).await?;
    let children = list_folder_children(&client, &token, &root_vaults_id).await?;

    let mut vaults = Vec::new();
    for child in children {
        if child.mime_type == "application/vnd.google-apps.folder" {
            vaults.push(RemoteVaultInfo {
                id: child.id,
                name: child.name,
                modified_time: child.modified_time,
                file_count: None,
            });
        }
    }
    vaults.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(vaults)
}

#[tauri::command]
pub async fn list_remote_drive_vaults(app: AppHandle) -> Result<Vec<RemoteVaultInfo>, String> {
    match list_remote_drive_vaults_impl(&app, false).await {
        Ok(vaults) => Ok(vaults),
        Err(err) => {
            eprintln!("[Drive Sync Error] {}", err);
            if is_auth_error(&err) {
                eprintln!("[Drive Sync Error] Token rechazado al listar bóvedas; renovando y reintentando…");
                let retried = list_remote_drive_vaults_impl(&app, true).await;
                if let Err(ref retry_err) = retried {
                    eprintln!("[Drive Sync Error] {}", retry_err);
                }
                retried
            } else {
                Err(err)
            }
        }
    }
}

/* ----------------------------------------------------------------------------
   Differential sync: plan → execute
   ---------------------------------------------------------------------------- */

/// One file operation decided by comparing the local vault, the Drive folder and the
/// manifest of the previous pass. Planning first lets the UI show an exact `current/total`.
#[derive(Debug)]
enum PlannedOp {
    /// New local file (or edited after being deleted remotely): create it in Drive.
    UploadNew { rel: String, abs: PathBuf, hash: String, mtime: i64 },
    /// Edited locally, untouched remotely: replace the Drive content (PATCH).
    UpdateRemote { rel: String, abs: PathBuf, hash: String, mtime: i64, file_id: String },
    /// Edited remotely or created on another device: download into the vault.
    Download { rel: String, file_id: String, remote_hash: String },
    /// Edited on both sides: keep the remote copy as "(Conflicto …)" and push the local one.
    Conflict { rel: String, abs: PathBuf, hash: String, mtime: i64, file_id: String },
    /// Deleted on another device while untouched here: move the local copy to `.urano/trash`.
    LocalTrash { rel: String, abs: PathBuf },
    /// Deleted locally: move the Drive file to the trash.
    RemoteTrash { rel: String, file_id: String },
}

impl PlannedOp {
    fn rel(&self) -> &str {
        match self {
            PlannedOp::UploadNew { rel, .. }
            | PlannedOp::UpdateRemote { rel, .. }
            | PlannedOp::Download { rel, .. }
            | PlannedOp::Conflict { rel, .. }
            | PlannedOp::LocalTrash { rel, .. }
            | PlannedOp::RemoteTrash { rel, .. } => rel,
        }
    }

    fn phase(&self) -> &'static str {
        match self {
            PlannedOp::Download { .. } | PlannedOp::LocalTrash { .. } => "download",
            _ => "upload",
        }
    }
}

struct LocalFile {
    abs: PathBuf,
    hash: String,
    mtime: i64,
}

/// Recursively scans the vault: every regular file (`.md`, `.canvas`, images, …) keyed by its
/// `/`-separated relative path, plus every directory so the Drive tree mirrors it. Hidden
/// entries other than `.urano`, `.git`, `node_modules`, the sync manifest and `.urano/trash`
/// are skipped (see `should_ignore_rel_path`).
fn scan_local_vault(v_path: &Path) -> (HashMap<String, LocalFile>, Vec<String>) {
    let mut files: HashMap<String, LocalFile> = HashMap::new();
    let mut dirs: Vec<String> = Vec::new();

    let walker = WalkDir::new(v_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if name.starts_with('.') && name != ".urano" {
                return false;
            }
            name != "node_modules"
        });

    for entry in walker.flatten() {
        if entry.depth() == 0 {
            continue;
        }
        let p = entry.path();
        let Ok(rel) = p.strip_prefix(v_path) else { continue };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if should_ignore_rel_path(&rel_str) {
            continue;
        }

        if entry.file_type().is_dir() {
            if !rel_str.starts_with(".urano/trash") {
                dirs.push(rel_str);
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }

        let Ok(bytes) = fs::read(p) else {
            eprintln!(
                "[Drive Sync Error] No se pudo leer {} para sincronizar",
                p.display()
            );
            log::warn!("No se pudo leer {} para sincronizar", p.display());
            continue;
        };
        let hash = compute_md5(&bytes);
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        files.insert(rel_str, LocalFile { abs: p.to_path_buf(), hash, mtime });
    }

    // Parents before children so `ensure_remote_folder` creates them in order.
    dirs.sort_by(|a, b| a.matches('/').count().cmp(&b.matches('/').count()).then(a.cmp(b)));
    (files, dirs)
}

fn plan_sync(
    local_files: &HashMap<String, LocalFile>,
    remote_files: &HashMap<String, DriveItem>,
    manifest: &mut DriveSyncManifest,
) -> Vec<PlannedOp> {
    let mut ops: Vec<PlannedOp> = Vec::new();

    let mut local_paths: Vec<&String> = local_files.keys().collect();
    local_paths.sort();

    for rel_path in local_paths {
        let local = &local_files[rel_path];
        let manifest_entry = manifest.files.get(rel_path).cloned();
        let remote_item = remote_files.get(rel_path);

        match (manifest_entry, remote_item) {
            // New file locally (not in manifest, not in Drive)
            (None, None) => ops.push(PlannedOp::UploadNew {
                rel: rel_path.clone(),
                abs: local.abs.clone(),
                hash: local.hash.clone(),
                mtime: local.mtime,
            }),

            // Known on both sides → differential check
            (Some(entry), Some(r_file)) => {
                let r_hash = r_file.md5_checksum.as_deref().unwrap_or("");
                let local_changed = local.hash != entry.hash;
                let remote_changed = !r_hash.is_empty() && r_hash != entry.hash;

                if local_changed && remote_changed && local.hash != r_hash {
                    ops.push(PlannedOp::Conflict {
                        rel: rel_path.clone(),
                        abs: local.abs.clone(),
                        hash: local.hash.clone(),
                        mtime: local.mtime,
                        file_id: r_file.id.clone(),
                    });
                } else if local_changed && !remote_changed {
                    ops.push(PlannedOp::UpdateRemote {
                        rel: rel_path.clone(),
                        abs: local.abs.clone(),
                        hash: local.hash.clone(),
                        mtime: local.mtime,
                        file_id: r_file.id.clone(),
                    });
                } else if remote_changed && !local_changed {
                    ops.push(PlannedOp::Download {
                        rel: rel_path.clone(),
                        file_id: r_file.id.clone(),
                        remote_hash: r_hash.to_string(),
                    });
                } else {
                    // Identical (or both converged to the same content): just refresh the pairing.
                    manifest.files.insert(
                        rel_path.clone(),
                        ManifestFileEntry {
                            drive_id: r_file.id.clone(),
                            modified_ms: local.mtime,
                            hash: local.hash.clone(),
                        },
                    );
                }
            }

            // Exists locally and in Drive but was never paired (first sync of an existing vault)
            (None, Some(r_file)) => {
                let r_hash = r_file.md5_checksum.as_deref().unwrap_or("");
                if local.hash == r_hash {
                    manifest.files.insert(
                        rel_path.clone(),
                        ManifestFileEntry {
                            drive_id: r_file.id.clone(),
                            modified_ms: local.mtime,
                            hash: local.hash.clone(),
                        },
                    );
                } else {
                    ops.push(PlannedOp::Conflict {
                        rel: rel_path.clone(),
                        abs: local.abs.clone(),
                        hash: local.hash.clone(),
                        mtime: local.mtime,
                        file_id: r_file.id.clone(),
                    });
                }
            }

            // Registered in manifest but gone from Drive → deleted on another device
            (Some(entry), None) => {
                if local.hash == entry.hash {
                    ops.push(PlannedOp::LocalTrash {
                        rel: rel_path.clone(),
                        abs: local.abs.clone(),
                    });
                } else {
                    // Edited here after the remote deletion: local edits win, re-upload it.
                    manifest.files.remove(rel_path);
                    ops.push(PlannedOp::UploadNew {
                        rel: rel_path.clone(),
                        abs: local.abs.clone(),
                        hash: local.hash.clone(),
                        mtime: local.mtime,
                    });
                }
            }
        }
    }

    // Remote files that do not exist locally
    let mut remote_paths: Vec<&String> = remote_files
        .keys()
        .filter(|rel| !local_files.contains_key(*rel))
        .collect();
    remote_paths.sort();
    for r_rel in remote_paths {
        let r_item = &remote_files[r_rel];
        if manifest.files.contains_key(r_rel) {
            // Deleted locally since the last pass → trash on Drive
            ops.push(PlannedOp::RemoteTrash {
                rel: r_rel.clone(),
                file_id: r_item.id.clone(),
            });
        } else {
            // New file from another device → download
            ops.push(PlannedOp::Download {
                rel: r_rel.clone(),
                file_id: r_item.id.clone(),
                remote_hash: r_item.md5_checksum.clone().unwrap_or_default(),
            });
        }
    }

    ops
}

/// Writes `bytes` at `dest`, creating parent folders; returns the md5 of what was written.
fn write_downloaded_file(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(dest, bytes).map_err(|e| e.to_string())
}

/// Full differential sync of the open vault with `Urano Vaults/<vault_name>` in Google Drive:
///   1. ensure the root folder `Urano Vaults` exists;
///   2. find or create the subfolder named exactly `vault_name`;
///   3. walk `vault_path` recursively, mirror its folders and upload every file with its real
///      content (metadata POST + media PATCH);
///   4. PATCH files edited locally, download files edited or created remotely, keep both
///      versions on conflicts and propagate deletions through the trash on each side.
/// Per-file failures are logged (`drive-sync:log` kind `error`) and counted but never abort
/// the pass, so one unreadable file cannot leave the whole vault un-synced.
async fn sync_vault_with_drive_impl(
    app: AppHandle,
    vault_path: String,
    vault_name: String,
    force_refresh: bool,
) -> Result<SyncSummary, String> {
    let token = if force_refresh {
        refresh_access_token(&app).await?
    } else {
        ensure_valid_token(&app).await?
    };
    let client = reqwest::Client::new();
    let v_path = Path::new(&vault_path);

    if !v_path.is_dir() {
        return Err(format!("La ruta de la bóveda no existe: {}", vault_path));
    }
    let vault_name = vault_name.trim().to_string();
    if vault_name.is_empty() {
        return Err("El nombre de la bóveda no puede estar vacío".to_string());
    }

    emit_progress(&app, "scan", 0, 0, None);

    // 1-2. Root "Urano Vaults" folder, then the subfolder for this vault
    let root_vaults_id =
        find_or_create_remote_folder(&client, &token, ROOT_FOLDER_NAME, None).await?;
    let vault_remote_id =
        find_or_create_remote_folder(&client, &token, &vault_name, Some(&root_vaults_id)).await?;

    // Manifest of the previous pass (.urano/drive_sync_manifest.json)
    let urano_dir = v_path.join(".urano");
    let _ = fs::create_dir_all(&urano_dir);
    let manifest_path = urano_dir.join("drive_sync_manifest.json");

    let mut manifest: DriveSyncManifest = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default();
    if manifest.remote_folder_id != vault_remote_id {
        // Linked to a different Drive folder (renamed vault / first sync): forget old ids.
        manifest.files.clear();
    }
    manifest.vault_name = vault_name.clone();
    manifest.remote_folder_id = vault_remote_id.clone();

    // 3. Scan both sides
    let (local_files, local_dirs) = scan_local_vault(v_path);

    let mut remote_files: HashMap<String, DriveItem> = HashMap::new();
    let mut folder_cache: HashMap<String, String> = HashMap::new();
    list_all_remote_items_recursive(
        &client,
        &token,
        &vault_remote_id,
        "",
        &mut remote_files,
        &mut folder_cache,
    )
    .await?;
    folder_cache.insert(String::new(), vault_remote_id.clone());

    // Plan
    let ops = plan_sync(&local_files, &remote_files, &mut manifest);
    let total_ops = ops.len();

    let mut uploaded = 0;
    let mut downloaded = 0;
    let mut conflicts = 0;
    let mut deleted = 0;
    let mut errors = 0;
    let mut first_error: Option<String> = None;
    let mut newly_downloaded: HashSet<String> = HashSet::new();

    let mut record_error = |app: &AppHandle, rel: &str, err: String| {
        eprintln!("[Drive Sync Error] {}", err);
        log::warn!("Sync de {} falló: {}", rel, err);
        emit_log(app, "error", Some(rel), Some(&err));
        errors += 1;
        if first_error.is_none() {
            first_error = Some(err);
        }
    };

    // Mirror every local folder (including empty ones) in Drive.
    for dir_rel in &local_dirs {
        if let Err(err) =
            ensure_remote_folder(&client, &token, &vault_remote_id, dir_rel, &mut folder_cache).await
        {
            record_error(&app, dir_rel, err);
        }
    }

    // 4. Execute
    for (index, op) in ops.into_iter().enumerate() {
        emit_progress(&app, op.phase(), index + 1, total_ops, Some(op.rel()));

        match op {
            PlannedOp::UploadNew { rel, abs, hash, mtime } => {
                let result: Result<DriveItem, String> = async {
                    let parent_id = ensure_remote_parent_folder(
                        &client,
                        &token,
                        &vault_remote_id,
                        &rel,
                        &mut folder_cache,
                    )
                    .await?;
                    let file_name = rel.rsplit('/').next().unwrap_or(&rel);
                    let bytes = fs::read(&abs).map_err(|e| e.to_string())?;
                    upload_new_file(&client, &token, file_name, &parent_id, get_mime_type(file_name), &bytes)
                        .await
                }
                .await;

                match result {
                    Ok(created) => {
                        manifest.files.insert(
                            rel.clone(),
                            ManifestFileEntry { drive_id: created.id, modified_ms: mtime, hash },
                        );
                        emit_log(&app, "upload", Some(&rel), None);
                        uploaded += 1;
                    }
                    Err(err) => record_error(&app, &rel, err),
                }
            }

            PlannedOp::UpdateRemote { rel, abs, hash, mtime, file_id } => {
                let result: Result<DriveItem, String> = async {
                    let bytes = fs::read(&abs).map_err(|e| e.to_string())?;
                    update_file_content(&client, &token, &file_id, &bytes).await
                }
                .await;

                match result {
                    Ok(updated) => {
                        manifest.files.insert(
                            rel.clone(),
                            ManifestFileEntry { drive_id: updated.id, modified_ms: mtime, hash },
                        );
                        emit_log(&app, "upload", Some(&rel), None);
                        uploaded += 1;
                    }
                    Err(err) => record_error(&app, &rel, err),
                }
            }

            PlannedOp::Download { rel, file_id, remote_hash } => {
                let result: Result<String, String> = async {
                    let bytes = download_file_bytes(&client, &token, &file_id).await?;
                    write_downloaded_file(&v_path.join(&rel), &bytes)?;
                    Ok(if remote_hash.is_empty() { compute_md5(&bytes) } else { remote_hash.clone() })
                }
                .await;

                match result {
                    Ok(hash) => {
                        manifest.files.insert(
                            rel.clone(),
                            ManifestFileEntry {
                                drive_id: file_id,
                                modified_ms: Utc::now().timestamp_millis(),
                                hash,
                            },
                        );
                        newly_downloaded.insert(rel.clone());
                        emit_log(&app, "download", Some(&rel), None);
                        downloaded += 1;
                    }
                    Err(err) => record_error(&app, &rel, err),
                }
            }

            PlannedOp::Conflict { rel, abs, hash, mtime, file_id } => {
                // Keep the remote version next to the local one, then push the local one.
                let stamp = Utc::now().format("%Y-%m-%d_%H-%M").to_string();
                let conflict_rel = conflict_file_name(&rel, &stamp);
                match download_file_bytes(&client, &token, &file_id).await {
                    Ok(remote_bytes) => {
                        if let Err(err) = write_downloaded_file(&v_path.join(&conflict_rel), &remote_bytes) {
                            record_error(&app, &conflict_rel, err);
                        }
                    }
                    Err(err) => record_error(&app, &conflict_rel, err),
                }
                emit_log(&app, "conflict", Some(&rel), Some(&conflict_rel));
                conflicts += 1;

                let result: Result<DriveItem, String> = async {
                    let bytes = fs::read(&abs).map_err(|e| e.to_string())?;
                    update_file_content(&client, &token, &file_id, &bytes).await
                }
                .await;

                match result {
                    Ok(updated) => {
                        manifest.files.insert(
                            rel.clone(),
                            ManifestFileEntry { drive_id: updated.id, modified_ms: mtime, hash },
                        );
                        emit_log(&app, "upload", Some(&rel), None);
                        uploaded += 1;
                    }
                    Err(err) => record_error(&app, &rel, err),
                }
            }

            PlannedOp::LocalTrash { rel, abs } => {
                move_to_local_trash(v_path, &rel, &abs);
                manifest.files.remove(&rel);
                emit_log(&app, "local_trash", Some(&rel), None);
                deleted += 1;
            }

            PlannedOp::RemoteTrash { rel, file_id } => match trash_remote_file(&client, &token, &file_id).await {
                Ok(()) => {
                    manifest.files.remove(&rel);
                    emit_log(&app, "trash", Some(&rel), None);
                    deleted += 1;
                }
                Err(err) => record_error(&app, &rel, err),
            },
        }
    }

    // Drop stale manifest entries (files that no longer exist locally nor were just downloaded).
    manifest
        .files
        .retain(|rel, _| local_files.contains_key(rel) || newly_downloaded.contains(rel));

    // 5. Save the manifest
    manifest.last_synced_at = Utc::now().timestamp();
    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    if let Err(err) = fs::write(&manifest_path, manifest_json) {
        eprintln!(
            "[Drive Sync Error] No se pudo guardar el manifiesto de sync en {}: {}",
            manifest_path.display(),
            err
        );
    }

    emit_progress(&app, "done", total_ops, total_ops, None);

    let succeeded = uploaded + downloaded + deleted + conflicts;
    // A 401 means the access token was revoked/expired mid-pass: surface it even when some
    // files went through so the command wrapper refreshes the token and retries once.
    if let Some(err) = first_error.as_ref() {
        if is_auth_error(err) {
            return Err(err.clone());
        }
    }
    if errors > 0 && succeeded == 0 && total_ops > 0 {
        // Nothing went through (expired session, no network…): surface the real cause.
        return Err(first_error.unwrap_or_else(|| "La sincronización falló".to_string()));
    }

    let now_display = Utc::now().format("%H:%M:%S").to_string();
    let message = format!(
        "Sincronización completada a las {}: {} subidos, {} descargados, {} eliminados, {} conflictos, {} errores.",
        now_display, uploaded, downloaded, deleted, conflicts, errors
    );

    Ok(SyncSummary {
        uploaded,
        downloaded,
        deleted,
        conflicts,
        errors,
        total: manifest.files.len(),
        message,
        timestamp: now_display,
    })
}

/// Manual "Sync now" / debounced auto-sync entry point.
///
/// Arguments are explicitly exposed in camelCase so the frontend call
/// `invoke('sync_vault_with_drive', { vaultPath, vaultName })` maps to
/// `vault_path` / `vault_name` regardless of Tauri defaults. If Google answers 401,
/// the stored refresh token is used to get a new access token and the pass is retried once.
#[tauri::command(rename_all = "camelCase")]
pub async fn sync_vault_with_drive(
    app: AppHandle,
    vault_path: String,
    vault_name: String,
) -> Result<SyncSummary, String> {
    match sync_vault_with_drive_impl(
        app.clone(),
        vault_path.clone(),
        vault_name.clone(),
        false,
    )
    .await
    {
        Ok(summary) => Ok(summary),
        Err(err) => {
            eprintln!("[Drive Sync Error] {}", err);
            if is_auth_error(&err) {
                eprintln!(
                    "[Drive Sync Error] Token rechazado durante la sincronización; renovando y reintentando…"
                );
                let retried =
                    sync_vault_with_drive_impl(app, vault_path, vault_name, true).await;
                if let Err(ref retry_err) = retried {
                    eprintln!("[Drive Sync Error] {}", retry_err);
                }
                retried
            } else {
                Err(err)
            }
        }
    }
}

/// Downloads a whole remote vault (`Urano Vaults/<name>`) into `local_dest_path`, mirroring
/// its folders, and writes the manifest so the next `sync_vault_with_drive` is incremental.
#[tauri::command(rename_all = "camelCase")]
pub async fn download_remote_vault(
    app: AppHandle,
    remote_folder_id: String,
    local_dest_path: String,
) -> Result<SyncSummary, String> {
    let token = ensure_valid_token(&app).await?;
    let client = reqwest::Client::new();
    let dest_dir = Path::new(&local_dest_path);

    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    emit_progress(&app, "scan", 0, 0, None);

    let mut remote_files: HashMap<String, DriveItem> = HashMap::new();
    let mut remote_folders: HashMap<String, String> = HashMap::new();
    list_all_remote_items_recursive(
        &client,
        &token,
        &remote_folder_id,
        "",
        &mut remote_files,
        &mut remote_folders,
    )
    .await?;

    for dir_rel in remote_folders.keys() {
        let _ = fs::create_dir_all(dest_dir.join(dir_rel));
    }

    let urano_dir = dest_dir.join(".urano");
    let _ = fs::create_dir_all(&urano_dir);
    let manifest_path = urano_dir.join("drive_sync_manifest.json");

    let mut manifest = DriveSyncManifest {
        vault_name: dest_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Urano Vault")
            .to_string(),
        remote_folder_id,
        last_synced_at: Utc::now().timestamp(),
        files: HashMap::new(),
    };

    let total = remote_files.len();
    let mut downloaded = 0;
    let mut errors = 0;
    let mut first_error: Option<String> = None;

    let mut remote_paths: Vec<String> = remote_files.keys().cloned().collect();
    remote_paths.sort();

    for (index, rel_path) in remote_paths.into_iter().enumerate() {
        emit_progress(&app, "download", index + 1, total, Some(&rel_path));
        let item = &remote_files[&rel_path];
        let result: Result<String, String> = async {
            let bytes = download_file_bytes(&client, &token, &item.id).await?;
            write_downloaded_file(&dest_dir.join(&rel_path), &bytes)?;
            Ok(item.md5_checksum.clone().unwrap_or_else(|| compute_md5(&bytes)))
        }
        .await;

        match result {
            Ok(hash) => {
                emit_log(&app, "download", Some(&rel_path), None);
                manifest.files.insert(
                    rel_path,
                    ManifestFileEntry {
                        drive_id: item.id.clone(),
                        modified_ms: Utc::now().timestamp_millis(),
                        hash,
                    },
                );
                downloaded += 1;
            }
            Err(err) => {
                log::warn!("Descarga de {} falló: {}", rel_path, err);
                emit_log(&app, "error", Some(&rel_path), Some(&err));
                errors += 1;
                if first_error.is_none() {
                    first_error = Some(err);
                }
            }
        }
    }

    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    let _ = fs::write(manifest_path, manifest_json);
    emit_progress(&app, "done", total, total, None);

    if errors > 0 && downloaded == 0 && total > 0 {
        return Err(first_error.unwrap_or_else(|| "La descarga falló".to_string()));
    }

    let now_display = Utc::now().format("%H:%M:%S").to_string();
    Ok(SyncSummary {
        uploaded: 0,
        downloaded,
        deleted: 0,
        conflicts: 0,
        errors,
        total: manifest.files.len(),
        message: format!(
            "Bóveda descargada a las {}: {} archivos, {} errores.",
            now_display, downloaded, errors
        ),
        timestamp: now_display,
    })
}

