use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tiny_http::{Response, Server};
use tokio::sync::Mutex;
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64, // Unix timestamp in seconds
    pub client_id: String,
    pub client_secret: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleUser {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

pub struct OAuthService {
    tokens: Arc<Mutex<Option<OAuthTokens>>>,
}

impl OAuthService {
    pub fn new() -> Self {
        let loaded = Self::load_tokens_from_disk().ok();
        Self {
            tokens: Arc::new(Mutex::new(loaded)),
        }
    }

    fn config_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".config").join("urano").join("tokens.json")
    }

    fn load_tokens_from_disk() -> Result<OAuthTokens, String> {
        let path = Self::config_path();
        if !path.exists() {
            return Err("No token found".to_string());
        }
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    }

    pub fn save_tokens_to_disk(tokens: &OAuthTokens) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let data = serde_json::to_string_pretty(tokens).map_err(|e| e.to_string())?;
        fs::write(path, data).map_err(|e| e.to_string())
    }

    pub async fn delete_tokens(&self) {
        let mut t = self.tokens.lock().await;
        *t = None;
        let path = Self::config_path();
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    pub async fn is_authenticated(&self) -> bool {
        let t = self.tokens.lock().await;
        t.is_some()
    }

    /// Generates a PKCE code_verifier and code_challenge
    fn generate_pkce() -> (String, String) {
        let mut random_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut random_bytes);
        let verifier = URL_SAFE_NO_PAD.encode(random_bytes);

        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

        (verifier, challenge)
    }

    /// Starts OAuth 2.0 PKCE flow on an ephemeral localhost port
    pub async fn start_oauth_flow(
        &self,
        client_id: String,
        client_secret: Option<String>,
    ) -> Result<bool, String> {
        let (verifier, challenge) = Self::generate_pkce();

        // Bind to ephemeral port
        let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| "No IP address available".to_string())?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{}", port);

        let scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
        let auth_url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
            urlencoding::encode(&client_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(scope),
            challenge
        );

        // Open user's default browser
        if let Err(e) = open::that(&auth_url) {
            log::warn!("No se pudo abrir el navegador automáticamente: {}", e);
        }

        // Wait for incoming callback on local server (blocking in a separate thread)
        let auth_code = tokio::task::spawn_blocking(move || -> Result<String, String> {
            let request = server.recv().map_err(|e| e.to_string())?;
            let url_str = format!("http://127.0.0.1{}", request.url());
            let parsed_url = Url::parse(&url_str).map_err(|e| e.to_string())?;

            let mut code = None;
            for (k, v) in parsed_url.query_pairs() {
                if k == "code" {
                    code = Some(v.to_string());
                    break;
                }
            }

            // Return nice HTML page to browser
            let html = r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Urano</title>
  <style>
    body { background: #161618; color: #dedede; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1c1c1f; padding: 2.5rem 3rem; border-radius: 16px; border: 1px solid #2e2e34; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); max-width: 420px; }
    h2 { color: #a78bfa; margin-top: 0; font-size: 1.5rem; }
    p { color: #8b8b96; font-size: 0.95rem; line-height: 1.5; margin-bottom: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h2>✓ ¡Conexión con Google Drive Exitosa!</h2>
    <p>Urano ha sido autorizado correctamente. Puedes cerrar esta pestaña del navegador y volver a la aplicación.</p>
  </div>
</body>
</html>"#;

            let response = Response::from_string(html)
                .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
            let _ = request.respond(response);

            code.ok_or_else(|| "No se encontró el parámetro 'code' en la redirección".to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        // Exchange code for tokens with Google
        let client = reqwest::Client::new();
        let mut form_params = vec![
            ("client_id", client_id.clone()),
            ("code", auth_code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code".to_string()),
            ("redirect_uri", redirect_uri),
        ];

        if let Some(secret) = &client_secret {
            form_params.push(("client_secret", secret.clone()));
        }

        let resp = client
            .post("https://oauth2.googleapis.com/token")
            .form(&form_params)
            .send()
            .await
            .map_err(|e| format!("Error solicitando tokens: {}", e))?;

        if !resp.status().is_success() {
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("Google rechazó el intercambio de código: {}", err_body));
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
            .map_err(|e| format!("Error deserializando token: {}", e))?;

        let expires_at = Utc::now().timestamp() + token_data.expires_in - 60; // 60s buffer

        let new_tokens = OAuthTokens {
            access_token: token_data.access_token,
            refresh_token: token_data.refresh_token,
            expires_at,
            client_id,
            client_secret,
        };

        Self::save_tokens_to_disk(&new_tokens)?;
        let mut t = self.tokens.lock().await;
        *t = Some(new_tokens);

        Ok(true)
    }

    /// Gets a valid access token, refreshing it if expired
    pub async fn get_valid_access_token(&self) -> Result<String, String> {
        let mut t_lock = self.tokens.lock().await;
        let tokens = t_lock
            .as_mut()
            .ok_or_else(|| "No se ha iniciado sesión en Google Drive".to_string())?;

        let now = Utc::now().timestamp();
        if now < tokens.expires_at {
            return Ok(tokens.access_token.clone());
        }

        // Token is expired, refresh it using refresh_token
        let refresh_token = tokens
            .refresh_token
            .as_ref()
            .ok_or_else(|| "No se encontró refresh_token. Debes volver a iniciar sesión.".to_string())?
            .clone();

        let client = reqwest::Client::new();
        let mut form_params = vec![
            ("client_id", tokens.client_id.clone()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token".to_string()),
        ];

        if let Some(secret) = &tokens.client_secret {
            form_params.push(("client_secret", secret.clone()));
        }

        let resp = client
            .post("https://oauth2.googleapis.com/token")
            .form(&form_params)
            .send()
            .await
            .map_err(|e| format!("Error al renovar token: {}", e))?;

        if !resp.status().is_success() {
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("No se pudo renovar token: {}", err_body));
        }

        #[derive(Deserialize)]
        struct RefreshResponse {
            access_token: String,
            expires_in: i64,
        }

        let ref_data: RefreshResponse = resp
            .json()
            .await
            .map_err(|e| format!("Error deserializando nuevo token: {}", e))?;

        tokens.access_token = ref_data.access_token.clone();
        tokens.expires_at = now + ref_data.expires_in - 60;

        let _ = Self::save_tokens_to_disk(tokens);

        Ok(ref_data.access_token)
    }

    /// Fetches profile information for the authenticated user
    pub async fn get_user_profile(&self) -> Result<GoogleUser, String> {
        let token = self.get_valid_access_token().await?;
        let client = reqwest::Client::new();
        let resp = client
            .get("https://www.googleapis.com/oauth2/v2/userinfo")
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err("Error obteniendo información de usuario de Google".to_string());
        }

        #[derive(Deserialize)]
        struct RawUser {
            email: String,
            name: Option<String>,
            picture: Option<String>,
        }

        let raw: RawUser = resp.json().await.map_err(|e| e.to_string())?;
        Ok(GoogleUser {
            email: raw.email.clone(),
            name: raw.name.unwrap_or(raw.email),
            picture: raw.picture,
        })
    }
}
