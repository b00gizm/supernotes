pub mod db;
mod notes;

use db::{Db, DbStatus};
use notes::{create_note, delete_note, get_note, list_notes, update_note};
use tauri::Manager;

#[tauri::command]
fn db_status(state: tauri::State<'_, Db>) -> Result<DbStatus, String> {
    state.status().map_err(|err| err.to_string())
}

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
            db_status,
            create_note,
            get_note,
            list_notes,
            update_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
