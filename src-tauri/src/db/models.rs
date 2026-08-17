use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteType {
    Regular,
    Daily,
    Meeting,
}

impl NoteType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Regular => "regular",
            Self::Daily => "daily",
            Self::Meeting => "meeting",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "regular" => Some(Self::Regular),
            "daily" => Some(Self::Daily),
            "meeting" => Some(Self::Meeting),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body_markdown: String,
    pub note_type: NoteType,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    pub source_note_id: String,
    pub target_note_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Open,
    Waiting,
    Done,
    Cancelled,
}

impl TaskState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Waiting => "waiting",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "waiting" => Some(Self::Waiting),
            "done" => Some(Self::Done),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    None,
    Low,
    Medium,
    High,
    Urgent,
}

impl TaskPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "none" => Some(Self::None),
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub note_id: String,
    pub title: String,
    pub state: TaskState,
    pub due_date: Option<String>,
    pub priority: Option<TaskPriority>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

/// Global Tasks view filters (ENG-63). `today` is the caller's local `YYYY-MM-DD`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskListFilter {
    Inbox,
    Upcoming,
    Complete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub task_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Meeting {
    pub note_id: String,
    pub meeting_date: String,
    pub start_time: String,
    pub end_time: String,
    pub transcript_note_id: Option<String>,
    pub calendar_event_id: Option<String>,
}

/// Note plus meeting metadata (create / create-from-event / lookup-by-event).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeetingNote {
    pub note: Note,
    pub meeting: Meeting,
}
