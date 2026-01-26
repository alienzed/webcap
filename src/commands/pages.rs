use std::path::Path;
use tokio::fs;
use crate::models::Page;

pub async fn get_pages(base_path: &Path) -> Result<Vec<Page>, String> {
    let pages_path = base_path.join("pages");
    
    if !pages_path.exists() {
        return Ok(vec![]);
    }

    let mut pages = Vec::new();
    let mut entries = fs::read_dir(&pages_path)
        .await
        .map_err(|e| format!("Failed to read pages directory: {}", e))?;

    while let Some(entry) = entries.next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(page) = load_page(&path).await {
                pages.push(page);
            }
        }
    }

    Ok(pages)
}

pub async fn get_page(base_path: &Path, page_id: &str) -> Result<Page, String> {
    let page_path = base_path.join("pages").join(format!("{}.json", page_id));
    load_page(&page_path).await
}

pub async fn save_page(base_path: &Path, page: &Page) -> Result<(), String> {
    let pages_path = base_path.join("pages");
    
    if !pages_path.exists() {
        fs::create_dir_all(&pages_path)
            .await
            .map_err(|e| format!("Failed to create pages directory: {}", e))?;
    }

    let page_path = pages_path.join(format!("{}.json", page.id));
    let json = serde_json::to_string_pretty(&page)
        .map_err(|e| format!("Failed to serialize page: {}", e))?;
    
    fs::write(&page_path, json)
        .await
        .map_err(|e| format!("Failed to write page: {}", e))?;

    Ok(())
}

pub async fn delete_page(base_path: &Path, page_id: &str) -> Result<(), String> {
    let page_path = base_path.join("pages").join(format!("{}.json", page_id));
    
    fs::remove_file(&page_path)
        .await
        .map_err(|e| format!("Failed to delete page: {}", e))?;

    Ok(())
}

async fn load_page(path: &Path) -> Result<Page, String> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read page: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse page: {}", e))
}
