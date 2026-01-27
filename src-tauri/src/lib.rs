mod commands;

use serde_json::Value;
use std::path::PathBuf;
use dirs;

/// Generic file I/O command that proxies frontend requests to the filesystem.
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

/// Returns a platform-appropriate default data directory path.
#[tauri::command]
fn get_default_data_path() -> Result<String, String> {
  if let Some(base) = dirs::data_local_dir() {
    let path = base.join("mediaweb-data");
    return Ok(path.to_string_lossy().to_string());
  }
  // Fallback to current directory
  let fallback = std::env::current_dir()
    .map_err(|e| format!("Failed to get current directory: {}", e))?
    .join("mediaweb-data");
  Ok(fallback.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![file_io, get_default_data_path])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
