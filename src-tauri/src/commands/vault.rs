use crate::services::vault::{FileItem, VaultService};
use std::collections::HashMap;
use std::path::Path;

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
