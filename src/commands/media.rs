use std::path::Path;
use tokio::fs;
use chrono::Utc;
use uuid::Uuid;
use crate::models::{Media, MediaMetadata};
use crate::utils;

pub async fn get_media_list(base_path: &Path) -> Result<Vec<Media>, String> {
    let media_path = base_path.join("media");
    
    if !media_path.exists() {
        return Ok(vec![]);
    }

    let mut media_list = Vec::new();
    
    let mut entries = fs::read_dir(&media_path)
        .await
        .map_err(|e| format!("Failed to read media directory: {}", e))?;

    while let Some(entry) = entries.next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))? 
    {
        let path = entry.path();
        if path.is_file() {
            if let Ok(media) = create_media_from_file(&path).await {
                media_list.push(media);
            }
        }
    }

    Ok(media_list)
}

async fn create_media_from_file(path: &Path) -> Result<Media, String> {
    let metadata = fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let media_type = detect_media_type(&filename);
    let id = utils::generate_id_from_filename(&filename);

    Ok(Media {
        id,
        filename,
        media_type,
        size: metadata.len(),
        created: Utc::now(),
        modified: Utc::now(),
    })
}

fn detect_media_type(filename: &str) -> String {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" => "image".to_string(),
        "mp4" | "webm" | "mov" | "avi" | "mkv" => "video".to_string(),
        _ => "unknown".to_string(),
    }
}

pub async fn get_metadata(base_path: &Path, media_id: &str) -> Result<MediaMetadata, String> {
    let meta_path = base_path.join("meta").join(format!("{}.json", media_id));
    
    if meta_path.exists() {
        let content = fs::read_to_string(&meta_path)
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse metadata: {}", e))
    } else {
        Ok(MediaMetadata::default())
    }
}

pub async fn update_metadata(base_path: &Path, media_id: &str, metadata: MediaMetadata) -> Result<(), String> {
    let meta_path = base_path.join("meta").join(format!("{}.json", media_id));
    
    let json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    
    fs::write(&meta_path, json)
        .await
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    Ok(())
}

pub async fn query_media(base_path: &Path, tags: Vec<String>, match_all: bool) -> Result<Vec<Media>, String> {
    let media_list = get_media_list(base_path).await?;
    
    if tags.is_empty() {
        return Ok(media_list);
    }

    let filtered = media_list
        .into_iter()
        .filter(|m| {
            let metadata = match tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(get_metadata(base_path, &m.id))
            }) {
                Ok(meta) => meta,
                Err(_) => return false,
            };

            if match_all {
                tags.iter().all(|t| metadata.tags.contains(t))
            } else {
                tags.iter().any(|t| metadata.tags.contains(t))
            }
        })
        .collect();

    Ok(filtered)
}
