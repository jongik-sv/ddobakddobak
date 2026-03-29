pub mod resample;

#[cfg(target_os = "macos")]
mod capture_macos;
#[cfg(target_os = "windows")]
mod capture_windows;

#[cfg(target_os = "macos")]
use capture_macos::SystemAudioCapture;
#[cfg(target_os = "windows")]
use capture_windows::SystemAudioCapture;

use base64::Engine;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

// ── State ──────────────────────────────────────────

pub struct AudioCaptureState {
    capture: Mutex<Option<SystemAudioCapture>>,
}

impl Default for AudioCaptureState {
    fn default() -> Self {
        Self {
            capture: Mutex::new(None),
        }
    }
}

// ── Event Payload ──────────────────────────────────

#[derive(Clone, Serialize)]
struct SystemAudioChunkPayload {
    pcm_base64: String,
    sample_count: usize,
}

// ── Tauri Commands ─────────────────────────────────

/// 시스템 오디오 캡처를 시작한다.
/// 캡처된 PCM 데이터는 `system-audio-chunk` 이벤트로 프론트엔드에 전달된다.
#[tauri::command]
pub fn start_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AudioCaptureState>();
    let mut capture_lock = state.capture.lock().unwrap();

    if capture_lock.is_some() {
        return Err("시스템 오디오 캡처가 이미 실행 중입니다".to_string());
    }

    let app_handle = app.clone();
    let callback = Box::new(move |pcm_i16: Vec<i16>| {
        let bytes: Vec<u8> = pcm_i16
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let pcm_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let sample_count = pcm_i16.len();

        app_handle
            .emit(
                "system-audio-chunk",
                SystemAudioChunkPayload {
                    pcm_base64,
                    sample_count,
                },
            )
            .ok();
    });

    let capture = SystemAudioCapture::start(callback)?;
    *capture_lock = Some(capture);

    Ok(())
}

/// 시스템 오디오 캡처를 중지한다.
#[tauri::command]
pub fn stop_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AudioCaptureState>();
    let mut capture_lock = state.capture.lock().unwrap();

    if let Some(mut capture) = capture_lock.take() {
        capture.stop();
        Ok(())
    } else {
        Err("실행 중인 시스템 오디오 캡처가 없습니다".to_string())
    }
}

/// 시스템 오디오 캡처 상태를 확인한다.
#[tauri::command]
pub fn is_system_audio_capturing(app: AppHandle) -> bool {
    let state = app.state::<AudioCaptureState>();
    let is_capturing = state.capture.lock().unwrap().is_some();
    is_capturing
}
