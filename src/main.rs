mod commands;
mod models;
mod utils;

use tauri::Manager;
use std::path::PathBuf;

#[tauri::command]
async fn init_data_directory(data_path: String) -> Result<(), String> {
    let path = PathBuf::from(&data_path);
    commands::filesystem::init_data_dir(&path).await
}

#[tauri::command]
async fn get_media_list(data_path: String) -> Result<Vec<models::Media>, String> {
    let path = PathBuf::from(&data_path);
    commands::media::get_media_list(&path).await
}

#[tauri::command]
async fn get_media_metadata(data_path: String, media_id: String) -> Result<models::MediaMetadata, String> {
    let path = PathBuf::from(&data_path);
    commands::media::get_metadata(&path, &media_id).await
}

#[tauri::command]
async fn update_media_metadata(data_path: String, media_id: String, metadata: models::MediaMetadata) -> Result<(), String> {
    let path = PathBuf::from(&data_path);
    commands::media::update_metadata(&path, &media_id, metadata).await
}

#[tauri::command]
async fn get_tags(data_path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&data_path);
    commands::tags::get_all_tags(&path).await
}

#[tauri::command]
async fn get_pages(data_path: String) -> Result<Vec<models::Page>, String> {
    let path = PathBuf::from(&data_path);
    commands::pages::get_pages(&path).await
}

#[tauri::command]
async fn save_page(data_path: String, page: models::Page) -> Result<(), String> {
    let path = PathBuf::from(&data_path);
    commands::pages::save_page(&path, &page).await
}

#[tauri::command]
async fn get_page(data_path: String, page_id: String) -> Result<models::Page, String> {
    let path = PathBuf::from(&data_path);
    commands::pages::get_page(&path, &page_id).await
}

#[tauri::command]
async fn delete_page(data_path: String, page_id: String) -> Result<(), String> {
    let path = PathBuf::from(&data_path);
    commands::pages::delete_page(&path, &page_id).await
}

#[tauri::command]
async fn query_media(data_path: String, tags: Vec<String>, match_all: bool) -> Result<Vec<models::Media>, String> {
    let path = PathBuf::from(&data_path);
    commands::media::query_media(&path, tags, match_all).await
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            init_data_directory,
            get_media_list,
            get_media_metadata,
            update_media_metadata,
            get_tags,
            get_pages,
            save_page,
            get_page,
            delete_page,
            query_media
        ])
        .setup(|app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
