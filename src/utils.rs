use uuid::Uuid;

pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn generate_id_from_filename(filename: &str) -> String {
    // Simple hash-like ID from filename without external crypto
    let mut hash = 5381u64;
    for byte in filename.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
    }
    format!("{:x}", hash)
}
