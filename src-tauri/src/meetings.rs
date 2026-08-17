use serde::Deserialize;
use tauri::State;

use crate::db::{Db, Meeting, MeetingNote, Repository};

#[derive(Debug, Deserialize)]
pub struct CreateMeetingNoteInput {
    pub title: String,
    #[serde(default)]
    pub body_markdown: String,
    pub meeting_date: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMeetingInput {
    pub note_id: String,
    pub meeting_date: String,
    pub start_time: String,
    pub end_time: String,
}

#[tauri::command]
pub fn create_meeting_note(
    state: State<'_, Db>,
    input: CreateMeetingNoteInput,
) -> Result<MeetingNote, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).create_meeting_note(
                &input.title,
                &input.body_markdown,
                &input.meeting_date,
                &input.start_time,
                &input.end_time,
                None,
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_meeting(state: State<'_, Db>, input: UpdateMeetingInput) -> Result<Meeting, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).update_meeting(
                &input.note_id,
                &input.meeting_date,
                &input.start_time,
                &input.end_time,
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_meeting(state: State<'_, Db>, note_id: String) -> Result<Meeting, String> {
    state
        .with_conn(|conn| Repository::new(conn).get_meeting(&note_id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_meeting_note_from_event(
    state: State<'_, Db>,
    event_id: String,
) -> Result<MeetingNote, String> {
    state
        .with_conn(|conn| Repository::new(conn).create_meeting_note_from_event(&event_id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_meeting_for_event(
    state: State<'_, Db>,
    event_id: String,
) -> Result<MeetingNote, String> {
    state
        .with_conn(|conn| Repository::new(conn).get_meeting_for_event(&event_id))
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Repository;

    #[test]
    fn create_meeting_note_input_defaults_body() {
        let input: CreateMeetingNoteInput = serde_json::from_str(
            r#"{"title":"Pricing sync","meeting_date":"2026-08-10","start_time":"14:00","end_time":"14:23"}"#,
        )
        .unwrap();
        assert_eq!(input.title, "Pricing sync");
        assert_eq!(input.body_markdown, "");
        assert_eq!(input.meeting_date, "2026-08-10");
        assert_eq!(input.start_time, "14:00");
        assert_eq!(input.end_time, "14:23");
    }

    #[test]
    fn update_meeting_input_keeps_note_id() {
        let input: UpdateMeetingInput = serde_json::from_str(
            r#"{"note_id":"n-1","meeting_date":"2026-08-11","start_time":"10:00","end_time":"10:30"}"#,
        )
        .unwrap();
        assert_eq!(input.note_id, "n-1");
        assert_eq!(input.meeting_date, "2026-08-11");
    }

    #[test]
    fn meeting_commands_round_trip_via_db() {
        let db = Db::open_in_memory().unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_meeting_note(
                    "Pricing sync",
                    "",
                    "2026-08-10",
                    "14:00",
                    "14:23",
                    None,
                )
            })
            .unwrap();
        assert_eq!(created.note.note_type, crate::db::NoteType::Meeting);

        let updated = db
            .with_conn(|conn| {
                Repository::new(conn).update_meeting(
                    &created.note.id,
                    "2026-08-10",
                    "14:00",
                    "15:00",
                )
            })
            .unwrap();
        assert_eq!(updated.end_time, "15:00");

        let event = db
            .with_conn(|conn| {
                Repository::new(conn).create_calendar_event(
                    "Standup",
                    "2026-08-10T09:30:00.000Z",
                    "2026-08-10T09:45:00.000Z",
                    None,
                )
            })
            .unwrap();
        let from_event = db
            .with_conn(|conn| Repository::new(conn).create_meeting_note_from_event(&event.id))
            .unwrap();
        assert_eq!(
            from_event.meeting.calendar_event_id.as_deref(),
            Some(event.id.as_str())
        );
        let looked_up = db
            .with_conn(|conn| Repository::new(conn).get_meeting_for_event(&event.id))
            .unwrap();
        assert_eq!(looked_up.note.id, from_event.note.id);
    }
}
