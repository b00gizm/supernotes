//! Note image files under `{app_data_dir}/images/`.

use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

const IMAGE_DIR: &str = "images";
const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;

fn sanitize_extension(extension: &str) -> Result<String, String> {
    let ext = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    if ext.is_empty() || ext.len() > 8 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid image extension".into());
    }
    Ok(ext)
}

/// Reject path traversal; only `images/<file>` refs are allowed.
pub fn validate_relative_image_path(relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let mut components = path.components();
    match components.next() {
        Some(Component::Normal(first)) if first == IMAGE_DIR => {}
        _ => return Err("invalid image path".into()),
    }
    let mut depth = 1usize;
    for component in components {
        match component {
            Component::Normal(_) => depth += 1,
            _ => return Err("invalid image path".into()),
        }
    }
    if depth != 2 {
        return Err("invalid image path".into());
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
pub fn save_note_image(
    app: AppHandle,
    bytes: Vec<u8>,
    extension: String,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("empty image".into());
    }
    // ponytail: hard size cap; raise if camera-roll dumps become common.
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("image too large".into());
    }
    let ext = sanitize_extension(&extension)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    let dir = data_dir.join(IMAGE_DIR);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let name = format!("{}.{}", Uuid::new_v4(), ext);
    let path = dir.join(&name);
    fs::write(&path, &bytes).map_err(|err| err.to_string())?;
    Ok(format!("{IMAGE_DIR}/{name}"))
}

#[tauri::command]
pub fn resolve_note_image_path(app: AppHandle, relative: String) -> Result<String, String> {
    let rel = validate_relative_image_path(&relative)?;
    let absolute = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join(rel);
    Ok(absolute.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_images_uuid_ext() {
        assert!(validate_relative_image_path("images/abc.png").is_ok());
    }

    #[test]
    fn rejects_traversal_and_siblings() {
        assert!(validate_relative_image_path("../images/x.png").is_err());
        assert!(validate_relative_image_path("images/../secret.png").is_err());
        assert!(validate_relative_image_path("notes/x.png").is_err());
        assert!(validate_relative_image_path("images/a/b.png").is_err());
        assert!(validate_relative_image_path("images").is_err());
    }

    #[test]
    fn sanitize_extension_allows_common_types() {
        assert_eq!(sanitize_extension("PNG").unwrap(), "png");
        assert_eq!(sanitize_extension(".jpeg").unwrap(), "jpeg");
        assert!(sanitize_extension("../x").is_err());
        assert!(sanitize_extension("").is_err());
    }
}
