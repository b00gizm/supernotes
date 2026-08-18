//! Trait-backed OpenAI-compatible chat completions (streaming).

use std::io::{BufRead, BufReader, Read};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::LlmIpcError;

pub const TEST_PROMPT: &str = "Reply with the single word pong.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone)]
pub struct ChatRequest {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: Option<u32>,
}

impl std::fmt::Debug for ChatRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatRequest")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("has_api_key", &self.api_key.is_some())
            .field("messages", &self.messages)
            .field("max_tokens", &self.max_tokens)
            .finish()
    }
}

pub trait LlmClient: Send + Sync {
    fn id(&self) -> &'static str;
    fn stream_chat(
        &self,
        request: &ChatRequest,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<(), LlmIpcError>;
}

/// Deterministic stand-in so CI / `SUPERNOTES_FAKE_LLM` never need a live API.
#[derive(Debug)]
pub struct FakeClient {
    pub tokens: Mutex<Vec<String>>,
    pub error: Mutex<Option<LlmIpcError>>,
}

impl Default for FakeClient {
    fn default() -> Self {
        Self {
            tokens: Mutex::new(vec!["p".into(), "ong".into()]),
            error: Mutex::new(None),
        }
    }
}

impl FakeClient {
    #[cfg(test)]
    pub fn failing(error: LlmIpcError) -> Self {
        Self {
            tokens: Mutex::new(Vec::new()),
            error: Mutex::new(Some(error)),
        }
    }

    #[cfg(test)]
    pub fn scripted(tokens: &[&str]) -> Self {
        Self {
            tokens: Mutex::new(tokens.iter().map(|t| (*t).to_string()).collect()),
            error: Mutex::new(None),
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
    ) -> Result<(), LlmIpcError> {
        if let Some(error) = self.error.lock().expect("fake llm error poisoned").clone() {
            return Err(error);
        }
        for token in self.tokens.lock().expect("fake llm tokens poisoned").iter() {
            on_token(token);
        }
        Ok(())
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
    ) -> Result<(), LlmIpcError> {
        let url = chat_completions_url(&request.base_url);
        let mut body = json!({
            "model": request.model,
            "messages": request.messages,
            "stream": true,
        });
        if let Some(max_tokens) = request.max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }

        let mut builder = ureq::post(&url)
            .set("Content-Type", "application/json")
            .set("Accept", "text/event-stream")
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
                return Err(map_http_status(code, response));
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
) -> Result<(), LlmIpcError> {
    for line in reader.lines() {
        let line =
            line.map_err(|err| LlmIpcError::unreachable(format!("Lost the LLM stream ({err}).")))?;
        match sse_token(&line) {
            SseLine::Done => return Ok(()),
            SseLine::Token(text) => on_token(&text),
            SseLine::Ignore => {}
        }
    }
    Ok(())
}

enum SseLine {
    Token(String),
    Done,
    Ignore,
}

fn sse_token(line: &str) -> SseLine {
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
    let Some(text) = value
        .pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
        .filter(|text| !text.is_empty())
    else {
        return SseLine::Ignore;
    };
    SseLine::Token(text.to_string())
}

fn map_http_status(code: u16, response: ureq::Response) -> LlmIpcError {
    let _ = read_body_discard(response);
    match code {
        401 | 403 => LlmIpcError::invalid_key(),
        429 => LlmIpcError::rate_limited(),
        _ => LlmIpcError::new(
            "request_failed",
            format!("The LLM server returned HTTP {code}."),
        ),
    }
}

fn read_body_discard(response: ureq::Response) {
    let mut buf = [0u8; 256];
    let mut reader = response.into_reader();
    let _ = reader.read(&mut buf);
}

fn transport_message(err: &ureq::Transport) -> String {
    let kind = format!("{err}");
    if kind.contains("timed out") || kind.contains("timeout") {
        return "The LLM server timed out. Check the base URL and try again.".into();
    }
    "Could not reach the LLM server. Check the base URL and that the server is running.".into()
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
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            }],
            max_tokens: Some(8),
        };
        let debug = format!("{req:?}");
        assert!(!debug.contains("sk-secret"));
        assert!(debug.contains("has_api_key: true"));
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
    fn fake_client_streams_tokens_incrementally() {
        let client = FakeClient::scripted(&["p", "ong"]);
        let mut seen = Vec::new();
        client
            .stream_chat(&dummy_request(), &mut |token| seen.push(token.to_string()))
            .unwrap();
        assert_eq!(seen, ["p", "ong"]);
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
    fn openai_client_maps_401_to_invalid_key() {
        let url = serve_once(401, "application/json", "{\"error\":\"nope\"}");
        let err = request_against(&url, Some("sk-bad")).unwrap_err();
        assert_eq!(err.code, "invalid_key");
        assert!(!err.message.contains("sk-"));
        assert!(!format!("{err:?}").contains("sk-bad"));
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
            messages: vec![ChatMessage {
                role: "user".into(),
                content: TEST_PROMPT.into(),
            }],
            max_tokens: Some(8),
        }
    }

    fn request_against(base_url: &str, api_key: Option<&str>) -> Result<(), LlmIpcError> {
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
