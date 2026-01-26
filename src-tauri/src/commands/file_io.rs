use std::path::{Path, PathBuf};
use tokio::fs;
use serde_json::Value;

/// Validates a relative path to prevent directory traversal attacks.
/// Only allows alphanumeric, dash, underscore, dot, and forward slash.
fn sanitize_rel_path(rel_path: &str) -> Result<&str, String> {
    if rel_path.is_empty() {
        return Err("Path is empty".into());
    }
    if rel_path.contains("..") {
        return Err("Path traversal is not allowed".into());
    }
    if rel_path.starts_with('/') || rel_path.starts_with('\\') {
        return Err("Absolute paths are not allowed".into());
    }

    for ch in rel_path.chars() {
        if !ch.is_alphanumeric() && ch != '-' && ch != '_' && ch != '.' && ch != '/' {
            return Err(format!("Invalid character in path: '{}'", ch));
        }
    }

    Ok(rel_path)
}

/// Ensures the base path exists and returns its canonical form.
async fn canonical_base(base_path: &Path) -> Result<PathBuf, String> {
    if !base_path.exists() {
        fs::create_dir_all(base_path)
            .await
            .map_err(|e| format!("Cannot create base path: {}", e))?;
    }

    base_path
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize base path: {}", e))
}

/// Resolves a relative path against a base path safely.
async fn resolve_path(base_path: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let _ = sanitize_rel_path(rel_path)?;
    let canonical_base = canonical_base(base_path).await?;
    let joined = base_path.join(rel_path);

    let canonical_joined = if joined.exists() {
        joined.canonicalize().map_err(|e| format!("Cannot canonicalize path: {}", e))?
    } else {
        joined.clone()
    };

    if !canonical_joined.starts_with(&canonical_base) {
        return Err("Path escape detected".into());
    }

    Ok(joined)
}

/// Handles generic file I/O operations: read, write, list, mkdir, remove.
/// All operations are relative to base_path with security validation.
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
            while let Some(entry) = entries.next_entry()
                .await
                .map_err(|e| format!("Failed to read directory entry: {}", e))? 
            {
                let file_name = entry.file_name();
                let name = file_name.to_string_lossy().to_string();
                let is_dir = entry.file_type()
                    .await
                    .map_err(|e| format!("Failed to read file type: {}", e))?
                    .is_dir();
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
        _ => Err(format!("Invalid operation: {}", op)),
    }
}
