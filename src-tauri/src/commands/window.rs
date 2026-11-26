use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWindowState {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
}

impl Default for SavedWindowState {
    fn default() -> Self {
        Self {
            width: 1200,
            height: 800,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

#[derive(Default)]
pub struct MainWindowBoundsState(pub Mutex<SavedWindowState>);

/// Checks that at least a 120x80 region of `(x, y, width, height)` overlaps one of the monitors.
pub fn is_rect_visible_on_monitors(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitors: &[(i32, i32, u32, u32)],
) -> bool {
    if width < 400 || height < 300 || x <= -16_000 || y <= -16_000 {
        return false;
    }
    if monitors.is_empty() {
        return true;
    }
    let rx1 = i64::from(x);
    let ry1 = i64::from(y);
    let rx2 = rx1 + i64::from(width);
    let ry2 = ry1 + i64::from(height);

    monitors.iter().any(|&(mx, my, mw, mh)| {
        let mx1 = i64::from(mx);
        let my1 = i64::from(my);
        let mx2 = mx1 + i64::from(mw);
        let my2 = my1 + i64::from(mh);

        let overlap_w = rx2.min(mx2) - rx1.max(mx1);
        let overlap_h = ry2.min(my2) - ry1.max(my1);
        overlap_w >= 120 && overlap_h >= 80
    })
}

pub fn update_tracked_window_bounds(window: &tauri::Window) {
    use tauri::Manager;

    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(false) {
        return;
    }
    let is_max = window.is_maximized().unwrap_or(false);
    let app_handle = window.app_handle();
    let tracker = app_handle.state::<MainWindowBoundsState>();
    if let Ok(mut state) = tracker.0.lock() {
        state.maximized = is_max;
        if !is_max {
            if let Ok(size) = window.inner_size() {
                if size.width >= 400 && size.height >= 300 {
                    state.width = size.width;
                    state.height = size.height;
                }
            }
            if let Ok(pos) = window.outer_position() {
                if pos.x > -16_000 && pos.y > -16_000 {
                    state.x = Some(pos.x);
                    state.y = Some(pos.y);
                }
            }
        }
    };
}

pub fn persist_main_window_state(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(win) = app.get_webview_window("main") {
        if !win.is_minimized().unwrap_or(false) && win.is_visible().unwrap_or(false) {
            let is_max = win.is_maximized().unwrap_or(false);
            let tracker = app.state::<MainWindowBoundsState>();
            if let Ok(mut state) = tracker.0.lock() {
                state.maximized = is_max;
                if !is_max {
                    if let Ok(size) = win.inner_size() {
                        if size.width >= 400 && size.height >= 300 {
                            state.width = size.width;
                            state.height = size.height;
                        }
                    }
                    if let Ok(pos) = win.outer_position() {
                        if pos.x > -16_000 && pos.y > -16_000 {
                            state.x = Some(pos.x);
                            state.y = Some(pos.y);
                        }
                    }
                }
            };
        }
    }

    let tracker = app.state::<MainWindowBoundsState>();
    let snapshot = match tracker.0.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return,
    };

    if snapshot.width < 400 || snapshot.height < 300 {
        return;
    }

    if let Ok(config_dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&config_dir);
        let state_path = config_dir.join("window_state.json");
        if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
            let _ = std::fs::write(state_path, json);
        }
    }
}

pub fn restore_main_window_state(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use tauri::Manager;

    if let Ok(config_dir) = app.path().app_config_dir() {
        let style_path = config_dir.join("window_frame_style.txt");
        if let Ok(saved_style) = std::fs::read_to_string(style_path) {
            if saved_style.trim() == "native" {
                let _ = window.set_decorations(true);
            }
        }

        let state_path = config_dir.join("window_state.json");
        if let Ok(raw) = std::fs::read_to_string(state_path) {
            if let Ok(saved) = serde_json::from_str::<SavedWindowState>(&raw) {
                if saved.width >= 400 && saved.height >= 300 {
                    let monitors: Vec<(i32, i32, u32, u32)> = window
                        .available_monitors()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|m| {
                            let pos = m.position();
                            let sz = m.size();
                            (pos.x, pos.y, sz.width, sz.height)
                        })
                        .collect();

                    let _ = window.set_size(tauri::PhysicalSize::new(saved.width, saved.height));
                    if let (Some(x), Some(y)) = (saved.x, saved.y) {
                        if is_rect_visible_on_monitors(x, y, saved.width, saved.height, &monitors) {
                            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                        } else {
                            let _ = window.center();
                        }
                    } else {
                        let _ = window.center();
                    }

                    if let Ok(mut tracked) = app.state::<MainWindowBoundsState>().0.lock() {
                        *tracked = saved.clone();
                    }

                    if saved.maximized {
                        let _ = window.maximize();
                    }
                }
            }
        } else if let Ok(mut tracked) = app.state::<MainWindowBoundsState>().0.lock() {
            if let Ok(size) = window.inner_size() {
                if size.width >= 400 && size.height >= 300 {
                    tracked.width = size.width;
                    tracked.height = size.height;
                }
            }
            if let Ok(pos) = window.outer_position() {
                if pos.x > -16_000 && pos.y > -16_000 {
                    tracked.x = Some(pos.x);
                    tracked.y = Some(pos.y);
                }
            }
        }
    }

    let _ = window.show();
    let _ = window.set_focus();
}

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
pub fn close_main_and_exit(app: tauri::AppHandle) {
    persist_main_window_state(&app);
    app.exit(0);
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
    .decorations(is_native)
    .theme(Some(tauri::Theme::Dark))
    .background_color(tauri::window::Color(30, 30, 30, 255));

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_visibility_accepts_primary_and_negative_secondary_monitors() {
        let monitors = vec![(0, 0, 1920, 1080), (-1920, 0, 1920, 1080)];
        assert!(is_rect_visible_on_monitors(100, 100, 1200, 800, &monitors));
        assert!(is_rect_visible_on_monitors(-1500, 80, 1200, 800, &monitors));
    }

    #[test]
    fn rect_visibility_rejects_minimized_and_unplugged_monitors() {
        let monitors = vec![(0, 0, 1920, 1080)];
        assert!(!is_rect_visible_on_monitors(-32_000, -32_000, 1200, 800, &monitors));
        assert!(!is_rect_visible_on_monitors(2400, 100, 1200, 800, &monitors));
        assert!(!is_rect_visible_on_monitors(100, 100, 200, 150, &monitors));
    }
}
