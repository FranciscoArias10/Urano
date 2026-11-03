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

