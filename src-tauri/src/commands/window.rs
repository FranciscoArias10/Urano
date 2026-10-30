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
