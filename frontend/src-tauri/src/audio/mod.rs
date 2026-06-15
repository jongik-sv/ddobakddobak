pub mod resample;
mod recorder;

#[cfg(target_os = "macos")]
mod capture_macos;
#[cfg(target_os = "windows")]
mod capture_windows;

#[cfg(target_os = "macos")]
use capture_macos::SystemAudioCapture;
#[cfg(target_os = "windows")]
use capture_windows::SystemAudioCapture;

use recorder::AudioRecorder;

use crate::sync_ext::LockExt;
use base64::Engine;
use serde::Serialize;
use std::sync::{Arc, Mutex};
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

pub struct RecorderState {
    recorder: Mutex<Option<Arc<AudioRecorder>>>,
}

impl Default for RecorderState {
    fn default() -> Self {
        Self {
            recorder: Mutex::new(None),
        }
    }
}

// ── Event Payload ──────────────────────────────────

#[derive(Clone, Serialize)]
struct AudioChunkPayload {
    pcm_base64: String,
    sample_count: usize,
}

// ── Helper ─────────────────────────────────────────

fn pcm_to_base64(pcm_i16: &[i16]) -> String {
    let bytes: Vec<u8> = pcm_i16
        .iter()
        .flat_map(|s| s.to_le_bytes())
        .collect();
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

// ── 시스템 오디오 캡처 Commands ────────────────────

/// 시스템 오디오 캡처를 시작한다.
/// 캡처된 PCM 데이터는 `system-audio-chunk` 이벤트로 프론트엔드에 전달된다.
#[tauri::command]
pub fn start_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AudioCaptureState>();
    let mut capture_lock = state.capture.lock_safe();

    if capture_lock.is_some() {
        return Err("시스템 오디오 캡처가 이미 실행 중입니다".to_string());
    }

    // 시스템 오디오는 Tauri 이벤트로 프론트엔드에 전달 → audio-processor.js에서 마이크와 믹싱
    // 녹음기에는 믹싱된 PCM이 JS에서 feed_recorder_mic으로 전달되므로 여기서 직접 피딩하지 않음
    let app_handle = app.clone();
    let callback = Box::new(move |pcm_i16: Vec<i16>| {
        let pcm_base64 = pcm_to_base64(&pcm_i16);
        let sample_count = pcm_i16.len();

        app_handle
            .emit(
                "system-audio-chunk",
                AudioChunkPayload {
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
    let mut capture_lock = state.capture.lock_safe();

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
    let is_capturing = state.capture.lock_safe().is_some();
    is_capturing
}

// ── 녹음 Commands ─────────────────────────────────

/// 녹음 파일 저장 디렉터리(app_data_dir/recordings). TMPDIR과 달리 OS가 청소하지 않아
/// 강제종료된 녹음이 영구 보존된다. 파일명은 `<meetingId>.wav`라 복구 시 회의 매칭이 자명.
fn recordings_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 조회 실패: {}", e))?;
    Ok(base.join("recordings"))
}

fn recording_path(app: &AppHandle, meeting_id: i64) -> Result<String, String> {
    Ok(recordings_dir(app)?
        .join(format!("{}.wav", meeting_id))
        .to_string_lossy()
        .to_string())
}

/// 녹음을 시작한다. `recordings/<meetingId>.wav`에 연속 기록(강제종료 내성).
#[tauri::command]
pub fn start_recording(app: AppHandle, meeting_id: i64) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let mut recorder_lock = state.recorder.lock_safe();

    if recorder_lock.is_some() {
        return Err("녹음이 이미 진행 중입니다".to_string());
    }

    let dir = recordings_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("recordings 디렉터리 생성 실패: {}", e))?;
    let path = recording_path(&app, meeting_id)?;

    let recorder = AudioRecorder::start(&path)?;
    *recorder_lock = Some(Arc::new(recorder));

    Ok(())
}

/// 녹음을 종료한다. WAV 파일을 base64로 인코딩하여 반환.
/// 파일은 삭제하지 않는다 — 업로드 성공 후 `delete_recording`으로 정리(실패 시 시작 복구 스윕이 처리).
#[tauri::command]
pub fn stop_recording(app: AppHandle) -> Result<String, String> {
    let state = app.state::<RecorderState>();
    let mut recorder_lock = state.recorder.lock_safe();

    if let Some(recorder) = recorder_lock.take() {
        let path = recorder.stop()?;
        let bytes = std::fs::read(&path).map_err(|e| format!("WAV 파일 읽기 실패: {}", e))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
    } else {
        Err("진행 중인 녹음이 없습니다".to_string())
    }
}

/// 업로드 완료된(혹은 폐기된) 녹음 파일을 삭제한다.
#[tauri::command]
pub fn delete_recording(app: AppHandle, meeting_id: i64) -> Result<(), String> {
    let path = recording_path(&app, meeting_id)?;
    std::fs::remove_file(&path).ok();
    Ok(())
}

/// 미업로드 녹음 파일(`<meetingId>.wav`, 헤더 제외 데이터 존재)의 meeting id 목록.
/// 시작 시 복구 스윕이 사용.
#[tauri::command]
pub fn list_orphan_recordings(app: AppHandle) -> Result<Vec<i64>, String> {
    let dir = recordings_dir(&app)?;
    let mut ids = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(stem) = name.strip_suffix(".wav") {
                if let Ok(id) = stem.parse::<i64>() {
                    let has_data = entry.metadata().map(|m| m.len() > 44).unwrap_or(false);
                    if has_data {
                        ids.push(id);
                    }
                }
            }
        }
    }
    Ok(ids)
}

/// 녹음 파일을 헤더 복구 후 base64로 반환(시작 복구 스윕 업로드용).
#[tauri::command]
pub fn read_recording(app: AppHandle, meeting_id: i64) -> Result<String, String> {
    let path = recording_path(&app, meeting_id)?;
    // 강제종료로 size가 stale/0인 파일도 안전하게 읽히도록 헤더를 실제 크기로 재계산.
    recorder::finalize_wav_header(&path)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("WAV 파일 읽기 실패: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 녹음 일시정지.
#[tauri::command]
pub fn pause_recording(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let recorder_lock = state.recorder.lock_safe();
    if let Some(ref rec) = *recorder_lock {
        rec.pause();
        Ok(())
    } else {
        Err("진행 중인 녹음이 없습니다".to_string())
    }
}

/// 녹음 재개.
#[tauri::command]
pub fn resume_recording(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let recorder_lock = state.recorder.lock_safe();
    if let Some(ref rec) = *recorder_lock {
        rec.resume();
        Ok(())
    } else {
        Err("진행 중인 녹음이 없습니다".to_string())
    }
}

/// 프론트엔드(getUserMedia)에서 마이크 PCM을 녹음기에 전달한다.
#[tauri::command]
pub fn feed_recorder_mic(app: AppHandle, pcm_base64: String) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let recorder_lock = state.recorder.lock_safe();
    if let Some(ref rec) = *recorder_lock {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&pcm_base64)
            .map_err(|e| format!("base64 디코딩 실패: {}", e))?;
        let pcm: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect();
        rec.feed_mic(&pcm);
    }
    Ok(())
}
