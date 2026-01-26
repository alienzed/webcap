use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Media {
    pub id: String,
    pub filename: String,
    pub media_type: String, // "image" or "video"
    pub size: u64,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaMetadata {
    pub tags: Vec<String>,
    pub title: String,
    pub caption: String,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop: Option<CropData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CropData {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrimData {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub match_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub sections: Vec<Section>,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub id: String,
    pub order: u32,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum Block {
    Text {
        id: String,
        order: u32,
        content: String,
    },
    Image {
        id: String,
        order: u32,
        media_id: String,
        caption: String,
    },
    Gallery {
        id: String,
        order: u32,
        query_id: String,
        layout: String, // "grid", "masonry", etc.
    },
    Video {
        id: String,
        order: u32,
        media_id: String,
        caption: String,
    },
}

impl Default for MediaMetadata {
    fn default() -> Self {
        Self {
            tags: vec![],
            title: String::new(),
            caption: String::new(),
            created: Utc::now(),
            modified: Utc::now(),
            crop: None,
            rotation: None,
        }
    }
}
