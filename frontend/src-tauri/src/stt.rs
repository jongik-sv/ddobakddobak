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

// ============================================================
// Dev-only on-device FFI smoke — 수동 sanity 게이트
// ============================================================

/// On-device FFI smoke 테스트. **Android 전용 + debug 빌드 밖에선 no-op**(임베드
/// fixture + 20× 루프가 `debug_assertions` 게이트 → release APK는 fixture/루프 미포함).
///
/// 핸들러엔 무조건 등록(generate_handler!가 개별 #[cfg] 불가). *본문*이 debug-gated라
/// release는 "debug-only" 에러만 반환. WebView devtools서 호출:
///   `window.__TAURI__.core.invoke('dev_ffi_smoke')`
///
/// Route-A 전 구간 end-to-end 검증: 모델 dir 해석 → recognizer 콜드로드(멱등) →
/// 임베드 ko.wav 디코드 → 실제 파이프라인과 같은 SYNC 디스패치로 transcribe 20×
/// (RAM 안정 + EOS 누수 가드). 한 줄 리포트 반환.
#[tauri::command]
pub fn dev_ffi_smoke(app: tauri::AppHandle, state: State<CohereState>) -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = (&app, &state);
        Err("dev_ffi_smoke is debug-only (release build carries no fixture)".to_string())
    }
    #[cfg(debug_assertions)]
    {
        use std::time::Instant;

        // debug에서만 임베드 — ~244KB fixture를 release APK 밖으로 유지.
        // CARGO_MANIFEST_DIR = <repo>/src-tauri → ../fixtures = <repo>/fixtures.
        const DEV_FIXTURE_WAV: &[u8] =
            include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/ko.wav"));

        // 1. 온디바이스 모델 dir 해석(미복사 시 actionable 에러).
        let paths = crate::model_path::resolve_model_paths(app)?;

        // 2. fixture를 16k mono f32 PCM으로 디코드.
        let pcm = decode_wav_pcm16_mono_16k(DEV_FIXTURE_WAV)?;

        // 3. recognizer 콜드로드(멱등; 첫 호출 ~12s). 스모크는 ko 고정.
        let t_load = Instant::now();
        {
            let mut guard = state.0.lock().map_err(|e| e.to_string())?;
            if guard.is_none() {
                *guard = Some((
                    "ko".to_string(),
                    crate::cohere_ffi::CohereRecognizer::create(&paths.dir, "ko")?,
                ));
            }
        }
        let load_ms = t_load.elapsed().as_millis();

        // 4. SYNC 디스패치 하 20× transcribe (RAM 안정 + EOS 누수 가드).
        const N: usize = 20;
        let mut first = String::new();
        let (mut min_ms, mut max_ms) = (u128::MAX, 0u128);
        for i in 0..N {
            let t = Instant::now();
            let text = {
                let guard = state.0.lock().map_err(|e| e.to_string())?;
                match guard.as_ref() {
                    None => return Err("recognizer vanished mid-loop".to_string()),
                    Some((_lang, rec)) => rec.transcribe(&pcm)?,
                }
            };
            let ms = t.elapsed().as_millis();
            min_ms = min_ms.min(ms);
            max_ms = max_ms.max(ms);
            if text.contains("<|") {
                return Err(format!("EOS leak at iter {i}: {text:?}"));
            }
            if text.trim().is_empty() {
                return Err(format!("empty transcript at iter {i}"));
            }
            if i == 0 {
                first = text;
            }
        }

        Ok(format!(
            "OK dir={} n={N} samples={} load_ms={load_ms} per_call_ms[min={min_ms} max={max_ms}] text={first:?}",
            paths.dir,
            pcm.len(),
        ))
    }
}

/// dev fixture용 최소 RIFF/WAVE 청크 워커: PCM16 mono 16kHz → f32. 청크를 순회하므로
/// (data가 offset 44에 있다고 가정 안 함) `ko.wav`의 `FLLR` 패딩 청크를 올바로
/// 건너뛴다. debug 전용 — dev_ffi_smoke만 호출.
#[cfg(debug_assertions)]
fn decode_wav_pcm16_mono_16k(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("fixture is not a RIFF/WAVE file".to_string());
    }
    let mut pos = 12usize;
    let mut fmt_ok = false;
    let (mut channels, mut sample_rate, mut bits) = (0u16, 0u32, 0u16);
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let sz = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]])
            as usize;
        let body = pos + 8;
        if body + sz > bytes.len() {
            return Err("WAV chunk overruns file".to_string());
        }
        if id == b"fmt " {
            if sz < 16 {
                return Err("fmt chunk too small".to_string());
            }
            let fmt = u16::from_le_bytes([bytes[body], bytes[body + 1]]);
            channels = u16::from_le_bytes([bytes[body + 2], bytes[body + 3]]);
            sample_rate = u32::from_le_bytes([
                bytes[body + 4],
                bytes[body + 5],
                bytes[body + 6],
                bytes[body + 7],
            ]);
            bits = u16::from_le_bytes([bytes[body + 14], bytes[body + 15]]);
            if fmt != 1 {
                return Err(format!("unsupported WAV format tag {fmt} (need PCM=1)"));
            }
            fmt_ok = true;
        } else if id == b"data" {
            if !fmt_ok {
                return Err("data chunk before fmt".to_string());
            }
            if channels != 1 || sample_rate != 16000 || bits != 16 {
                return Err(format!(
                    "fixture must be PCM16 mono 16k; got ch={channels} sr={sample_rate} bits={bits}"
                ));
            }
            let data = &bytes[body..body + sz];
            let mut pcm = Vec::with_capacity(data.len() / 2);
            for s in data.chunks_exact(2) {
                pcm.push(i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0);
            }
            return Ok(pcm);
        }
        // RIFF 청크는 워드 정렬: 홀수 길이 body 뒤엔 패드 바이트.
        pos = body + sz + (sz & 1);
    }
    Err("no data chunk found in fixture".to_string())
}
