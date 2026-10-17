use crate::services::oauth::{GoogleUser, OAuthService};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn is_authenticated(oauth: State<'_, Arc<OAuthService>>) -> Result<bool, String> {
    Ok(oauth.is_authenticated().await)
}

#[tauri::command]
pub async fn start_oauth_login(
    client_id: String,
    client_secret: Option<String>,
    oauth: State<'_, Arc<OAuthService>>,
) -> Result<bool, String> {
    oauth.start_oauth_flow(client_id, client_secret).await
}

#[tauri::command]
pub async fn get_google_user(oauth: State<'_, Arc<OAuthService>>) -> Result<Option<GoogleUser>, String> {
    if !oauth.is_authenticated().await {
        return Ok(None);
    }
    match oauth.get_user_profile().await {
        Ok(user) => Ok(Some(user)),
        Err(e) => {
            log::warn!("No se pudo obtener perfil de usuario: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn logout_google(oauth: State<'_, Arc<OAuthService>>) -> Result<(), String> {
    oauth.delete_tokens().await;
    Ok(())
}
