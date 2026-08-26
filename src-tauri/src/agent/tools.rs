//! Read-only agent tools over the existing SQLite repos (ENG-73).
//!
//! Failed calls return an error JSON object for the model. They do not become
//! IPC errors and they do not create rows (`get_daily_note` looks up only).

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::{utc_now, CalendarEvent, Db, DbError, Note, Repository, TaskListFilter, TaskState};
use crate::llm::ChatTool;

const SNIPPET_CHARS: usize = 200;

pub fn chat_tools() -> Vec<ChatTool> {
    vec![
        ChatTool::function(
            "search_notes",
            "Search notes by title (case-insensitive substring). Returns matching notes with body snippets. Empty query returns no matches.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Title substring to search for" }
                },
                "required": ["query"]
            }),
        ),
        ChatTool::function(
            "get_note",
            "Load one note by id or title. Unknown notes return null.",
            json!({
                "type": "object",
                "properties": {
                    "id_or_title": { "type": "string", "description": "Note id or exact title" }
                },
                "required": ["id_or_title"]
            }),
        ),
        ChatTool::function(
            "list_tasks",
            "List tasks. Reuses the Tasks sidebar filters (inbox/upcoming/complete) plus optional state, due range, and overdue.",
            json!({
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "enum": ["inbox", "upcoming", "complete"],
                        "description": "Existing list_tasks sidebar filter"
                    },
                    "state": {
                        "type": "string",
                        "enum": ["open", "waiting", "done", "cancelled"]
                    },
                    "due_from": { "type": "string", "description": "Inclusive YYYY-MM-DD" },
                    "due_to": { "type": "string", "description": "Inclusive YYYY-MM-DD" },
                    "overdue": { "type": "boolean" },
                    "today": { "type": "string", "description": "Local YYYY-MM-DD for overdue / complete window" }
                }
            }),
        ),
        ChatTool::function(
            "list_calendar_events",
            "List calendar events overlapping a range (same from/to as list_calendar_events IPC). Includes the linked task when task_id is set.",
            json!({
                "type": "object",
                "properties": {
                    "from": { "type": "string", "description": "Range start (ISO-8601). Events overlapping [from, to)." },
                    "to": { "type": "string", "description": "Range end (ISO-8601)" },
                    "date": { "type": "string", "description": "YYYY-MM-DD UTC day when from/to are omitted" }
                }
            }),
        ),
        ChatTool::function(
            "get_daily_note",
            "Load the daily note for a YYYY-MM-DD date. Missing days return null; does not create a note.",
            json!({
                "type": "object",
                "properties": {
                    "date": { "type": "string", "description": "YYYY-MM-DD" }
                },
                "required": ["date"]
            }),
        ),
    ]
}

pub fn execute_tool(db: &Db, name: &str, arguments: &str) -> Value {
    let args: Value = match serde_json::from_str(arguments) {
        Ok(value) => value,
        Err(err) => return json!({ "error": format!("invalid arguments: {err}") }),
    };
    match db.with_conn(|conn| {
        let repo = Repository::new(conn);
        match name {
            "search_notes" => search_notes(&repo, &args),
            "get_note" => get_note(&repo, &args),
            "list_tasks" => list_tasks(conn, &repo, &args),
            "list_calendar_events" => list_calendar_events(conn, &repo, &args),
            "get_daily_note" => get_daily_note(&repo, &args),
            other => Ok(json!({ "error": format!("unknown tool: {other}") })),
        }
    }) {
        Ok(value) => value,
        Err(err) => json!({ "error": err.to_string() }),
    }
}

fn arg_str<'a>(args: &'a Value, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_str))
        .unwrap_or("")
        .trim()
}

fn snippet(body: &str) -> String {
    let trimmed = body.trim();
    let mut chars = trimmed.chars();
    let taken: String = chars.by_ref().take(SNIPPET_CHARS).collect();
    if chars.next().is_some() {
        format!("{taken}…")
    } else {
        taken
    }
}

fn search_notes(repo: &Repository<'_>, args: &Value) -> Result<Value, DbError> {
    let query = arg_str(args, &["query"]);
    if query.is_empty() {
        return Ok(json!([]));
    }
    let notes = repo.search_notes_by_title(query)?;
    Ok(Value::Array(
        notes
            .into_iter()
            .map(|note| {
                json!({
                    "id": note.id,
                    "title": note.title,
                    "note_type": note.note_type,
                    "snippet": snippet(&note.body_markdown),
                    "updated_at": note.updated_at,
                })
            })
            .collect(),
    ))
}

fn get_note(repo: &Repository<'_>, args: &Value) -> Result<Value, DbError> {
    let id_or_title = arg_str(args, &["id_or_title", "id", "title"]);
    if id_or_title.is_empty() {
        return Ok(Value::Null);
    }
    match repo.get_note(id_or_title) {
        Ok(note) => return Ok(serde_json::to_value(note).unwrap_or(Value::Null)),
        Err(DbError::NotFound) => {}
        Err(err) => return Err(err),
    }
    Ok(repo
        .find_note_by_title(id_or_title)?
        .map(|note| serde_json::to_value(note).unwrap_or(Value::Null))
        .unwrap_or(Value::Null))
}

#[derive(Debug, Default, Deserialize)]
struct ListTasksArgs {
    #[serde(default)]
    filter: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    due_from: Option<String>,
    #[serde(default)]
    due_to: Option<String>,
    #[serde(default)]
    overdue: Option<bool>,
    #[serde(default)]
    today: Option<String>,
}

fn list_tasks(conn: &Connection, repo: &Repository<'_>, args: &Value) -> Result<Value, DbError> {
    let parsed: ListTasksArgs = serde_json::from_value(args.clone()).unwrap_or_default();
    let today = parsed
        .today
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| utc_today(conn));
    let mut tasks = match parsed.filter.as_deref() {
        Some("inbox") => repo.list_tasks(TaskListFilter::Inbox, &today)?,
        Some("upcoming") => repo.list_tasks(TaskListFilter::Upcoming, &today)?,
        Some("complete") => repo.list_tasks(TaskListFilter::Complete, &today)?,
        Some(other) => {
            return Ok(json!({ "error": format!("unknown filter: {other}") }));
        }
        // Empty title search is the existing "all tasks" path (⌘K).
        None => repo.search_tasks_by_title("")?,
    };
    if let Some(state) = parsed
        .state
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let Some(want) = TaskState::parse(state) else {
            return Ok(json!({ "error": format!("unknown state: {state}") }));
        };
        tasks.retain(|task| task.state == want);
    }
    if let Some(from) = parsed
        .due_from
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tasks.retain(|task| task.due_date.as_deref().is_some_and(|due| due >= from));
    }
    if let Some(to) = parsed
        .due_to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tasks.retain(|task| task.due_date.as_deref().is_some_and(|due| due <= to));
    }
    if parsed.overdue == Some(true) {
        tasks.retain(|task| {
            matches!(task.state, TaskState::Open | TaskState::Waiting)
                && task
                    .due_date
                    .as_deref()
                    .is_some_and(|due| due < today.as_str())
        });
    }
    Ok(serde_json::to_value(tasks).unwrap_or(json!([])))
}

fn utc_today(conn: &Connection) -> String {
    utc_now(conn)
        .ok()
        .and_then(|stamp| stamp.get(..10).map(str::to_string))
        .unwrap_or_else(|| "1970-01-01".into())
}

#[derive(Debug, Default, Deserialize)]
struct DateRangeArgs {
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

fn list_calendar_events(
    conn: &Connection,
    repo: &Repository<'_>,
    args: &Value,
) -> Result<Value, DbError> {
    let parsed: DateRangeArgs = serde_json::from_value(args.clone()).unwrap_or_default();
    let (from, to) = resolve_date_range(conn, &parsed)?;
    let events = repo.list_calendar_events(from.as_deref(), to.as_deref())?;
    let mut out = Vec::with_capacity(events.len());
    for event in events {
        out.push(event_with_task(repo, event)?);
    }
    Ok(Value::Array(out))
}

fn resolve_date_range(
    conn: &Connection,
    parsed: &DateRangeArgs,
) -> Result<(Option<String>, Option<String>), DbError> {
    let from = parsed
        .from
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let to = parsed
        .to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if from.is_some() || to.is_some() {
        return Ok((from.map(str::to_string), to.map(str::to_string)));
    }
    let Some(date) = parsed
        .date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return Ok((None, None));
    };
    let next = conn.query_row("SELECT date(?1, '+1 day')", [date], |row| {
        row.get::<_, String>(0)
    })?;
    Ok((
        Some(format!("{date}T00:00:00.000Z")),
        Some(format!("{next}T00:00:00.000Z")),
    ))
}

fn event_with_task(repo: &Repository<'_>, event: CalendarEvent) -> Result<Value, DbError> {
    let task = match event.task_id.as_deref() {
        Some(id) => match repo.get_task(id) {
            Ok(task) => Some(task),
            Err(DbError::NotFound) => None,
            Err(err) => return Err(err),
        },
        None => None,
    };
    Ok(json!({
        "id": event.id,
        "title": event.title,
        "start": event.start,
        "end": event.end,
        "task_id": event.task_id,
        "created_at": event.created_at,
        "task": task,
    }))
}

fn get_daily_note(repo: &Repository<'_>, args: &Value) -> Result<Value, DbError> {
    let date = arg_str(args, &["date"]);
    if date.is_empty() {
        return Ok(Value::Null);
    }
    match repo.find_daily(date) {
        Ok(Some(note)) => Ok(note_json(note)),
        Ok(None) => Ok(Value::Null),
        Err(DbError::Invalid(_)) => Ok(Value::Null),
        Err(err) => Err(err),
    }
}

fn note_json(note: Note) -> Value {
    serde_json::to_value(note).unwrap_or(Value::Null)
}
