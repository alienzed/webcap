use std::path::Path;
use tokio::fs;
use std::collections::HashSet;

pub async fn get_all_tags(base_path: &Path) -> Result<Vec<String>, String> {
    let tags_path = base_path.join("tags.json");
    
    if !tags_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&tags_path)
        .await
        .map_err(|e| format!("Failed to read tags: {}", e))?;
    
    let tags: Vec<String> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse tags: {}", e))?;

    Ok(tags)
}

pub async fn add_tag(base_path: &Path, tag: String) -> Result<(), String> {
    let mut tags = get_all_tags(base_path).await?;
    
    if !tags.contains(&tag) {
        tags.push(tag);
        tags.sort();
        save_tags(base_path, &tags).await?;
    }

    Ok(())
}

pub async fn remove_unused_tags(base_path: &Path) -> Result<(), String> {
    let meta_path = base_path.join("meta");
    
    if !meta_path.exists() {
        return Ok(());
    }

    let mut used_tags = HashSet::new();

    let mut entries = fs::read_dir(&meta_path)
        .await
        .map_err(|e| format!("Failed to read meta directory: {}", e))?;

    while let Some(entry) = entries.next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(&path).await {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(tags_array) = meta.get("tags").and_then(|t| t.as_array()) {
                        for tag in tags_array {
                            if let Some(tag_str) = tag.as_str() {
                                used_tags.insert(tag_str.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let all_tags = get_all_tags(base_path).await?;
    let filtered_tags: Vec<String> = all_tags
        .into_iter()
        .filter(|t| used_tags.contains(t))
        .collect();

    save_tags(base_path, &filtered_tags).await?;
    Ok(())
}

async fn save_tags(base_path: &Path, tags: &[String]) -> Result<(), String> {
    let tags_path = base_path.join("tags.json");
    let json = serde_json::to_string_pretty(tags)
        .map_err(|e| format!("Failed to serialize tags: {}", e))?;
    
    fs::write(&tags_path, json)
        .await
        .map_err(|e| format!("Failed to write tags: {}", e))?;

    Ok(())
}
