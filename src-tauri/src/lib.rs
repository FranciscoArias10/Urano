pub mod commands;
pub mod services;
pub mod spellcheck;
pub mod storage;

use services::oauth::OAuthService;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::spellcheck::setup_hunspell_dictionaries();

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

            // Linux / WebKitGTK: el pellizco del touchpad escala la página entera
            // de forma nativa. Mientras el puntero esté sobre un Canvas lo
            // interceptamos y se lo reenviamos al lienzo (ver commands/canvas.rs).
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    commands::canvas::install_touchpad_pinch_interceptor(&window);
                    let _ = commands::spellcheck::set_spellcheck_language(window.clone(), "en".to_string(), true);
                }
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
            commands::vault::read_clipboard_image,
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
            commands::canvas::set_canvas_pinch_capture,
            commands::locales::list_custom_locales,
            commands::locales::get_custom_locales_dir,
            commands::locales::open_path,
            commands::spellcheck::set_spellcheck_language,
            commands::spellcheck::check_words_batch,
            commands::spellcheck::suggest_word,
            spellcheck::load_hunspell_dictionary,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
