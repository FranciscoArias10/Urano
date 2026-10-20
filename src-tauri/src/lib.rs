pub mod commands;
pub mod services;
pub mod storage;

use services::oauth::OAuthService;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let oauth_service = Arc::new(OAuthService::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(oauth_service)
        .invoke_handler(tauri::generate_handler![
            commands::vault::open_vault,
            commands::vault::list_vault_files,
            commands::vault::read_file,
            commands::vault::write_file,
            commands::vault::read_file_binary,
            commands::vault::write_file_binary,
            commands::vault::create_file,
            commands::vault::create_folder,
            commands::vault::delete_item,
            commands::vault::rename_item,
            commands::vault::get_vault_notes_content,
            commands::auth::is_authenticated,
            commands::auth::start_oauth_login,
            commands::auth::get_google_user,
            commands::auth::logout_google,
            commands::sync::sync_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
