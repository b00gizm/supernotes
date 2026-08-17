use serde::Deserialize;
use tauri::State;

use crate::db::{Db, Meeting, Repository};

#[derive(Debug, Deserialize)]
pub struct MeetingInput {
    pub note_id: String,
    pub meeting_date: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub transcript_note_id: Option<String>,
}

#[tauri::command]
pub fn get_meeting(state: State<'_, Db>, note_id: String) -> Result<Meeting, String> {
    state
        .with_conn(|conn| Repository::new(conn).get_meeting(&note_id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_meeting(state: State<'_, Db>, input: MeetingInput) -> Result<Meeting, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).create_meeting(
                &input.note_id,
                &input.meeting_date,
                &input.start_time,
                &input.end_time,
                input.transcript_note_id.as_deref(),
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_meeting(state: State<'_, Db>, input: MeetingInput) -> Result<Meeting, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).update_meeting(
                &input.note_id,
                &input.meeting_date,
                &input.start_time,
                &input.end_time,
                input.transcript_note_id.as_deref(),
            )
        })
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NoteType, Repository};

    #[test]
    fn meeting_commands_round_trip_via_db() {
        let db = Db::open_in_memory().unwrap();
        let note = db
            .with_conn(|conn| {
                Repository::new(conn).create_note("Pricing sync", "", NoteType::Meeting, false)
            })
            .unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_meeting(&note.id, "2026-08-10", "14:00", "14:23", None)
            })
            .unwrap();
        assert_eq!(created.meeting_date, "2026-08-10");
        assert_eq!(created.start_time, "14:00");
        assert_eq!(created.end_time, "14:23");

        let updated = db
            .with_conn(|conn| {
                Repository::new(conn).update_meeting(&note.id, "2026-08-11", "10:00", "10:30", None)
            })
            .unwrap();
        assert_eq!(updated.meeting_date, "2026-08-11");
        assert_eq!(
            db.with_conn(|conn| Repository::new(conn).get_meeting(&note.id))
                .unwrap()
                .start_time,
            "10:00"
        );
    }

    #[test]
    fn meeting_input_defaults_transcript() {
        let input: MeetingInput = serde_json::from_str(
            r#"{"note_id":"n1","meeting_date":"2026-08-10","start_time":"14:00","end_time":"14:23"}"#,
        )
        .unwrap();
        assert_eq!(input.note_id, "n1");
        assert!(input.transcript_note_id.is_none());
    }
}
