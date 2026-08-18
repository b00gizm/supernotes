//! Mic recording + streamed on-device transcription (ENG-69).
//!
//! Memory: the capture callback uses a bounded `sync_channel` (drop-newest-if-full),
//! the chunker keeps ≤ one window + overlap, and inference uses a single-slot
//! mailbox that *replaces* a queued window if the model is still busy. PCM is
//! never accumulated for the whole session. Segment *text* is kept until stop
//! so the transcript note can be written (tens of KB for a 30-min meeting).

mod engine;
mod platform;
mod session;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::db::Db;

pub use engine::{
    ModelProgress, ModelStore, TranscriptSegment, TranscriptionEngine, TranscriptionModel,
    WhisperEngine,
};
pub use platform::{production_capture, MicPermission, PermissionStatus, SystemMicPermission};
pub use session::{Recorder, RecordingState, StopRecordingResult};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const WINDOW_MS: u64 = 8_000;
pub const WINDOW_OVERLAP_MS: u64 = 1_000;
/// ~160–400 ms of capture if the chunker stalls; extra frames are dropped.
pub const FRAME_CHANNEL_CAP: usize = 8;

pub const STATE_EVENT: &str = "recording://state";
pub const SEGMENT_EVENT: &str = "recording://segment";
pub const ERROR_EVENT: &str = "recording://error";
pub const MODEL_EVENT: &str = "recording://model";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingIpcError {
    pub code: String,
    pub message: String,
}

impl RecordingIpcError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn permission_denied() -> Self {
        Self::new(
            "permission_denied",
            "Microphone access was denied. Enable it in System Settings → Privacy & Security → Microphone.",
        )
    }
}

impl std::fmt::Display for RecordingIpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RecordingIpcError {}

pub trait EventSink: Send + Sync {
    fn emit_state(&self, state: &RecordingState);
    fn emit_segment(&self, segment: &TranscriptSegment);
    fn emit_error(&self, error: &RecordingIpcError);
    fn emit_model(&self, progress: &ModelProgress);
}

impl EventSink for AppHandle {
    fn emit_state(&self, state: &RecordingState) {
        let _ = self.emit(STATE_EVENT, state);
    }
    fn emit_segment(&self, segment: &TranscriptSegment) {
        let _ = self.emit(SEGMENT_EVENT, segment);
    }
    fn emit_error(&self, error: &RecordingIpcError) {
        let _ = self.emit(ERROR_EVENT, error);
    }
    fn emit_model(&self, progress: &ModelProgress) {
        let _ = self.emit(MODEL_EVENT, progress);
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct CollectingSink {
    segments: std::sync::Mutex<Vec<TranscriptSegment>>,
}

#[cfg(test)]
impl CollectingSink {
    pub fn segments(&self) -> Vec<TranscriptSegment> {
        self.segments.lock().expect("sink poisoned").clone()
    }
}

#[cfg(test)]
impl EventSink for CollectingSink {
    fn emit_state(&self, _state: &RecordingState) {}
    fn emit_segment(&self, segment: &TranscriptSegment) {
        self.segments
            .lock()
            .expect("sink poisoned")
            .push(segment.clone());
    }
    fn emit_error(&self, _error: &RecordingIpcError) {}
    fn emit_model(&self, _progress: &ModelProgress) {}
}

pub fn use_fake_engine() -> bool {
    matches!(
        std::env::var("SUPERNOTES_FAKE_TRANSCRIBE").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

pub fn production_recorder(models_dir: std::path::PathBuf) -> Recorder {
    let engine: Arc<dyn TranscriptionEngine> = if use_fake_engine() {
        Arc::new(engine::FakeEngine::default())
    } else {
        Arc::new(WhisperEngine::new())
    };
    Recorder::new(
        engine,
        Arc::new(SystemMicPermission),
        ModelStore::production(models_dir),
        production_capture(),
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MicrophonePermission {
    pub status: PermissionStatus,
}

#[tauri::command]
pub fn get_recording_state(recorder: State<'_, Recorder>) -> RecordingState {
    recorder.state()
}

#[tauri::command]
pub fn get_microphone_permission(recorder: State<'_, Recorder>) -> MicrophonePermission {
    MicrophonePermission {
        status: recorder.microphone_permission(),
    }
}

#[tauri::command]
pub fn list_transcription_models(recorder: State<'_, Recorder>) -> Vec<TranscriptionModel> {
    recorder.list_models()
}

#[tauri::command]
pub async fn ensure_transcription_model(
    app: AppHandle,
    recorder: State<'_, Recorder>,
    model_id: String,
) -> Result<TranscriptionModel, RecordingIpcError> {
    let sink: Arc<dyn EventSink> = Arc::new(app);
    recorder.ensure_model(&model_id, sink.as_ref())?;
    recorder
        .list_models()
        .into_iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| {
            RecordingIpcError::new("model_unavailable", format!("unknown model {model_id}"))
        })
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    db: State<'_, Db>,
    recorder: State<'_, Recorder>,
    meeting_note_id: String,
    model_id: Option<String>,
) -> Result<RecordingState, RecordingIpcError> {
    let sink: Arc<dyn EventSink> = Arc::new(app);
    recorder.start(&db, sink, &meeting_note_id, model_id.as_deref())
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    db: State<'_, Db>,
    recorder: State<'_, Recorder>,
) -> Result<StopRecordingResult, RecordingIpcError> {
    let sink: Arc<dyn EventSink> = Arc::new(app);
    recorder.stop(&db, sink)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_recording_args_are_camel_case_from_tauri() {
        // Tauri 2 sends `{ meetingNoteId, modelId }` for these parameters.
        let meeting_note_id: String = serde_json::from_value(serde_json::json!("note-1")).unwrap();
        let model_id: Option<String> =
            serde_json::from_value(serde_json::json!("tiny.en")).unwrap();
        assert_eq!(meeting_note_id, "note-1");
        assert_eq!(model_id.as_deref(), Some("tiny.en"));
    }

    #[test]
    fn permission_error_serializes_for_ipc() {
        let err = RecordingIpcError::permission_denied();
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "permission_denied");
        assert!(json["message"].as_str().unwrap().contains("Microphone"));
    }
}
