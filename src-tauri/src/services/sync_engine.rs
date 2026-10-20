use crate::services::gdrive::{DriveFile, GDriveClient};
use crate::services::oauth::OAuthService;
use crate::storage::manifest::{ManifestStore, SyncRecord};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncResult {
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub total: usize,
}

pub struct SyncEngine;

impl SyncEngine {
    /// Computes MD5 checksum formatted as lowercase hexadecimal (matching Google Drive md5Checksum)
    pub fn compute_md5(data: &[u8]) -> String {
        use md5::{Digest, Md5};
        let mut hasher = Md5::new();
        hasher.update(data);
        format!("{:x}", hasher.finalize())
    }

    /// Performs a zero-data-loss differential sync with Google Drive
    pub async fn run_sync(
        vault_path: &Path,
        remote_folder_name: &str,
        oauth_service: &OAuthService,
    ) -> Result<SyncResult, String> {
        let token = oauth_service.get_valid_access_token().await?;
        let gdrive = GDriveClient::new();
        let manifest = ManifestStore::open(vault_path)?;

        // 1. Locate or create root remote vault folder
        let root_remote_id = gdrive
            .find_or_create_folder(&token, remote_folder_name, None)
            .await?;

        // 2. Fetch existing sync manifest
        let manifest_records = manifest.get_all_records()?;

        // 3. Scan local files
        let mut local_files: HashMap<String, (PathBuf, String)> = HashMap::new();
        for entry in WalkDir::new(vault_path)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.')
            })
            .flatten()
        {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext.eq_ignore_ascii_case("md")
                    || ext.eq_ignore_ascii_case("markdown")
                    || ext.eq_ignore_ascii_case("canvas")
                    || ext.eq_ignore_ascii_case("base")
                    || crate::services::vault::IMAGE_EXTENSIONS.iter().any(|&ie| ext.eq_ignore_ascii_case(ie))
                {
                    if let Ok(rel) = path.strip_prefix(vault_path) {
                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        if let Ok(bytes) = fs::read(path) {
                            let hash = Self::compute_md5(&bytes);
                            local_files.insert(rel_str, (path.to_path_buf(), hash));
                        }
                    }
                }
            }
        }

        // 4. Fetch remote files from Google Drive
        let remote_list = gdrive.list_folder_contents(&token, &root_remote_id).await?;
        let mut remote_files: HashMap<String, DriveFile> = HashMap::new();
        for file in remote_list {
            if file.mime_type != "application/vnd.google-apps.folder" {
                remote_files.insert(file.name.clone(), file);
            }
        }

        let mut uploaded = 0;
        let mut downloaded = 0;
        let mut conflicts = 0;
        let total = local_files.len();

        // 5. Compare local files against remote
        for (rel_path, (local_path, local_md5)) in &local_files {
            let manifest_record = manifest_records.get(rel_path);
            let remote_file = remote_files.get(rel_path);

            match (manifest_record, remote_file) {
                // Case 1: Local file is completely new (not in manifest, not in Drive)
                (None, None) => {
                    let bytes = fs::read(local_path).map_err(|e| e.to_string())?;
                    let uploaded_file = gdrive
                        .upload_file(&token, rel_path, &root_remote_id, &bytes)
                        .await?;

                    let rec = SyncRecord {
                        rel_path: rel_path.clone(),
                        local_md5: local_md5.clone(),
                        remote_id: uploaded_file.id,
                        remote_md5: uploaded_file.md5_checksum.unwrap_or_else(|| local_md5.clone()),
                        last_synced_at: Utc::now().timestamp(),
                    };
                    manifest.upsert_record(&rec)?;
                    uploaded += 1;
                }

                // Case 2: In manifest and in Drive -> Check for modifications / conflicts
                (Some(record), Some(r_file)) => {
                    let r_md5 = r_file.md5_checksum.as_deref().unwrap_or("");
                    let local_changed = local_md5 != &record.local_md5;
                    let remote_changed = r_md5 != record.remote_md5;

                    if local_changed && remote_changed && local_md5 != r_md5 {
                        // CONFLICT: Both modified independently!
                        // Zero data loss: download remote file as conflict file
                        conflicts += 1;
                        let now_str = Utc::now().format("%Y-%m-%d_%H-%M").to_string();
                        let conflict_name = if let Some(stripped) = rel_path.strip_suffix(".md") {
                            format!("{} (Conflicto {}).md", stripped, now_str)
                        } else {
                            format!("{} (Conflicto {})", rel_path, now_str)
                        };

                        let conflict_path = vault_path.join(&conflict_name);
                        let remote_bytes = gdrive.download_file(&token, &r_file.id).await?;
                        let _ = fs::write(&conflict_path, remote_bytes);

                        // Keep local as current version and push update to Drive
                        let local_bytes = fs::read(local_path).map_err(|e| e.to_string())?;
                        let updated = gdrive.update_file(&token, &r_file.id, &local_bytes).await?;

                        let rec = SyncRecord {
                            rel_path: rel_path.clone(),
                            local_md5: local_md5.clone(),
                            remote_id: r_file.id.clone(),
                            remote_md5: updated.md5_checksum.unwrap_or_else(|| local_md5.clone()),
                            last_synced_at: Utc::now().timestamp(),
                        };
                        manifest.upsert_record(&rec)?;
                    } else if local_changed && !remote_changed {
                        // Only modified locally -> Upload to Drive
                        let bytes = fs::read(local_path).map_err(|e| e.to_string())?;
                        let updated = gdrive.update_file(&token, &r_file.id, &bytes).await?;

                        let rec = SyncRecord {
                            rel_path: rel_path.clone(),
                            local_md5: local_md5.clone(),
                            remote_id: r_file.id.clone(),
                            remote_md5: updated.md5_checksum.unwrap_or_else(|| local_md5.clone()),
                            last_synced_at: Utc::now().timestamp(),
                        };
                        manifest.upsert_record(&rec)?;
                        uploaded += 1;
                    } else if remote_changed && !local_changed {
                        // Only modified remotely -> Download to local
                        let bytes = gdrive.download_file(&token, &r_file.id).await?;
                        fs::write(local_path, &bytes).map_err(|e| e.to_string())?;

                        let rec = SyncRecord {
                            rel_path: rel_path.clone(),
                            local_md5: r_md5.to_string(),
                            remote_id: r_file.id.clone(),
                            remote_md5: r_md5.to_string(),
                            last_synced_at: Utc::now().timestamp(),
                        };
                        manifest.upsert_record(&rec)?;
                        downloaded += 1;
                    }
                }

                // Case 3: Local exists, not in manifest, but exists in Drive
                (None, Some(r_file)) => {
                    let r_md5 = r_file.md5_checksum.as_deref().unwrap_or("");
                    if local_md5 == r_md5 {
                        // Identical content, just register in manifest
                        let rec = SyncRecord {
                            rel_path: rel_path.clone(),
                            local_md5: local_md5.clone(),
                            remote_id: r_file.id.clone(),
                            remote_md5: r_md5.to_string(),
                            last_synced_at: Utc::now().timestamp(),
                        };
                        manifest.upsert_record(&rec)?;
                    } else {
                        // Conflict resolution on first sync
                        let bytes = gdrive.download_file(&token, &r_file.id).await?;
                        let now_str = Utc::now().format("%Y-%m-%d_%H-%M").to_string();
                        let conflict_name = format!("{}_remoto_{}.md", rel_path, now_str);
                        let _ = fs::write(vault_path.join(conflict_name), bytes);
                        conflicts += 1;
                    }
                }

                _ => {}
            }
        }

        // 6. Check for remote files that do not exist locally
        for (r_name, r_file) in &remote_files {
            if !local_files.contains_key(r_name) {
                // File exists remotely but not locally
                // If it was in manifest previously, it was deleted locally
                if manifest_records.contains_key(r_name) {
                    // Local deletion: trash file on Drive
                    let _ = gdrive.trash_file(&token, &r_file.id).await;
                    let _ = manifest.delete_record(r_name);
                } else {
                    // New file from another device: download
                    let bytes = gdrive.download_file(&token, &r_file.id).await?;
                    let target_path = vault_path.join(r_name);
                    if let Some(parent) = target_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    fs::write(&target_path, &bytes).map_err(|e| e.to_string())?;

                    let r_md5 = r_file.md5_checksum.as_deref().unwrap_or("");
                    let rec = SyncRecord {
                        rel_path: r_name.clone(),
                        local_md5: r_md5.to_string(),
                        remote_id: r_file.id.clone(),
                        remote_md5: r_md5.to_string(),
                        last_synced_at: Utc::now().timestamp(),
                    };
                    manifest.upsert_record(&rec)?;
                    downloaded += 1;
                }
            }
        }

        Ok(SyncResult {
            uploaded,
            downloaded,
            conflicts,
            total,
        })
    }
}
