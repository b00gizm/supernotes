use serde::Deserialize;
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

#[derive(Debug, Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: String,
    pub state: TaskState,
    pub due_date: Option<String>,
    pub priority: Option<TaskPriority>,
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
                &input.title,
                input.state,
                input.due_date.as_deref(),
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
                    "Buy milk",
                    TaskState::Done,
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
}
