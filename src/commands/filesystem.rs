use std::path::Path;
use tokio::fs;

pub async fn init_data_dir(base_path: &Path) -> Result<(), String> {
    let paths = vec!["media", "meta", "pages"];
    
    for dir in paths {
        let path = base_path.join(dir);
        if !path.exists() {
            fs::create_dir_all(&path)
                .await
                .map_err(|e| format!("Failed to create {}: {}", dir, e))?;
        }
    }

    // Create tags.json if it doesn't exist
    let tags_path = base_path.join("tags.json");
    if !tags_path.exists() {
        fs::write(&tags_path, "[]")
            .await
            .map_err(|e| format!("Failed to create tags.json: {}", e))?;
    }

    Ok(())
}
