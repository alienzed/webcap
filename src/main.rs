mod commands;

use tauri::Manager;
use std::path::PathBuf;
use serde_json::Value;

/// Generic file I/O command that handles: read, write, list, mkdir, remove
/// All operations are scoped to a data directory with path validation.
#[tauri::command]
async fn file_io(
    op: String,
    data_path: String,
    rel_path: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    let base = PathBuf::from(&data_path);
    commands::file_io::handle_file_io(&op, &base, &rel_path, payload).await
}

/// Get the default data directory path (platform-specific)
/// On Windows: C:\Users\{user}\AppData\Local\mediaweb
/// On macOS: ~/Library/Application Support/mediaweb
/// On Linux: ~/.local/share/mediaweb
#[tauri::command]
fn get_default_data_path() -> String {
    if let Some(data_dir) = dirs::data_dir() {
        let mut mediaweb_dir = data_dir;
        mediaweb_dir.push("mediaweb");
        mediaweb_dir.to_string_lossy().to_string()
    } else {
        // Ultimate fallback to current directory
        "./mediaweb".to_string()
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![file_io, get_default_data_path])
        .setup(|app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
