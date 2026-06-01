//! 온디바이스 STT command 경계 — **Android 전용**.
//!
//! 또박또박 데스크톱 STT는 ActionCable→sidecar 경로(서버측 전사)라 이 모듈을 쓰지
//! 않는다. 따라서 이 모듈 전체가 `#[cfg(target_os = "android")]` 게이트다(lib.rs).
//! Android는 sherpa C-API(`crate::cohere_ffi`)로 in-process 전사한다.
//!
//! command JSON arg 형태: `stt_load { model_dir: String, language: String }`,
//! `stt_transcribe { pcm: Vec<f32> }`.

use std::sync::Mutex;
use tauri::State;

/// 프로세스 수명 동안 로드한 인식기 + **현재 로드된 언어**를 보관하고, FFI 호출을
/// 직렬화한다. 언어가 바뀌면 recognizer를 재생성한다(Cohere는 create 시 언어 1개
/// 고정 — 변경하려면 drop 후 재생성, ~12s 콜드로드).
pub struct CohereState(pub Mutex<Option<(String, crate::cohere_ffi::CohereRecognizer)>>);

impl Default for CohereState {
    fn default() -> Self {
        CohereState(Mutex::new(None))
    }
}

/// **Why this command is SYNC (no `async`):** ~3초 블로킹 CPU 추론을 async command로
/// 두면 공유 Tokio 런타임의 future 안에서 돌며 `MutexGuard` + raw recognizer 포인터를
/// `.await` 경계 너머(워커 스레드 간 폴링)로 들고 가게 된다 — Send/Sync를 강제
/// assert했기에 "겉보기로만" 건전, 20× 루프 하에서 불안정해진다. Tauri는 **동기**
/// command를 async 런타임 밖 자체 스레드풀에서 디스패치하므로 블로킹 ONNX 호출과
/// MutexGuard가 호출 동안 한 OS 스레드에 머문다. (cohere_ffi 모듈 doc (e) 참조 —
/// 이 sync 전제가 깨지면 Send/Sync 건전성도 깨진다. async 래핑 절대 금지.)
#[tauri::command]
pub fn stt_load(
    model_dir: String,
    language: String,
    state: State<CohereState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    // 멱등: 같은 언어가 이미 로드돼 있으면 그대로 Ok (콜드 로드는 ~12s, 1회만).
    if let Some((lang, _)) = guard.as_ref() {
        if *lang == language {
            return Ok(());
        }
    }
    // 언어 변경(또는 최초) → 기존 recognizer drop 후 재생성.
    *guard = None;
    let rec = crate::cohere_ffi::CohereRecognizer::create(&model_dir, &language)?;
    *guard = Some((language, rec));
    Ok(())
}

#[tauri::command]
pub fn stt_transcribe(pcm: Vec<f32>, state: State<CohereState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        None => Err("model not loaded; call stt_load first".to_string()),
        Some((_lang, rec)) => rec.transcribe(&pcm),
    }
}
