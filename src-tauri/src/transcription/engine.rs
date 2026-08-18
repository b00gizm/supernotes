//! Swappable transcription backend (whisper.cpp, fake, later diarization).

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::{RecordingIpcError, TARGET_SAMPLE_RATE};

pub const DEFAULT_MODEL_ID: &str = "tiny";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub meeting_note_id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    /// Local `HH:MM` when the utterance was spoken (not scheduled meeting start).
    pub clock: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub start_ms: u64,
}

impl AudioChunk {
    pub fn end_ms(&self) -> u64 {
        if self.sample_rate == 0 {
            return self.start_ms;
        }
        self.start_ms
            + (self.samples.len() as u64 * 1000).saturating_div(u64::from(self.sample_rate))
    }
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{0}")]
pub struct EngineError(pub String);

pub trait TranscriptionEngine: Send + Sync {
    fn id(&self) -> &'static str;
    /// Load weights / validate the model file. Fake engines no-op.
    fn prepare(&self, model: &ModelSpec, path: &Path) -> Result<(), EngineError> {
        let _ = (model, path);
        Ok(())
    }
    fn transcribe(&self, chunk: &AudioChunk) -> Result<Vec<RawSegment>, EngineError>;
}

/// Engine-owned text + offsets relative to the chunk start (not the meeting).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// Deterministic stand-in so CI never needs a mic or ggml file.
#[derive(Debug, Default)]
pub struct FakeEngine {
    /// Optional `chunk.start_ms → text`. Missing keys get a placeholder line.
    pub script: Mutex<HashMap<u64, String>>,
}

impl FakeEngine {
    pub fn scripted(lines: &[(u64, &str)]) -> Self {
        let mut script = HashMap::new();
        for (start_ms, text) in lines {
            script.insert(*start_ms, (*text).to_string());
        }
        Self {
            script: Mutex::new(script),
        }
    }
}

impl TranscriptionEngine for FakeEngine {
    fn id(&self) -> &'static str {
        "fake"
    }

    fn transcribe(&self, chunk: &AudioChunk) -> Result<Vec<RawSegment>, EngineError> {
        let script = self.script.lock().expect("fake engine script poisoned");
        let text = script.get(&chunk.start_ms).cloned().unwrap_or_else(|| {
            format!(
                "(audio {}–{}s)",
                chunk.start_ms / 1000,
                chunk.end_ms() / 1000
            )
        });
        if text.is_empty() {
            return Ok(Vec::new());
        }
        Ok(vec![RawSegment {
            start_ms: 0,
            end_ms: chunk.end_ms().saturating_sub(chunk.start_ms),
            text,
        }])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptionModel {
    pub id: String,
    pub label: String,
    pub filename: String,
    pub downloaded: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

pub const MODEL_CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: "tiny.en",
        label: "Tiny (English)",
        filename: "ggml-tiny.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        size_bytes: 77_700_000,
    },
    ModelSpec {
        id: "tiny",
        label: "Tiny (multilingual)",
        filename: "ggml-tiny.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        size_bytes: 77_700_000,
    },
    ModelSpec {
        id: "base.en",
        label: "Base (English)",
        filename: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        size_bytes: 148_000_000,
    },
    ModelSpec {
        id: "base",
        label: "Base (multilingual)",
        filename: "ggml-base.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        size_bytes: 148_000_000,
    },
];

/// `.en` ggml files stay pinned; multilingual models use FullParams auto-detect (`None`).
fn whisper_language(model_id: &str) -> Option<&'static str> {
    if model_id.ends_with(".en") {
        Some("en")
    } else {
        None
    }
}

pub fn model_spec(id: &str) -> Result<&'static ModelSpec, RecordingIpcError> {
    MODEL_CATALOG
        .iter()
        .find(|model| model.id == id)
        .ok_or_else(|| {
            RecordingIpcError::new(
                "model_unavailable",
                format!("unknown transcription model {id:?}"),
            )
        })
}

pub trait ModelFetcher: Send + Sync {
    fn fetch(
        &self,
        url: &str,
        dest: &Path,
        on_progress: &dyn Fn(u64, Option<u64>),
    ) -> Result<(), RecordingIpcError>;
}

/// Streams the HTTP body to disk in 64 KiB chunks (never buffers the whole file).
pub struct UreqFetcher;

impl ModelFetcher for UreqFetcher {
    fn fetch(
        &self,
        url: &str,
        dest: &Path,
        on_progress: &dyn Fn(u64, Option<u64>),
    ) -> Result<(), RecordingIpcError> {
        let response = ureq::get(url).call().map_err(|err| {
            RecordingIpcError::new("model_unavailable", format!("download failed: {err}"))
        })?;
        let total = response
            .header("Content-Length")
            .and_then(|value| value.parse().ok());
        let mut reader = response.into_reader();
        write_stream(&mut reader, dest, total, on_progress)
    }
}

pub struct BytesFetcher {
    pub url_to_bytes: HashMap<String, Vec<u8>>,
}

impl ModelFetcher for BytesFetcher {
    fn fetch(
        &self,
        url: &str,
        dest: &Path,
        on_progress: &dyn Fn(u64, Option<u64>),
    ) -> Result<(), RecordingIpcError> {
        let bytes = self.url_to_bytes.get(url).ok_or_else(|| {
            RecordingIpcError::new("model_unavailable", format!("no fixture for {url}"))
        })?;
        write_stream(
            &mut bytes.as_slice(),
            dest,
            Some(bytes.len() as u64),
            on_progress,
        )
    }
}

fn write_stream(
    reader: &mut impl Read,
    dest: &Path,
    total: Option<u64>,
    on_progress: &dyn Fn(u64, Option<u64>),
) -> Result<(), RecordingIpcError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            RecordingIpcError::new("model_unavailable", format!("create models dir: {err}"))
        })?;
    }
    let tmp = dest.with_extension("part");
    let mut file = File::create(&tmp).map_err(|err| {
        RecordingIpcError::new("model_unavailable", format!("create download: {err}"))
    })?;
    let mut buf = [0u8; 64 * 1024];
    let mut written = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|err| {
            RecordingIpcError::new("model_unavailable", format!("read download: {err}"))
        })?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|err| {
            RecordingIpcError::new("model_unavailable", format!("write download: {err}"))
        })?;
        written += n as u64;
        on_progress(written, total);
    }
    file.sync_all().map_err(|err| {
        RecordingIpcError::new("model_unavailable", format!("sync download: {err}"))
    })?;
    drop(file);
    fs::rename(&tmp, dest).map_err(|err| {
        RecordingIpcError::new("model_unavailable", format!("finalize download: {err}"))
    })?;
    Ok(())
}

pub struct ModelStore {
    dir: PathBuf,
    fetcher: Arc<dyn ModelFetcher>,
}

impl ModelStore {
    pub fn new(dir: PathBuf, fetcher: Arc<dyn ModelFetcher>) -> Self {
        Self { dir, fetcher }
    }

    pub fn production(dir: PathBuf) -> Self {
        Self::new(dir, Arc::new(UreqFetcher))
    }

    pub fn path_for(&self, spec: &ModelSpec) -> PathBuf {
        self.dir.join(spec.filename)
    }

    pub fn is_downloaded(&self, spec: &ModelSpec) -> bool {
        self.path_for(spec).is_file()
    }

    pub fn list(&self) -> Vec<TranscriptionModel> {
        MODEL_CATALOG
            .iter()
            .map(|spec| TranscriptionModel {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                filename: spec.filename.to_string(),
                downloaded: self.is_downloaded(spec),
                size_bytes: spec.size_bytes,
            })
            .collect()
    }

    pub fn ensure(
        &self,
        model_id: &str,
        on_progress: &dyn Fn(ModelProgress),
    ) -> Result<(ModelSpec, PathBuf), RecordingIpcError> {
        let spec = *model_spec(model_id)?;
        let path = self.path_for(&spec);
        if path.is_file() {
            return Ok((spec, path));
        }
        self.fetcher.fetch(spec.url, &path, &|downloaded, total| {
            on_progress(ModelProgress {
                model_id: spec.id.to_string(),
                downloaded_bytes: downloaded,
                total_bytes: total,
            });
        })?;
        Ok((spec, path))
    }
}

/// whisper.cpp via whisper-rs on macOS. Other targets keep the same type so
/// model download / selection still works; inference returns `engine`.
pub struct WhisperEngine {
    #[cfg(target_os = "macos")]
    loaded: Mutex<Option<LoadedWhisper>>,
    #[cfg(not(target_os = "macos"))]
    _not_macos: (),
}

#[cfg(target_os = "macos")]
struct LoadedWhisper {
    model_id: String,
    ctx: whisper_rs::WhisperContext,
}

impl WhisperEngine {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            loaded: Mutex::new(None),
            #[cfg(not(target_os = "macos"))]
            _not_macos: (),
        }
    }
}

impl Default for WhisperEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TranscriptionEngine for WhisperEngine {
    fn id(&self) -> &'static str {
        "whisper"
    }

    fn prepare(&self, model: &ModelSpec, path: &Path) -> Result<(), EngineError> {
        if !path.is_file() {
            return Err(EngineError(format!(
                "model file missing: {}",
                path.display()
            )));
        }
        #[cfg(target_os = "macos")]
        {
            use whisper_rs::{WhisperContext, WhisperContextParameters};
            let mut loaded = self.loaded.lock().expect("whisper ctx poisoned");
            if loaded
                .as_ref()
                .is_some_and(|current| current.model_id == model.id)
            {
                return Ok(());
            }
            let path_str = path
                .to_str()
                .ok_or_else(|| EngineError("model path is not valid UTF-8".to_string()))?;
            let ctx =
                WhisperContext::new_with_params(path_str, WhisperContextParameters::default())
                    .map_err(|err| EngineError(err.to_string()))?;
            *loaded = Some(LoadedWhisper {
                model_id: model.id.to_string(),
                ctx,
            });
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = model;
            Ok(())
        }
    }

    fn transcribe(&self, chunk: &AudioChunk) -> Result<Vec<RawSegment>, EngineError> {
        if chunk.sample_rate != TARGET_SAMPLE_RATE {
            return Err(EngineError(format!(
                "whisper expects {TARGET_SAMPLE_RATE} Hz, got {}",
                chunk.sample_rate
            )));
        }
        #[cfg(target_os = "macos")]
        {
            use whisper_rs::{FullParams, SamplingStrategy};
            let loaded = self.loaded.lock().expect("whisper ctx poisoned");
            let loaded = loaded
                .as_ref()
                .ok_or_else(|| EngineError("whisper model not prepared".to_string()))?;
            let mut state = loaded
                .ctx
                .create_state()
                .map_err(|err| EngineError(err.to_string()))?;
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_n_threads(2);
            // FullParams defaults to "en"; None is whisper-rs auto-detect.
            params.set_language(whisper_language(&loaded.model_id));
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_suppress_blank(true);
            params.set_no_context(true);
            state
                .full(params, &chunk.samples)
                .map_err(|err| EngineError(err.to_string()))?;
            let mut out = Vec::new();
            for segment in state.as_iter() {
                let text = segment
                    .to_str()
                    .map_err(|err| EngineError(err.to_string()))?
                    .trim()
                    .to_string();
                if text.is_empty() {
                    continue;
                }
                // whisper.cpp timestamps are centiseconds.
                let start_ms = (segment.start_timestamp() as u64).saturating_mul(10);
                let end_ms = (segment.end_timestamp() as u64).saturating_mul(10);
                out.push(RawSegment {
                    start_ms,
                    end_ms: end_ms.max(start_ms),
                    text,
                });
            }
            Ok(out)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = chunk;
            Err(EngineError(
                "whisper.cpp inference is compiled for macOS builds; use SUPERNOTES_FAKE_TRANSCRIBE=1 on this target"
                    .to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_multilingual_tiny() {
        assert_eq!(DEFAULT_MODEL_ID, "tiny");
        assert_eq!(model_spec(DEFAULT_MODEL_ID).unwrap().id, "tiny");
        assert!(model_spec("tiny.en").is_ok());
    }

    #[test]
    fn multilingual_models_auto_detect_language() {
        assert_eq!(whisper_language("tiny"), None);
        assert_eq!(whisper_language("base"), None);
        assert_eq!(whisper_language(DEFAULT_MODEL_ID), None);
        assert_eq!(whisper_language("tiny.en"), Some("en"));
        assert_eq!(whisper_language("base.en"), Some("en"));
    }

    #[test]
    fn fake_engine_is_swappable_and_uses_script() {
        let engine: Box<dyn TranscriptionEngine> = Box::new(FakeEngine::scripted(&[(
            0,
            "Let's walk through the enterprise tier.",
        )]));
        assert_eq!(engine.id(), "fake");
        let chunk = AudioChunk {
            samples: vec![0.0; TARGET_SAMPLE_RATE as usize],
            sample_rate: TARGET_SAMPLE_RATE,
            start_ms: 0,
        };
        let segs = engine.transcribe(&chunk).unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].text, "Let's walk through the enterprise tier.");
        assert_eq!(segs[0].end_ms, 1000);
    }

    #[test]
    fn whisper_engine_reports_stable_id() {
        let engine: Box<dyn TranscriptionEngine> = Box::new(WhisperEngine::new());
        assert_eq!(engine.id(), "whisper");
    }

    #[test]
    fn model_store_downloads_once_via_fetcher() {
        let dir = std::env::temp_dir().join(format!("supernotes-models-{}", uuid::Uuid::new_v4()));
        let spec = model_spec("tiny.en").unwrap();
        let fetcher = BytesFetcher {
            url_to_bytes: HashMap::from([(spec.url.to_string(), b"ggml-fixture".to_vec())]),
        };
        let store = ModelStore::new(dir.clone(), Arc::new(fetcher));
        assert!(!store.is_downloaded(spec));
        let progresses = Mutex::new(Vec::new());
        let (got, path) = store
            .ensure("tiny.en", &|p| progresses.lock().unwrap().push(p))
            .unwrap();
        assert_eq!(got.id, "tiny.en");
        assert_eq!(fs::read(&path).unwrap(), b"ggml-fixture");
        assert!(!progresses.lock().unwrap().is_empty());
        assert!(store
            .list()
            .iter()
            .any(|m| m.id == "tiny.en" && m.downloaded));

        let before = fs::metadata(&path).unwrap().modified().unwrap();
        store
            .ensure("tiny.en", &|_| panic!("should not re-download"))
            .unwrap();
        let after = fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(before, after);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unknown_model_is_model_unavailable() {
        let err = model_spec("huge").unwrap_err();
        assert_eq!(err.code, "model_unavailable");
    }
}
