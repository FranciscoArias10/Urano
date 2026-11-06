#[tauri::command]
pub fn toggle_maximize_window(window: tauri::Window) {
    if let Ok(is_maximized) = window.is_maximized() {
        if is_maximized {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn close_window(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
pub fn set_window_decorations(
    app: tauri::AppHandle,
    window: tauri::Window,
    decorations: bool,
) -> Result<(), String> {
    use tauri::Manager;
    window.set_decorations(decorations).map_err(|e| e.to_string())?;
    if let Ok(config_dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&config_dir);
        let style_path = config_dir.join("window_frame_style.txt");
        let style_str = if decorations { "native" } else { "frameless" };
        let _ = std::fs::write(style_path, style_str);
    }
    Ok(())
}

#[tauri::command]
pub async fn open_settings_window(
    app: tauri::AppHandle,
    tab_id: Option<String>,
    vault_name: Option<String>,
    frame_style: Option<String>,
) -> Result<(), String> {
    use tauri::{Emitter, Manager};

    let title = match &vault_name {
        Some(v) if !v.trim().is_empty() => format!("Preferencias - {} - Urano", v.trim()),
        _ => "Preferencias - Urano".to_string(),
    };

    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        let _ = existing.set_title(&title);
        if let Some(tab) = tab_id {
            let _ = existing.emit("urano:set-settings-tab", tab);
        }
        return Ok(());
    }

    let mut query_params = vec!["window=settings".to_string()];
    if let Some(tab) = &tab_id {
        query_params.push(format!("tab={}", urlencoding::encode(tab)));
    }
    if let Some(v) = &vault_name {
        if !v.trim().is_empty() {
            query_params.push(format!("vault={}", urlencoding::encode(v.trim())));
        }
    }
    let url_str = format!("index.html?{}", query_params.join("&"));

    let is_native = frame_style.as_deref() == Some("native");

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App(url_str.into()),
    )
    .title(&title)
    .inner_size(900.0, 680.0)
    .min_inner_size(600.0, 450.0)
    .resizable(true)
    .decorations(is_native);

    let window = builder.build().map_err(|e| e.to_string())?;

    if let Some(icon) = app.default_window_icon() {
        let _ = window.set_icon(icon.clone());
    }
    let _ = window.set_focus();

    Ok(())
}

#[tauri::command]
pub fn set_custom_window_icon(
    app: tauri::AppHandle,
    window: tauri::Window,
    icon_path: Option<String>,
) -> Result<(), String> {
    if let Some(path_str) = icon_path {
        let decoded = image::open(&path_str)
            .map_err(|e| format!("No se pudo cargar el icono desde {path_str}: {e}"))?
            .to_rgba8();
        let (width, height) = decoded.dimensions();
        let img = tauri::image::Image::new_owned(decoded.into_raw(), width, height);
        window.set_icon(img).map_err(|e| e.to_string())?;
    } else if let Some(default_icon) = app.default_window_icon() {
        window.set_icon(default_icon.clone()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
