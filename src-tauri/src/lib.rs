pub mod db;
mod media;
mod menu_nav;
mod notes;

use db::Db;
use media::{resolve_note_image_path, save_note_image};
use notes::{
    create_note, delete_note, get_note, get_or_create_daily_note, list_links_from, list_links_to,
    list_notes, search_notes, set_note_pinned, update_note,
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
            menu_nav::install_app_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_note,
            get_or_create_daily_note,
            get_note,
            list_notes,
            search_notes,
            update_note,
            set_note_pinned,
            delete_note,
            list_links_from,
            list_links_to,
            save_note_image,
            resolve_note_image_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
