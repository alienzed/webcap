use std::path::{Path, PathBuf};
use tokio::fs;
use serde_json::Value;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

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

/// Resolves a relative path against a base path safely.
async fn resolve_path(base_path: &Path, rel_path: &str) -> Result<PathBuf, String> {
    eprintln!("🔍 [resolve_path] base={:?}, rel={:?}", base_path, rel_path);
    let _ = sanitize_rel_path(rel_path)?;

    // Ensure base exists and get absolute form
    if !base_path.exists() {
        fs::create_dir_all(base_path)
            .await
            .map_err(|e| format!("Cannot create base path: {}", e))?;
    }

    let base_abs = if base_path.is_absolute() {
        base_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .join(base_path)
    };

    // Depth-based escape check (no need for canonicalize on non-existent paths)
    let mut depth: i32 = 0;
    for component in Path::new(rel_path).components() {
        match component {
            std::path::Component::Normal(_) => depth += 1,
            std::path::Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    eprintln!("❌ [resolve_path] Too many .. -> escape");
                    return Err("Path escape detected".into());
                }
            }
            std::path::Component::CurDir => {}
            _ => {}
        }
    }

    let joined = base_abs.join(rel_path);
    eprintln!("✅ [resolve_path] depth={}, joined={:?}", depth, joined);
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
        "write_binary" => {
            eprintln!("💾 [file_io] Writing binary file: {:?}", path);
            if let Some(Value::String(base64_data)) = payload {
                // Remove data URL prefix if present
                let base64_str = if let Some(idx) = base64_data.find("base64,") {
                    &base64_data[idx + 7..]
                } else {
                    &base64_data
                };

                let bytes = STANDARD
                    .decode(base64_str)
                    .map_err(|e| format!("Failed to decode base64: {}", e))?;

                if let Some(parent) = path.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent)
                            .await
                            .map_err(|e| format!("Failed to create directory: {}", e))?;
                    }
                }

                fs::write(&path, bytes)
                    .await
                    .map_err(|e| format!("Failed to write binary file: {}", e))?;
                eprintln!("✅ [file_io] Binary write successful");
                Ok(serde_json::json!({ "ok": true }))
            } else {
                Err("No base64 payload provided for write_binary".to_string())
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
