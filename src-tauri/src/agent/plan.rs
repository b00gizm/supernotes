//! Staged write-tool plans. Tool calls never mutate SQLite; approve applies
//! through the existing `Repository` writers.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{
    local_date_and_hm, local_today, CalendarEvent, Db, DbError, DbResult, Repository, Task,
    TaskPriority, TaskState,
};

pub const PLAN_REASSURANCE: &str = "Nothing is written until you approve.";
pub const PLAN_DECLINE_LABEL: &str = "Decline";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StagedAction {
    CreateTask {
        title: String,
        due_date: Option<String>,
        priority: Option<TaskPriority>,
        today: String,
    },
    UpdateTask {
        id: String,
        state: Option<TaskState>,
        due_date: Option<Option<String>>,
        priority: Option<Option<TaskPriority>>,
    },
    CreateCalendarEvent {
        title: String,
        start: String,
        end: String,
        task_id: Option<String>,
    },
}

impl StagedAction {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::CreateTask { .. } => "create_task",
            Self::UpdateTask { .. } => "update_task",
            Self::CreateCalendarEvent { .. } => "create_calendar_event",
        }
    }

    pub fn model_payload(&self) -> Value {
        match self {
            Self::CreateTask {
                title,
                due_date,
                priority,
                today,
            } => json!({
                "staged": true,
                "kind": "create_task",
                "title": title,
                "due_date": due_date,
                "priority": priority,
                "today": today,
            }),
            Self::UpdateTask {
                id,
                state,
                due_date,
                priority,
            } => json!({
                "staged": true,
                "kind": "update_task",
                "id": id,
                "state": state,
                "due_date": due_date.clone().flatten(),
                "priority": priority.clone().flatten(),
            }),
            Self::CreateCalendarEvent {
                title,
                start,
                end,
                task_id,
            } => json!({
                "staged": true,
                "kind": "create_calendar_event",
                "title": title,
                "start": start,
                "end": end,
                "task_id": task_id,
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPlan {
    pub id: String,
    pub items: Vec<StagedAction>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanSlot {
    Empty,
    Pending(PendingPlan),
    Applied {
        plan: PendingPlan,
        results: Vec<AppliedPlanItem>,
    },
    Declined {
        id: String,
    },
}

impl Default for PlanSlot {
    fn default() -> Self {
        Self::Empty
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentPlanEvent {
    pub stream_id: String,
    pub plan_id: String,
    pub title: String,
    pub date_label: Option<String>,
    pub items: Vec<AgentPlanItemView>,
    pub approve_label: String,
    pub decline_label: String,
    pub reassurance: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentPlanItemView {
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppliedPlanItem {
    CreateTask { task: Task },
    UpdateTask { task: Task },
    CreateCalendarEvent { event: CalendarEvent },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ApprovePlanResult {
    pub plan_id: String,
    pub items: Vec<AppliedPlanItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlanIdInput {
    pub plan_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeclinePlanResult {
    pub plan_id: String,
    pub declined: bool,
}

#[derive(Debug, Default, Deserialize)]
struct CreateTaskArgs {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    today: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct UpdateTaskArgs {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    due_date: Option<Value>,
    #[serde(default)]
    priority: Option<Value>,
}

#[derive(Debug, Default, Deserialize)]
struct CreateEventArgs {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    start: Option<String>,
    #[serde(default)]
    end: Option<String>,
    #[serde(default)]
    task_id: Option<String>,
}

pub fn stage_write(conn: &Connection, name: &str, args: &Value) -> DbResult<Option<StagedAction>> {
    match name {
        "create_task" => Ok(Some(stage_create_task(conn, args)?)),
        "update_task" => Ok(Some(stage_update_task(args)?)),
        "create_calendar_event" => Ok(Some(stage_create_event(args)?)),
        _ => Ok(None),
    }
}

fn stage_create_task(conn: &Connection, args: &Value) -> DbResult<StagedAction> {
    let parsed: CreateTaskArgs = serde_json::from_value(args.clone()).unwrap_or_default();
    let title = parsed
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DbError::Invalid("title is required".into()))?
        .to_string();
    let due_date = parsed
        .due_date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let priority = parse_priority_opt(parsed.priority.as_deref())?;
    let today = parsed
        .today
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .map_or_else(|| local_today(conn), Ok)?;
    Ok(StagedAction::CreateTask {
        title,
        due_date,
        priority,
        today,
    })
}

fn stage_update_task(args: &Value) -> DbResult<StagedAction> {
    let parsed: UpdateTaskArgs = serde_json::from_value(args.clone()).unwrap_or_default();
    let id = parsed
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DbError::Invalid("id is required".into()))?
        .to_string();
    let state = match parsed
        .state
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(
            TaskState::parse(value)
                .ok_or_else(|| DbError::Invalid(format!("unknown state: {value}")))?,
        ),
        None => None,
    };
    let due_date = match parsed.due_date {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Some(None)
            } else {
                Some(Some(trimmed.to_string()))
            }
        }
        Some(_) => return Err(DbError::Invalid("due_date must be a string or null".into())),
    };
    let priority = match parsed.priority {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(value)) => Some(parse_priority_opt(Some(&value))?),
        Some(_) => return Err(DbError::Invalid("priority must be a string or null".into())),
    };
    if state.is_none() && due_date.is_none() && priority.is_none() {
        return Err(DbError::Invalid(
            "update_task needs state, due_date, or priority".into(),
        ));
    }
    Ok(StagedAction::UpdateTask {
        id,
        state,
        due_date,
        priority,
    })
}

fn stage_create_event(args: &Value) -> DbResult<StagedAction> {
    let parsed: CreateEventArgs = serde_json::from_value(args.clone()).unwrap_or_default();
    let title = parsed
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DbError::Invalid("title is required".into()))?
        .to_string();
    let start = parsed
        .start
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DbError::Invalid("start is required".into()))?
        .to_string();
    let end = parsed
        .end
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DbError::Invalid("end is required".into()))?
        .to_string();
    if end <= start {
        return Err(DbError::Invalid("event end must be after start".into()));
    }
    let task_id = parsed
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Ok(StagedAction::CreateCalendarEvent {
        title,
        start,
        end,
        task_id,
    })
}

fn parse_priority_opt(value: Option<&str>) -> DbResult<Option<TaskPriority>> {
    let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    TaskPriority::parse(raw)
        .map(Some)
        .ok_or_else(|| DbError::Invalid(format!("unknown priority: {raw}")))
}

pub fn build_plan_event(db: &Db, stream_id: &str, plan: &PendingPlan) -> AgentPlanEvent {
    db.with_conn(|conn| Ok(build_plan_event_on(conn, stream_id, plan)))
        .unwrap_or_else(|_| build_plan_event_on_fallback(stream_id, plan))
}

fn build_plan_event_on(conn: &Connection, stream_id: &str, plan: &PendingPlan) -> AgentPlanEvent {
    let (title, approve_label, date_ymd) = summarize_plan(&plan.items);
    let date_label = date_ymd.as_deref().and_then(format_short_day);
    let items = plan
        .items
        .iter()
        .map(|action| item_view(conn, action))
        .collect();
    AgentPlanEvent {
        stream_id: stream_id.to_string(),
        plan_id: plan.id.clone(),
        title,
        date_label,
        items,
        approve_label,
        decline_label: PLAN_DECLINE_LABEL.to_string(),
        reassurance: PLAN_REASSURANCE.to_string(),
    }
}

fn build_plan_event_on_fallback(stream_id: &str, plan: &PendingPlan) -> AgentPlanEvent {
    let (title, approve_label, date_ymd) = summarize_plan(&plan.items);
    AgentPlanEvent {
        stream_id: stream_id.to_string(),
        plan_id: plan.id.clone(),
        title,
        date_label: date_ymd.as_deref().and_then(format_short_day),
        items: plan
            .items
            .iter()
            .map(|action| item_view_fallback(action))
            .collect(),
        approve_label,
        decline_label: PLAN_DECLINE_LABEL.to_string(),
        reassurance: PLAN_REASSURANCE.to_string(),
    }
}

fn item_view(conn: &Connection, action: &StagedAction) -> AgentPlanItemView {
    let mut view = item_view_fallback(action);
    if let StagedAction::CreateCalendarEvent { start, end, .. } = action {
        view.time_range = Some(format_time_range(conn, start, end));
    }
    view
}

fn item_view_fallback(action: &StagedAction) -> AgentPlanItemView {
    match action {
        StagedAction::CreateTask {
            title,
            due_date,
            priority,
            ..
        } => AgentPlanItemView {
            kind: action.kind().into(),
            title: title.clone(),
            time_range: None,
            start: None,
            end: None,
            task_id: None,
            id: None,
            due_date: due_date.clone(),
            state: None,
            priority: priority.map(|value| value.as_str().to_string()),
        },
        StagedAction::UpdateTask {
            id,
            state,
            due_date,
            priority,
        } => AgentPlanItemView {
            kind: action.kind().into(),
            title: String::new(),
            time_range: None,
            start: None,
            end: None,
            task_id: None,
            id: Some(id.clone()),
            due_date: due_date.clone().flatten(),
            state: state.map(|value| value.as_str().to_string()),
            priority: priority
                .and_then(|inner| inner)
                .map(|value| value.as_str().to_string()),
        },
        StagedAction::CreateCalendarEvent {
            title,
            start,
            end,
            task_id,
        } => AgentPlanItemView {
            kind: action.kind().into(),
            title: title.clone(),
            time_range: Some(format!("{start} – {end}")),
            start: Some(start.clone()),
            end: Some(end.clone()),
            task_id: task_id.clone(),
            id: None,
            due_date: None,
            state: None,
            priority: None,
        },
    }
}

fn format_time_range(conn: &Connection, start: &str, end: &str) -> String {
    let start_hm = local_date_and_hm(conn, start)
        .map(|(_, hm)| strip_leading_hour_zero(&hm))
        .unwrap_or_else(|_| start.to_string());
    let end_hm = local_date_and_hm(conn, end)
        .map(|(_, hm)| strip_leading_hour_zero(&hm))
        .unwrap_or_else(|_| end.to_string());
    format!("{start_hm} – {end_hm}")
}

fn strip_leading_hour_zero(hm: &str) -> String {
    if hm.len() == 5 && hm.as_bytes()[0] == b'0' {
        hm[1..].to_string()
    } else {
        hm.to_string()
    }
}

pub fn summarize_plan(items: &[StagedAction]) -> (String, String, Option<String>) {
    let mut tasks = 0usize;
    let mut updates = 0usize;
    let mut blocks = 0usize;
    let mut date_ymd = None;
    for item in items {
        match item {
            StagedAction::CreateTask { today, .. } => {
                tasks += 1;
                if date_ymd.is_none() {
                    date_ymd = Some(today.clone());
                }
            }
            StagedAction::UpdateTask { .. } => updates += 1,
            StagedAction::CreateCalendarEvent { start, .. } => {
                blocks += 1;
                if date_ymd.is_none() {
                    date_ymd = start.get(..10).map(str::to_string);
                }
            }
        }
    }
    let n = items.len();
    if blocks > 0 && tasks == 0 && updates == 0 {
        let title = if blocks == 1 {
            "1 time block".into()
        } else {
            format!("{blocks} time blocks")
        };
        let approve = if blocks == 1 {
            "Add 1 block".into()
        } else {
            format!("Add {blocks} blocks")
        };
        return (title, approve, date_ymd);
    }
    if tasks > 0 && blocks == 0 && updates == 0 {
        let title = if tasks == 1 {
            "1 task".into()
        } else {
            format!("{tasks} tasks")
        };
        let approve = if tasks == 1 {
            "Add 1 task".into()
        } else {
            format!("Add {tasks} tasks")
        };
        return (title, approve, date_ymd);
    }
    if updates > 0 && blocks == 0 && tasks == 0 {
        let title = if updates == 1 {
            "1 task update".into()
        } else {
            format!("{updates} task updates")
        };
        let approve = if updates == 1 {
            "Update 1 task".into()
        } else {
            format!("Update {updates} tasks")
        };
        return (title, approve, None);
    }
    (
        format!("{n} changes"),
        format!("Apply {n} changes"),
        date_ymd,
    )
}

/// `Thu, Aug 13` from a `YYYY-MM-DD` civil date (local calendar, not UTC instant).
pub fn format_short_day(ymd: &str) -> Option<String> {
    let (year, month, day) = parse_ymd(ymd)?;
    let weekday =
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday_sun0(year, month, day) as usize];
    let month_name = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ][(month - 1) as usize];
    Some(format!("{weekday}, {month_name} {day}"))
}

fn parse_ymd(ymd: &str) -> Option<(i32, u32, u32)> {
    let bytes = ymd.as_bytes();
    if bytes.len() < 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i32 = ymd.get(..4)?.parse().ok()?;
    let month: u32 = ymd.get(5..7)?.parse().ok()?;
    let day: u32 = ymd.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

fn weekday_sun0(year: i32, month: u32, day: u32) -> u32 {
    const T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let year = if month < 3 { year - 1 } else { year };
    (year + year / 4 - year / 100 + year / 400 + T[month as usize - 1] + day as i32).rem_euclid(7)
        as u32
}

pub fn apply_plan(db: &Db, plan: &PendingPlan) -> Result<Vec<AppliedPlanItem>, String> {
    db.with_conn(|conn| apply_plan_on(conn, plan))
        .map_err(|err| err.to_string())
}

fn apply_plan_on(conn: &Connection, plan: &PendingPlan) -> DbResult<Vec<AppliedPlanItem>> {
    let mut daily_ids = Vec::new();
    for item in &plan.items {
        if let StagedAction::CreateTask { today, .. } = item {
            if daily_ids.iter().all(|(date, _)| date != today) {
                let note = Repository::new(conn).get_or_create_daily(today)?;
                daily_ids.push((today.clone(), note.id));
            }
        }
    }
    let tx = conn.unchecked_transaction()?;
    let repo = Repository::new(&*tx);
    let mut results = Vec::with_capacity(plan.items.len());
    for item in &plan.items {
        results.push(apply_item(&repo, item, &daily_ids)?);
    }
    tx.commit()?;
    Ok(results)
}

fn apply_item(
    repo: &Repository<'_>,
    item: &StagedAction,
    daily_ids: &[(String, String)],
) -> DbResult<AppliedPlanItem> {
    match item {
        StagedAction::CreateTask {
            title,
            due_date,
            priority,
            today,
        } => {
            let note_id = daily_ids
                .iter()
                .find(|(date, _)| date == today)
                .map(|(_, id)| id.as_str())
                .ok_or_else(|| DbError::Invalid("daily note was not resolved".into()))?;
            let task = repo.create_task(
                note_id,
                title,
                TaskState::Open,
                due_date.as_deref(),
                *priority,
            )?;
            Ok(AppliedPlanItem::CreateTask { task })
        }
        StagedAction::UpdateTask {
            id,
            state,
            due_date,
            priority,
        } => {
            let task = repo.update_task(
                id,
                None,
                *state,
                due_date.as_ref().map(|inner| inner.as_deref()),
                *priority,
            )?;
            Ok(AppliedPlanItem::UpdateTask { task })
        }
        StagedAction::CreateCalendarEvent {
            title,
            start,
            end,
            task_id,
        } => {
            let event = repo.create_calendar_event(title, start, end, task_id.as_deref())?;
            Ok(AppliedPlanItem::CreateCalendarEvent { event })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_short_day_matches_mockup_1i() {
        assert_eq!(
            format_short_day("2026-08-13").as_deref(),
            Some("Thu, Aug 13")
        );
    }

    #[test]
    fn summarize_calendar_batch_matches_mockup_1i() {
        let items = vec![
            StagedAction::CreateCalendarEvent {
                title: "Finalize tier table".into(),
                start: "2026-08-13T09:00:00.000Z".into(),
                end: "2026-08-13T10:30:00.000Z".into(),
                task_id: None,
            },
            StagedAction::CreateCalendarEvent {
                title: "Pricing survey email".into(),
                start: "2026-08-13T13:00:00.000Z".into(),
                end: "2026-08-13T13:45:00.000Z".into(),
                task_id: None,
            },
            StagedAction::CreateCalendarEvent {
                title: "Update roadmap note".into(),
                start: "2026-08-13T15:00:00.000Z".into(),
                end: "2026-08-13T16:00:00.000Z".into(),
                task_id: None,
            },
        ];
        let (title, approve, date) = summarize_plan(&items);
        assert_eq!(title, "3 time blocks");
        assert_eq!(approve, "Add 3 blocks");
        assert_eq!(date.as_deref(), Some("2026-08-13"));
    }
}
