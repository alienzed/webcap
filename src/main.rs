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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![file_io])
        .setup(|app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
