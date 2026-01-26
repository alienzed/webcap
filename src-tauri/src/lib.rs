mod commands;

use serde_json::Value;
use std::path::PathBuf;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![file_io])
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
