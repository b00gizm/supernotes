use serde::Deserialize;
use tauri::State;

use crate::db::{CalendarEvent, Db, Repository};

#[derive(Debug, Deserialize)]
pub struct CreateCalendarEventInput {
    pub title: String,
    pub start: String,
    pub end: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCalendarEventInput {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub task_id: Option<String>,
}

#[tauri::command]
pub fn create_calendar_event(
    state: State<'_, Db>,
    input: CreateCalendarEventInput,
) -> Result<CalendarEvent, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).create_calendar_event(
                &input.title,
                &input.start,
                &input.end,
                input.task_id.as_deref(),
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_calendar_event(state: State<'_, Db>, id: String) -> Result<CalendarEvent, String> {
    state
        .with_conn(|conn| Repository::new(conn).get_calendar_event(&id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_calendar_events(
    state: State<'_, Db>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<CalendarEvent>, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).list_calendar_events(from.as_deref(), to.as_deref())
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_calendar_event(
    state: State<'_, Db>,
    input: UpdateCalendarEventInput,
) -> Result<CalendarEvent, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).update_calendar_event(
                &input.id,
                &input.title,
                &input.start,
                &input.end,
                input.task_id.as_deref(),
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_calendar_event(state: State<'_, Db>, id: String) -> Result<(), String> {
    state
        .with_conn(|conn| Repository::new(conn).delete_calendar_event(&id))
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NoteType, Repository, TaskState};

    #[test]
    fn calendar_commands_round_trip_via_db() {
        let db = Db::open_in_memory().unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_calendar_event(
                    "Standup",
                    "2026-08-10T09:30:00.000Z",
                    "2026-08-10T09:45:00.000Z",
                    None,
                )
            })
            .unwrap();
        assert_eq!(created.title, "Standup");

        let listed = db
            .with_conn(|conn| {
                Repository::new(conn).list_calendar_events(
                    Some("2026-08-10T00:00:00.000Z"),
                    Some("2026-08-11T00:00:00.000Z"),
                )
            })
            .unwrap();
        assert_eq!(listed.len(), 1);

        let updated = db
            .with_conn(|conn| {
                Repository::new(conn).update_calendar_event(
                    &created.id,
                    "Standup",
                    "2026-08-10T10:00:00.000Z",
                    "2026-08-10T10:15:00.000Z",
                    None,
                )
            })
            .unwrap();
        assert_eq!(updated.start, "2026-08-10T10:00:00.000Z");

        db.with_conn(|conn| Repository::new(conn).delete_calendar_event(&created.id))
            .unwrap();
        let empty = db
            .with_conn(|conn| Repository::new(conn).list_calendar_events(None, None))
            .unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn rejects_end_before_start() {
        let db = Db::open_in_memory().unwrap();
        let err = db
            .with_conn(|conn| {
                Repository::new(conn).create_calendar_event(
                    "Bad",
                    "2026-08-10T10:00:00.000Z",
                    "2026-08-10T09:00:00.000Z",
                    None,
                )
            })
            .unwrap_err();
        assert!(err.to_string().contains("end must be after start"));
    }

    #[test]
    fn create_calendar_event_input_keeps_task_id() {
        let db = Db::open_in_memory().unwrap();
        let (note, task) = db
            .with_conn(|conn| {
                let repo = Repository::new(conn);
                let note = repo.create_note("Tasks", "", NoteType::Regular, false)?;
                let task = repo.create_task(&note.id, "Focus", TaskState::Open, None, None)?;
                Ok((note, task))
            })
            .unwrap();
        let _ = note;
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_calendar_event(
                    "Focus block",
                    "2026-08-10T16:00:00.000Z",
                    "2026-08-10T16:45:00.000Z",
                    Some(&task.id),
                )
            })
            .unwrap();
        assert_eq!(created.task_id.as_deref(), Some(task.id.as_str()));
    }

    #[test]
    fn delete_event_unlinks_but_keeps_the_task() {
        let db = Db::open_in_memory().unwrap();
        let task = db
            .with_conn(|conn| {
                let repo = Repository::new(conn);
                let note = repo.create_note("Tasks", "", NoteType::Regular, false)?;
                repo.create_task(&note.id, "Focus", TaskState::Open, None, None)
            })
            .unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_calendar_event(
                    "Focus block",
                    "2026-08-10T16:00:00.000Z",
                    "2026-08-10T16:15:00.000Z",
                    Some(&task.id),
                )
            })
            .unwrap();
        let moved = db
            .with_conn(|conn| {
                Repository::new(conn).update_calendar_event(
                    &created.id,
                    "Focus block",
                    "2026-08-10T18:00:00.000Z",
                    "2026-08-10T19:00:00.000Z",
                    Some(&task.id),
                )
            })
            .unwrap();
        assert_eq!(moved.task_id.as_deref(), Some(task.id.as_str()));
        assert_eq!(moved.start, "2026-08-10T18:00:00.000Z");

        db.with_conn(|conn| Repository::new(conn).delete_calendar_event(&created.id))
            .unwrap();
        let kept = db
            .with_conn(|conn| Repository::new(conn).get_task(&task.id))
            .unwrap();
        assert_eq!(kept.title, "Focus");
        assert_eq!(kept.state, TaskState::Open);
    }
}
