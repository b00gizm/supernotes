//! In-memory agent chat session on top of the ENG-70 LLM stream (ENG-72).
//!
//! History lives in process memory only. Restart = empty. Optional open-note
//! context is loaded here from `notes`; missing/unknown ids are skipped.

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::db::{Db, Repository};
use crate::llm::{ChatMessage, EventSink, Llm, LlmChatResult, LlmIpcError};

/// Baymax listens for this to toggle the Assistant sidebar. No UI here.
pub const TOGGLE_EVENT: &str = "agent://toggle";
/// Mockup 1i chip: ⌥⌘A (Option+Command+A / Alt+Meta+A).
pub const TOGGLE_ACCELERATOR: &str = "Alt+CmdOrCtrl+A";

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
        message: &str,
        note_id: Option<&str>,
    ) -> Result<LlmChatResult, LlmIpcError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(LlmIpcError::invalid("message cannot be empty"));
        }

        let context = note_context_message(db, note_id);
        let (outgoing, generation) = {
            let mut inner = self.inner.lock().expect("agent session poisoned");
            inner.turns.push(ChatMessage {
                role: "user".into(),
                content: message.to_string(),
            });
            let mut outgoing =
                Vec::with_capacity(inner.turns.len() + usize::from(context.is_some()));
            if let Some(context) = context {
                outgoing.push(context);
            }
            outgoing.extend(inner.turns.iter().cloned());
            (outgoing, inner.generation)
        };

        match llm.stream_chat(db, &outgoing, sink) {
            Ok(result) => {
                let mut inner = self.inner.lock().expect("agent session poisoned");
                if inner.generation == generation {
                    inner.turns.push(ChatMessage {
                        role: "assistant".into(),
                        content: result.text.clone(),
                    });
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
    Some(ChatMessage {
        role: "system".into(),
        content: format_note_context(&note.title, &note.body_markdown),
    })
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
    let sink: Arc<dyn EventSink> = Arc::new(app);
    session.send(
        &db,
        &llm,
        sink.as_ref(),
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
    use crate::db::NoteType;
    use crate::llm::{
        ChatRequest, CollectingSink, FakeClient, LlmClient, LlmIpcError, MemorySecretStore,
    };
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    struct RecordingClient {
        inner: FakeClient,
        last: Mutex<Option<Vec<ChatMessage>>>,
    }

    impl RecordingClient {
        fn new(inner: FakeClient) -> Self {
            Self {
                inner,
                last: Mutex::new(None),
            }
        }

        fn last_messages(&self) -> Vec<ChatMessage> {
            self.last
                .lock()
                .expect("recording client poisoned")
                .clone()
                .unwrap_or_default()
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
        ) -> Result<(), LlmIpcError> {
            *self.last.lock().expect("recording client poisoned") = Some(request.messages.clone());
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
        ) -> Result<(), LlmIpcError> {
            if let Some(tx) = self.started.lock().expect("slow client poisoned").take() {
                let _ = tx.send(());
            }
            std::thread::sleep(self.delay);
            on_token("ok");
            Ok(())
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

        let first = session.send(&db, &llm, &sink, "hello", None).unwrap();
        assert_eq!(first.text, "ok");
        assert_eq!(sink.tokens(), ["ok"]);
        assert_eq!(
            recorder.last_messages(),
            [ChatMessage {
                role: "user".into(),
                content: "hello".into(),
            }]
        );

        session.send(&db, &llm, &sink, "again", None).unwrap();
        assert_eq!(
            recorder.last_messages(),
            [
                ChatMessage {
                    role: "user".into(),
                    content: "hello".into(),
                },
                ChatMessage {
                    role: "assistant".into(),
                    content: "ok".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: "again".into(),
                },
            ]
        );

        session.clear();
        assert!(session.turns().is_empty());
        session.send(&db, &llm, &sink, "fresh", None).unwrap();
        assert_eq!(
            recorder.last_messages(),
            [ChatMessage {
                role: "user".into(),
                content: "fresh".into(),
            }]
        );
    }

    #[test]
    fn note_id_present_includes_body_missing_does_not_error() {
        let (db, llm, session, recorder) = harness(FakeClient::default());
        let sink = CollectingSink::default();
        let id = insert_note(&db, "Pricing v2", "Three tiers, usage-based add-ons — café");

        session
            .send(&db, &llm, &sink, "Please proof-read this", Some(&id))
            .unwrap();
        let sent = recorder.last_messages();
        assert_eq!(sent[0].role, "system");
        assert!(sent[0].content.contains("Pricing v2"));
        assert!(sent[0].content.contains("usage-based add-ons — café"));
        assert_eq!(sent[1].role, "user");
        assert_eq!(sent[1].content, "Please proof-read this");

        session.clear();
        session
            .send(&db, &llm, &sink, "hello", Some("missing-note"))
            .unwrap();
        assert_eq!(
            recorder.last_messages(),
            [ChatMessage {
                role: "user".into(),
                content: "hello".into(),
            }]
        );

        session.clear();
        session.send(&db, &llm, &sink, "no note", None).unwrap();
        assert_eq!(recorder.last_messages()[0].role, "user");
        session
            .send(&db, &llm, &sink, "blank id", Some("   "))
            .unwrap();
        assert!(recorder
            .last_messages()
            .iter()
            .all(|message| message.role != "system"));
    }

    #[test]
    fn empty_message_is_invalid_and_does_not_touch_history() {
        let (db, llm, session, recorder) = harness(FakeClient::default());
        let sink = CollectingSink::default();
        let err = session.send(&db, &llm, &sink, "   ", None).unwrap_err();
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
        let err = session.send(&db, &llm, &sink, "hello", None).unwrap_err();
        assert_eq!(err.code, "unreachable");
        assert_eq!(sink.errors()[0].code, "unreachable");
        assert_eq!(
            session.turns(),
            [ChatMessage {
                role: "user".into(),
                content: "hello".into(),
            }]
        );
    }

    #[test]
    fn assistant_shortcut_is_option_command_a() {
        assert_eq!(TOGGLE_ACCELERATOR, "Alt+CmdOrCtrl+A");
        assert_eq!(TOGGLE_EVENT, "agent://toggle");
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

        std::thread::scope(|scope| {
            let send = scope.spawn(|| session.send(&db, &llm, &sink, "hello", None));
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
}
