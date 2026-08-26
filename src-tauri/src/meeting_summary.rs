//! Structured meeting summary from the existing LLM client (ENG-71).
//!
//! Persists JSON on `meetings.summary_json`. Never writes the transcript note
//! or LLM markdown into the meeting note body.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::db::{Db, Meeting, Note, NoteType, Repository, TaskPriority, TaskState};
use crate::llm::{
    ChatMessage, EventSink, Llm, LlmDoneEvent, LlmIpcError, LlmStreamError, LlmTokenEvent,
};

pub const PROGRESS_EVENT: &str = "summary://progress";
pub const DONE_EVENT: &str = "summary://done";
pub const ERROR_EVENT: &str = "summary://error";

const SYSTEM_PROMPT: &str = r#"You summarize a meeting transcript into JSON only.
No markdown, no prose outside the JSON object.

Use names from the transcript and the meeting title only. Be conservative.
No speaker diarization: do not invent speakers. Prefer maybe/unknown over guessing.

Schema:
{
  "purpose": "1-2 sentences",
  "participants": [{"name": "Sara Kim", "certainty": "certain"|"maybe"|"unknown"}],
  "key_points": [{"text": "...", "timestamp": "HH:MM"|null, "children": [...]}],
  "outcome": "what was decided / next steps",
  "action_items": [{"title": "...", "due_date": "YYYY-MM-DD"|null, "priority": "none"|"low"|"medium"|"high"|"urgent"|null}]
}

Timestamps must match transcript clocks (HH:MM). due_date must be YYYY-MM-DD or null.
certain = named in title or clearly addressed. maybe = mentioned weakly. unknown = unnamed speaker.
"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantCertainty {
    Certain,
    Maybe,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryParticipant {
    pub name: String,
    pub certainty: ParticipantCertainty,
    pub note_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryKeyPoint {
    pub text: String,
    pub timestamp: Option<String>,
    #[serde(default)]
    pub children: Vec<SummaryKeyPoint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryActionItem {
    pub title: String,
    pub due_date: Option<String>,
    pub priority: Option<TaskPriority>,
    pub task_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryTranscriptMeta {
    pub note_id: String,
    pub duration_seconds: u32,
    pub word_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeetingSummary {
    pub meeting_note_id: String,
    pub purpose: String,
    pub participants: Vec<SummaryParticipant>,
    pub key_points: Vec<SummaryKeyPoint>,
    pub outcome: String,
    pub action_items: Vec<SummaryActionItem>,
    pub transcript: SummaryTranscriptMeta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerateSummaryJob {
    pub stream_id: String,
    pub meeting_note_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryProgressEvent {
    pub stream_id: String,
    pub meeting_note_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryDoneEvent {
    pub stream_id: String,
    pub meeting_note_id: String,
    pub summary: MeetingSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryErrorEvent {
    pub stream_id: String,
    pub meeting_note_id: String,
    pub code: String,
    pub message: String,
}

pub trait SummarySink: Send + Sync {
    fn emit_progress(&self, event: &SummaryProgressEvent);
    fn emit_done(&self, event: &SummaryDoneEvent);
    fn emit_error(&self, event: &SummaryErrorEvent);
}

impl SummarySink for AppHandle {
    fn emit_progress(&self, event: &SummaryProgressEvent) {
        let _ = self.emit(PROGRESS_EVENT, event);
    }
    fn emit_done(&self, event: &SummaryDoneEvent) {
        let _ = self.emit(DONE_EVENT, event);
    }
    fn emit_error(&self, event: &SummaryErrorEvent) {
        let _ = self.emit(ERROR_EVENT, event);
    }
}

fn inflight() -> &'static Mutex<HashSet<String>> {
    // ponytail: one in-flight generate per meeting; a queue if we need cancel.
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn reserve_inflight(meeting_note_id: &str) -> Result<(), LlmIpcError> {
    let mut set = inflight().lock().expect("summary inflight poisoned");
    if !set.insert(meeting_note_id.to_string()) {
        return Err(LlmIpcError::invalid(
            "A summary is already generating for this meeting.",
        ));
    }
    Ok(())
}

fn release_inflight(meeting_note_id: &str) {
    inflight()
        .lock()
        .expect("summary inflight poisoned")
        .remove(meeting_note_id);
}

#[derive(Debug, Deserialize)]
struct LlmParticipant {
    name: String,
    certainty: ParticipantCertainty,
}

#[derive(Debug, Deserialize)]
struct LlmKeyPoint {
    text: String,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    children: Vec<LlmKeyPoint>,
}

#[derive(Debug, Deserialize)]
struct LlmActionItem {
    title: String,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    priority: Option<TaskPriority>,
}

#[derive(Debug, Deserialize)]
struct LlmSummaryDraft {
    purpose: String,
    #[serde(default)]
    participants: Vec<LlmParticipant>,
    #[serde(default)]
    key_points: Vec<LlmKeyPoint>,
    #[serde(default)]
    outcome: String,
    #[serde(default)]
    action_items: Vec<LlmActionItem>,
}

struct NullSink;

impl EventSink for NullSink {
    fn emit_token(&self, _event: &LlmTokenEvent) {}
    fn emit_done(&self, _event: &LlmDoneEvent) {}
    fn emit_error(&self, _event: &LlmStreamError) {}
}

fn extract_json_object(raw: &str) -> Result<&str, LlmIpcError> {
    let trimmed = raw.trim();
    let start = trimmed
        .find('{')
        .ok_or_else(|| LlmIpcError::invalid("The model did not return a JSON summary."))?;
    let end = trimmed
        .rfind('}')
        .ok_or_else(|| LlmIpcError::invalid("The model did not return a JSON summary."))?;
    if end < start {
        return Err(LlmIpcError::invalid(
            "The model did not return a JSON summary.",
        ));
    }
    Ok(&trimmed[start..=end])
}

fn parse_summary_draft(raw: &str) -> Result<LlmSummaryDraft, LlmIpcError> {
    let json = extract_json_object(raw)?;
    serde_json::from_str::<LlmSummaryDraft>(json).map_err(|_| {
        LlmIpcError::invalid("The model returned JSON that does not match the summary schema.")
    })
}

pub fn transcript_word_count(body: &str) -> u32 {
    body.lines()
        .flat_map(|line| strip_clock(line).split_whitespace())
        .filter(|word| !word.is_empty())
        .count() as u32
}

fn strip_clock(line: &str) -> &str {
    let line = line.trim();
    if let Some((clock, rest)) = line.split_once("  ") {
        if parse_hm(clock).is_some() {
            return rest.trim();
        }
    }
    line
}

pub fn duration_seconds(start_hm: &str, end_hm: &str) -> u32 {
    match (parse_hm(start_hm), parse_hm(end_hm)) {
        (Some(start), Some(end)) => {
            let mut mins = end - start;
            if mins <= 0 {
                mins += 24 * 60;
            }
            (mins * 60) as u32
        }
        _ => 0,
    }
}

fn parse_hm(value: &str) -> Option<i32> {
    let (h, m) = value.split_once(':')?;
    let hours: i32 = h.parse().ok()?;
    let mins: i32 = m.parse().ok()?;
    if (0..=23).contains(&hours) && (0..=59).contains(&mins) {
        Some(hours * 60 + mins)
    } else {
        None
    }
}

fn valid_clock(value: &str) -> Option<String> {
    parse_hm(value).map(|_| value.to_string())
}

fn valid_due_date(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() != 10 {
        return None;
    }
    let bytes = value.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if value.chars().enumerate().all(|(i, c)| match i {
        4 | 7 => true,
        _ => c.is_ascii_digit(),
    }) {
        Some(value.to_string())
    } else {
        None
    }
}

fn normalize_name(name: &str) -> Option<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.len() > 80 {
        return None;
    }
    if name.to_ascii_lowercase().starts_with("unknown") {
        return None;
    }
    Some(name)
}

fn sanitize_key_points(points: Vec<LlmKeyPoint>, depth: u8) -> Vec<SummaryKeyPoint> {
    if depth > 4 {
        return Vec::new();
    }
    points
        .into_iter()
        .filter_map(|point| {
            let text = point.text.trim();
            if text.is_empty() {
                return None;
            }
            Some(SummaryKeyPoint {
                text: text.to_string(),
                timestamp: point.timestamp.as_deref().and_then(valid_clock),
                children: sanitize_key_points(point.children, depth + 1),
            })
        })
        .collect()
}

fn build_user_prompt(meeting: &Meeting, title: &str, transcript: &str) -> String {
    format!(
        "Meeting title: {title}\nDate: {} {}–{}\n\nTranscript:\n{transcript}",
        meeting.meeting_date, meeting.start_time, meeting.end_time
    )
}

pub fn get_summary(db: &Db, meeting_note_id: &str) -> Result<Option<MeetingSummary>, LlmIpcError> {
    db.with_conn(|conn| {
        let raw = Repository::new(conn).load_meeting_summary_json(meeting_note_id)?;
        match raw {
            None => Ok(None),
            Some(json) => serde_json::from_str(&json).map(Some).map_err(|err| {
                crate::db::DbError::Invalid(format!("stored summary is invalid: {err}"))
            }),
        }
    })
    .map_err(map_db_err)
}

pub fn generate_summary(
    db: &Db,
    llm: &Llm,
    meeting_note_id: &str,
) -> Result<MeetingSummary, LlmIpcError> {
    let (meeting, meeting_note, transcript) = load_transcript_context(db, meeting_note_id)?;
    let previous = get_summary(db, meeting_note_id)?;

    let messages = [
        ChatMessage::new("system", SYSTEM_PROMPT),
        ChatMessage::new(
            "user",
            build_user_prompt(&meeting, &meeting_note.title, &transcript.body_markdown),
        ),
    ];
    let assembled = llm.stream_chat(db, &messages, &NullSink)?.text;
    let draft = parse_summary_draft(&assembled)?;
    persist_summary(db, &meeting, &meeting_note, &transcript, draft, previous)
}

fn load_transcript_context(
    db: &Db,
    meeting_note_id: &str,
) -> Result<(Meeting, Note, Note), LlmIpcError> {
    db.with_conn(|conn| {
        let repo = Repository::new(conn);
        let meeting = repo.get_meeting(meeting_note_id)?;
        let meeting_note = repo.get_note(meeting_note_id)?;
        let Some(transcript_id) = &meeting.transcript_note_id else {
            return Err(crate::db::DbError::Invalid(
                "This meeting has no transcript yet. Record and stop first.".into(),
            ));
        };
        let transcript = repo.get_note(transcript_id)?;
        if transcript.body_markdown.trim().is_empty() {
            return Err(crate::db::DbError::Invalid(
                "The transcript is empty, so a summary cannot be generated.".into(),
            ));
        }
        Ok((meeting, meeting_note, transcript))
    })
    .map_err(map_db_err)
}

fn persist_summary(
    db: &Db,
    meeting: &Meeting,
    meeting_note: &Note,
    transcript: &Note,
    draft: LlmSummaryDraft,
    previous: Option<MeetingSummary>,
) -> Result<MeetingSummary, LlmIpcError> {
    let purpose = draft.purpose.trim().to_string();
    if purpose.is_empty() {
        return Err(LlmIpcError::invalid("The model returned an empty purpose."));
    }
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let repo = Repository::new(&tx);
        if let Some(prev) = &previous {
            for item in &prev.action_items {
                match repo.delete_task(&item.task_id) {
                    Ok(()) | Err(crate::db::DbError::NotFound) => {}
                    Err(err) => return Err(err),
                }
            }
        }

        let participants = resolve_participants(
            &repo,
            draft
                .participants
                .into_iter()
                .map(|raw| (raw.name, raw.certainty)),
        )?;

        let mut action_items = Vec::new();
        for raw in draft.action_items {
            let title = raw.title.trim();
            if title.is_empty() {
                continue;
            }
            let due_date = raw.due_date.as_deref().and_then(valid_due_date);
            let task = repo.create_task(
                &meeting.note_id,
                title,
                TaskState::Open,
                due_date.as_deref(),
                raw.priority,
            )?;
            action_items.push(SummaryActionItem {
                title: title.to_string(),
                due_date,
                priority: raw.priority,
                task_id: task.id,
            });
        }

        let summary = MeetingSummary {
            meeting_note_id: meeting.note_id.clone(),
            purpose: purpose.clone(),
            participants,
            key_points: sanitize_key_points(draft.key_points, 0),
            outcome: draft.outcome.trim().to_string(),
            action_items,
            transcript: SummaryTranscriptMeta {
                note_id: transcript.id.clone(),
                duration_seconds: duration_seconds(&meeting.start_time, &meeting.end_time),
                word_count: transcript_word_count(&transcript.body_markdown),
            },
        };
        let json = serde_json::to_string(&summary)
            .map_err(|err| crate::db::DbError::Invalid(err.to_string()))?;
        repo.save_meeting_summary_json(&meeting.note_id, &json)?;
        let meeting_body = repo.get_note(&meeting_note.id)?.body_markdown;
        let transcript_body = repo.get_note(&transcript.id)?.body_markdown;
        if meeting_body != meeting_note.body_markdown {
            return Err(crate::db::DbError::Invalid(
                "summary persist must not rewrite the meeting note body".into(),
            ));
        }
        if transcript_body != transcript.body_markdown {
            return Err(crate::db::DbError::Invalid(
                "summary persist must not rewrite the transcript".into(),
            ));
        }
        tx.commit()?;
        Ok(summary)
    })
    .map_err(map_db_err)
}

fn resolve_participants(
    repo: &Repository<'_>,
    items: impl IntoIterator<Item = (String, ParticipantCertainty)>,
) -> crate::db::DbResult<Vec<SummaryParticipant>> {
    let mut participants = Vec::new();
    for (raw_name, raw_certainty) in items {
        let Some(name) = normalize_name(&raw_name) else {
            if matches!(raw_certainty, ParticipantCertainty::Unknown) {
                participants.push(SummaryParticipant {
                    name: "Unknown speaker".into(),
                    certainty: ParticipantCertainty::Unknown,
                    note_id: None,
                });
            }
            continue;
        };
        let mut certainty = raw_certainty;
        if matches!(certainty, ParticipantCertainty::Certain)
            && name.to_ascii_lowercase().starts_with("unknown")
        {
            certainty = ParticipantCertainty::Unknown;
        }
        let note_id = if matches!(certainty, ParticipantCertainty::Certain) {
            Some(resolve_or_create_person(repo, &name)?.id)
        } else {
            None
        };
        participants.push(SummaryParticipant {
            name,
            certainty,
            note_id,
        });
    }
    Ok(participants)
}

fn resolve_or_create_person(repo: &Repository<'_>, name: &str) -> crate::db::DbResult<Note> {
    if let Some(existing) = repo.find_note_by_title(name)? {
        return Ok(existing);
    }
    repo.create_note_in_tx(name, "", NoteType::Regular, false)
}

pub fn begin_generate(db: &Db, meeting_note_id: &str) -> Result<GenerateSummaryJob, LlmIpcError> {
    load_transcript_context(db, meeting_note_id)?;
    reserve_inflight(meeting_note_id)?;
    Ok(GenerateSummaryJob {
        stream_id: Uuid::new_v4().to_string(),
        meeting_note_id: meeting_note_id.to_string(),
    })
}

pub fn emit_generate_result(
    sink: &dyn SummarySink,
    job: &GenerateSummaryJob,
    result: Result<MeetingSummary, LlmIpcError>,
) {
    match result {
        Ok(summary) => sink.emit_done(&SummaryDoneEvent {
            stream_id: job.stream_id.clone(),
            meeting_note_id: job.meeting_note_id.clone(),
            summary,
        }),
        Err(error) => sink.emit_error(&SummaryErrorEvent {
            stream_id: job.stream_id.clone(),
            meeting_note_id: job.meeting_note_id.clone(),
            code: error.code,
            message: error.message,
        }),
    }
    release_inflight(&job.meeting_note_id);
}

pub fn save_participants(
    db: &Db,
    meeting_note_id: &str,
    participants: Vec<SummaryParticipant>,
) -> Result<MeetingSummary, LlmIpcError> {
    let Some(existing) = get_summary(db, meeting_note_id)? else {
        return Err(LlmIpcError::invalid(
            "No summary to edit. Generate one first.",
        ));
    };
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let repo = Repository::new(&tx);
        let previous_task_ids: Vec<String> = existing
            .action_items
            .iter()
            .map(|item| item.task_id.clone())
            .collect();
        let resolved = resolve_participants(
            &repo,
            participants
                .into_iter()
                .map(|item| (item.name, item.certainty)),
        )?;
        let summary = MeetingSummary {
            participants: resolved,
            ..existing
        };
        let json = serde_json::to_string(&summary)
            .map_err(|err| crate::db::DbError::Invalid(err.to_string()))?;
        repo.save_meeting_summary_json(meeting_note_id, &json)?;
        for task_id in &previous_task_ids {
            repo.get_task(task_id)?;
        }
        tx.commit()?;
        Ok(summary)
    })
    .map_err(map_db_err)
}

fn map_db_err(err: crate::db::DbError) -> LlmIpcError {
    match err {
        crate::db::DbError::Invalid(message) => LlmIpcError::invalid(message),
        crate::db::DbError::NotFound => LlmIpcError::invalid("Meeting not found."),
        other => LlmIpcError::new("request_failed", other.to_string()),
    }
}

#[tauri::command]
pub fn get_meeting_summary(
    db: State<'_, Db>,
    meeting_note_id: String,
) -> Result<Option<MeetingSummary>, LlmIpcError> {
    get_summary(&db, &meeting_note_id)
}

#[tauri::command]
pub fn generate_meeting_summary(
    app: AppHandle,
    db: State<'_, Db>,
    meeting_note_id: String,
) -> Result<GenerateSummaryJob, LlmIpcError> {
    let job = begin_generate(&db, &meeting_note_id)?;
    app.emit_progress(&SummaryProgressEvent {
        stream_id: job.stream_id.clone(),
        meeting_note_id: job.meeting_note_id.clone(),
    });
    let app = app.clone();
    let job_for_thread = job.clone();
    std::thread::spawn(move || {
        let db = app.state::<Db>();
        let llm = app.state::<Llm>();
        let result = generate_summary(&db, &llm, &job_for_thread.meeting_note_id);
        emit_generate_result(&app, &job_for_thread, result);
    });
    Ok(job)
}

#[tauri::command]
pub fn save_meeting_summary_participants(
    db: State<'_, Db>,
    meeting_note_id: String,
    participants: Vec<SummaryParticipant>,
) -> Result<MeetingSummary, LlmIpcError> {
    save_participants(&db, &meeting_note_id, participants)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{FakeClient, MemorySecretStore};
    use std::sync::Arc;

    const SAMPLE_JSON: &str = r#"{
      "purpose": "Settle the pricing v2 tier structure so the table can ship with the beta cohort this week.",
      "participants": [
        {"name": "Sara Kim", "certainty": "certain"},
        {"name": "Marcus Webb", "certainty": "certain"},
        {"name": "Steve", "certainty": "maybe"}
      ],
      "key_points": [
        {
          "text": "Free tier stays; importer moves behind the paid line",
          "timestamp": "14:02",
          "children": [
            {"text": "revisit only if activation dips, September at the earliest", "timestamp": "14:05"}
          ]
        },
        {"text": "Annual pricing blocked on refund language", "timestamp": "14:11"}
      ],
      "outcome": "Tier structure approved. Ship behind flags.pricingV2 once legal clears the annual terms.",
      "action_items": [
        {"title": "Send updated tier table", "due_date": "2026-08-10", "priority": "high"},
        {"title": "Legal review of annual terms", "due_date": "2026-08-14"}
      ]
    }"#;

    fn llm_with(client: FakeClient) -> Llm {
        Llm::new(Arc::new(client), Arc::new(MemorySecretStore::default()))
    }

    fn meeting_with_transcript(db: &Db, body: &str) -> (String, String) {
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_meeting_note(
                    "Pricing sync",
                    "keep this body",
                    "2026-08-10",
                    "14:00",
                    "14:45",
                    None,
                )
            })
            .unwrap();
        let (meeting, transcript) = db
            .with_conn(|conn| Repository::new(conn).save_meeting_transcript(&created.note.id, body))
            .unwrap();
        (meeting.note_id, transcript.id)
    }

    #[test]
    fn parse_summary_reads_mockup_shape_and_strips_fences() {
        let fenced = format!("```json\n{SAMPLE_JSON}\n```");
        let draft = parse_summary_draft(&fenced).unwrap();
        assert!(draft.purpose.contains("pricing v2"));
        assert_eq!(draft.participants.len(), 3);
        assert_eq!(draft.key_points[0].children.len(), 1);
        assert_eq!(
            draft.action_items[0].due_date.as_deref(),
            Some("2026-08-10")
        );
    }

    #[test]
    fn parse_summary_rejects_non_json() {
        let err = parse_summary_draft("pong").unwrap_err();
        assert_eq!(err.code, "invalid");
    }

    #[test]
    fn word_count_skips_clock_prefixes() {
        let body = "14:02  Free tier stays\n14:05  revisit only if activation dips";
        assert_eq!(transcript_word_count(body), 8);
        assert_eq!(duration_seconds("14:00", "14:45"), 45 * 60);
    }

    #[test]
    fn generate_creates_tasks_and_people_notes() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, transcript_id) = meeting_with_transcript(
            &db,
            "14:02  Sara said the free tier stays\n14:11  Marcus blocked annual on refund language",
        );
        let llm = llm_with(FakeClient::scripted(&[SAMPLE_JSON]));
        let summary = generate_summary(&db, &llm, &meeting_id).unwrap();

        assert!(summary.purpose.contains("pricing v2"));
        assert_eq!(
            get_summary(&db, &meeting_id).unwrap().unwrap().purpose,
            summary.purpose
        );
        assert_eq!(summary.participants.len(), 3);
        assert!(summary.participants[0].note_id.is_some());
        assert!(summary.participants[1].note_id.is_some());
        assert_eq!(
            summary.participants[2].certainty,
            ParticipantCertainty::Maybe
        );
        assert!(summary.participants[2].note_id.is_none());
        assert_eq!(summary.action_items.len(), 2);
        assert_eq!(summary.transcript.note_id, transcript_id);
        assert_eq!(summary.transcript.duration_seconds, 45 * 60);
        assert!(summary.transcript.word_count > 0);
        assert_eq!(summary.key_points[0].timestamp.as_deref(), Some("14:02"));

        let tasks = db
            .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&meeting_id))
            .unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "Send updated tier table");
        assert_eq!(tasks[0].due_date.as_deref(), Some("2026-08-10"));

        let sara = db
            .with_conn(|conn| Repository::new(conn).find_note_by_title("Sara Kim"))
            .unwrap()
            .unwrap();
        assert_eq!(sara.note_type, NoteType::Regular);

        let meeting_note = db
            .with_conn(|conn| Repository::new(conn).get_note(&meeting_id))
            .unwrap();
        assert_eq!(meeting_note.body_markdown, "keep this body");
        let transcript = db
            .with_conn(|conn| Repository::new(conn).get_note(&transcript_id))
            .unwrap();
        assert!(transcript.body_markdown.contains("free tier stays"));
    }

    #[test]
    fn regenerate_replaces_generated_tasks_only() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, _) = meeting_with_transcript(&db, "14:02  Decide the tiers");
        let first = generate_summary(
            &db,
            &llm_with(FakeClient::scripted(&[SAMPLE_JSON])),
            &meeting_id,
        )
        .unwrap();
        let kept = db
            .with_conn(|conn| {
                Repository::new(conn).create_task(
                    &meeting_id,
                    "Human task stays",
                    TaskState::Open,
                    None,
                    None,
                )
            })
            .unwrap();

        let replacement = r#"{
          "purpose": "Confirm the table.",
          "participants": [{"name": "Sara Kim", "certainty": "certain"}],
          "key_points": [{"text": "Ship the table", "timestamp": "14:18"}],
          "outcome": "Approved again.",
          "action_items": [{"title": "Only this one"}]
        }"#;
        let second = generate_summary(
            &db,
            &llm_with(FakeClient::scripted(&[replacement])),
            &meeting_id,
        )
        .unwrap();

        assert_eq!(second.action_items.len(), 1);
        assert_eq!(second.action_items[0].title, "Only this one");
        assert_ne!(
            second.action_items[0].task_id,
            first.action_items[0].task_id
        );

        let tasks = db
            .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&meeting_id))
            .unwrap();
        let titles: Vec<_> = tasks.iter().map(|t| t.title.as_str()).collect();
        assert!(titles.contains(&"Human task stays"));
        assert!(titles.contains(&"Only this one"));
        assert!(!titles.contains(&"Send updated tier table"));
        assert!(
            db.with_conn(|conn| Repository::new(conn).get_task(&kept.id))
                .unwrap()
                .id
                == kept.id
        );
    }

    #[test]
    fn failed_generate_leaves_transcript_and_skips_summary() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, transcript_id) =
            meeting_with_transcript(&db, "14:02  This text must survive");
        let err = generate_summary(
            &db,
            &llm_with(FakeClient::failing(LlmIpcError::unreachable(
                "Could not reach the LLM server.",
            ))),
            &meeting_id,
        )
        .unwrap_err();
        assert_eq!(err.code, "unreachable");
        assert!(get_summary(&db, &meeting_id).unwrap().is_none());
        let transcript = db
            .with_conn(|conn| Repository::new(conn).get_note(&transcript_id))
            .unwrap();
        assert!(transcript.body_markdown.contains("must survive"));
        let tasks = db
            .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&meeting_id))
            .unwrap();
        assert!(tasks.is_empty());
    }

    #[test]
    fn bad_json_from_model_does_not_write() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, _) = meeting_with_transcript(&db, "14:02  Hello");
        let err = generate_summary(&db, &llm_with(FakeClient::scripted(&["pong"])), &meeting_id)
            .unwrap_err();
        assert_eq!(err.code, "invalid");
        assert!(get_summary(&db, &meeting_id).unwrap().is_none());
    }

    #[test]
    fn missing_transcript_is_invalid() {
        let db = Db::open_in_memory().unwrap();
        let created = db
            .with_conn(|conn| {
                Repository::new(conn).create_meeting_note(
                    "No transcript",
                    "",
                    "2026-08-10",
                    "14:00",
                    "14:45",
                    None,
                )
            })
            .unwrap();
        let err = generate_summary(
            &db,
            &llm_with(FakeClient::scripted(&[SAMPLE_JSON])),
            &created.note.id,
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid");
        assert!(err.message.contains("transcript"));
    }

    #[derive(Default)]
    struct CollectingSink {
        progress: std::sync::Mutex<Vec<SummaryProgressEvent>>,
        done: std::sync::Mutex<Vec<SummaryDoneEvent>>,
        errors: std::sync::Mutex<Vec<SummaryErrorEvent>>,
    }

    impl SummarySink for CollectingSink {
        fn emit_progress(&self, event: &SummaryProgressEvent) {
            self.progress
                .lock()
                .expect("sink poisoned")
                .push(event.clone());
        }
        fn emit_done(&self, event: &SummaryDoneEvent) {
            self.done.lock().expect("sink poisoned").push(event.clone());
        }
        fn emit_error(&self, event: &SummaryErrorEvent) {
            self.errors
                .lock()
                .expect("sink poisoned")
                .push(event.clone());
        }
    }

    struct HoldClient {
        hold: std::sync::Mutex<Option<std::sync::mpsc::Receiver<()>>>,
        tokens: Vec<String>,
    }

    impl crate::llm::LlmClient for HoldClient {
        fn id(&self) -> &'static str {
            "hold"
        }

        fn stream_chat(
            &self,
            _request: &crate::llm::ChatRequest,
            on_token: &mut dyn FnMut(&str),
        ) -> Result<crate::llm::ChatOutcome, LlmIpcError> {
            if let Some(rx) = self.hold.lock().expect("hold poisoned").take() {
                let _ = rx.recv();
            }
            for token in &self.tokens {
                on_token(token);
            }
            Ok(crate::llm::ChatOutcome::default())
        }
    }

    #[test]
    fn begin_generate_returns_before_llm_runs() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, _) = meeting_with_transcript(&db, "14:02  Decide the tiers");
        let (tx, rx) = std::sync::mpsc::channel();
        let llm = Llm::new(
            Arc::new(HoldClient {
                hold: std::sync::Mutex::new(Some(rx)),
                tokens: vec![SAMPLE_JSON.to_string()],
            }),
            Arc::new(MemorySecretStore::default()),
        );
        let job = begin_generate(&db, &meeting_id).unwrap();
        assert_eq!(job.meeting_note_id, meeting_id);
        assert!(!job.stream_id.is_empty());
        assert!(get_summary(&db, &meeting_id).unwrap().is_none());

        std::thread::scope(|scope| {
            let handle = scope.spawn(|| generate_summary(&db, &llm, &meeting_id));
            assert!(get_summary(&db, &meeting_id).unwrap().is_none());
            tx.send(()).unwrap();
            handle.join().expect("generate thread").unwrap();
        });
        assert!(get_summary(&db, &meeting_id).unwrap().is_some());
        release_inflight(&meeting_id);
    }

    #[test]
    fn emit_generate_result_surfaces_llm_failure() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, transcript_id) =
            meeting_with_transcript(&db, "14:02  This text must survive");
        let job = begin_generate(&db, &meeting_id).unwrap();
        let sink = CollectingSink::default();
        let err = generate_summary(
            &db,
            &llm_with(FakeClient::failing(LlmIpcError::unreachable(
                "Could not reach the LLM server.",
            ))),
            &meeting_id,
        )
        .unwrap_err();
        emit_generate_result(&sink, &job, Err(err));
        assert_eq!(sink.errors.lock().unwrap()[0].code, "unreachable");
        assert!(get_summary(&db, &meeting_id).unwrap().is_none());
        let transcript = db
            .with_conn(|conn| Repository::new(conn).get_note(&transcript_id))
            .unwrap();
        assert!(transcript.body_markdown.contains("must survive"));
    }

    #[test]
    fn save_participants_does_not_delete_tasks() {
        let db = Db::open_in_memory().unwrap();
        let (meeting_id, _) = meeting_with_transcript(&db, "14:02  Decide the tiers");
        let first = generate_summary(
            &db,
            &llm_with(FakeClient::scripted(&[SAMPLE_JSON])),
            &meeting_id,
        )
        .unwrap();
        let task_ids: Vec<_> = first
            .action_items
            .iter()
            .map(|item| item.task_id.clone())
            .collect();

        let saved = save_participants(
            &db,
            &meeting_id,
            vec![
                SummaryParticipant {
                    name: "Sara Kim".into(),
                    certainty: ParticipantCertainty::Certain,
                    note_id: None,
                },
                SummaryParticipant {
                    name: "Steve".into(),
                    certainty: ParticipantCertainty::Certain,
                    note_id: None,
                },
            ],
        )
        .unwrap();

        assert_eq!(saved.participants.len(), 2);
        assert_eq!(saved.participants[1].name, "Steve");
        assert!(saved.participants[1].note_id.is_some());
        assert_eq!(
            saved
                .action_items
                .iter()
                .map(|item| item.task_id.clone())
                .collect::<Vec<_>>(),
            task_ids
        );
        let tasks = db
            .with_conn(|conn| Repository::new(conn).list_tasks_for_note(&meeting_id))
            .unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(
            get_summary(&db, &meeting_id)
                .unwrap()
                .unwrap()
                .participants
                .len(),
            2
        );
    }
}
