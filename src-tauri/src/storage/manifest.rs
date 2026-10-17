use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncRecord {
    pub rel_path: String,
    pub local_md5: String,
    pub remote_id: String,
    pub remote_md5: String,
    pub last_synced_at: i64,
}

pub struct ManifestStore {
    conn: Connection,
}

impl ManifestStore {
    pub fn open(vault_path: &Path) -> Result<Self, String> {
        let urano_dir = vault_path.join(".urano");
        let _ = std::fs::create_dir_all(&urano_dir);
        let db_path = urano_dir.join("sync.db");

        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_manifest (
                rel_path TEXT PRIMARY KEY,
                local_md5 TEXT NOT NULL,
                remote_id TEXT NOT NULL,
                remote_md5 TEXT NOT NULL,
                last_synced_at INTEGER NOT NULL
            );",
            [],
        )
        .map_err(|e| e.to_string())?;

        Ok(Self { conn })
    }

    pub fn get_all_records(&self) -> Result<HashMap<String, SyncRecord>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT rel_path, local_md5, remote_id, remote_md5, last_synced_at FROM sync_manifest")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(SyncRecord {
                    rel_path: row.get(0)?,
                    local_md5: row.get(1)?,
                    remote_id: row.get(2)?,
                    remote_md5: row.get(3)?,
                    last_synced_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for item in rows.flatten() {
            map.insert(item.rel_path.clone(), item);
        }
        Ok(map)
    }

    pub fn upsert_record(&self, record: &SyncRecord) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO sync_manifest (rel_path, local_md5, remote_id, remote_md5, last_synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(rel_path) DO UPDATE SET
                    local_md5 = excluded.local_md5,
                    remote_id = excluded.remote_id,
                    remote_md5 = excluded.remote_md5,
                    last_synced_at = excluded.last_synced_at;",
                params![
                    record.rel_path,
                    record.local_md5,
                    record.remote_id,
                    record.remote_md5,
                    record.last_synced_at
                ],
            )
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn delete_record(&self, rel_path: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM sync_manifest WHERE rel_path = ?1", params![rel_path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
