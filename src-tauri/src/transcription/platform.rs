//! Mic capture + permission. Real CoreAudio/cpal is macOS/Windows-only.

use std::sync::mpsc::{Receiver, SyncSender};

use serde::{Deserialize, Serialize};

use super::session::PcmFrame;
use super::RecordingIpcError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
}

pub trait MicPermission: Send + Sync {
    fn status(&self) -> PermissionStatus;
    /// May show the OS prompt. Opening the input stream also prompts on macOS.
    fn request(&self) -> PermissionStatus {
        self.status()
    }
}

#[cfg(test)]
pub struct GrantedPermission;
#[cfg(test)]
impl MicPermission for GrantedPermission {
    fn status(&self) -> PermissionStatus {
        PermissionStatus::Granted
    }
}

#[cfg(test)]
pub struct DeniedPermission;
#[cfg(test)]
impl MicPermission for DeniedPermission {
    fn status(&self) -> PermissionStatus {
        PermissionStatus::Denied
    }
}

pub struct SystemMicPermission;

impl MicPermission for SystemMicPermission {
    fn status(&self) -> PermissionStatus {
        #[cfg(target_os = "macos")]
        {
            macos_microphone_status()
        }
        #[cfg(not(target_os = "macos"))]
        {
            PermissionStatus::Granted
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_microphone_status() -> PermissionStatus {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
        return PermissionStatus::NotDetermined;
    };
    let media = NSString::from_str("soun");
    let status: i64 = unsafe { msg_send![cls, authorizationStatusForMediaType: &*media] };
    match status {
        0 => PermissionStatus::NotDetermined,
        1 => PermissionStatus::Restricted,
        2 => PermissionStatus::Denied,
        3 => PermissionStatus::Granted,
        _ => PermissionStatus::NotDetermined,
    }
}

pub trait AudioCapture: Send + Sync {
    /// Blocking: push frames until `stop` fires, then return.
    fn capture(
        &self,
        frames: SyncSender<PcmFrame>,
        stop: Receiver<()>,
    ) -> Result<(), RecordingIpcError>;
}

/// Test / `SUPERNOTES_FAKE_TRANSCRIBE` source: push a finite PCM buffer.
#[cfg(test)]
pub struct ScriptedCapture {
    samples: Vec<f32>,
    sample_rate: u32,
    frame_len: usize,
}

#[cfg(test)]
impl ScriptedCapture {
    pub fn from_samples(samples: Vec<f32>, sample_rate: u32, frame_len: usize) -> Self {
        Self {
            samples,
            sample_rate,
            frame_len: frame_len.max(1),
        }
    }
}

#[cfg(test)]
impl AudioCapture for ScriptedCapture {
    fn capture(
        &self,
        frames: SyncSender<PcmFrame>,
        stop: Receiver<()>,
    ) -> Result<(), RecordingIpcError> {
        for chunk in self.samples.chunks(self.frame_len) {
            if stop.try_recv().is_ok() {
                return Ok(());
            }
            // Blocking send so tests deliver every frame; the live mic path uses try_send.
            if frames
                .send(PcmFrame {
                    samples: chunk.to_vec(),
                    sample_rate: self.sample_rate,
                })
                .is_err()
            {
                return Ok(());
            }
        }
        drop(frames); // disconnect so the chunker flushes the tail window
        let _ = stop.recv();
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub struct UnavailableCapture;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl AudioCapture for UnavailableCapture {
    fn capture(
        &self,
        _frames: SyncSender<PcmFrame>,
        _stop: Receiver<()>,
    ) -> Result<(), RecordingIpcError> {
        Err(RecordingIpcError::new(
            "engine",
            "microphone capture is not compiled for this target",
        ))
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub struct CpalCapture;

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl AudioCapture for CpalCapture {
    fn capture(
        &self,
        frames: SyncSender<PcmFrame>,
        stop: Receiver<()>,
    ) -> Result<(), RecordingIpcError> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| {
            RecordingIpcError::new("permission_denied", "no microphone input device")
        })?;
        let config = device.default_input_config().map_err(|err| {
            let msg = err.to_string();
            if looks_like_permission(&msg) {
                RecordingIpcError::permission_denied()
            } else {
                RecordingIpcError::new("engine", msg)
            }
        })?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                build_stream::<f32>(&device, &config.into(), channels, sample_rate, frames)?
            }
            cpal::SampleFormat::I16 => {
                build_stream::<i16>(&device, &config.into(), channels, sample_rate, frames)?
            }
            cpal::SampleFormat::U16 => {
                build_stream::<u16>(&device, &config.into(), channels, sample_rate, frames)?
            }
            other => {
                return Err(RecordingIpcError::new(
                    "engine",
                    format!("unsupported mic sample format {other}"),
                ));
            }
        };
        stream.play().map_err(|err| {
            if looks_like_permission(&err.to_string()) {
                RecordingIpcError::permission_denied()
            } else {
                RecordingIpcError::new("engine", err.to_string())
            }
        })?;
        let _ = stop.recv();
        drop(stream);
        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn build_stream<T: cpal::SizedSample + cpal::Sample>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    sample_rate: u32,
    frames: SyncSender<PcmFrame>,
) -> Result<cpal::Stream, RecordingIpcError>
where
    f32: cpal::FromSample<T>,
{
    use cpal::traits::DeviceTrait;
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let mut mono = Vec::with_capacity(data.len() / channels.max(1));
                if channels <= 1 {
                    mono.extend(data.iter().map(|s| s.to_sample::<f32>()));
                } else {
                    for frame in data.chunks(channels) {
                        let sum: f32 = frame.iter().map(|s| s.to_sample::<f32>()).sum();
                        mono.push(sum / channels as f32);
                    }
                }
                let _ = frames.try_send(PcmFrame {
                    samples: mono,
                    sample_rate,
                });
            },
            move |err| {
                eprintln!("supernotes mic stream error: {err}");
            },
            None,
        )
        .map_err(|err| {
            if looks_like_permission(&err.to_string()) {
                RecordingIpcError::permission_denied()
            } else {
                RecordingIpcError::new("engine", err.to_string())
            }
        })
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn looks_like_permission(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("permission")
        || lower.contains("denied")
        || lower.contains("not authorized")
        || lower.contains("not permitted")
}

pub fn production_capture() -> ArcCapture {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        std::sync::Arc::new(CpalCapture)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::sync::Arc::new(UnavailableCapture)
    }
}

pub type ArcCapture = std::sync::Arc<dyn AudioCapture>;
