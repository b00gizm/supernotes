//! In-memory agent chat session on top of the ENG-70 LLM stream (ENG-72/73).
//!
//! History lives in process memory only. Restart = empty. Optional open-note
//! context is loaded here from `notes`; missing/unknown ids are skipped.
//! Read-only tools run against the existing SQLite repos. The session mutex
//! is never held across `stream_turn` or tool I/O.

mod tools;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::{Db, Repository};
use crate::llm::{ChatMessage, EventSink, Llm, LlmChatResult, LlmDoneEvent, LlmIpcError};

pub use tools::{chat_tools, execute_tool};

/// Baymax listens for this to toggle the Assistant sidebar. No UI here.
pub const TOGGLE_EVENT: &str = "agent://toggle";
/// Mockup 1i chip: ⌥⌘A (Option+Command+A / Alt+Meta+A).
pub const TOGGLE_ACCELERATOR: &str = "Alt+CmdOrCtrl+A";
pub const TOOL_EVENT: &str = "agent://tool";
pub const TOOL_RESULT_EVENT: &str = "agent://tool.result";
pub const MAX_TOOL_ITERATIONS: usize = 8;

const TOOLS_SYSTEM: &str = "You have read-only tools for the user's notes, tasks, calendar, and daily notes. Use them to answer from real app data instead of guessing.";

#[derive(Debug, Default)]
struct SessionInner {
    turns: Vec<ChatMessage>,
    /// Bumped on clear so an in-flight send does not append after a wipe.
    generation: u64,
}

#[derive(Debug, Default)]
pub struct AgentSession {
    inner: Mutex<SessionInner>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SendAgentChatInput {
    pub message: String,
    #[serde(default)]
    pub note_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentToolEvent {
    pub stream_id: String,
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentToolResultEvent {
    pub stream_id: String,
    pub id: String,
    pub name: String,
    pub result: serde_json::Value,
}

pub trait ToolEventSink: Send + Sync {
    fn emit_tool(&self, event: &AgentToolEvent);
    fn emit_tool_result(&self, event: &AgentToolResultEvent);
}

impl ToolEventSink for AppHandle {
    fn emit_tool(&self, event: &AgentToolEvent) {
        let _ = self.emit(TOOL_EVENT, event);
    }
    fn emit_tool_result(&self, event: &AgentToolResultEvent) {
        let _ = self.emit(TOOL_RESULT_EVENT, event);
    }
}

impl AgentSession {
    pub fn clear(&self) {
        let mut inner = self.inner.lock().expect("agent session poisoned");
        inner.turns.clear();
        inner.generation = inner.generation.wrapping_add(1);
    }

    pub fn send(
        &self,
        db: &Db,
        llm: &Llm,
        sink: &dyn EventSink,
        tools: &dyn ToolEventSink,
        message: &str,
        note_id: Option<&str>,
    ) -> Result<LlmChatResult, LlmIpcError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(LlmIpcError::invalid("message cannot be empty"));
        }

        let context = note_context_message(db, note_id);
        let (history, generation) = {
            let mut inner = self.inner.lock().expect("agent session poisoned");
            inner.turns.push(ChatMessage::new("user", message));
            (inner.turns.clone(), inner.generation)
        };

        let stream_id = Uuid::new_v4().to_string();
        let result = run_tool_loop(db, llm, sink, tools, &stream_id, &history, context.as_ref());

        match result {
            Ok(result) => {
                let mut inner = self.inner.lock().expect("agent session poisoned");
                if inner.generation == generation {
                    inner
                        .turns
                        .push(ChatMessage::new("assistant", result.text.clone()));
                }
                Ok(result)
            }
            Err(error) => Err(error),
        }
    }

    #[cfg(test)]
    fn turns(&self) -> Vec<ChatMessage> {
        self.inner
            .lock()
            .expect("agent session poisoned")
            .turns
            .clone()
    }
}

fn run_tool_loop(
    db: &Db,
    llm: &Llm,
    sink: &dyn EventSink,
    tools: &dyn ToolEventSink,
    stream_id: &str,
    history: &[ChatMessage],
    context: Option<&ChatMessage>,
) -> Result<LlmChatResult, LlmIpcError> {
    let catalog = chat_tools();
    let mut outgoing = Vec::with_capacity(history.len() + 2);
    outgoing.push(ChatMessage::new("system", TOOLS_SYSTEM));
    if let Some(context) = context {
        outgoing.push(context.clone());
    }
    outgoing.extend(history.iter().cloned());

    let mut last_text = String::new();
    let mut engine_id = String::new();
    for _ in 0..MAX_TOOL_ITERATIONS {
        let turn = llm.stream_turn(db, &outgoing, Some(&catalog), sink, stream_id, false)?;
        engine_id = turn.result.engine_id;
        last_text = turn.result.text;
        if turn.tool_calls.is_empty() {
            break;
        }
        outgoing.push(ChatMessage {
            role: "assistant".into(),
            content: last_text.clone(),
            tool_calls: Some(turn.tool_calls.clone()),
            tool_call_id: None,
        });
        for call in turn.tool_calls {
            tools.emit_tool(&AgentToolEvent {
                stream_id: stream_id.to_string(),
                id: call.id.clone(),
                name: call.function.name.clone(),
                arguments: call.function.arguments.clone(),
            });
            let result = execute_tool(db, &call.function.name, &call.function.arguments);
            tools.emit_tool_result(&AgentToolResultEvent {
                stream_id: stream_id.to_string(),
                id: call.id.clone(),
                name: call.function.name.clone(),
                result: result.clone(),
            });
            outgoing.push(ChatMessage {
                role: "tool".into(),
                content: result.to_string(),
                tool_calls: None,
                tool_call_id: Some(call.id),
            });
        }
    }

    sink.emit_done(&LlmDoneEvent {
        stream_id: stream_id.to_string(),
        text: last_text.clone(),
    });
    Ok(LlmChatResult {
        stream_id: stream_id.to_string(),
        text: last_text,
        engine_id,
    })
}

pub fn format_note_context(title: &str, body: &str) -> String {
    format!(
        "The user has this note open. Use it when they refer to \"this\" or ask to proof-read.\n\n# {title}\n\n{body}"
    )
}

fn note_context_message(db: &Db, note_id: Option<&str>) -> Option<ChatMessage> {
    let id = note_id.map(str::trim).filter(|id| !id.is_empty())?;
    // Missing/unknown (or any load failure) = no context. Chat still runs.
    let note = db
        .with_conn(|conn| Repository::new(conn).get_note(id))
        .ok()?;
    Some(ChatMessage::new(
        "system",
        format_note_context(&note.title, &note.body_markdown),
    ))
}

/// Menu accelerator is the real registration (same path as ENG-60). This hook
/// stays infallible so headless Linux CI / a missing global-shortcut backend
/// cannot take down `setup`.
pub fn register_assistant_shortcut() -> Result<(), String> {
    Ok(())
}

#[tauri::command(async)]
pub fn send_agent_chat(
    app: AppHandle,
    db: State<'_, Db>,
    llm: State<'_, Llm>,
    session: State<'_, AgentSession>,
    input: SendAgentChatInput,
) -> Result<LlmChatResult, LlmIpcError> {
    session.send(
        &db,
        &llm,
        &app,
        &app,
        &input.message,
        input.note_id.as_deref(),
    )
}

#[tauri::command(async)]
pub fn clear_agent_conversation(session: State<'_, AgentSession>) {
    session.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NoteType, TaskState};
    use crate::llm::{
        ChatOutcome, ChatRequest, CollectingSink, FakeChatTurn, FakeClient, LlmClient, LlmIpcError,
        MemorySecretStore, ToolCall,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct CollectingTools {
        calls: Mutex<Vec<AgentToolEvent>>,
        results: Mutex<Vec<AgentToolResultEvent>>,
    }

    impl CollectingTools {
        fn names(&self) -> Vec<String> {
            self.calls
                .lock()
                .expect("tools poisoned")
                .iter()
                .map(|event| event.name.clone())
                .collect()
        }

        fn results(&self) -> Vec<AgentToolResultEvent> {
            self.results.lock().expect("tools poisoned").clone()
        }
    }

    impl ToolEventSink for CollectingTools {
        fn emit_tool(&self, event: &AgentToolEvent) {
            self.calls
                .lock()
                .expect("tools poisoned")
                .push(event.clone());
        }
        fn emit_tool_result(&self, event: &AgentToolResultEvent) {
            self.results
                .lock()
                .expect("tools poisoned")
                .push(event.clone());
        }
    }

    struct RecordingClient {
        inner: FakeClient,
        last: Mutex<Option<ChatRequest>>,
        calls: AtomicUsize,
    }

    impl RecordingClient {
        fn new(inner: FakeClient) -> Self {
            Self {
                inner,
                last: Mutex::new(None),
                calls: AtomicUsize::new(0),
            }
        }

        fn last_messages(&self) -> Vec<ChatMessage> {
            self.last
                .lock()
                .expect("recording client poisoned")
                .as_ref()
                .map(|request| request.messages.clone())
                .unwrap_or_default()
        }

        fn last_has_tools(&self) -> bool {
            self.last
                .lock()
                .expect("recording client poisoned")
                .as_ref()
                .and_then(|request| request.tools.as_ref())
                .is_some_and(|tools| !tools.is_empty())
        }

        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl LlmClient for RecordingClient {
        fn id(&self) -> &'static str {
            "fake"
        }

        fn stream_chat(
            &self,
            request: &ChatRequest,
            on_token: &mut dyn FnMut(&str),
        ) -> Result<ChatOutcome, LlmIpcError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.last.lock().expect("recording client poisoned") = Some(request.clone());
            self.inner.stream_chat(request, on_token)
        }
    }

    struct SlowClient {
        started: Mutex<Option<mpsc::Sender<()>>>,
        delay: Duration,
    }

    impl LlmClient for SlowClient {
        fn id(&self) -> &'static str {
            "fake"
        }

        fn stream_chat(
            &self,
            _request: &ChatRequest,
            on_token: &mut dyn FnMut(&str),
        ) -> Result<ChatOutcome, LlmIpcError> {
            if let Some(tx) = self.started.lock().expect("slow client poisoned").take() {
                let _ = tx.send(());
            }
            std::thread::sleep(self.delay);
            on_token("ok");
            Ok(ChatOutcome::default())
        }
    }

    struct AlwaysToolsClient {
        calls: AtomicUsize,
    }

    impl LlmClient for AlwaysToolsClient {
        fn id(&self) -> &'static str {
            "fake"
        }

        fn stream_chat(
            &self,
            _request: &ChatRequest,
            on_token: &mut dyn FnMut(&str),
        ) -> Result<ChatOutcome, LlmIpcError> {
            let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            on_token("looking");
            Ok(ChatOutcome {
                tool_calls: vec![ToolCall::function(
                    format!("call_{n}"),
                    "search_notes",
                    r#"{"query":"x"}"#,
                )],
            })
        }
    }

    fn harness(client: FakeClient) -> (Db, Llm, AgentSession, Arc<RecordingClient>) {
        let recorder = Arc::new(RecordingClient::new(client));
        let llm = Llm::new(recorder.clone(), Arc::new(MemorySecretStore::default()));
        (
            Db::open_in_memory().unwrap(),
            llm,
            AgentSession::default(),
            recorder,
        )
    }

    fn insert_note(db: &Db, title: &str, body: &str) -> String {
        db.with_conn(|conn| {
            Repository::new(conn).create_note(title, body, NoteType::Regular, false)
        })
        .unwrap()
        .id
    }

    fn without_system(messages: &[ChatMessage]) -> Vec<ChatMessage> {
        messages
            .iter()
            .filter(|message| message.role != "system")
            .cloned()
            .collect()
    }

    #[test]
    fn send_args_are_snake_case_inside_input() {
        let input: SendAgentChatInput =
            serde_json::from_str(r#"{"message":"proof this","note_id":"note-1"}"#).unwrap();
        assert_eq!(input.message, "proof this");
        assert_eq!(input.note_id.as_deref(), Some("note-1"));

        let none: SendAgentChatInput = serde_json::from_str(r#"{"message":"hi"}"#).unwrap();
        assert_eq!(none.note_id, None);
    }

    #[test]
    fn history_accumulates_across_turns_and_clear_wipes_it() {
        let (db, llm, session, recorder) = harness(FakeClient::scripted(&["ok"]));
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();

        let first = session
            .send(&db, &llm, &sink, &tools, "hello", None)
            .unwrap();
        assert_eq!(first.text, "ok");
        assert_eq!(sink.tokens(), ["ok"]);
        assert_eq!(
            without_system(&recorder.last_messages()),
            [ChatMessage::new("user", "hello")]
        );
        assert!(recorder.last_has_tools());
        assert_eq!(recorder.last_messages()[0].role, "system");
        assert!(recorder.last_messages()[0]
            .content
            .contains("read-only tools"));

        session
            .send(&db, &llm, &sink, &tools, "again", None)
            .unwrap();
        assert_eq!(
            without_system(&recorder.last_messages()),
            [
                ChatMessage::new("user", "hello"),
                ChatMessage::new("assistant", "ok"),
                ChatMessage::new("user", "again"),
            ]
        );

        session.clear();
        assert!(session.turns().is_empty());
        session
            .send(&db, &llm, &sink, &tools, "fresh", None)
            .unwrap();
        assert_eq!(
            without_system(&recorder.last_messages()),
            [ChatMessage::new("user", "fresh")]
        );
    }

    #[test]
    fn note_id_present_includes_body_missing_does_not_error() {
        let (db, llm, session, recorder) = harness(FakeClient::default());
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();
        let id = insert_note(&db, "Pricing v2", "Three tiers, usage-based add-ons — café");

        session
            .send(
                &db,
                &llm,
                &sink,
                &tools,
                "Please proof-read this",
                Some(&id),
            )
            .unwrap();
        let sent = recorder.last_messages();
        assert_eq!(sent[0].role, "system");
        assert_eq!(sent[1].role, "system");
        assert!(sent[1].content.contains("Pricing v2"));
        assert!(sent[1].content.contains("usage-based add-ons — café"));
        assert_eq!(sent[2].role, "user");
        assert_eq!(sent[2].content, "Please proof-read this");

        session.clear();
        session
            .send(&db, &llm, &sink, &tools, "hello", Some("missing-note"))
            .unwrap();
        assert_eq!(
            without_system(&recorder.last_messages()),
            [ChatMessage::new("user", "hello")]
        );

        session.clear();
        session
            .send(&db, &llm, &sink, &tools, "no note", None)
            .unwrap();
        assert_eq!(without_system(&recorder.last_messages())[0].role, "user");
        session
            .send(&db, &llm, &sink, &tools, "blank id", Some("   "))
            .unwrap();
        assert_eq!(
            recorder
                .last_messages()
                .iter()
                .filter(|message| message.role == "system")
                .count(),
            1
        );
    }

    #[test]
    fn empty_message_is_invalid_and_does_not_touch_history() {
        let (db, llm, session, recorder) = harness(FakeClient::default());
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();
        let err = session
            .send(&db, &llm, &sink, &tools, "   ", None)
            .unwrap_err();
        assert_eq!(err.code, "invalid");
        assert!(session.turns().is_empty());
        assert!(recorder.last_messages().is_empty());
    }

    #[test]
    fn stream_failure_keeps_codes_and_does_not_append_assistant() {
        let (db, llm, session, _) = harness(FakeClient::failing(LlmIpcError::unreachable(
            "Could not reach the LLM server.",
        )));
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();
        let err = session
            .send(&db, &llm, &sink, &tools, "hello", None)
            .unwrap_err();
        assert_eq!(err.code, "unreachable");
        assert_eq!(sink.errors()[0].code, "unreachable");
        assert_eq!(session.turns(), [ChatMessage::new("user", "hello")]);
    }

    #[test]
    fn assistant_shortcut_is_option_command_a() {
        assert_eq!(TOGGLE_ACCELERATOR, "Alt+CmdOrCtrl+A");
        assert_eq!(TOGGLE_EVENT, "agent://toggle");
        assert_eq!(TOOL_EVENT, "agent://tool");
        assert_eq!(TOOL_RESULT_EVENT, "agent://tool.result");
        assert!(register_assistant_shortcut().is_ok());
    }

    #[test]
    fn format_note_context_keeps_user_body() {
        let text = format_note_context("Daily", "proof me");
        assert!(text.contains("# Daily"));
        assert!(text.contains("proof me"));
    }

    #[test]
    fn clear_during_slow_stream_does_not_stall_or_poison() {
        let (started_tx, started_rx) = mpsc::channel();
        let llm = Llm::new(
            Arc::new(SlowClient {
                started: Mutex::new(Some(started_tx)),
                delay: Duration::from_millis(250),
            }),
            Arc::new(MemorySecretStore::default()),
        );
        let db = Db::open_in_memory().unwrap();
        let session = AgentSession::default();
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();

        std::thread::scope(|scope| {
            let send = scope.spawn(|| session.send(&db, &llm, &sink, &tools, "hello", None));
            started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("slow stream started");
            let started = Instant::now();
            session.clear();
            assert!(
                started.elapsed() < Duration::from_millis(80),
                "clear stalled behind stream: {:?}",
                started.elapsed()
            );
            assert!(session.turns().is_empty());
            send.join().unwrap().unwrap();
        });

        assert!(session.turns().is_empty());
        session.clear();
        assert!(session.turns().is_empty());
    }

    #[test]
    fn each_tool_reads_real_db_rows() {
        let db = Db::open_in_memory().unwrap();
        let note_id = insert_note(
            &db,
            "Mike Q3 sync",
            "Mike said the Q3 numbers slipped to 4.2M — café",
        );
        let daily = db
            .with_conn(|conn| Repository::new(conn).get_or_create_daily("2026-08-25"))
            .unwrap();
        db.with_conn(|conn| {
            let repo = Repository::new(conn);
            repo.update_note(&daily.id, &daily.title, "Standup at 9, ship brief")?;
            repo.create_task(
                &note_id,
                "Send Q3 deck",
                TaskState::Open,
                Some("2026-08-25"),
                None,
            )?;
            repo.create_task(
                &note_id,
                "Overdue invoice",
                TaskState::Open,
                Some("2026-08-20"),
                None,
            )?;
            let task = repo.create_task(
                &note_id,
                "Prep standup",
                TaskState::Open,
                Some("2026-08-25"),
                None,
            )?;
            repo.create_calendar_event(
                "Standup",
                "2026-08-25T09:00:00.000Z",
                "2026-08-25T09:30:00.000Z",
                Some(&task.id),
            )?;
            Ok(())
        })
        .unwrap();

        let hits = execute_tool(&db, "search_notes", r#"{"query":"Q3"}"#);
        assert_eq!(hits[0]["title"], "Mike Q3 sync");
        assert!(hits[0]["snippet"]
            .as_str()
            .unwrap()
            .contains("Q3 numbers slipped"));

        let empty = execute_tool(&db, "search_notes", r#"{"query":""}"#);
        assert_eq!(empty, serde_json::json!([]));
        let miss = execute_tool(&db, "search_notes", r#"{"query":"zzzz-nope"}"#);
        assert_eq!(miss, serde_json::json!([]));

        let by_id = execute_tool(
            &db,
            "get_note",
            &format!(r#"{{"id_or_title":"{note_id}"}}"#),
        );
        assert_eq!(by_id["title"], "Mike Q3 sync");
        let by_title = execute_tool(&db, "get_note", r#"{"id_or_title":"Mike Q3 sync"}"#);
        assert_eq!(by_title["id"], note_id);
        assert_eq!(
            execute_tool(&db, "get_note", r#"{"id_or_title":"missing"}"#),
            serde_json::Value::Null
        );

        let due = execute_tool(
            &db,
            "list_tasks",
            r#"{"state":"open","due_from":"2026-08-25","due_to":"2026-08-25","today":"2026-08-25"}"#,
        );
        assert!(due
            .as_array()
            .unwrap()
            .iter()
            .any(|task| task["title"] == "Send Q3 deck"));
        let overdue = execute_tool(
            &db,
            "list_tasks",
            r#"{"overdue":true,"today":"2026-08-25"}"#,
        );
        assert_eq!(overdue[0]["title"], "Overdue invoice");
        let upcoming = execute_tool(
            &db,
            "list_tasks",
            r#"{"filter":"upcoming","today":"2026-08-25"}"#,
        );
        assert!(upcoming.as_array().unwrap().len() >= 2);

        let events = execute_tool(&db, "list_calendar_events", r#"{"date":"2026-08-25"}"#);
        assert_eq!(events[0]["title"], "Standup");
        assert_eq!(events[0]["task"]["title"], "Prep standup");

        let daily_note = execute_tool(&db, "get_daily_note", r#"{"date":"2026-08-25"}"#);
        assert!(daily_note["body_markdown"]
            .as_str()
            .unwrap()
            .contains("ship brief"));
        assert_eq!(
            execute_tool(&db, "get_daily_note", r#"{"date":"2026-01-01"}"#),
            serde_json::Value::Null
        );
        assert_eq!(
            execute_tool(&db, "get_daily_note", r#"{"date":"nope"}"#),
            serde_json::Value::Null
        );
    }

    #[test]
    fn tool_loop_runs_two_tools_then_final_answer() {
        let (db, llm, session, recorder) = harness(FakeClient::scripted_turns(vec![
            FakeChatTurn::tool_calls(vec![
                ToolCall::function(
                    "call_cal",
                    "list_calendar_events",
                    r#"{"date":"2026-08-25"}"#,
                ),
                ToolCall::function(
                    "call_tasks",
                    "list_tasks",
                    r#"{"due_from":"2026-08-25","due_to":"2026-08-25","today":"2026-08-25"}"#,
                ),
            ]),
            FakeChatTurn::tool_calls(vec![ToolCall::function(
                "call_note",
                "search_notes",
                r#"{"query":"Q3"}"#,
            )]),
            FakeChatTurn::tokens(&["Agenda: standup. Mike said 4.2M."]),
        ]));
        let note_id = insert_note(
            &db,
            "Mike Q3 sync",
            "Mike said the Q3 numbers slipped to 4.2M",
        );
        db.with_conn(|conn| {
            let repo = Repository::new(conn);
            repo.create_task(
                &note_id,
                "Send Q3 deck",
                TaskState::Open,
                Some("2026-08-25"),
                None,
            )?;
            repo.create_calendar_event(
                "Standup",
                "2026-08-25T09:00:00.000Z",
                "2026-08-25T09:30:00.000Z",
                None,
            )?;
            Ok(())
        })
        .unwrap();

        let sink = CollectingSink::default();
        let tools = CollectingTools::default();
        let result = session
            .send(&db, &llm, &sink, &tools, "What's on my agenda today?", None)
            .unwrap();
        assert_eq!(result.text, "Agenda: standup. Mike said 4.2M.");
        assert_eq!(
            tools.names(),
            ["list_calendar_events", "list_tasks", "search_notes"]
        );
        assert_eq!(tools.results()[0].result[0]["title"], "Standup");
        assert!(tools.results()[1]
            .result
            .as_array()
            .unwrap()
            .iter()
            .any(|task| task["title"] == "Send Q3 deck"));
        assert_eq!(tools.results()[2].result[0]["title"], "Mike Q3 sync");
        assert_eq!(sink.tokens(), ["Agenda: standup. Mike said 4.2M."]);
        assert_eq!(recorder.call_count(), 3);
        assert_eq!(
            session.turns().last().unwrap().content,
            "Agenda: standup. Mike said 4.2M."
        );
        assert!(session.turns().iter().all(|message| message.role != "tool"));
    }

    #[test]
    fn iteration_cap_ends_without_hanging_and_returns_text() {
        let llm = Llm::new(
            Arc::new(AlwaysToolsClient {
                calls: AtomicUsize::new(0),
            }),
            Arc::new(MemorySecretStore::default()),
        );
        let db = Db::open_in_memory().unwrap();
        let session = AgentSession::default();
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();
        let started = Instant::now();
        let result = session
            .send(&db, &llm, &sink, &tools, "loop forever", None)
            .unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(result.text, "looking");
        assert_eq!(tools.names().len(), MAX_TOOL_ITERATIONS);
        assert_eq!(session.turns().last().unwrap().content, "looking");
    }

    #[test]
    fn failed_tool_does_not_poison_session() {
        let (db, llm, session, recorder) = harness(FakeClient::scripted_turns(vec![
            FakeChatTurn::tool_calls(vec![ToolCall::function("call_bad", "not_a_tool", r#"{}"#)]),
            FakeChatTurn::tokens(&["I could not find that tool."]),
            FakeChatTurn::tokens(&["next works"]),
        ]));
        let sink = CollectingSink::default();
        let tools = CollectingTools::default();
        let first = session
            .send(&db, &llm, &sink, &tools, "use a missing tool", None)
            .unwrap();
        assert_eq!(first.text, "I could not find that tool.");
        assert_eq!(
            tools.results()[0].result["error"],
            "unknown tool: not_a_tool"
        );
        let outgoing = recorder.last_messages();
        assert!(outgoing.iter().any(|message| message.role == "tool"
            && message.content.contains("unknown tool: not_a_tool")));

        let second = session
            .send(&db, &llm, &sink, &tools, "hello again", None)
            .unwrap();
        assert_eq!(second.text, "next works");
        assert_eq!(session.turns().last().unwrap().content, "next works");
    }
}
