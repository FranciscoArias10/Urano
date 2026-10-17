use crate::services::oauth::OAuthService;
use crate::services::sync_engine::{SyncEngine, SyncResult};
use std::path::Path;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn sync_vault(
    vault_path: String,
    remote_folder_name: String,
    oauth: State<'_, Arc<OAuthService>>,
) -> Result<SyncResult, String> {
    SyncEngine::run_sync(
        Path::new(&vault_path),
        &remote_folder_name,
        oauth.inner(),
    )
    .await
}
