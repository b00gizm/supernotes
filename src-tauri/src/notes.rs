use serde::Deserialize;
use tauri::State;

use crate::db::{Db, Note, NoteType, Repository};

#[derive(Debug, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    #[serde(default)]
    pub body_markdown: String,
    #[serde(default = "default_note_type")]
    pub note_type: NoteType,
    #[serde(default)]
    pub pinned: bool,
}

fn default_note_type() -> NoteType {
    NoteType::Regular
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoteInput {
    pub id: String,
    pub title: String,
    pub body_markdown: String,
    pub pinned: bool,
}

#[tauri::command]
pub fn create_note(state: State<'_, Db>, input: CreateNoteInput) -> Result<Note, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).create_note(
                &input.title,
                &input.body_markdown,
                input.note_type,
                input.pinned,
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_note(state: State<'_, Db>, id: String) -> Result<Note, String> {
    state
        .with_conn(|conn| Repository::new(conn).get_note(&id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_notes(state: State<'_, Db>) -> Result<Vec<Note>, String> {
    state
        .with_conn(|conn| Repository::new(conn).list_notes())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_note(state: State<'_, Db>, input: UpdateNoteInput) -> Result<Note, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).update_note(
                &input.id,
                &input.title,
                &input.body_markdown,
                input.pinned,
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_note(state: State<'_, Db>, id: String) -> Result<(), String> {
    state
        .with_conn(|conn| Repository::new(conn).delete_note(&id))
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NoteType, Repository};

    #[test]
    fn note_commands_round_trip_via_db() {
        // Commands take Tauri State; exercise the same Repository path they call.
        let db = Db::open_in_memory().unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_note("Hello", "body", NoteType::Regular, false)
            })
            .unwrap();
        let updated = db
            .with_conn(|conn| {
                Repository::new(conn).update_note(&created.id, "Hello!", "edited", true)
            })
            .unwrap();
        assert_eq!(updated.title, "Hello!");
        assert!(updated.pinned);
        db.with_conn(|conn| Repository::new(conn).delete_note(&created.id))
            .unwrap();
        assert!(db
            .with_conn(|conn| Repository::new(conn).get_note(&created.id))
            .is_err());
    }

    #[test]
    fn create_note_input_defaults() {
        let input: CreateNoteInput = serde_json::from_str(r#"{"title":"Scratch"}"#).unwrap();
        assert_eq!(input.body_markdown, "");
        assert_eq!(input.note_type, NoteType::Regular);
        assert!(!input.pinned);
    }
}
