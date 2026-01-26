use std::path::Path;
use tokio::fs;
use serde_json::Value;

pub async fn handle_file_io(command: &str, path: &Path, data: Option<Value>) -> Result<Value, String> {
    match command {
        "read" => {
            let content = fs::read_to_string(path)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))?;
            let json: Value = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse JSON: {}", e))?;
            Ok(json)
        }
        "write" => {
            if let Some(data) = data {
                let json_string = serde_json::to_string(&data)
                    .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
                fs::write(path, json_string)
                    .await
                    .map_err(|e| format!("Failed to write file: {}", e))?;
                Ok(data)
            } else {
                Err("No data provided for writing".to_string())
            }
        }
        _ => Err("Invalid command".to_string()),
    }
}