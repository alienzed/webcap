use std::path::{Path, PathBuf};
use tokio::fs;
use serde_json::Value;

fn sanitize_rel_path(rel_path: &str) -> Result<&str, String> {
    if rel_path.is_empty() {
        return Err("Path is empty".into());
    }
    if rel_path.contains("..") { // prevent traversal
        return Err("Path traversal is not allowed".into());
    }
    Ok(rel_path)
}

async fn resolve_path(base_path: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let _ = sanitize_rel_path(rel_path)?;
    let joined = base_path.join(rel_path);
    Ok(joined)
}

pub async fn handle_file_io(op: &str, base_path: &Path, rel_path: &str, payload: Option<Value>) -> Result<Value, String> {
    let path = resolve_path(base_path, rel_path).await?;
    match op {
        "read" => {
            let content = fs::read_to_string(&path)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))?;
            let json: Value = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;
            Ok(json)
        }
        "write" => {
            if let Some(data) = payload {
                let json_string = serde_json::to_string_pretty(&data)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                if let Some(parent) = path.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent)
                            .await
                            .map_err(|e| format!("Failed to create directory: {}", e))?;
                    }
                }
                fs::write(&path, json_string)
                    .await
                    .map_err(|e| format!("Failed to write file: {}", e))?;
                Ok(data)
            } else {
                Err("No payload provided for write".to_string())
            }
        }
        "list" => {
            let mut entries = fs::read_dir(&path)
                .await
                .map_err(|e| format!("Failed to read directory: {}", e))?;
            let mut items = Vec::new();
            while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Failed to read directory entry: {}", e))? {
                let file_name = entry.file_name();
                let name = file_name.to_string_lossy().to_string();
                let is_dir = entry.file_type().await.map_err(|e| format!("Failed to read file type: {}", e))?.is_dir();
                items.push(serde_json::json!({ "name": name, "is_dir": is_dir }));
            }
            Ok(Value::Array(items))
        }
        "mkdir" => {
            fs::create_dir_all(&path)
                .await
                .map_err(|e| format!("Failed to create directory: {}", e))?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "remove" => {
            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .await
                    .map_err(|e| format!("Failed to remove directory: {}", e))?;
            } else {
                fs::remove_file(&path)
                    .await
                    .map_err(|e| format!("Failed to remove file: {}", e))?;
            }
            Ok(serde_json::json!({ "ok": true }))
        }
        _ => Err("Invalid op".to_string()),
    }
}