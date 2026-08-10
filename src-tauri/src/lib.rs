pub mod db;

use db::{Db, DbStatus};
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format_greeting(name)
}

#[tauri::command]
fn db_status(state: tauri::State<'_, Db>) -> Result<DbStatus, String> {
    state.status().map_err(|err| err.to_string())
}

fn format_greeting(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
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
        .invoke_handler(tauri::generate_handler![greet, db_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::format_greeting;

    #[test]
    fn format_greeting_includes_name() {
        let message = format_greeting("Supernotes");
        assert!(message.contains("Supernotes"));
        assert!(message.starts_with("Hello, "));
    }
}
