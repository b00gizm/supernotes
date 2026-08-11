pub mod db;
mod media;
mod notes;

use db::Db;
use media::{resolve_note_image_path, save_note_image};
use notes::{
    create_note, delete_note, get_note, list_notes, search_notes, set_note_pinned, update_note,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db = Db::open(&data_dir).expect("failed to open sqlite database");
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_note,
            get_note,
            list_notes,
            search_notes,
            update_note,
            set_note_pinned,
            delete_note,
            save_note_image,
            resolve_note_image_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
