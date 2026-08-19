//! OpenAI-compatible LLM client + settings (ENG-70).
//!
//! The API key lives in the OS keychain (`SecretStore`). SQLite stores only
//! `base_url` and `model`. `SUPERNOTES_FAKE_LLM=1` forces the in-memory
//! client + secret store (CI / Linux `tauri dev` without a live API).

mod client;
mod secrets;
mod settings;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::Db;

pub use client::{
    ChatMessage, ChatRequest, FakeClient, LlmClient, OpenAiCompatibleClient, TEST_MAX_TOKENS,
    TEST_PROMPT,
};
pub use secrets::{KeyringSecretStore, MemorySecretStore, SecretStore};

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
pub const DEFAULT_MODEL: &str = "gpt-4o-mini";

pub const TOKEN_EVENT: &str = "llm://token";
pub const DONE_EVENT: &str = "llm://done";
pub const ERROR_EVENT: &str = "llm://error";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmIpcError {
    pub code: String,
    pub message: String,
}

impl LlmIpcError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn unreachable(message: impl Into<String>) -> Self {
        Self::new("unreachable", message)
    }

    pub fn invalid_key() -> Self {
        Self::new(
            "invalid_key",
            "The API key was rejected. Check the key, or leave it empty for a local server that does not need one.",
        )
    }

    pub fn rate_limited() -> Self {
        Self::new(
            "rate_limited",
            "The LLM server rate-limited the request. Wait a moment and try again.",
        )
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }
}

impl std::fmt::Display for LlmIpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for LlmIpcError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmSettings {
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    pub engine_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaveLlmSettingsInput {
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamLlmChatInput {
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmChatResult {
    pub stream_id: String,
    pub text: String,
    pub engine_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmTokenEvent {
    pub stream_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmDoneEvent {
    pub stream_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmStreamError {
    pub stream_id: String,
    pub code: String,
    pub message: String,
}

pub trait EventSink: Send + Sync {
    fn emit_token(&self, event: &LlmTokenEvent);
    fn emit_done(&self, event: &LlmDoneEvent);
    fn emit_error(&self, event: &LlmStreamError);
}

impl EventSink for AppHandle {
    fn emit_token(&self, event: &LlmTokenEvent) {
        let _ = self.emit(TOKEN_EVENT, event);
    }
    fn emit_done(&self, event: &LlmDoneEvent) {
        let _ = self.emit(DONE_EVENT, event);
    }
    fn emit_error(&self, event: &LlmStreamError) {
        let _ = self.emit(ERROR_EVENT, event);
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct CollectingSink {
    tokens: std::sync::Mutex<Vec<String>>,
    errors: std::sync::Mutex<Vec<LlmStreamError>>,
}

#[cfg(test)]
impl CollectingSink {
    pub fn tokens(&self) -> Vec<String> {
        self.tokens.lock().expect("sink poisoned").clone()
    }

    pub fn errors(&self) -> Vec<LlmStreamError> {
        self.errors.lock().expect("sink poisoned").clone()
    }
}

#[cfg(test)]
impl EventSink for CollectingSink {
    fn emit_token(&self, event: &LlmTokenEvent) {
        self.tokens
            .lock()
            .expect("sink poisoned")
            .push(event.text.clone());
    }
    fn emit_done(&self, _event: &LlmDoneEvent) {}
    fn emit_error(&self, event: &LlmStreamError) {
        self.errors
            .lock()
            .expect("sink poisoned")
            .push(event.clone());
    }
}

pub fn use_fake_llm() -> bool {
    matches!(
        std::env::var("SUPERNOTES_FAKE_LLM").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

pub fn production_llm() -> Llm {
    if use_fake_llm() {
        Llm::new(
            Arc::new(FakeClient::default()),
            Arc::new(MemorySecretStore::default()),
        )
    } else {
        Llm::new(
            Arc::new(OpenAiCompatibleClient::default()),
            Arc::new(KeyringSecretStore::production()),
        )
    }
}

pub struct Llm {
    client: Arc<dyn LlmClient>,
    secrets: Arc<dyn SecretStore>,
}

impl Llm {
    pub fn new(client: Arc<dyn LlmClient>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { client, secrets }
    }

    pub fn settings(&self, db: &Db) -> Result<LlmSettings, LlmIpcError> {
        let has_api_key = self
            .secrets
            .get_api_key()?
            .is_some_and(|key| !key.trim().is_empty());
        let (base_url, model) = db
            .with_conn(settings::load_settings)
            .map_err(|err| LlmIpcError::new("request_failed", err.to_string()))?;
        Ok(LlmSettings {
            base_url,
            model,
            has_api_key,
            engine_id: self.client.id().to_string(),
        })
    }

    pub fn save_settings(
        &self,
        db: &Db,
        input: &SaveLlmSettingsInput,
    ) -> Result<LlmSettings, LlmIpcError> {
        let (base_url, model) = settings::validate_settings(&input.base_url, &input.model)?;
        db.with_conn(|conn| settings::save_settings(conn, &base_url, &model))
            .map_err(|err| LlmIpcError::new("request_failed", err.to_string()))?;
        self.settings(db)
    }

    pub fn set_api_key(&self, db: &Db, api_key: &str) -> Result<LlmSettings, LlmIpcError> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(LlmIpcError::invalid(
                "API key cannot be empty. Use clear if you want to remove it.",
            ));
        }
        self.secrets.set_api_key(api_key)?;
        match self.secrets.get_api_key()? {
            Some(got) if got == api_key => {}
            _ => {
                return Err(LlmIpcError::new(
                    "request_failed",
                    "Could not persist the API key in the OS keychain. Test would send no Authorization header.",
                ));
            }
        }
        self.settings(db)
    }

    pub fn clear_api_key(&self, db: &Db) -> Result<LlmSettings, LlmIpcError> {
        self.secrets.clear_api_key()?;
        self.settings(db)
    }

    pub fn test_connection(
        &self,
        db: &Db,
        sink: &dyn EventSink,
    ) -> Result<LlmChatResult, LlmIpcError> {
        self.stream(
            db,
            &[ChatMessage {
                role: "user".into(),
                content: TEST_PROMPT.into(),
            }],
            Some(TEST_MAX_TOKENS),
            sink,
        )
    }

    pub fn stream_chat(
        &self,
        db: &Db,
        messages: &[ChatMessage],
        sink: &dyn EventSink,
    ) -> Result<LlmChatResult, LlmIpcError> {
        if messages.is_empty() {
            return Err(LlmIpcError::invalid("messages cannot be empty"));
        }
        self.stream(db, messages, None, sink)
    }

    fn stream(
        &self,
        db: &Db,
        messages: &[ChatMessage],
        max_tokens: Option<u32>,
        sink: &dyn EventSink,
    ) -> Result<LlmChatResult, LlmIpcError> {
        let settings = self.settings(db)?;
        let api_key = self.secrets.get_api_key()?;
        let stream_id = Uuid::new_v4().to_string();
        let request = ChatRequest {
            base_url: settings.base_url,
            model: settings.model,
            api_key,
            messages: messages.to_vec(),
            max_tokens,
        };

        let mut assembled = String::new();
        let result = self.client.stream_chat(&request, &mut |token| {
            assembled.push_str(token);
            sink.emit_token(&LlmTokenEvent {
                stream_id: stream_id.clone(),
                text: token.to_string(),
            });
        });

        match result {
            Ok(()) => {
                sink.emit_done(&LlmDoneEvent {
                    stream_id: stream_id.clone(),
                    text: assembled.clone(),
                });
                Ok(LlmChatResult {
                    stream_id,
                    text: assembled,
                    engine_id: self.client.id().to_string(),
                })
            }
            Err(error) => {
                sink.emit_error(&LlmStreamError {
                    stream_id: stream_id.clone(),
                    code: error.code.clone(),
                    message: error.message.clone(),
                });
                Err(error)
            }
        }
    }
}

#[tauri::command]
pub fn get_llm_settings(
    db: State<'_, Db>,
    llm: State<'_, Llm>,
) -> Result<LlmSettings, LlmIpcError> {
    llm.settings(&db)
}

#[tauri::command]
pub fn save_llm_settings(
    db: State<'_, Db>,
    llm: State<'_, Llm>,
    input: SaveLlmSettingsInput,
) -> Result<LlmSettings, LlmIpcError> {
    llm.save_settings(&db, &input)
}

#[tauri::command]
pub fn set_llm_api_key(
    db: State<'_, Db>,
    llm: State<'_, Llm>,
    api_key: String,
) -> Result<LlmSettings, LlmIpcError> {
    llm.set_api_key(&db, &api_key)
}

#[tauri::command]
pub fn clear_llm_api_key(
    db: State<'_, Db>,
    llm: State<'_, Llm>,
) -> Result<LlmSettings, LlmIpcError> {
    llm.clear_api_key(&db)
}

#[tauri::command]
pub fn test_llm_connection(
    app: AppHandle,
    db: State<'_, Db>,
    llm: State<'_, Llm>,
) -> Result<LlmChatResult, LlmIpcError> {
    let sink: Arc<dyn EventSink> = Arc::new(app);
    llm.test_connection(&db, sink.as_ref())
}

#[tauri::command]
pub fn stream_llm_chat(
    app: AppHandle,
    db: State<'_, Db>,
    llm: State<'_, Llm>,
    input: StreamLlmChatInput,
) -> Result<LlmChatResult, LlmIpcError> {
    let sink: Arc<dyn EventSink> = Arc::new(app);
    llm.stream_chat(&db, &input.messages, sink.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::current_version;
    use rusqlite::Connection;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn service() -> (Db, Llm) {
        (
            Db::open_in_memory().unwrap(),
            Llm::new(
                Arc::new(FakeClient::default()),
                Arc::new(MemorySecretStore::default()),
            ),
        )
    }

    #[test]
    fn save_settings_args_are_snake_case_inside_input() {
        let input: SaveLlmSettingsInput =
            serde_json::from_str(r#"{"base_url":"http://127.0.0.1:11434/v1","model":"llama3.2"}"#)
                .unwrap();
        assert_eq!(input.base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(input.model, "llama3.2");
    }

    #[test]
    fn set_api_key_arg_is_plain_string_from_tauri() {
        // Tauri 2 sends `{ apiKey }` for the `api_key` parameter.
        let api_key: String = serde_json::from_value(serde_json::json!("sk-test")).unwrap();
        assert_eq!(api_key, "sk-test");
    }

    #[test]
    fn persist_base_url_and_model_not_the_key() {
        let (db, llm) = service();
        let saved = llm
            .save_settings(
                &db,
                &SaveLlmSettingsInput {
                    base_url: "http://127.0.0.1:11434/v1".into(),
                    model: "llama3.2".into(),
                },
            )
            .unwrap();
        assert_eq!(saved.base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(saved.model, "llama3.2");
        assert!(!saved.has_api_key);
        assert_eq!(saved.engine_id, "fake");

        llm.set_api_key(&db, "sk-secret-xyz").unwrap();
        let loaded = llm.settings(&db).unwrap();
        assert!(loaded.has_api_key);
        assert_eq!(loaded.base_url, "http://127.0.0.1:11434/v1");

        let json = serde_json::to_string(&loaded).unwrap();
        assert!(!json.contains("sk-secret"));
        assert!(!json.contains("\"api_key\""));
    }

    #[test]
    fn set_and_clear_key_via_secret_store() {
        let (db, llm) = service();
        assert!(!llm.settings(&db).unwrap().has_api_key);
        llm.set_api_key(&db, "  sk-test  ").unwrap();
        assert!(llm.settings(&db).unwrap().has_api_key);
        llm.clear_api_key(&db).unwrap();
        assert!(!llm.settings(&db).unwrap().has_api_key);
    }

    #[test]
    fn test_connection_streams_tokens_incrementally() {
        let (db, llm) = service();
        let sink = CollectingSink::default();
        let result = llm.test_connection(&db, &sink).unwrap();
        assert_eq!(sink.tokens(), ["p", "ong"]);
        assert_eq!(result.text, "pong");
        assert_eq!(result.engine_id, "fake");
        assert!(!result.stream_id.is_empty());
    }

    #[test]
    fn test_connection_requests_content_budget_not_eight() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning_content\":\"We need to reply\"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, body_rx) = client::serve_capture_body(sse);
        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(
            Arc::new(OpenAiCompatibleClient::with_timeout(
                std::time::Duration::from_secs(2),
            )),
            Arc::new(MemorySecretStore::default()),
        );
        llm.save_settings(
            &db,
            &SaveLlmSettingsInput {
                base_url: url,
                model: "gpt-4o-mini".into(),
            },
        )
        .unwrap();
        let sink = CollectingSink::default();
        let result = llm.test_connection(&db, &sink).unwrap();
        let body = body_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["max_tokens"], TEST_MAX_TOKENS);
        assert_ne!(json["max_tokens"], 8);
        assert_eq!(sink.tokens(), ["pong"]);
        assert_eq!(result.text, "pong");
    }

    #[test]
    fn test_connection_failure_maps_error_code() {
        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(
            Arc::new(FakeClient::failing(LlmIpcError::unreachable(
                "Could not reach the LLM server.",
            ))),
            Arc::new(MemorySecretStore::default()),
        );
        let sink = CollectingSink::default();
        let err = llm.test_connection(&db, &sink).unwrap_err();
        assert_eq!(err.code, "unreachable");
        assert_eq!(sink.errors()[0].code, "unreachable");
        assert!(sink.tokens().is_empty());
    }

    #[test]
    fn key_is_never_written_to_sqlite() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("supernotes-llm-key-{nanos}"));
        let secret = "sk-super-secret-test-key-xyz";
        let db = Db::open(&dir).unwrap();
        let llm = Llm::new(
            Arc::new(FakeClient::default()),
            Arc::new(MemorySecretStore::default()),
        );
        llm.save_settings(
            &db,
            &SaveLlmSettingsInput {
                base_url: "https://api.openai.com/v1".into(),
                model: "gpt-4o-mini".into(),
            },
        )
        .unwrap();
        llm.set_api_key(&db, secret).unwrap();

        let path = db.path().to_path_buf();
        drop(db);

        let bytes = fs::read(&path).unwrap();
        assert!(
            !bytes.windows(secret.len()).any(|w| w == secret.as_bytes()),
            "API key leaked into the sqlite file"
        );

        let conn = Connection::open(&path).unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for table in tables {
            let mut stmt = conn.prepare(&format!("SELECT * FROM \"{table}\"")).unwrap();
            let cols = stmt.column_count();
            let mut rows = stmt.query([]).unwrap();
            while let Some(row) = rows.next().unwrap() {
                for i in 0..cols {
                    let value: Result<String, _> = row.get(i);
                    if let Ok(value) = value {
                        assert!(!value.contains(secret), "key found in {table} column {i}");
                    }
                }
            }
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn error_payload_serializes_for_ipc() {
        let err = LlmIpcError::rate_limited();
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "rate_limited");
        assert!(json["message"].as_str().unwrap().contains("rate-limited"));
    }

    #[test]
    fn test_connection_sends_saved_bearer_to_auth_gate() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, auth_rx) = client::serve_bearer_gate("sk-test-key", sse);
        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(
            Arc::new(OpenAiCompatibleClient::with_timeout(
                std::time::Duration::from_secs(2),
            )),
            Arc::new(MemorySecretStore::default()),
        );
        llm.save_settings(
            &db,
            &SaveLlmSettingsInput {
                base_url: url,
                model: "gpt-4o-mini".into(),
            },
        )
        .unwrap();
        llm.set_api_key(&db, "sk-test-key").unwrap();

        let sink = CollectingSink::default();
        let result = llm.test_connection(&db, &sink).unwrap();
        assert_eq!(
            auth_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            Some("Bearer sk-test-key".into())
        );
        assert_eq!(sink.tokens(), ["pong"]);
        assert_eq!(result.text, "pong");
        assert_eq!(result.engine_id, "openai_compatible");
    }

    #[test]
    fn set_api_key_fails_if_store_cannot_read_back() {
        struct LieStore;
        impl SecretStore for LieStore {
            fn set_api_key(&self, _key: &str) -> Result<(), LlmIpcError> {
                Ok(())
            }
            fn get_api_key(&self) -> Result<Option<String>, LlmIpcError> {
                Ok(None)
            }
            fn clear_api_key(&self) -> Result<(), LlmIpcError> {
                Ok(())
            }
        }

        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(Arc::new(FakeClient::default()), Arc::new(LieStore));
        let err = llm.set_api_key(&db, "sk-test-key").unwrap_err();
        assert_eq!(err.code, "request_failed");
        assert!(err.message.contains("keychain"));
        assert!(!llm.settings(&db).unwrap().has_api_key);
    }

    #[test]
    fn keychain_get_error_surfaces_before_test_without_a_key() {
        struct FailStore;
        impl SecretStore for FailStore {
            fn set_api_key(&self, _key: &str) -> Result<(), LlmIpcError> {
                Err(LlmIpcError::new(
                    "request_failed",
                    "Could not access the OS keychain (locked).",
                ))
            }
            fn get_api_key(&self) -> Result<Option<String>, LlmIpcError> {
                Err(LlmIpcError::new(
                    "request_failed",
                    "Could not access the OS keychain (locked).",
                ))
            }
            fn clear_api_key(&self) -> Result<(), LlmIpcError> {
                Ok(())
            }
        }

        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(
            Arc::new(OpenAiCompatibleClient::with_timeout(
                std::time::Duration::from_millis(200),
            )),
            Arc::new(FailStore),
        );
        let set_err = llm.set_api_key(&db, "sk-test-key").unwrap_err();
        assert_eq!(set_err.code, "request_failed");
        assert!(set_err.message.contains("keychain"));

        let sink = CollectingSink::default();
        let test_err = llm.test_connection(&db, &sink).unwrap_err();
        assert_eq!(test_err.code, "request_failed");
        assert!(test_err.message.contains("keychain"));
        assert!(sink.tokens().is_empty());
    }

    #[test]
    fn keyring_set_then_test_connection_sends_bearer() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store = KeyringSecretStore::for_test(
            "cloud.snowfire.supernotes.test",
            format!("llm_api_key_{nanos}"),
        );
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, auth_rx) = client::serve_bearer_gate("sk-test-key", sse);
        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(
            Arc::new(OpenAiCompatibleClient::with_timeout(
                std::time::Duration::from_secs(2),
            )),
            Arc::new(store),
        );
        llm.save_settings(
            &db,
            &SaveLlmSettingsInput {
                base_url: url,
                model: "gpt-4o-mini".into(),
            },
        )
        .unwrap();
        let saved = llm.set_api_key(&db, "sk-test-key").unwrap();
        assert!(saved.has_api_key);

        let sink = CollectingSink::default();
        let result = llm.test_connection(&db, &sink).unwrap();
        assert_eq!(
            auth_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            Some("Bearer sk-test-key".into())
        );
        assert_eq!(result.text, "pong");
        llm.clear_api_key(&db).unwrap();
    }

    #[test]
    fn test_connection_without_key_is_missing_api_key_not_canned_reject() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, auth_rx) = client::serve_bearer_gate("sk-test-key", sse);
        let db = Db::open_in_memory().unwrap();
        let llm = Llm::new(
            Arc::new(OpenAiCompatibleClient::with_timeout(
                std::time::Duration::from_secs(2),
            )),
            Arc::new(MemorySecretStore::default()),
        );
        llm.save_settings(
            &db,
            &SaveLlmSettingsInput {
                base_url: url,
                model: "gpt-4o-mini".into(),
            },
        )
        .unwrap();

        let sink = CollectingSink::default();
        let err = llm.test_connection(&db, &sink).unwrap_err();
        assert_eq!(
            auth_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            None
        );
        assert_eq!(err.code, "invalid_key");
        assert!(err.message.contains("Missing API key"));
        assert_ne!(err.message, LlmIpcError::invalid_key().message);
        assert_eq!(sink.errors()[0].code, "invalid_key");
    }

    #[test]
    fn migration_creates_settings_table_without_key_column() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.with_conn(current_version).unwrap(), 6);
        db.with_conn(|conn| {
            let cols: Vec<String> = conn
                .prepare("PRAGMA table_info(llm_settings)")
                .unwrap()
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert!(cols.contains(&"base_url".into()));
            assert!(cols.contains(&"model".into()));
            assert!(!cols
                .iter()
                .any(|c| c.contains("key") || c.contains("secret")));
            Ok(())
        })
        .unwrap();
    }
}
