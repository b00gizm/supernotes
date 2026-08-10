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
    use crate::db::NoteType;

    fn create(
        db: &Db,
        title: &str,
        body: &str,
        note_type: NoteType,
        pinned: bool,
    ) -> Result<Note, String> {
        db.with_conn(|conn| {
            Repository::new(conn).create_note(title, body, note_type, pinned)
        })
        .map_err(|err| err.to_string())
    }

    fn get(db: &Db, id: &str) -> Result<Note, String> {
        db.with_conn(|conn| Repository::new(conn).get_note(id))
            .map_err(|err| err.to_string())
    }

    fn list(db: &Db) -> Result<Vec<Note>, String> {
        db.with_conn(|conn| Repository::new(conn).list_notes())
            .map_err(|err| err.to_string())
    }

    fn update(
        db: &Db,
        id: &str,
        title: &str,
        body: &str,
        pinned: bool,
    ) -> Result<Note, String> {
        db.with_conn(|conn| Repository::new(conn).update_note(id, title, body, pinned))
            .map_err(|err| err.to_string())
    }

    fn delete(db: &Db, id: &str) -> Result<(), String> {
        db.with_conn(|conn| Repository::new(conn).delete_note(id))
            .map_err(|err| err.to_string())
    }

    #[test]
    fn note_crud_round_trip() {
        let db = Db::open_in_memory().unwrap();

        let created = create(&db, "Hello", "body", NoteType::Regular, false).unwrap();
        assert_eq!(created.title, "Hello");
        assert_eq!(created.body_markdown, "body");
        assert_eq!(created.note_type, NoteType::Regular);
        assert!(!created.pinned);

        let fetched = get(&db, &created.id).unwrap();
        assert_eq!(fetched, created);

        let updated = update(&db, &created.id, "Hello!", "edited", true).unwrap();
        assert_eq!(updated.title, "Hello!");
        assert_eq!(updated.body_markdown, "edited");
        assert!(updated.pinned);
        assert!(updated.updated_at >= created.updated_at);

        let notes = list(&db).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, created.id);

        delete(&db, &created.id).unwrap();
        assert!(get(&db, &created.id).is_err());
        assert!(list(&db).unwrap().is_empty());
    }

    #[test]
    fn missing_note_errors() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(get(&db, "missing").unwrap_err(), "not found");
        assert_eq!(
            update(&db, "missing", "t", "b", false).unwrap_err(),
            "not found"
        );
        assert_eq!(delete(&db, "missing").unwrap_err(), "not found");
    }

    #[test]
    fn create_note_input_defaults() {
        let json = r#"{"title":"Scratch"}"#;
        let input: CreateNoteInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.title, "Scratch");
        assert_eq!(input.body_markdown, "");
        assert_eq!(input.note_type, NoteType::Regular);
        assert!(!input.pinned);
    }
}
