use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "md5Checksum")]
    pub md5_checksum: Option<String>,
    #[serde(rename = "modifiedTime")]
    pub modified_time: Option<String>,
    pub trashed: Option<bool>,
    pub parents: Option<Vec<String>>,
}

pub struct GDriveClient {
    client: reqwest::Client,
}

impl GDriveClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// Finds or creates a folder in Google Drive (by name and optional parent_id)
    pub async fn find_or_create_folder(
        &self,
        token: &str,
        folder_name: &str,
        parent_id: Option<&str>,
    ) -> Result<String, String> {
        // Query to check if folder exists
        let mut query = format!(
            "name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            folder_name.replace('\'', "\\'")
        );
        if let Some(parent) = parent_id {
            query.push_str(&format!(" and '{}' in parents", parent));
        }

        let url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name)",
            urlencoding::encode(&query)
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        #[derive(Deserialize)]
        struct ListResponse {
            files: Option<Vec<DriveFile>>,
        }

        let list_data: ListResponse = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(files) = list_data.files {
            if let Some(first) = files.first() {
                return Ok(first.id.clone());
            }
        }

        // Folder doesn't exist, create it
        let mut metadata = serde_json::json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder"
        });

        if let Some(parent) = parent_id {
            metadata["parents"] = serde_json::json!([parent]);
        }

        let create_resp = self
            .client
            .post("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(token)
            .json(&metadata)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let created: DriveFile = create_resp.json().await.map_err(|e| e.to_string())?;
        Ok(created.id)
    }

    /// Lists all non-trashed files and folders under a parent folder
    pub async fn list_folder_contents(
        &self,
        token: &str,
        parent_id: &str,
    ) -> Result<Vec<DriveFile>, String> {
        let query = format!("'{}' in parents and trashed = false", parent_id);
        let url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&pageSize=1000&fields=files(id,name,mimeType,md5Checksum,modifiedTime,trashed,parents)",
            urlencoding::encode(&query)
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        #[derive(Deserialize)]
        struct ListResponse {
            files: Option<Vec<DriveFile>>,
        }

        let data: ListResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok(data.files.unwrap_or_default())
    }

    /// Uploads a new file using multipart upload
    pub async fn upload_file(
        &self,
        token: &str,
        name: &str,
        parent_id: &str,
        content: &[u8],
    ) -> Result<DriveFile, String> {
        let metadata = serde_json::json!({
            "name": name,
            "parents": [parent_id],
            "mimeType": "text/markdown"
        });

        let boundary = "urano_boundary_separator";
        let mut body = Vec::new();

        // Part 1: Metadata
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
        body.extend_from_slice(metadata.to_string().as_bytes());
        body.extend_from_slice(b"\r\n");

        // Part 2: Media content
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(b"Content-Type: text/markdown; charset=UTF-8\r\n\r\n");
        body.extend_from_slice(content);
        body.extend_from_slice(b"\r\n");

        // Closing boundary
        body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

        let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,md5Checksum,modifiedTime";

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {}", token)).unwrap());
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_str(&format!("multipart/related; boundary={}", boundary)).unwrap(),
        );

        let resp = self
            .client
            .post(url)
            .headers(headers)
            .body(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Error al subir archivo a Drive: {}", err_text));
        }

        let file: DriveFile = resp.json().await.map_err(|e| e.to_string())?;
        Ok(file)
    }

    /// Updates existing file content in Google Drive
    pub async fn update_file(
        &self,
        token: &str,
        file_id: &str,
        content: &[u8],
    ) -> Result<DriveFile, String> {
        let url = format!(
            "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media&fields=id,name,mimeType,md5Checksum,modifiedTime",
            file_id
        );

        let resp = self
            .client
            .patch(&url)
            .bearer_auth(token)
            .header("Content-Type", "text/markdown; charset=UTF-8")
            .body(content.to_vec())
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Error al actualizar archivo en Drive: {}", err_text));
        }

        let file: DriveFile = resp.json().await.map_err(|e| e.to_string())?;
        Ok(file)
    }

    /// Downloads file binary/text content from Google Drive
    pub async fn download_file(&self, token: &str, file_id: &str) -> Result<Vec<u8>, String> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media",
            file_id
        );

        let resp = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Error al descargar archivo {} de Drive", file_id));
        }

        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        Ok(bytes.to_vec())
    }

    /// Trashes a file in Google Drive
    pub async fn trash_file(&self, token: &str, file_id: &str) -> Result<(), String> {
        let url = format!("https://www.googleapis.com/drive/v3/files/{}", file_id);
        let resp = self
            .client
            .patch(&url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "trashed": true }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Error al mover a papelera en Drive: {}", file_id));
        }
        Ok(())
    }
}
