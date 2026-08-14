use serde::{Deserialize, Deserializer};
use tauri::State;

use crate::db::{Db, Repository, Task, TaskListFilter, TaskPriority, TaskState};

#[derive(Debug, Deserialize)]
pub struct CreateTaskInput {
    pub note_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default = "default_task_state")]
    pub state: TaskState,
    pub due_date: Option<String>,
    pub priority: Option<TaskPriority>,
}

fn default_task_state() -> TaskState {
    TaskState::Open
}

/// Distinguish omitted vs JSON null for nullable patch fields.
fn deserialize_patch_null<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub state: Option<TaskState>,
    #[serde(default, deserialize_with = "deserialize_patch_null")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_patch_null")]
    pub priority: Option<Option<TaskPriority>>,
}

#[tauri::command]
pub fn create_task(state: State<'_, Db>, input: CreateTaskInput) -> Result<Task, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).create_task(
                &input.note_id,
                &input.title,
                input.state,
                input.due_date.as_deref(),
                input.priority,
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_task(state: State<'_, Db>, id: String) -> Result<Task, String> {
    state
        .with_conn(|conn| Repository::new(conn).get_task(&id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_tasks_for_note(state: State<'_, Db>, note_id: String) -> Result<Vec<Task>, String> {
    state
        .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&note_id))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn search_tasks(state: State<'_, Db>, query: String) -> Result<Vec<Task>, String> {
    state
        .with_conn(|conn| Repository::new(conn).search_tasks_by_title(&query))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_tasks(
    state: State<'_, Db>,
    filter: TaskListFilter,
    today: String,
) -> Result<Vec<Task>, String> {
    state
        .with_conn(|conn| Repository::new(conn).list_tasks(filter, &today))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_task(state: State<'_, Db>, input: UpdateTaskInput) -> Result<Task, String> {
    state
        .with_conn(|conn| {
            Repository::new(conn).update_task(
                &input.id,
                input.title.as_deref(),
                input.state,
                input.due_date.as_ref().map(|inner| inner.as_deref()),
                input.priority,
            )
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_task(state: State<'_, Db>, id: String) -> Result<(), String> {
    state
        .with_conn(|conn| Repository::new(conn).delete_task(&id))
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NoteType, Repository};

    #[test]
    fn task_commands_round_trip_via_db() {
        let db = Db::open_in_memory().unwrap();
        let note = db
            .with_conn(|conn| {
                Repository::new(conn).create_note("Tasks", "", NoteType::Regular, false)
            })
            .unwrap();

        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_task(&note.id, "Buy milk", TaskState::Open, None, None)
            })
            .unwrap();
        assert_eq!(created.title, "Buy milk");
        assert_eq!(created.state, TaskState::Open);

        let done = db
            .with_conn(|conn| {
                Repository::new(conn).update_task(
                    &created.id,
                    None,
                    Some(TaskState::Done),
                    None,
                    None,
                )
            })
            .unwrap();
        assert_eq!(done.state, TaskState::Done);
        assert!(done.completed_at.is_some());

        let listed = db
            .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&note.id))
            .unwrap();
        assert_eq!(listed.len(), 1);

        db.with_conn(|conn| Repository::new(conn).delete_task(&created.id))
            .unwrap();
        let empty = db
            .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&note.id))
            .unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn create_task_input_defaults_open() {
        let input: CreateTaskInput =
            serde_json::from_str(r#"{"note_id":"n1","title":"Ship it"}"#).unwrap();
        assert_eq!(input.state, TaskState::Open);
        assert_eq!(input.title, "Ship it");
        assert!(input.due_date.is_none());
        assert!(input.priority.is_none());
    }

    fn apply_update(db: &Db, json: &str) -> Task {
        let input: UpdateTaskInput = serde_json::from_str(json).unwrap();
        db.with_conn(|conn| {
            Repository::new(conn).update_task(
                &input.id,
                input.title.as_deref(),
                input.state,
                input.due_date.as_ref().map(|inner| inner.as_deref()),
                input.priority,
            )
        })
        .unwrap()
    }

    #[test]
    fn update_task_state_only_does_not_clear_due_date() {
        let db = Db::open_in_memory().unwrap();
        let note = db
            .with_conn(|conn| {
                Repository::new(conn).create_note("Tasks", "", NoteType::Regular, false)
            })
            .unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_task(
                    &note.id,
                    "Has due",
                    TaskState::Open,
                    Some("2026-08-20"),
                    Some(TaskPriority::High),
                )
            })
            .unwrap();

        let updated = apply_update(
            &db,
            &format!(r#"{{"id":"{}","state":"done"}}"#, created.id),
        );
        assert_eq!(updated.state, TaskState::Done);
        assert_eq!(updated.due_date.as_deref(), Some("2026-08-20"));
        assert_eq!(updated.priority, Some(TaskPriority::High));
        assert_eq!(updated.title, "Has due");
        assert!(updated.completed_at.is_some());
    }

    #[test]
    fn update_task_title_only_does_not_reopen_or_clear_completed_at() {
        let db = Db::open_in_memory().unwrap();
        let note = db
            .with_conn(|conn| {
                Repository::new(conn).create_note("Tasks", "", NoteType::Regular, false)
            })
            .unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_task(&note.id, "Old", TaskState::Open, None, None)
            })
            .unwrap();
        let done = apply_update(
            &db,
            &format!(r#"{{"id":"{}","state":"done"}}"#, created.id),
        );
        let completed_at = done.completed_at.clone();
        assert_eq!(done.state, TaskState::Done);
        assert!(completed_at.is_some());

        let renamed = apply_update(
            &db,
            &format!(r#"{{"id":"{}","title":"New title"}}"#, created.id),
        );
        assert_eq!(renamed.title, "New title");
        assert_eq!(renamed.state, TaskState::Done);
        assert_eq!(renamed.completed_at, completed_at);
    }

    #[test]
    fn update_task_json_null_due_date_clears() {
        let db = Db::open_in_memory().unwrap();
        let note = db
            .with_conn(|conn| {
                Repository::new(conn).create_note("Tasks", "", NoteType::Regular, false)
            })
            .unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_task(
                    &note.id,
                    "Dated",
                    TaskState::Open,
                    Some("2026-08-20"),
                    Some(TaskPriority::Low),
                )
            })
            .unwrap();

        let omitted = apply_update(&db, &format!(r#"{{"id":"{}"}}"#, created.id));
        assert_eq!(omitted.due_date.as_deref(), Some("2026-08-20"));
        assert_eq!(omitted.priority, Some(TaskPriority::Low));

        let cleared = apply_update(
            &db,
            &format!(r#"{{"id":"{}","due_date":null,"priority":null}}"#, created.id),
        );
        assert!(cleared.due_date.is_none());
        assert!(cleared.priority.is_none());
        assert_eq!(cleared.title, "Dated");
        assert_eq!(cleared.state, TaskState::Open);
    }

    #[test]
    fn update_task_input_omitted_vs_json_null() {
        let omitted: UpdateTaskInput = serde_json::from_str(r#"{"id":"t1","state":"done"}"#).unwrap();
        assert_eq!(omitted.id, "t1");
        assert!(omitted.title.is_none());
        assert_eq!(omitted.state, Some(TaskState::Done));
        assert!(omitted.due_date.is_none());
        assert!(omitted.priority.is_none());

        let clear: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t1","due_date":null,"priority":null}"#).unwrap();
        assert_eq!(clear.due_date, Some(None));
        assert_eq!(clear.priority, Some(None));
    }
}
