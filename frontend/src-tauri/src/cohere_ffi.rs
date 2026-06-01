//! In-process Cohere Transcribe 2B int8 recognizer via the sherpa-onnx C-API
//! (Route A FFI). Android 전용 — `lib.rs`에서 `#[cfg(target_os = "android")] mod
//! cohere_ffi;`로 선언된다.
//!
//! 비자명한 제약 (드롭되지 않도록 여기 명시):
//! (a) 모델은 **실제 파일시스템 경로**에서만 로드된다. 라이브러리가 AssetManager를
//!     거부한다("Please copy files to SD card for Cohere Transcribe. It does not
//!     support using a manager").
//! (b) `encoder.int8.onnx.data`(2.6 GB 외부 데이터)는 `encoder.int8.onnx`와 같은
//!     디렉터리에 있어야 한다. ORT가 파일명으로 암묵 로드하므로 config에는 넘기지 않는다.
//! (c) `SherpaOnnxAcceptWaveformOffline`는 스트림당 **최대 한 번**만 호출 가능
//!     (오프라인 인식은 전체 발화를 한 번에 받는다).
//! (d) 결과(result)와 스트림(stream)은 호출마다 해제하고, recognizer는 Drop(State
//!     teardown / 프로세스 종료) 시에만 해제한다.
//! (e) `Send`/`Sync`를 강제 assert한 근거: 모든 접근이 외부 Mutex로 직렬화되며
//!     (한 번에 한 스레드, 절대 동시 접근 없음) **그리고** Tauri command가
//!     동기(sync)로 설계되어 MutexGuard/raw 포인터가 `.await` 경계를 넘지 않는다.
//!     (cohere int8 추론은 ~3초 블로킹 CPU 작업이라, async command로 두면 future가
//!     워커 스레드 간 폴링되며 guard가 await를 넘어 unsound해진다 — `stt.rs` 참조.)
//! (f) `greedy_search` / `model_type='cohere-transcribe-03-2026'` / 유효한
//!     `language`만 동작한다. 라이브러리가 컴파일된 `.so` 안의 검증 문자열로 하드
//!     검사하며, 이 셋 중 하나라도 빠지거나 다르면 `create()`가 NULL을 반환한다.
//!     절대 "단순화"로 제거하지 말 것. language는 `COHERE_LANGS`(14개)로 사전 검증
//!     한다 — 미지원 언어를 넘기면 NULL이 떨어지므로, 그 전에 명확한 Err로 막는다.

// bindgen이 호스트 빌드 타임에 생성한 정확한 구조체/함수 정의. extern 블록을
// 직접 쓰지 않는다(opaque-handle 타입명이 bindgen과 어긋나는 drift 방지).
#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]
include!(concat!(env!("OUT_DIR"), "/sherpa_bindings.rs"));

use std::ffi::{CStr, CString};
use std::path::Path;

// EOS 누수 컷은 호스트 테스트가 가능한 순수 헬퍼(text_post)에 한 소스로 둔다.
pub use crate::text_post::cut_eos;

/// Cohere Transcribe `.so` 내부 검증 문자열로 실측한 지원 언어 14개.
/// create()에 이 목록 밖 언어를 넘기면 라이브러리가 NULL을 반환하므로,
/// 호출 전에 화이트리스트로 막아 명확한 에러를 돌려준다.
pub const COHERE_LANGS: &[&str] = &[
    "ar", "de", "el", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "vi", "zh",
];

/// 8초(=128k 샘플 @16k) 백스톱. chunker의 하드 클램프 뒤에 있는 마지막 방어선이다
/// — Cohere는 긴 청크에서 반복/열화한다.
const MAX_SAMPLES: usize = 8 * 16000;
/// preroll(400ms) + overlap(300ms) + 한 프레임 슬랙 허용치.
const MAX_SAMPLES_TOL: usize = MAX_SAMPLES + (16000 * 7 / 10) + 512;

/// 인식기 핸들. ptr는 opaque이며 모든 접근은 외부 Mutex로 직렬화된다.
pub struct CohereRecognizer {
    ptr: *const SherpaOnnxOfflineRecognizer,
}

// SAFETY: ptr는 라이브러리 소유의 opaque 핸들이고, 모든 접근이 외부 Mutex로
// 직렬화되어 한 번에 한 스레드만 사용한다(동시 접근 없음). 게다가 호출하는 Tauri
// command가 동기(sync)라 guard가 await/워커-스레드 경계를 넘지 않으므로 이 assert는
// 건전하다. (모듈 doc (e) 참조 — sync가 깨지면 이 건전성도 깨진다.)
unsafe impl Send for CohereRecognizer {}
unsafe impl Sync for CohereRecognizer {}

impl CohereRecognizer {
    /// `model_dir`에서 Cohere Transcribe int8 인식기를 생성한다.
    /// 파일: `encoder.int8.onnx`(+ `.data`), `decoder.int8.onnx`, `tokens.txt`.
    /// `language`는 `COHERE_LANGS` 중 하나여야 한다(아니면 즉시 Err).
    pub fn create(model_dir: &str, language: &str) -> Result<CohereRecognizer, String> {
        // 언어 화이트리스트 검증 (create NULL 방어 — 모듈 doc (f)).
        if !COHERE_LANGS.contains(&language) {
            return Err(format!(
                "unsupported Cohere language {language:?} (supported: {COHERE_LANGS:?})"
            ));
        }

        let dir = Path::new(model_dir);
        let encoder = dir.join("encoder.int8.onnx");
        let decoder = dir.join("decoder.int8.onnx");
        let tokens = dir.join("tokens.txt");

        // encoder.int8.onnx.data 는 config에 넘기지 않는다 — ORT가 같은 디렉터리에서
        // 파일명으로 암묵 로드한다(모듈 doc (b)).
        for p in [&encoder, &decoder, &tokens] {
            if !p.exists() {
                return Err(format!("model file missing: {}", p.display()));
            }
        }

        // CString들을 create 호출 전 구간 동안 로컬에 보관(라이브러리가 create 중
        // 내부 복사하므로 호출 후 drop돼도 안전).
        let c_encoder = cstr(&encoder.to_string_lossy())?;
        let c_decoder = cstr(&decoder.to_string_lossy())?;
        let c_tokens = cstr(&tokens.to_string_lossy())?;
        let c_lang = cstr(language)?;
        let c_provider = cstr("cpu")?;
        let c_method = cstr("greedy_search")?;
        let c_model_type = cstr("cohere-transcribe-03-2026")?;

        // 헤더가 memset(&config,0,sizeof) 를 명시적으로 요구한다(쓰지 않는 모델
        // 패밀리가 NULL로 남도록). zeroed()는 이 all-pointer/int POD에 대해
        // 등가이며 건전하다.
        let mut config: SherpaOnnxOfflineRecognizerConfig = unsafe { std::mem::zeroed() };

        // zeroed() leaves lm_config, hr (HomophoneReplacerConfig), hotwords_file,
        // rule_fsts/rule_fars, blank_penalty all NULL/0 — REQUIRED; do not touch.
        // A non-null garbage pointer in any embedded struct would be dereferenced
        // by the lib.

        config.feat_config.sample_rate = 16000;
        config.feat_config.feature_dim = 80;

        let m = &mut config.model_config;
        m.cohere_transcribe.encoder = c_encoder.as_ptr();
        m.cohere_transcribe.decoder = c_decoder.as_ptr();
        m.cohere_transcribe.language = c_lang.as_ptr();
        m.cohere_transcribe.use_punct = 1;
        m.cohere_transcribe.use_itn = 1;
        m.tokens = c_tokens.as_ptr();
        m.num_threads = 4;
        m.debug = 0;
        m.provider = c_provider.as_ptr();
        m.model_type = c_model_type.as_ptr();

        config.decoding_method = c_method.as_ptr();

        let ptr = unsafe { SherpaOnnxCreateOfflineRecognizer(&config) };
        if ptr.is_null() {
            return Err(
                "failed to create Cohere recognizer (check model files/ABI/model_type/language)"
                    .to_string(),
            );
        }
        // CStrings drop here — 라이브러리는 create 중 문자열을 내부 복사한다.
        Ok(CohereRecognizer { ptr })
    }

    /// 한 발화 PCM(16k mono f32, [-1,1])을 전사한다. 외부 Mutex 하에서 호출됨.
    pub fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        if samples.is_empty() {
            return Ok(String::new());
        }

        // 8초 길이 가드(maxSegmentS 불변식의 FFI 경계 백스톱). 폭주 버퍼가 출력을
        // 조용히 망가뜨리지 않도록 경고 후 truncate(chunker 클램프 뒤 마지막 방어선).
        let samples: &[f32] = if samples.len() > MAX_SAMPLES_TOL {
            eprintln!(
                "cohere_ffi: segment {} samples exceeds backstop {}; truncating",
                samples.len(),
                MAX_SAMPLES_TOL
            );
            &samples[..MAX_SAMPLES_TOL]
        } else {
            samples
        };

        let stream = unsafe { SherpaOnnxCreateOfflineStream(self.ptr) };
        if stream.is_null() {
            return Err("failed to create offline stream".to_string());
        }
        // 스트림은 모든 경로에서 반드시 해제(RAII).
        let _stream_guard = StreamGuard(stream);

        // accept-once: 오프라인 인식은 전체 발화를 한 번에 받는다.
        unsafe {
            SherpaOnnxAcceptWaveformOffline(
                stream,
                16000,
                samples.as_ptr(),
                samples.len() as i32,
            );
        }
        unsafe { SherpaOnnxDecodeOfflineStream(self.ptr, stream) };

        let r = unsafe { SherpaOnnxGetOfflineStreamResult(stream) };
        if r.is_null() {
            return Err("offline stream result is null".to_string());
        }
        // 결과 텍스트는 destroy 전에 복사(result 포인터는 result 객체 소유이며
        // destroy 시 무효화된다).
        let text = unsafe {
            if (*r).text.is_null() {
                String::new()
            } else {
                CStr::from_ptr((*r).text).to_string_lossy().into_owned()
            }
        };
        unsafe { SherpaOnnxDestroyOfflineRecognizerResult(r) };
        // _stream_guard drop이 여기서 스트림 해제. recognizer는 여기서 해제하지 않음.

        Ok(cut_eos(&text))
    }
}

impl Drop for CohereRecognizer {
    fn drop(&mut self) {
        // State teardown / 프로세스 종료 시에만 실행.
        unsafe { SherpaOnnxDestroyOfflineRecognizer(self.ptr) };
    }
}

/// 스트림을 모든 경로에서 해제하기 위한 RAII 가드(추가 의존성 없음).
struct StreamGuard(*const SherpaOnnxOfflineStream);

impl Drop for StreamGuard {
    fn drop(&mut self) {
        unsafe { SherpaOnnxDestroyOfflineStream(self.0) };
    }
}

fn cstr(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|e| format!("invalid C string ({s:?}): {e}"))
}
