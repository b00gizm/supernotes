//! Trait-backed OpenAI-compatible chat completions (streaming).

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::LlmIpcError;

pub const TEST_PROMPT: &str = "Reply with the single word pong.";
/// Reasoning models (e.g. deepseek-v4-flash) spend a small `max_tokens` on
/// `reasoning_content` and never emit `content` (`finish_reason: length`).
pub const TEST_MAX_TOKENS: u32 = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub function: ToolCallFunction,
}

impl ToolCall {
    pub fn function(
        id: impl Into<String>,
        name: impl Into<String>,
        arguments: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            type_: "function".into(),
            function: ToolCallFunction {
                name: name.into(),
                arguments: arguments.into(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatToolFunction {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatTool {
    #[serde(rename = "type")]
    pub type_: String,
    pub function: ChatToolFunction,
}

impl ChatTool {
    pub fn function(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            type_: "function".into(),
            function: ChatToolFunction {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChatOutcome {
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ChatMessage {
    pub role: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            ..Self::default()
        }
    }
}

#[derive(Clone)]
pub struct ChatRequest {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: Option<u32>,
    pub tools: Option<Vec<ChatTool>>,
}

impl std::fmt::Debug for ChatRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatRequest")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("has_api_key", &self.api_key.is_some())
            .field("messages", &self.messages)
            .field("max_tokens", &self.max_tokens)
            .field(
                "has_tools",
                &self.tools.as_ref().is_some_and(|t| !t.is_empty()),
            )
            .finish()
    }
}

pub trait LlmClient: Send + Sync {
    fn id(&self) -> &'static str;
    fn stream_chat(
        &self,
        request: &ChatRequest,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<ChatOutcome, LlmIpcError>;
}

/// One scripted `stream_chat` response for `FakeClient`.
#[derive(Debug, Clone, Default)]
pub struct FakeChatTurn {
    pub tokens: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
}

#[cfg(test)]
impl FakeChatTurn {
    pub fn tokens(tokens: &[&str]) -> Self {
        Self {
            tokens: tokens.iter().map(|t| (*t).to_string()).collect(),
            tool_calls: Vec::new(),
        }
    }

    pub fn tool_calls(calls: Vec<ToolCall>) -> Self {
        Self {
            tokens: Vec::new(),
            tool_calls: calls,
        }
    }
}

/// Deterministic stand-in so CI / `SUPERNOTES_FAKE_LLM` never need a live API.
#[derive(Debug)]
pub struct FakeClient {
    pub tokens: Mutex<Vec<String>>,
    pub error: Mutex<Option<LlmIpcError>>,
    turns: Mutex<VecDeque<FakeChatTurn>>,
}

impl Default for FakeClient {
    fn default() -> Self {
        Self {
            tokens: Mutex::new(vec!["p".into(), "ong".into()]),
            error: Mutex::new(None),
            turns: Mutex::new(VecDeque::new()),
        }
    }
}

#[cfg(test)]
impl FakeClient {
    pub fn failing(error: LlmIpcError) -> Self {
        Self {
            tokens: Mutex::new(Vec::new()),
            error: Mutex::new(Some(error)),
            turns: Mutex::new(VecDeque::new()),
        }
    }

    pub fn scripted(tokens: &[&str]) -> Self {
        Self {
            tokens: Mutex::new(tokens.iter().map(|t| (*t).to_string()).collect()),
            error: Mutex::new(None),
            turns: Mutex::new(VecDeque::new()),
        }
    }

    pub fn scripted_turns(turns: Vec<FakeChatTurn>) -> Self {
        Self {
            tokens: Mutex::new(Vec::new()),
            error: Mutex::new(None),
            turns: Mutex::new(turns.into()),
        }
    }
}

impl LlmClient for FakeClient {
    fn id(&self) -> &'static str {
        "fake"
    }

    fn stream_chat(
        &self,
        _request: &ChatRequest,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<ChatOutcome, LlmIpcError> {
        if let Some(error) = self.error.lock().expect("fake llm error poisoned").clone() {
            return Err(error);
        }
        if let Some(turn) = self
            .turns
            .lock()
            .expect("fake llm turns poisoned")
            .pop_front()
        {
            for token in &turn.tokens {
                on_token(token);
            }
            return Ok(ChatOutcome {
                tool_calls: turn.tool_calls,
            });
        }
        for token in self.tokens.lock().expect("fake llm tokens poisoned").iter() {
            on_token(token);
        }
        Ok(ChatOutcome::default())
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleClient {
    timeout: Duration,
}

impl Default for OpenAiCompatibleClient {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(30),
        }
    }
}

impl OpenAiCompatibleClient {
    #[cfg(test)]
    pub fn with_timeout(timeout: Duration) -> Self {
        Self { timeout }
    }
}

impl LlmClient for OpenAiCompatibleClient {
    fn id(&self) -> &'static str {
        "openai_compatible"
    }

    fn stream_chat(
        &self,
        request: &ChatRequest,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<ChatOutcome, LlmIpcError> {
        let url = chat_completions_url(&request.base_url);
        let mut body = json!({
            "model": request.model,
            "messages": request.messages,
            "stream": true,
        });
        if let Some(max_tokens) = request.max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }
        if let Some(tools) = &request.tools {
            if !tools.is_empty() {
                body["tools"] = json!(tools);
            }
        }

        // Match curl-ish defaults: some gateways 401 empty bodies on `User-Agent: ureq`.
        let mut builder = ureq::post(&url)
            .set("Content-Type", "application/json")
            .set("Accept", "*/*")
            .set("User-Agent", "Supernotes")
            .timeout(self.timeout);
        if let Some(key) = request
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
        {
            builder = builder.set("Authorization", &format!("Bearer {key}"));
        }

        let response = match builder.send_json(body) {
            Ok(response) => response,
            Err(ureq::Error::Status(code, response)) => {
                return Err(map_http_status(code, response, request.api_key.as_deref()));
            }
            Err(ureq::Error::Transport(err)) => {
                return Err(LlmIpcError::unreachable(transport_message(&err)));
            }
        };

        let reader = BufReader::new(response.into_reader());
        consume_sse(reader, on_token)
    }
}

pub fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    format!("{base}/chat/completions")
}

pub fn consume_sse<R: BufRead>(
    reader: R,
    on_token: &mut dyn FnMut(&str),
) -> Result<ChatOutcome, LlmIpcError> {
    let mut acc = ToolCallAcc::default();
    for line in reader.lines() {
        let line =
            line.map_err(|err| LlmIpcError::unreachable(format!("Lost the LLM stream ({err}).")))?;
        match sse_token(&line, &mut acc) {
            SseLine::Done => break,
            SseLine::Token(text) => on_token(&text),
            SseLine::Ignore => {}
        }
    }
    Ok(ChatOutcome {
        tool_calls: acc.finish(),
    })
}

enum SseLine {
    Token(String),
    Done,
    Ignore,
}

#[derive(Default)]
struct ToolCallAcc {
    calls: BTreeMap<usize, PartialToolCall>,
}

#[derive(Default)]
struct PartialToolCall {
    id: String,
    name: String,
    arguments: String,
}

impl ToolCallAcc {
    fn apply_value(&mut self, value: &serde_json::Value) {
        apply_tool_calls_array(self, value.pointer("/choices/0/delta/tool_calls"));
        apply_tool_calls_array(self, value.pointer("/choices/0/message/tool_calls"));
    }

    fn finish(self) -> Vec<ToolCall> {
        self.calls
            .into_iter()
            .filter(|(_, part)| !part.name.is_empty())
            .map(|(index, part)| {
                let id = if part.id.is_empty() {
                    format!("call_{index}")
                } else {
                    part.id
                };
                ToolCall::function(id, part.name, part.arguments)
            })
            .collect()
    }
}

fn apply_tool_calls_array(acc: &mut ToolCallAcc, array: Option<&serde_json::Value>) {
    let Some(items) = array.and_then(|v| v.as_array()) else {
        return;
    };
    for (fallback_index, item) in items.iter().enumerate() {
        let index = item
            .get("index")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(fallback_index);
        let part = acc.calls.entry(index).or_default();
        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
            if !id.is_empty() {
                part.id = id.to_string();
            }
        }
        if let Some(name) = item.pointer("/function/name").and_then(|v| v.as_str()) {
            if !name.is_empty() {
                part.name = name.to_string();
            }
        }
        if let Some(args) = item.pointer("/function/arguments").and_then(|v| v.as_str()) {
            part.arguments.push_str(args);
        }
    }
}

fn sse_token(line: &str, acc: &mut ToolCallAcc) -> SseLine {
    let line = line.trim();
    let Some(data) = line.strip_prefix("data:") else {
        return SseLine::Ignore;
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return if data == "[DONE]" {
            SseLine::Done
        } else {
            SseLine::Ignore
        };
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return SseLine::Ignore;
    };
    acc.apply_value(&value);
    match sse_delta_text(&value) {
        Some(text) => SseLine::Token(text),
        None => SseLine::Ignore,
    }
}

fn sse_delta_text(value: &serde_json::Value) -> Option<String> {
    let text = value
        .pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
        .filter(|text| !text.is_empty())?;
    Some(text.to_string())
}

fn map_http_status(code: u16, response: ureq::Response, api_key: Option<&str>) -> LlmIpcError {
    let body = read_body(response);
    let message = extract_error_message(&body).map(|text| redact_secret(&text, api_key));
    match code {
        401 | 403 => map_auth_status(&body, message.as_deref()),
        429 => LlmIpcError::rate_limited(),
        _ => LlmIpcError::new(
            "request_failed",
            message.unwrap_or_else(|| format!("The LLM server returned HTTP {code}.")),
        ),
    }
}

/// 401/403 is not always a bad key (OpenCode: valid key, upstream blocked).
fn map_auth_status(body: &str, message: Option<&str>) -> LlmIpcError {
    match message {
        None => LlmIpcError::invalid_key(),
        Some(text) if is_credential_failure(body, text) => LlmIpcError::new("invalid_key", text),
        Some(text) => LlmIpcError::new("request_failed", text),
    }
}

fn extract_error_message(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(text) = value
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .or_else(|| value.pointer("/message").and_then(|v| v.as_str()))
            .or_else(|| value.get("error").and_then(|v| v.as_str()))
        {
            let text = text.trim();
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn is_credential_failure(body: &str, message: &str) -> bool {
    let hay = format!("{body}\n{message}").to_ascii_lowercase();
    const NEEDLES: &[&str] = &[
        "invalid_api_key",
        "incorrect api key",
        "invalid api key",
        "invalid api-key",
        "wrong api key",
        "unknown api key",
        "api key is invalid",
        "api key was rejected",
        "no api key",
        "missing api key",
        "api key required",
        "incorrect api_key",
    ];
    NEEDLES.iter().any(|needle| hay.contains(needle))
}

fn redact_secret(message: &str, api_key: Option<&str>) -> String {
    let Some(key) = api_key.map(str::trim).filter(|key| key.len() >= 8) else {
        return message.to_string();
    };
    if message.contains(key) {
        message.replace(key, "***")
    } else {
        message.to_string()
    }
}

fn read_body(response: ureq::Response) -> String {
    let mut buf = String::new();
    let mut reader = response.into_reader().take(4096);
    let _ = reader.read_to_string(&mut buf);
    buf
}

fn transport_message(err: &ureq::Transport) -> String {
    let kind = format!("{err}");
    if kind.contains("timed out") || kind.contains("timeout") {
        return "The LLM server timed out. Check the base URL and try again.".into();
    }
    "Could not reach the LLM server. Check the base URL and that the server is running.".into()
}

#[cfg(test)]
fn authorization_header(request: &str) -> Option<String> {
    request.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("authorization")
            .then(|| value.trim().to_string())
    })
}

/// OpenCode-style gate: missing/wrong Bearer → 401 `Missing API key.`; match → SSE.
/// Reports the captured `Authorization` value (`None` if the header was absent).
#[cfg(test)]
pub(crate) fn serve_bearer_gate(
    expected_key: &str,
    sse_body: &str,
) -> (String, std::sync::mpsc::Receiver<Option<String>>) {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let expected = format!("Bearer {expected_key}");
    let sse_body = sse_body.to_string();
    let (auth_tx, auth_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let auth = authorization_header(&req);
        let authorized = auth.as_deref() == Some(expected.as_str());
        let _ = auth_tx.send(auth);
        let response = if authorized {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{sse_body}"
            )
        } else {
            let body = r#"{"error":{"message":"Missing API key."}}"#;
            format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
        };
        let _ = stream.write_all(response.as_bytes());
    });
    (format!("http://{addr}/v1"), auth_rx)
}

#[cfg(test)]
fn read_http_request(stream: &mut impl std::io::Read) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    // ponytail: one-shot HTTP/1.1; loop until headers + Content-Length or EOF.
    for _ in 0..32 {
        let n = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
        let Some(split) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
            continue;
        };
        let header_end = split + 4;
        let headers = String::from_utf8_lossy(&buf[..header_end]);
        let want = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())?
        });
        match want {
            Some(want) if buf.len() >= header_end + want => break,
            Some(_) => continue,
            None => break,
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

#[cfg(test)]
pub(crate) fn serve_capture_body(sse_body: &str) -> (String, std::sync::mpsc::Receiver<String>) {
    use std::io::Write;
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let sse_body = sse_body.to_string();
    let (body_tx, body_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let req = read_http_request(&mut stream);
        let body = req.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        let _ = body_tx.send(body);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{sse_body}"
        );
        let _ = stream.write_all(response.as_bytes());
    });
    (format!("http://{addr}/v1"), body_rx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn chat_completions_url_trims_slash() {
        assert_eq!(
            chat_completions_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://127.0.0.1:11434/v1"),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
    }

    #[test]
    fn request_debug_omits_api_key() {
        let req = ChatRequest {
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            api_key: Some("sk-secret-should-never-print".into()),
            messages: vec![ChatMessage::new("user", "hi")],
            max_tokens: Some(8),
            tools: None,
        };
        let debug = format!("{req:?}");
        assert!(!debug.contains("sk-secret"));
        assert!(debug.contains("has_api_key: true"));
        assert!(debug.contains("has_tools: false"));
    }

    #[test]
    fn consume_sse_emits_tokens_then_stops_at_done() {
        let body = "\
data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\
data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\
data: [DONE]\n\
data: {\"choices\":[{\"delta\":{\"content\":\"nope\"}}]}\n";
        let mut seen = Vec::new();
        consume_sse(body.as_bytes(), &mut |token| seen.push(token.to_string())).unwrap();
        assert_eq!(seen, ["Hel", "lo"]);
    }

    #[test]
    fn consume_sse_ignores_reasoning_only_deltas() {
        let body = "\
data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning_content\":\"We need to reply with single word \\\"\"}}]}\n\
data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"pong\"}}]}\n\
data: [DONE]\n";
        let mut seen = Vec::new();
        consume_sse(body.as_bytes(), &mut |token| seen.push(token.to_string())).unwrap();
        assert!(seen.is_empty());
    }

    #[test]
    fn consume_sse_emits_content_only_when_both_fields_present() {
        let body = "\
data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning_content\":\"think\"}}]}\n\
data: {\"choices\":[{\"delta\":{\"content\":\"p\",\"reasoning_content\":\"more think\"}}]}\n\
data: {\"choices\":[{\"delta\":{\"content\":\"ong\"}}]}\n\
data: [DONE]\n";
        let mut seen = Vec::new();
        consume_sse(body.as_bytes(), &mut |token| seen.push(token.to_string())).unwrap();
        assert_eq!(seen, ["p", "ong"]);
    }

    #[test]
    fn fake_client_streams_tokens_incrementally() {
        let client = FakeClient::scripted(&["p", "ong"]);
        let mut seen = Vec::new();
        client
            .stream_chat(&dummy_request(), &mut |token| seen.push(token.to_string()))
            .unwrap();
        assert_eq!(seen, ["p", "ong"]);
    }

    #[test]
    fn consume_sse_accumulates_streamed_tool_calls() {
        let body = "\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"search_notes\",\"arguments\":\"\"}}]}}]}\n\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"query\\\":\"}}]}}]}\n\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"Q3\\\"}\"}}]}}]}\n\
data: [DONE]\n";
        let mut seen = Vec::new();
        let outcome =
            consume_sse(body.as_bytes(), &mut |token| seen.push(token.to_string())).unwrap();
        assert!(seen.is_empty());
        assert_eq!(
            outcome.tool_calls,
            [ToolCall::function(
                "call_1",
                "search_notes",
                r#"{"query":"Q3"}"#
            )]
        );
    }

    #[test]
    fn consume_sse_reads_message_tool_calls() {
        let body = "\
data: {\"choices\":[{\"message\":{\"role\":\"assistant\",\"tool_calls\":[{\"id\":\"call_9\",\"type\":\"function\",\"function\":{\"name\":\"get_note\",\"arguments\":\"{\\\"id_or_title\\\":\\\"Mike\\\"}\"}}]}}]}\n\
data: [DONE]\n";
        let outcome = consume_sse(body.as_bytes(), &mut |_| {}).unwrap();
        assert_eq!(
            outcome.tool_calls,
            [ToolCall::function(
                "call_9",
                "get_note",
                r#"{"id_or_title":"Mike"}"#
            )]
        );
    }

    #[test]
    fn fake_client_scripts_tool_calls_then_tokens() {
        let client = FakeClient::scripted_turns(vec![
            FakeChatTurn::tool_calls(vec![ToolCall::function(
                "call_1",
                "search_notes",
                r#"{"query":"Q3"}"#,
            )]),
            FakeChatTurn::tokens(&["done"]),
        ]);
        let first = client.stream_chat(&dummy_request(), &mut |_| {}).unwrap();
        assert_eq!(first.tool_calls[0].function.name, "search_notes");
        let mut seen = Vec::new();
        let second = client
            .stream_chat(&dummy_request(), &mut |token| seen.push(token.to_string()))
            .unwrap();
        assert!(second.tool_calls.is_empty());
        assert_eq!(seen, ["done"]);
    }

    #[test]
    fn openai_client_sends_tools_in_request_body() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, body_rx) = serve_capture_body(sse);
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_secs(2));
        let mut req = dummy_request();
        req.base_url = url;
        req.tools = Some(vec![ChatTool::function(
            "search_notes",
            "Search notes by title",
            json!({"type":"object","properties":{"query":{"type":"string"}}}),
        )]);
        client.stream_chat(&req, &mut |_| {}).unwrap();
        let body = body_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["tools"][0]["function"]["name"], "search_notes");
        assert_eq!(json["stream"], true);
    }

    #[test]
    fn fake_client_maps_scripted_failure() {
        let client = FakeClient::failing(LlmIpcError::invalid_key());
        let err = client
            .stream_chat(&dummy_request(), &mut |_| {})
            .unwrap_err();
        assert_eq!(err.code, "invalid_key");
    }

    #[test]
    fn openai_client_streams_sse_from_local_server() {
        let url = serve_once(
            200,
            "text/event-stream",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
             data: [DONE]\n\n",
        );
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_secs(2));
        let mut req = dummy_request();
        req.base_url = url;
        req.api_key = Some("sk-test".into());
        let mut seen = Vec::new();
        client
            .stream_chat(&req, &mut |token| seen.push(token.to_string()))
            .unwrap();
        assert_eq!(seen, ["Hel", "lo"]);
    }

    #[test]
    fn openai_client_sends_bearer_when_key_is_set() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, auth_rx) = serve_bearer_gate("sk-test-key", sse);
        let mut seen = Vec::new();
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_secs(2));
        let mut req = dummy_request();
        req.base_url = url;
        req.api_key = Some("sk-test-key".into());
        client
            .stream_chat(&req, &mut |token| seen.push(token.to_string()))
            .unwrap();
        assert_eq!(
            auth_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            Some("Bearer sk-test-key".into())
        );
        assert_eq!(seen, ["pong"]);
    }

    #[test]
    fn openai_client_omits_authorization_without_key() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"pong\"}}]}\n\n\
             data: [DONE]\n\n";
        let (url, auth_rx) = serve_bearer_gate("sk-test-key", sse);
        let err = request_against(&url, None).unwrap_err();
        assert_eq!(auth_rx.recv_timeout(Duration::from_secs(2)).unwrap(), None);
        assert_eq!(err.code, "invalid_key");
        assert!(
            err.message.contains("Missing API key"),
            "got {}",
            err.message
        );
        assert_ne!(err.message, LlmIpcError::invalid_key().message);
    }

    #[test]
    fn openai_client_emits_content_incrementally_after_reasoning() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (resume_tx, resume_rx) = mpsc::channel::<()>();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let head = "\
HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Connection: close\r\n\
\r\n\
data: {\"choices\":[{\"delta\":{\"content\":\"\",\"reasoning_content\":\"We need to reply\"}}]}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"p\"}}]}\n\n";
            stream.write_all(head.as_bytes()).unwrap();
            stream.flush().unwrap();
            let _ = started_tx.send(());
            let _ = resume_rx.recv_timeout(Duration::from_secs(2));
            stream
                .write_all(
                    b"data: {\"choices\":[{\"delta\":{\"content\":\"ong\"}}]}\n\ndata: [DONE]\n\n",
                )
                .unwrap();
        });

        let (token_tx, token_rx) = mpsc::channel::<String>();
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_secs(2));
        let mut req = dummy_request();
        req.base_url = format!("http://{addr}/v1");
        let handle = thread::spawn(move || {
            client.stream_chat(&req, &mut |token| {
                let _ = token_tx.send(token.to_string());
            })
        });

        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let first = token_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(first, "p");
        resume_tx.send(()).unwrap();
        handle.join().unwrap().unwrap();
        assert_eq!(
            token_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            "ong"
        );
    }

    #[test]
    fn extract_error_message_reads_openai_and_opencode_shapes() {
        assert_eq!(
            extract_error_message(
                r#"{"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}"#
            )
            .as_deref(),
            Some("Incorrect API key provided")
        );
        assert_eq!(
            extract_error_message(
                r#"{"type":"error","error":{"type":"AuthError","message":"Request blocked by upstream provider."}}"#
            )
            .as_deref(),
            Some("Request blocked by upstream provider.")
        );
        assert_eq!(extract_error_message("  "), None);
        assert_eq!(
            extract_error_message(r#"{"error":"nope"}"#).as_deref(),
            Some("nope")
        );
    }

    #[test]
    fn auth_status_empty_or_credential_is_invalid_key() {
        let empty = map_auth_status("", None);
        assert_eq!(empty.code, "invalid_key");
        assert!(empty.message.contains("API key was rejected"));

        let classic = map_auth_status(
            r#"{"error":{"code":"invalid_api_key","message":"Incorrect API key provided"}}"#,
            Some("Incorrect API key provided"),
        );
        assert_eq!(classic.code, "invalid_key");
        assert_eq!(classic.message, "Incorrect API key provided");
    }

    #[test]
    fn auth_status_upstream_block_is_not_invalid_key() {
        let err = map_auth_status(
            r#"{"type":"error","error":{"type":"AuthError","message":"Request blocked by upstream provider."}}"#,
            Some("Request blocked by upstream provider."),
        );
        assert_eq!(err.code, "request_failed");
        assert_eq!(err.message, "Request blocked by upstream provider.");
    }

    #[test]
    fn openai_client_maps_empty_401_to_invalid_key() {
        let url = serve_once(401, "application/json", "");
        let err = request_against(&url, Some("sk-test-key")).unwrap_err();
        assert_eq!(err.code, "invalid_key");
        assert!(err.message.contains("API key was rejected"));
        assert!(!format!("{err:?}").contains("sk-test-key"));
    }

    #[test]
    fn openai_client_maps_classic_invalid_key_401() {
        let url = serve_once(
            401,
            "application/json",
            r#"{"error":{"message":"Incorrect API key provided: sk-test-key","code":"invalid_api_key"}}"#,
        );
        let err = request_against(&url, Some("sk-test-key")).unwrap_err();
        assert_eq!(err.code, "invalid_key");
        assert!(err.message.contains("Incorrect API key provided"));
        assert!(!err.message.contains("sk-test-key"));
        assert!(!format!("{err:?}").contains("sk-test-key"));
    }

    #[test]
    fn openai_client_maps_401_with_upstream_body_to_request_failed() {
        let url = serve_once(
            401,
            "application/json",
            r#"{"type":"error","error":{"type":"AuthError","message":"Request blocked by upstream provider."}}"#,
        );
        let err = request_against(&url, Some("sk-test-key")).unwrap_err();
        assert_eq!(err.code, "request_failed");
        assert_eq!(err.message, "Request blocked by upstream provider.");
        assert!(!err.message.contains("sk-"));
    }

    #[test]
    fn openai_client_maps_429_to_rate_limited() {
        let url = serve_once(429, "application/json", "{\"error\":\"slow\"}");
        let err = request_against(&url, None).unwrap_err();
        assert_eq!(err.code, "rate_limited");
    }

    #[test]
    fn openai_client_maps_refused_port_to_unreachable() {
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_millis(200));
        let mut req = dummy_request();
        req.base_url = "http://127.0.0.1:1/v1".into();
        let err = client.stream_chat(&req, &mut |_| {}).unwrap_err();
        assert_eq!(err.code, "unreachable");
    }

    #[test]
    fn openai_client_emits_first_token_before_stream_ends() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (resume_tx, resume_rx) = mpsc::channel::<()>();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let head = "\
HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Connection: close\r\n\
\r\n\
data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n";
            stream.write_all(head.as_bytes()).unwrap();
            stream.flush().unwrap();
            let _ = started_tx.send(());
            let _ = resume_rx.recv_timeout(Duration::from_secs(2));
            stream
                .write_all(
                    b"data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n",
                )
                .unwrap();
        });

        let (token_tx, token_rx) = mpsc::channel::<String>();
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_secs(2));
        let mut req = dummy_request();
        req.base_url = format!("http://{addr}/v1");
        let handle = thread::spawn(move || {
            client.stream_chat(&req, &mut |token| {
                let _ = token_tx.send(token.to_string());
            })
        });

        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let first = token_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(first, "Hel");
        resume_tx.send(()).unwrap();
        handle.join().unwrap().unwrap();
        assert_eq!(token_rx.recv_timeout(Duration::from_secs(2)).unwrap(), "lo");
    }

    fn dummy_request() -> ChatRequest {
        ChatRequest {
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4o-mini".into(),
            api_key: None,
            messages: vec![ChatMessage::new("user", TEST_PROMPT)],
            max_tokens: Some(8),
            tools: None,
        }
    }

    fn request_against(base_url: &str, api_key: Option<&str>) -> Result<ChatOutcome, LlmIpcError> {
        let client = OpenAiCompatibleClient::with_timeout(Duration::from_secs(2));
        let mut req = dummy_request();
        req.base_url = base_url.to_string();
        req.api_key = api_key.map(str::to_string);
        client.stream_chat(&req, &mut |_| {})
    }

    fn serve_once(status: u16, content_type: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let content_type = content_type.to_string();
        let body = body.to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let reason = match status {
                200 => "OK",
                401 => "Unauthorized",
                429 => "Too Many Requests",
                _ => "Error",
            };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        format!("http://{addr}/v1")
    }
}
