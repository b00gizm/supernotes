//! Chunked capture → engine → events. Audio/text buffers stay bounded.

use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::{local_ms_of_day, Db, Meeting, Note, Repository};

use super::engine::{
    model_spec, AudioChunk, ModelProgress, ModelStore, TranscriptSegment, TranscriptionEngine,
    DEFAULT_MODEL_ID,
};
use super::platform::{AudioCapture, MicPermission, PermissionStatus};
use super::{
    EventSink, RecordingIpcError, FRAME_CHANNEL_CAP, TARGET_SAMPLE_RATE, WINDOW_MS,
    WINDOW_OVERLAP_MS,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingStatus {
    Idle,
    DownloadingModel,
    Recording,
    Stopping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingState {
    pub status: RecordingStatus,
    pub meeting_note_id: Option<String>,
    pub session_id: Option<String>,
    pub model_id: Option<String>,
    pub engine_id: Option<String>,
    pub started_at: Option<String>,
}

impl RecordingState {
    pub fn idle() -> Self {
        Self {
            status: RecordingStatus::Idle,
            meeting_note_id: None,
            session_id: None,
            model_id: None,
            engine_id: None,
            started_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StopRecordingResult {
    pub meeting: Meeting,
    pub transcript_note: Note,
}

pub struct PcmFrame {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

/// Sliding window over 16 kHz mono PCM. Buffer never exceeds window + overlap + one push.
pub struct AudioChunker {
    sample_rate: u32,
    window_samples: usize,
    overlap_samples: usize,
    buf: Vec<f32>,
    origin_ms: u64,
    samples_accepted: u64,
}

impl AudioChunker {
    pub fn new(sample_rate: u32, window_ms: u64, overlap_ms: u64) -> Self {
        let window_samples = ms_to_samples(sample_rate, window_ms);
        let overlap_samples = ms_to_samples(sample_rate, overlap_ms).min(window_samples);
        Self {
            sample_rate,
            window_samples,
            overlap_samples,
            buf: Vec::with_capacity(window_samples + overlap_samples),
            origin_ms: 0,
            samples_accepted: 0,
        }
    }

    #[cfg(test)]
    pub fn max_buffered_samples(&self) -> usize {
        self.window_samples + self.overlap_samples
    }

    #[cfg(test)]
    pub fn buffered_samples(&self) -> usize {
        self.buf.len()
    }

    pub fn push(&mut self, samples: &[f32]) -> Vec<AudioChunk> {
        let mut out = Vec::new();
        let mut rest = samples;
        while !rest.is_empty() {
            let room = self.window_samples.saturating_sub(self.buf.len()).max(1);
            let take = rest.len().min(room);
            self.buf.extend_from_slice(&rest[..take]);
            self.samples_accepted += take as u64;
            rest = &rest[take..];
            if self.buf.len() >= self.window_samples {
                out.push(self.emit_window());
            }
        }
        out
    }

    pub fn flush(&mut self) -> Option<AudioChunk> {
        if self.buf.is_empty() {
            return None;
        }
        let samples = std::mem::take(&mut self.buf);
        let start_ms = self.origin_ms;
        Some(AudioChunk {
            samples,
            sample_rate: self.sample_rate,
            start_ms,
        })
    }

    fn emit_window(&mut self) -> AudioChunk {
        let samples = self.buf[..self.window_samples].to_vec();
        let start_ms = self.origin_ms;
        let keep = self.overlap_samples;
        self.buf.drain(..self.window_samples.saturating_sub(keep));
        let hop = self.window_samples.saturating_sub(self.overlap_samples) as u64;
        self.origin_ms += hop.saturating_mul(1000) / u64::from(self.sample_rate.max(1));
        AudioChunk {
            samples,
            sample_rate: self.sample_rate,
            start_ms,
        }
    }
}

fn ms_to_samples(sample_rate: u32, ms: u64) -> usize {
    (u64::from(sample_rate).saturating_mul(ms) / 1000) as usize
}

/// Linear resample to 16 kHz mono. Fine for speech; swap for a sinc if quality lags.
pub fn resample_mono(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == 0 || to_rate == 0 || samples.is_empty() {
        return Vec::new();
    }
    if from_rate == to_rate {
        return samples.to_vec();
    }
    let out_len =
        (samples.len() as u64 * u64::from(to_rate) / u64::from(from_rate)).max(1) as usize;
    let mut out = Vec::with_capacity(out_len);
    let scale = (samples.len() - 1) as f64 / (out_len.saturating_sub(1).max(1)) as f64;
    for i in 0..out_len {
        let src = i as f64 * scale;
        let lo = src.floor() as usize;
        let hi = (lo + 1).min(samples.len() - 1);
        let frac = (src - lo as f64) as f32;
        out.push(samples[lo] * (1.0 - frac) + samples[hi] * frac);
    }
    out
}

/// Single-slot mailbox: at most one queued window. A new send replaces the old.
pub struct Mailbox<T> {
    inner: Mutex<MailboxInner<T>>,
    cv: Condvar,
}

struct MailboxInner<T> {
    slot: Option<T>,
    closed: bool,
}

impl<T> Mailbox<T> {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(MailboxInner {
                slot: None,
                closed: false,
            }),
            cv: Condvar::new(),
        }
    }

    /// Returns true when a previous item was dropped.
    pub fn send_replace(&self, item: T) -> bool {
        let mut inner = self.inner.lock().expect("mailbox poisoned");
        if inner.closed {
            return false;
        }
        let dropped = inner.slot.is_some();
        inner.slot = Some(item);
        self.cv.notify_one();
        dropped
    }

    pub fn recv(&self) -> Option<T> {
        let mut inner = self.inner.lock().expect("mailbox poisoned");
        loop {
            if let Some(item) = inner.slot.take() {
                return Some(item);
            }
            if inner.closed {
                return None;
            }
            inner = self.cv.wait(inner).expect("mailbox wait poisoned");
        }
    }

    pub fn close(&self) {
        let mut inner = self.inner.lock().expect("mailbox poisoned");
        inner.closed = true;
        self.cv.notify_all();
    }
}

pub struct Recorder {
    engine: Arc<dyn TranscriptionEngine>,
    permission: Arc<dyn MicPermission>,
    models: ModelStore,
    audio: Arc<dyn AudioCapture>,
    /// Tests pin local ms-since-midnight; production reads SQLite `localtime`.
    clock_origin_ms: Option<u64>,
    inner: Mutex<RecorderInner>,
}

struct RecorderInner {
    state: RecordingState,
    live: Option<LiveSession>,
}

struct LiveSession {
    meeting_note_id: String,
    stop_tx: mpsc::Sender<()>,
    capture: Option<JoinHandle<Result<(), RecordingIpcError>>>,
    chunker: Option<JoinHandle<()>>,
    infer: Option<JoinHandle<Vec<TranscriptSegment>>>,
    mailbox: Arc<Mailbox<AudioChunk>>,
}

impl Recorder {
    pub fn new(
        engine: Arc<dyn TranscriptionEngine>,
        permission: Arc<dyn MicPermission>,
        models: ModelStore,
        audio: Arc<dyn AudioCapture>,
    ) -> Self {
        Self {
            engine,
            permission,
            models,
            audio,
            clock_origin_ms: None,
            inner: Mutex::new(RecorderInner {
                state: RecordingState::idle(),
                live: None,
            }),
        }
    }

    #[cfg(test)]
    pub fn with_clock_origin_ms(mut self, ms_of_day: u64) -> Self {
        self.clock_origin_ms = Some(ms_of_day);
        self
    }

    pub fn state(&self) -> RecordingState {
        self.inner.lock().expect("recorder poisoned").state.clone()
    }

    pub fn list_models(&self) -> Vec<super::engine::TranscriptionModel> {
        self.models.list()
    }

    pub fn ensure_model(
        &self,
        model_id: &str,
        sink: &dyn EventSink,
    ) -> Result<(), RecordingIpcError> {
        if self.engine.id() == "fake" {
            return Ok(());
        }
        self.models.ensure(model_id, &|progress| {
            sink.emit_model(&progress);
        })?;
        Ok(())
    }

    pub fn microphone_permission(&self) -> PermissionStatus {
        self.permission.status()
    }

    pub fn start(
        &self,
        db: &Db,
        sink: Arc<dyn EventSink>,
        meeting_note_id: &str,
        model_id: Option<&str>,
    ) -> Result<RecordingState, RecordingIpcError> {
        {
            let inner = self.inner.lock().expect("recorder poisoned");
            if inner.live.is_some() {
                return Err(RecordingIpcError::new(
                    "already_recording",
                    format!(
                        "already recording {}",
                        inner.state.meeting_note_id.clone().unwrap_or_default()
                    ),
                ));
            }
        }

        match self.permission.status() {
            PermissionStatus::Denied | PermissionStatus::Restricted => {
                return Err(RecordingIpcError::permission_denied());
            }
            PermissionStatus::NotDetermined => {
                if matches!(
                    self.permission.request(),
                    PermissionStatus::Denied | PermissionStatus::Restricted
                ) {
                    return Err(RecordingIpcError::permission_denied());
                }
            }
            PermissionStatus::Granted => {}
        }

        db.with_conn(|conn| Repository::new(conn).get_meeting(meeting_note_id))
            .map_err(|err| match err {
                crate::db::DbError::NotFound => RecordingIpcError::new(
                    "meeting_not_found",
                    format!("no meeting for note {meeting_note_id}"),
                ),
                other => RecordingIpcError::new("invalid", other.to_string()),
            })?;

        let model_id = model_id.unwrap_or(DEFAULT_MODEL_ID).to_string();
        // Only the whisper.cpp backend needs a ggml file. Fake / test engines skip it.
        if self.engine.id() == "whisper" {
            model_spec(&model_id)?;
            self.set_status(
                sink.as_ref(),
                RecordingState {
                    status: RecordingStatus::DownloadingModel,
                    meeting_note_id: Some(meeting_note_id.to_string()),
                    session_id: None,
                    model_id: Some(model_id.clone()),
                    engine_id: Some(self.engine.id().to_string()),
                    started_at: None,
                },
            );
            let (spec, path) = self.models.ensure(&model_id, &|progress: ModelProgress| {
                sink.emit_model(&progress);
            })?;
            self.engine
                .prepare(&spec, &path)
                .map_err(|err| RecordingIpcError::new("engine", err.0))?;
        }

        let session_id = Uuid::new_v4().to_string();
        let started_at = iso_now_fallback();
        let origin_ms = match self.clock_origin_ms {
            Some(ms) => ms,
            None => db
                .with_conn(local_ms_of_day)
                .map_err(|err| RecordingIpcError::new("invalid", err.to_string()))?,
        };

        let (stop_tx, stop_rx) = mpsc::channel();
        let (frame_tx, frame_rx) = mpsc::sync_channel::<PcmFrame>(FRAME_CHANNEL_CAP);
        let mailbox = Arc::new(Mailbox::new());

        let capture_audio = Arc::clone(&self.audio);
        let capture = thread::Builder::new()
            .name("sn-capture".into())
            .spawn(move || capture_audio.capture(frame_tx, stop_rx))
            .map_err(|err| RecordingIpcError::new("engine", err.to_string()))?;

        let chunk_mailbox = Arc::clone(&mailbox);
        let chunker = thread::Builder::new()
            .name("sn-chunker".into())
            .spawn(move || {
                run_chunker(frame_rx, chunk_mailbox);
            })
            .map_err(|err| RecordingIpcError::new("engine", err.to_string()))?;

        let infer_mailbox = Arc::clone(&mailbox);
        let infer_engine = Arc::clone(&self.engine);
        let infer_sink = Arc::clone(&sink);
        let infer_meeting = meeting_note_id.to_string();
        let infer = thread::Builder::new()
            .name("sn-infer".into())
            .spawn(move || {
                run_infer(
                    infer_mailbox,
                    infer_engine,
                    infer_sink,
                    infer_meeting,
                    origin_ms,
                )
            })
            .map_err(|err| RecordingIpcError::new("engine", err.to_string()))?;

        let state = RecordingState {
            status: RecordingStatus::Recording,
            meeting_note_id: Some(meeting_note_id.to_string()),
            session_id: Some(session_id),
            model_id: Some(model_id),
            engine_id: Some(self.engine.id().to_string()),
            started_at: Some(started_at),
        };
        {
            let mut inner = self.inner.lock().expect("recorder poisoned");
            inner.state = state.clone();
            inner.live = Some(LiveSession {
                meeting_note_id: meeting_note_id.to_string(),
                stop_tx,
                capture: Some(capture),
                chunker: Some(chunker),
                infer: Some(infer),
                mailbox,
            });
        }
        sink.emit_state(&state);
        Ok(state)
    }

    pub fn stop(
        &self,
        db: &Db,
        sink: Arc<dyn EventSink>,
    ) -> Result<StopRecordingResult, RecordingIpcError> {
        let live = {
            let mut inner = self.inner.lock().expect("recorder poisoned");
            let Some(live) = inner.live.take() else {
                return Err(RecordingIpcError::new(
                    "not_recording",
                    "no active recording",
                ));
            };
            inner.state.status = RecordingStatus::Stopping;
            sink.emit_state(&inner.state);
            live
        };

        let _ = live.stop_tx.send(());
        if let Some(handle) = live.capture {
            match handle.join() {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    self.finish_idle(sink.as_ref());
                    return Err(err);
                }
                Err(_) => {
                    self.finish_idle(sink.as_ref());
                    return Err(RecordingIpcError::new("engine", "capture thread panicked"));
                }
            }
        }
        if let Some(handle) = live.chunker {
            let _ = handle.join();
        }
        live.mailbox.close();
        let segments = match live.infer {
            Some(handle) => handle
                .join()
                .map_err(|_| RecordingIpcError::new("engine", "infer thread panicked"))?,
            None => Vec::new(),
        };

        let body = format_transcript(&segments);
        let (meeting, transcript_note) = db
            .with_conn(|conn| {
                Repository::new(conn).save_meeting_transcript(&live.meeting_note_id, &body)
            })
            .map_err(|err| RecordingIpcError::new("invalid", err.to_string()))?;

        self.finish_idle(sink.as_ref());
        Ok(StopRecordingResult {
            meeting,
            transcript_note,
        })
    }

    fn finish_idle(&self, sink: &dyn EventSink) {
        let state = RecordingState::idle();
        self.inner.lock().expect("recorder poisoned").state = state.clone();
        sink.emit_state(&state);
    }

    fn set_status(&self, sink: &dyn EventSink, state: RecordingState) {
        self.inner.lock().expect("recorder poisoned").state = state.clone();
        sink.emit_state(&state);
    }
}

fn run_chunker(frame_rx: mpsc::Receiver<PcmFrame>, mailbox: Arc<Mailbox<AudioChunk>>) {
    let mut chunker = AudioChunker::new(TARGET_SAMPLE_RATE, WINDOW_MS, WINDOW_OVERLAP_MS);
    while let Ok(frame) = frame_rx.recv() {
        let mono = if frame.sample_rate == TARGET_SAMPLE_RATE {
            frame.samples
        } else {
            resample_mono(&frame.samples, frame.sample_rate, TARGET_SAMPLE_RATE)
        };
        for chunk in chunker.push(&mono) {
            let _dropped = mailbox.send_replace(chunk);
        }
    }
    if let Some(chunk) = chunker.flush() {
        let _dropped = mailbox.send_replace(chunk);
    }
}

fn run_infer(
    mailbox: Arc<Mailbox<AudioChunk>>,
    engine: Arc<dyn TranscriptionEngine>,
    sink: Arc<dyn EventSink>,
    meeting_note_id: String,
    origin_ms: u64,
) -> Vec<TranscriptSegment> {
    let mut collected = Vec::new();
    while let Some(chunk) = mailbox.recv() {
        match engine.transcribe(&chunk) {
            Ok(raw) => {
                for item in raw {
                    let start_ms = chunk.start_ms.saturating_add(item.start_ms);
                    let end_ms = chunk.start_ms.saturating_add(item.end_ms);
                    let segment = TranscriptSegment {
                        id: Uuid::new_v4().to_string(),
                        meeting_note_id: meeting_note_id.clone(),
                        start_ms,
                        end_ms,
                        clock: format_clock(origin_ms, start_ms),
                        text: item.text,
                    };
                    sink.emit_segment(&segment);
                    collected.push(segment);
                }
            }
            Err(err) => {
                sink.emit_error(&RecordingIpcError::new("engine", err.0));
            }
        }
    }
    collected
}

/// Local `HH:MM` for an utterance: recording origin (ms since local midnight) + elapsed.
/// ponytail: naive add — DST mid-session can be off by 1h; use a TZ-aware instant if that shows up.
pub fn format_clock(origin_ms_of_day: u64, offset_ms: u64) -> String {
    let total_mins = origin_ms_of_day.saturating_add(offset_ms) / 60_000;
    let mins = total_mins % (24 * 60);
    format!("{:02}:{:02}", mins / 60, mins % 60)
}

#[cfg(test)]
pub fn hhmm_to_ms_of_day(hour: u64, minute: u64) -> u64 {
    hour.saturating_mul(3_600_000)
        .saturating_add(minute.saturating_mul(60_000))
}

pub fn format_transcript(segments: &[TranscriptSegment]) -> String {
    let mut lines = Vec::new();
    for segment in segments {
        let text = segment.text.trim();
        if text.is_empty() {
            continue;
        }
        lines.push(format!("{}  {text}", segment.clock));
    }
    lines.join("\n")
}

fn iso_now_fallback() -> String {
    // Commands normally go through SQLite strftime; this is only a session stamp.
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days = secs / 86400;
    let tod = secs % 86400;
    let (year, month, day) = civil_from_days(days as i64);
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

/// Howard Hinnant civil-from-days (UTC). Avoids a chrono dep for a stamp.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

/// Wait until `pred` or timeout. Used by tests so we don't sleep blindly.
#[cfg(test)]
pub fn wait_until(timeout: std::time::Duration, mut pred: impl FnMut() -> bool) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if pred() {
            return true;
        }
        thread::sleep(std::time::Duration::from_millis(5));
    }
    pred()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NoteType, Repository};
    use crate::transcription::engine::FakeEngine;
    use crate::transcription::platform::{GrantedPermission, ScriptedCapture};
    use crate::transcription::{CollectingSink, TARGET_SAMPLE_RATE};
    use std::time::Duration;

    fn test_recorder(
        engine: Arc<dyn TranscriptionEngine>,
        audio: Arc<dyn AudioCapture>,
    ) -> Recorder {
        let dir = std::env::temp_dir().join(format!("sn-rec-{}", Uuid::new_v4()));
        Recorder::new(
            engine,
            Arc::new(GrantedPermission),
            ModelStore::new(
                dir,
                Arc::new(crate::transcription::engine::BytesFetcher {
                    url_to_bytes: Default::default(),
                }),
            ),
            audio,
        )
    }

    fn meeting_db() -> (Db, String) {
        let db = Db::open_in_memory().unwrap();
        let id = db
            .with_conn(|conn| {
                Repository::new(conn).create_meeting_note(
                    "Pricing sync",
                    "",
                    "2026-08-10",
                    "14:00",
                    "14:23",
                    None,
                )
            })
            .unwrap()
            .note
            .id;
        (db, id)
    }

    #[test]
    fn chunker_emits_windows_and_stays_bounded() {
        let sr = TARGET_SAMPLE_RATE;
        let mut chunker = AudioChunker::new(sr, 8_000, 1_000);
        let frame = vec![0.1f32; (sr / 50) as usize];
        let frames = 30 * 60 * 50; // 30 minutes of 20 ms frames
        let mut max_buf = 0usize;
        let mut chunks = 0usize;
        for _ in 0..frames {
            let out = chunker.push(&frame);
            chunks += out.len();
            max_buf = max_buf.max(chunker.buffered_samples());
            assert!(
                chunker.buffered_samples() <= chunker.max_buffered_samples(),
                "chunker grew to {}",
                chunker.buffered_samples()
            );
        }
        assert!(
            chunks >= (30 * 60 * 1000 / 8_000) - 1,
            "expected ~225 windows, got {chunks}"
        );
        assert!(max_buf <= chunker.max_buffered_samples());
    }

    #[test]
    fn mailbox_replaces_instead_of_queueing() {
        let box_: Mailbox<u32> = Mailbox::new();
        assert!(!box_.send_replace(1));
        assert!(box_.send_replace(2));
        assert_eq!(box_.recv(), Some(2));
        box_.close();
        assert_eq!(box_.recv(), None);
    }

    #[test]
    fn format_clock_uses_utterance_origin_not_schedule() {
        let fifteen_fifty_four = hhmm_to_ms_of_day(15, 54);
        assert_eq!(format_clock(fifteen_fifty_four, 0), "15:54");
        assert_eq!(format_clock(fifteen_fifty_four, 125_000), "15:56");
        assert_eq!(
            format_clock(hhmm_to_ms_of_day(23, 50), 20 * 60_000),
            "00:10"
        );
        assert_ne!(
            format_clock(fifteen_fifty_four, 0),
            format_clock(hhmm_to_ms_of_day(16, 0), 0)
        );
    }

    #[test]
    fn start_stop_streams_segments_and_links_readonly_note() {
        let (db, meeting_id) = meeting_db();
        let sr = TARGET_SAMPLE_RATE;
        let window = (sr * 8) as usize;
        let samples = vec![0.2f32; window * 2 + sr as usize];
        let engine = Arc::new(FakeEngine::scripted(&[
            (0, "Let's walk through the enterprise tier."),
            (7_000, "The per-seat discount only applies above fifty."),
        ]));
        let audio = Arc::new(ScriptedCapture::from_samples(
            samples,
            sr,
            (sr / 50) as usize,
        ));
        // Meeting is 14:00–14:23; Record was hit at 15:54 (early/late vs schedule).
        let recorder = test_recorder(engine, audio).with_clock_origin_ms(hhmm_to_ms_of_day(15, 54));
        let sink = Arc::new(CollectingSink::default());
        let state = recorder
            .start(&db, sink.clone(), &meeting_id, Some("tiny.en"))
            .unwrap();
        assert_eq!(state.status, RecordingStatus::Recording);
        assert_eq!(state.engine_id.as_deref(), Some("fake"));

        assert!(wait_until(Duration::from_secs(2), || {
            !sink.segments().is_empty()
        }));

        let stopped = recorder.stop(&db, sink.clone()).unwrap();
        let segs = sink.segments();
        assert_eq!(segs[0].clock, "15:54");
        assert_ne!(segs[0].clock, "14:00");
        assert_eq!(segs[0].start_ms, 0);
        assert_eq!(segs[0].text, "Let's walk through the enterprise tier.");
        assert!(
            stopped.transcript_note.body_markdown.starts_with("15:54  "),
            "{}",
            stopped.transcript_note.body_markdown
        );
        // Later windows may be dropped if the chunker outruns infer (drop-oldest mailbox).
        for pair in segs.windows(2) {
            assert!(pair[1].start_ms >= pair[0].start_ms);
        }
        assert_eq!(
            stopped.meeting.transcript_note_id.as_deref(),
            Some(stopped.transcript_note.id.as_str())
        );
        assert!(stopped.transcript_note.title.contains("transcript"));
        assert!(stopped
            .transcript_note
            .body_markdown
            .contains("Let's walk through the enterprise tier."));
        assert_eq!(stopped.transcript_note.note_type, NoteType::Regular);

        let err = db
            .with_conn(|conn| {
                Repository::new(conn).update_note(&stopped.transcript_note.id, "hacked", "nope")
            })
            .unwrap_err();
        assert!(err.to_string().contains("read-only"));

        assert_eq!(recorder.state().status, RecordingStatus::Idle);
    }

    #[test]
    fn permission_denied_is_an_ipc_code() {
        let (db, meeting_id) = meeting_db();
        let dir = std::env::temp_dir().join(format!("sn-rec-{}", Uuid::new_v4()));
        let recorder = Recorder::new(
            Arc::new(FakeEngine::default()),
            Arc::new(crate::transcription::platform::DeniedPermission),
            ModelStore::new(
                dir,
                Arc::new(crate::transcription::engine::BytesFetcher {
                    url_to_bytes: Default::default(),
                }),
            ),
            Arc::new(ScriptedCapture::from_samples(
                vec![0.0; 16],
                TARGET_SAMPLE_RATE,
                16,
            )),
        );
        let err = recorder
            .start(&db, Arc::new(CollectingSink::default()), &meeting_id, None)
            .unwrap_err();
        assert_eq!(err.code, "permission_denied");
    }

    #[test]
    fn engine_trait_is_swappable() {
        struct OtherEngine;
        impl TranscriptionEngine for OtherEngine {
            fn id(&self) -> &'static str {
                "other"
            }
            fn transcribe(
                &self,
                chunk: &AudioChunk,
            ) -> Result<
                Vec<crate::transcription::engine::RawSegment>,
                crate::transcription::engine::EngineError,
            > {
                Ok(vec![crate::transcription::engine::RawSegment {
                    start_ms: 0,
                    end_ms: chunk.end_ms().saturating_sub(chunk.start_ms),
                    text: "swapped".into(),
                }])
            }
        }

        let (db, meeting_id) = meeting_db();
        let samples = vec![0.3f32; TARGET_SAMPLE_RATE as usize * 2];
        let recorder = test_recorder(
            Arc::new(OtherEngine),
            Arc::new(ScriptedCapture::from_samples(
                samples,
                TARGET_SAMPLE_RATE,
                320,
            )),
        );
        let sink = Arc::new(CollectingSink::default());
        let state = recorder
            .start(&db, sink.clone(), &meeting_id, None)
            .unwrap();
        assert_eq!(state.model_id.as_deref(), Some("tiny"));
        assert_eq!(state.engine_id.as_deref(), Some("other"));
        assert!(wait_until(Duration::from_secs(2), || !sink
            .segments()
            .is_empty()));
        assert_eq!(sink.segments()[0].text, "swapped");
        recorder.stop(&db, sink).unwrap();
    }

    #[test]
    fn slow_engine_drops_chunks_instead_of_buffering() {
        let mailbox = Arc::new(Mailbox::new());
        let mb = Arc::clone(&mailbox);
        let handle = thread::spawn(move || {
            let mut n = 0u32;
            while mb.recv().is_some() {
                thread::sleep(Duration::from_millis(80));
                n += 1;
            }
            n
        });
        let mut dropped = 0u32;
        for i in 0..8 {
            if mailbox.send_replace(AudioChunk {
                samples: vec![0.0; 16],
                sample_rate: TARGET_SAMPLE_RATE,
                start_ms: i * 8_000,
            }) {
                dropped += 1;
            }
            thread::sleep(Duration::from_millis(5));
        }
        mailbox.close();
        let processed = handle.join().unwrap();
        assert!(dropped >= 1, "expected replace-drops, got {dropped}");
        assert!(
            processed < 8,
            "slow consumer must not see every window, saw {processed}"
        );
    }
}
