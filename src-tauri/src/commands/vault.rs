use crate::services::vault::{FileItem, VaultService};
use std::collections::HashMap;
use std::path::Path;
use tauri::ipc::Response;

#[tauri::command]
pub fn open_vault(vault_path: String) -> Result<Vec<FileItem>, String> {
    VaultService::open_vault(Path::new(&vault_path))
}

#[tauri::command]
pub fn list_vault_files(vault_path: String) -> Result<Vec<FileItem>, String> {
    VaultService::open_vault(Path::new(&vault_path))
}

#[tauri::command]
pub fn read_file(file_path: String) -> Result<String, String> {
    VaultService::read_file(Path::new(&file_path))
}

#[tauri::command]
pub fn write_file(file_path: String, content: String) -> Result<(), String> {
    VaultService::write_file(Path::new(&file_path), &content)
}

#[tauri::command]
pub fn read_file_binary(file_path: String) -> Result<Response, String> {
    // Raw binary IPC response: avoids serializing every byte as a JSON number.
    VaultService::read_file_binary(Path::new(&file_path)).map(Response::new)
}

#[tauri::command]
pub fn write_file_binary(file_path: String, data: Vec<u8>) -> Result<(), String> {
    VaultService::write_file_binary(Path::new(&file_path), &data)
}

/// Returns the clipboard image as PNG bytes (empty body when the clipboard
/// holds no image). The body travels as raw binary, never as a JSON array.
#[tauri::command]
pub fn read_clipboard_image() -> Result<Response, String> {
    Ok(Response::new(read_clipboard_png().unwrap_or_default()))
}

/// Linux: ask GTK for the clipboard's `image/png` target directly. The clipboard
/// owner already holds an encoded PNG, so no decode/re-encode round-trip happens.
/// Falls back to GDK decoding + libpng (native C) for owners that only offer
/// other image targets. Must run on the main thread, which sync commands do.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn read_clipboard_png() -> Option<Vec<u8>> {
    let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);

    let targets: Vec<String> = clipboard
        .wait_for_targets()
        .unwrap_or_default()
        .iter()
        .map(|atom| atom.name().to_string())
        .collect();

    if !targets.iter().any(|t| t.starts_with("image/")) {
        return None;
    }

    if targets.iter().any(|t| t == "image/png") {
        if let Some(selection) = clipboard.wait_for_contents(&gtk::gdk::Atom::intern("image/png")) {
            let bytes = selection.data();
            if !bytes.is_empty() {
                return Some(bytes);
            }
        }
    }

    let pixbuf = clipboard.wait_for_image()?;
    pixbuf.save_to_bufferv("png", &[("compression", "3")]).ok()
}

/// Other platforms: arboard yields RGBA pixels, encode them with the fastest
/// PNG settings so the command stays responsive even in debug builds.
#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
fn read_clipboard_png() -> Option<Vec<u8>> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;

    let mut clipboard = arboard::Clipboard::new().ok()?;
    let img = clipboard.get_image().ok()?;
    let width = img.width as u32;
    let height = img.height as u32;
    let rgba = img.bytes.into_owned();

    let mut png_bytes = Vec::new();
    let encoder = PngEncoder::new_with_quality(
        std::io::Cursor::new(&mut png_bytes),
        CompressionType::Fast,
        FilterType::Sub,
    );
    encoder
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .ok()?;
    Some(png_bytes)
}

#[tauri::command]
pub fn create_file(file_path: String) -> Result<(), String> {
    VaultService::create_file(Path::new(&file_path))
}

#[tauri::command]
pub fn create_folder(folder_path: String) -> Result<(), String> {
    VaultService::create_folder(Path::new(&folder_path))
}

#[tauri::command]
pub fn delete_item(path: String) -> Result<(), String> {
    VaultService::delete_item(Path::new(&path))
}


#[tauri::command]
pub fn rename_item(old_path: String, new_path: String) -> Result<(), String> {
    VaultService::rename_item(Path::new(&old_path), Path::new(&new_path))
}

#[tauri::command]
pub fn get_vault_notes_content(vault_path: String) -> Result<HashMap<String, String>, String> {
    VaultService::get_vault_notes_content(Path::new(&vault_path))
}
