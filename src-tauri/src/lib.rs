mod calendar;
pub mod db;
mod media;
mod meetings;
mod menu_nav;
mod notes;
mod tasks;
mod transcription;

use calendar::{
    create_calendar_event, delete_calendar_event, get_calendar_event, list_calendar_events,
    update_calendar_event,
};
use db::Db;
use media::{resolve_note_image_path, save_note_image};
use meetings::{
    create_meeting_note, create_meeting_note_from_event, get_meeting, get_meeting_for_event,
    update_meeting,
};
use notes::{
    create_note, delete_note, get_note, get_or_create_daily_note, list_links_from, list_links_to,
    list_notes, search_notes, set_note_pinned, update_note,
};
use tasks::{
    create_task, delete_task, get_task, list_tasks, list_tasks_for_note, search_tasks, update_task,
};
use tauri::Manager;
use transcription::{
    ensure_transcription_model, get_microphone_permission, get_recording_state,
    list_transcription_models, production_recorder, start_recording, stop_recording,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db = Db::open(&data_dir).unwrap_or_else(|err| {
                panic!("failed to open sqlite database: {err}");
            });
            app.manage(db);
            app.manage(production_recorder(data_dir.join("models")));
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
            create_task,
            get_task,
            list_tasks,
            list_tasks_for_note,
            search_tasks,
            update_task,
            delete_task,
            create_calendar_event,
            get_calendar_event,
            list_calendar_events,
            update_calendar_event,
            delete_calendar_event,
            create_meeting_note,
            update_meeting,
            get_meeting,
            create_meeting_note_from_event,
            get_meeting_for_event,
            start_recording,
            stop_recording,
            get_recording_state,
            get_microphone_permission,
            list_transcription_models,
            ensure_transcription_model,
            save_note_image,
            resolve_note_image_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
