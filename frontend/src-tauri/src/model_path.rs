//! Cohere int8 모델 경로 해석 + Android 첫 실행 스테이징 복사.
//!
//! 또박또박 데스크톱 STT는 sidecar 경로라 이 모듈의 command를 쓰지 않는다. 따라서
//! `#[tauri::command]` + `model_dir`는 `#[cfg(target_os = "android")]` 게이트.
//! 순수 헬퍼(`paths_in`/`copy_with_verify`/`part_path`)와 단위 테스트는 비게이트라
//! 호스트에서 `cargo test model_path`로 검증된다(향후 다운로더 T11도 재사용).

use std::path::{Path, PathBuf};
#[cfg(target_os = "android")]
use tauri::Manager;

/// sherpa-onnx recognizer가 필요로 하는 Cohere Transcribe 2B int8 산출물 4개.
/// `encoder.int8.onnx`는 ~2.9MB ONNX 그래프이고, 실제 가중치는 같은 디렉터리의
/// `encoder.int8.onnx.data`(~2605MB 외부 데이터)에 있다 — onnxruntime이 파일명으로
/// 암묵 로드하므로 config에는 넘기지 않는다.
const ENCODER: &str = "encoder.int8.onnx";
const ENCODER_DATA: &str = "encoder.int8.onnx.data";
const DECODER: &str = "decoder.int8.onnx";
const TOKENS: &str = "tokens.txt";

/// `encoder.int8.onnx.data`의 최소 그럴듯한 크기(바이트). 실제 ~2605MB. 중단된
/// `adb push`/다운로드는 더 작은(보통 0바이트) stub을 남긴다. 이 가드는 `.data`만
/// 겨냥한다 — `encoder.int8.onnx` 자체는 ~2.9MB라 가드해도 truncate를 못 잡는다.
const MIN_ENCODER_DATA_BYTES: u64 = 2_500_000_000;

/// 플랫폼 데이터 디렉터리 하위 모델 경로.
const MODEL_SUBDIR: &str = "models/cohere-onnx";

/// adb push 스테이징 디렉터리(앱 첫 실행 복사가 샌드박스로 이전하기 전).
#[cfg(target_os = "android")]
const STAGING_DIR: &str = "/data/local/tmp/cohere-onnx";

/// Cohere int8 모델 산출물의 절대 경로(해석 결과).
///
/// `encoder.int8.onnx.data`는 여기 노출하지 않는다: ORT가 encoder와 같은 디렉터리
/// 에서 파일명으로 암묵 로드한다. caller는 dir/encoder/decoder/tokens를 넘기고,
/// `.data` 동거는 `paths_in`이 사이즈가드로 보증한다.
#[derive(serde::Serialize)]
pub struct ModelPaths {
    pub dir: String,
    pub encoder: String,
    pub decoder: String,
    pub tokens: String,
}

/// UI 모델 게이트용 존재 리포트.
#[derive(serde::Serialize)]
pub struct ModelStatus {
    pub present: bool,
    pub dir: String,
    pub missing: Vec<String>,
}

/// 네 파일이 모두 `dir`에 있고 `encoder.int8.onnx.data`가 최소
/// `MIN_ENCODER_DATA_BYTES` 이상일 때만 `Some(ModelPaths)`(truncate된 push 방어).
fn paths_in(dir: &Path) -> Option<ModelPaths> {
    let encoder = dir.join(ENCODER);
    let encoder_data = dir.join(ENCODER_DATA);
    let decoder = dir.join(DECODER);
    let tokens = dir.join(TOKENS);

    if !encoder.exists() || !decoder.exists() || !tokens.exists() {
        return None;
    }

    let data_ok = std::fs::metadata(&encoder_data)
        .map(|m| m.len() >= MIN_ENCODER_DATA_BYTES)
        .unwrap_or(false);
    if !data_ok {
        return None;
    }

    Some(ModelPaths {
        dir: dir.to_string_lossy().into_owned(),
        encoder: encoder.to_string_lossy().into_owned(),
        decoder: decoder.to_string_lossy().into_owned(),
        tokens: tokens.to_string_lossy().into_owned(),
    })
}

/// `dir`에서 누락/불완전 파일 목록 계산(status 리포트용).
/// `encoder.int8.onnx.data`는 부재 OR truncate면 "missing"으로 친다.
fn missing_in(dir: &Path) -> Vec<String> {
    let mut missing = Vec::new();
    if !dir.join(ENCODER).exists() {
        missing.push(ENCODER.to_string());
    }
    let data = dir.join(ENCODER_DATA);
    let data_ok = std::fs::metadata(&data)
        .map(|m| m.len() >= MIN_ENCODER_DATA_BYTES)
        .unwrap_or(false);
    if !data_ok {
        missing.push(ENCODER_DATA.to_string());
    }
    if !dir.join(DECODER).exists() {
        missing.push(DECODER.to_string());
    }
    if !dir.join(TOKENS).exists() {
        missing.push(TOKENS.to_string());
    }
    missing
}

/// Android 모델 디렉터리: `<app_local_data_dir>/models/cohere-onnx` (실 FS 경로 —
/// 라이브러리가 AssetManager 미지원).
#[cfg(target_os = "android")]
fn model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("could not resolve app local data dir: {e}"))?;
    Ok(base.join(MODEL_SUBDIR))
}

/// 모델 완전 존재 여부 + 설치 디렉터리 + 누락 파일 리포트. 시작 시 모델 게이트 UI 구동.
#[cfg(target_os = "android")]
#[tauri::command]
pub fn cohere_model_status(app: tauri::AppHandle) -> ModelStatus {
    if let Ok(found) = resolve_model_paths(app.clone()) {
        return ModelStatus {
            present: true,
            dir: found.dir,
            missing: Vec::new(),
        };
    }
    match model_dir(&app) {
        Ok(dir) => ModelStatus {
            present: false,
            missing: missing_in(&dir),
            dir: dir.to_string_lossy().into_owned(),
        },
        Err(_) => ModelStatus {
            present: false,
            dir: String::new(),
            missing: vec![
                ENCODER.to_string(),
                ENCODER_DATA.to_string(),
                DECODER.to_string(),
                TOKENS.to_string(),
            ],
        },
    }
}

/// Cohere int8 모델 산출물 절대 경로 해석.
/// Android: `<app_local_data_dir>/models/cohere-onnx`만(기기에 repo 없음, 라이브러리
/// AssetManager 거부). miss 시 실 FS 경로 + 4파일을 명시한 actionable 에러.
#[cfg(target_os = "android")]
#[tauri::command]
pub fn resolve_model_paths(app: tauri::AppHandle) -> Result<ModelPaths, String> {
    let dir = model_dir(&app)?;
    if let Some(found) = paths_in(&dir) {
        return Ok(found);
    }
    Err(format!(
        "Cohere int8 model not found; push files to {} \
         ({ENCODER} + {ENCODER_DATA} + {DECODER} + {TOKENS}). \
         MUST be a real filesystem path; AssetManager is not supported.",
        dir.display()
    ))
}

/// `src` → `dst` 내구성 복사: `dst.part`에 스트리밍 기록 → fsync → 원자적 rename.
///
/// **스트리밍**(8KB 버퍼)으로 복사한다 — 원본 source처럼 파일 전체를 메모리에
/// `read()`하면 ~2.6GB .data에서 거대 할당이 발생해 저사양/에뮬(RAM 4.5GB)서 OOM
/// 위험. `io::copy`는 상수 메모리로 동일한 byte-exact 결과를 낸다. temp→fsync→rename
/// 불변식은 유지(부분 파일이 dst로 안 보이게). 호스트 컴파일 가능(Android 전용 API
/// 없음)이라 아래 단위 테스트가 호스트에서 돈다.
fn copy_with_verify(src: &Path, dst: &Path) -> Result<(), String> {
    use std::io::{BufReader, BufWriter};

    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create dir {}: {e}", parent.display()))?;
    }

    let part = part_path(dst);

    {
        let in_f = std::fs::File::open(src)
            .map_err(|e| format!("could not open source {}: {e}", src.display()))?;
        // 이전 중단 복사의 잔여 *.part를 덮어쓴다.
        let out_f = std::fs::File::create(&part)
            .map_err(|e| format!("could not create temp {}: {e}", part.display()))?;
        let mut reader = BufReader::with_capacity(256 * 1024, in_f);
        let mut writer = BufWriter::with_capacity(256 * 1024, out_f);
        std::io::copy(&mut reader, &mut writer)
            .map_err(|e| format!("could not stream-copy to {}: {e}", part.display()))?;
        // BufWriter flush + fsync로 내구 보장.
        let out_f = writer
            .into_inner()
            .map_err(|e| format!("could not flush temp {}: {e}", part.display()))?;
        out_f
            .sync_all()
            .map_err(|e| format!("could not fsync temp {}: {e}", part.display()))?;
    }

    std::fs::rename(&part, dst).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        format!("could not rename {} -> {}: {e}", part.display(), dst.display())
    })?;

    Ok(())
}

/// `<dst>.part` 형제 경로(원자적 쓰기 스테이징 이름).
fn part_path(dst: &Path) -> PathBuf {
    let mut name = dst
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".part");
    dst.with_file_name(name)
}

/// Android 첫 실행: 모델이 앱 샌드박스에 있도록 보장. 필요 시 스테이징 디렉터리에서
/// 복사. 멱등 — 이미 완전 존재면 즉시 반환(런치/전사마다 재복사 안 함).
///
/// 스테이징 디렉터리 부재 시 UI가 adb-push 안내로 렌더하는 `MODEL_MISSING` 구조화
/// 에러 문자열 반환(v1 PROD 다운로더는 T11).
#[cfg(target_os = "android")]
#[tauri::command]
pub fn ensure_cohere_model(app: tauri::AppHandle) -> Result<ModelPaths, String> {
    let dir = model_dir(&app)?;

    // 멱등 fast-path: 이미 완전 존재.
    if let Some(found) = paths_in(&dir) {
        return Ok(found);
    }

    let staging = Path::new(STAGING_DIR);
    if !staging.exists() {
        return Err(format!(
            "MODEL_MISSING: Cohere int8 model not staged. \
             adb push the four files to {STAGING_DIR} then relaunch. \
             Target sandbox dir: {} (real filesystem path; AssetManager unsupported).",
            dir.display()
        ));
    }

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create model dir {}: {e}", dir.display()))?;

    // 각 산출물을 temp→fsync→rename(스트리밍)으로 복사. 큰 .data는 encoder 그래프
    // 옆에 동거(onnxruntime이 파일명으로 암묵 로드).
    for name in [ENCODER, ENCODER_DATA, DECODER, TOKENS] {
        let src = staging.join(name);
        if !src.exists() {
            return Err(format!(
                "MODEL_MISSING: staged file absent: {} \
                 (re-run the adb push of all four files to {STAGING_DIR}).",
                src.display()
            ));
        }
        let dst = dir.join(name);
        copy_with_verify(&src, &dst)?;
    }

    // 복사 완전 착지 검증(사이즈가드가 truncate된 source/copy를 잡는다).
    paths_in(&dir).ok_or_else(|| {
        format!(
            "model copy incomplete in {} (a file is missing or the .data is truncated); \
             re-push to {STAGING_DIR} and retry.",
            dir.display()
        )
    })
}

/// 모델 4파일을 `base_url`에서 스트리밍 다운로드해 앱 샌드박스에 설치한다(adb 스테이징의
/// 프로덕션 대체 — T11). 각 파일은 `<base_url>/cohere-onnx/<name>`에서 받아 temp→fsync→
/// rename으로 내구 기록하고, `.data`는 사이즈가드로 완전성 확인.
///
/// 진행률은 `stt://model-download` 이벤트로 emit한다: `{ file, received, total, fileIndex, fileCount }`.
/// 멱등: 이미 완전 존재하면 즉시 반환(재다운로드 안 함). reqwest streaming이라 2.7GB도
/// 상수 메모리로 받는다(JS writeFile 전체적재 OOM 회피).
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_cohere_model(
    app: tauri::AppHandle,
    base_url: String,
) -> Result<ModelPaths, String> {
    use tauri::Emitter;

    let dir = model_dir(&app)?;

    // 멱등 fast-path.
    if let Some(found) = paths_in(&dir) {
        return Ok(found);
    }
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create model dir {}: {e}", dir.display()))?;

    let base = base_url.trim_end_matches('/').to_string();
    let files = [ENCODER, ENCODER_DATA, DECODER, TOKENS];
    let client = reqwest::Client::new();

    for (idx, name) in files.iter().enumerate() {
        let url = format!("{base}/cohere-onnx/{name}");
        let dst = dir.join(name);
        // 개별 파일 멱등: .data는 사이즈가드, 나머지는 존재만으로 스킵.
        if *name == ENCODER_DATA {
            if std::fs::metadata(&dst).map(|m| m.len() >= MIN_ENCODER_DATA_BYTES).unwrap_or(false) {
                continue;
            }
        } else if dst.exists() {
            continue;
        }

        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("download request failed ({url}): {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("download {url} returned HTTP {}", resp.status()));
        }
        let total = resp.content_length().unwrap_or(0);

        let part = part_path(&dst);
        let mut file = tokio::fs::File::create(&part)
            .await
            .map_err(|e| format!("could not create temp {}: {e}", part.display()))?;

        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        let mut stream = resp.bytes_stream();
        let mut received: u64 = 0;
        let mut last_emit: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download stream error ({name}): {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("write error {}: {e}", part.display()))?;
            received += chunk.len() as u64;
            // ~16MB마다 진행률 emit(이벤트 폭주 방지).
            if received - last_emit >= 16 * 1024 * 1024 {
                last_emit = received;
                let _ = app.emit(
                    "stt://model-download",
                    serde_json::json!({
                        "file": name, "received": received, "total": total,
                        "fileIndex": idx, "fileCount": files.len(),
                    }),
                );
            }
        }
        file.flush().await.map_err(|e| format!("flush error: {e}"))?;
        file.sync_all().await.map_err(|e| format!("fsync error: {e}"))?;
        drop(file);

        tokio::fs::rename(&part, &dst).await.map_err(|e| {
            format!("could not rename {} -> {}: {e}", part.display(), dst.display())
        })?;

        let _ = app.emit(
            "stt://model-download",
            serde_json::json!({
                "file": name, "received": received, "total": total,
                "fileIndex": idx, "fileCount": files.len(), "done": true,
            }),
        );
    }

    paths_in(&dir).ok_or_else(|| {
        format!(
            "download incomplete in {} (a file is missing or .data truncated); retry.",
            dir.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write_sized(path: &Path, len: u64, byte: u8) {
        let mut f = fs::File::create(path).unwrap();
        let chunk = vec![byte; 64 * 1024];
        let mut remaining = len;
        while remaining > 0 {
            let n = remaining.min(chunk.len() as u64) as usize;
            f.write_all(&chunk[..n]).unwrap();
            remaining -= n as u64;
        }
        f.sync_all().unwrap();
    }

    fn lay_model(dir: &Path, data_len: u64) {
        fs::create_dir_all(dir).unwrap();
        write_sized(&dir.join(ENCODER), 4096, b'E');
        write_sized(&dir.join(ENCODER_DATA), data_len, b'D');
        write_sized(&dir.join(DECODER), 4096, b'C');
        write_sized(&dir.join(TOKENS), 4096, b'T');
    }

    #[test]
    fn paths_in_some_when_all_present_with_plausible_data_size() {
        let tmp = std::env::temp_dir().join(format!("mp_some_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        write_sized(&tmp.join(ENCODER), 4096, b'E');
        write_sized(&tmp.join(DECODER), 4096, b'C');
        write_sized(&tmp.join(TOKENS), 4096, b'T');
        // 사이즈가드 크기의 sparse 파일 — APFS/ext4서 실 디스크 거의 0.
        let data = fs::File::create(tmp.join(ENCODER_DATA)).unwrap();
        data.set_len(MIN_ENCODER_DATA_BYTES).unwrap();
        data.sync_all().unwrap();

        let got = paths_in(&tmp).expect("all four present + plausible .data → Some");
        assert!(got.encoder.ends_with(ENCODER));
        assert!(got.decoder.ends_with(DECODER));
        assert!(got.tokens.ends_with(TOKENS));
        assert_eq!(got.dir, tmp.to_string_lossy());
        assert!(Path::new(&got.encoder).is_absolute(), "encoder path is absolute");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn paths_in_none_when_one_missing() {
        let tmp = std::env::temp_dir().join(format!("mp_miss_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        write_sized(&tmp.join(ENCODER), 4096, b'E');
        write_sized(&tmp.join(TOKENS), 4096, b'T');
        let data = fs::File::create(tmp.join(ENCODER_DATA)).unwrap();
        data.set_len(MIN_ENCODER_DATA_BYTES).unwrap();
        data.sync_all().unwrap();

        assert!(paths_in(&tmp).is_none(), "missing decoder → None");
        let missing = missing_in(&tmp);
        assert!(missing.contains(&DECODER.to_string()));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn paths_in_none_when_data_is_zero_byte_stub() {
        let tmp = std::env::temp_dir().join(format!("mp_stub_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        lay_model(&tmp, 0);

        assert!(
            paths_in(&tmp).is_none(),
            "0-byte .data stub must fail the size guard → None"
        );
        let missing = missing_in(&tmp);
        assert!(
            missing.contains(&ENCODER_DATA.to_string()),
            "truncated .data reported missing"
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn copy_with_verify_is_byte_exact_and_cleans_part() {
        let tmp = std::env::temp_dir().join(format!("cwv_exact_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let src = tmp.join("src.bin");
        let dst = tmp.join("nested/dst.bin");
        let payload: Vec<u8> = (0..50_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&src, &payload).unwrap();

        copy_with_verify(&src, &dst).expect("copy ok");

        let got = fs::read(&dst).unwrap();
        assert_eq!(got, payload, "byte-exact copy");
        assert!(!part_path(&dst).exists(), "*.part removed after rename");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn copy_with_verify_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!("cwv_idem_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let src = tmp.join("src.bin");
        let dst = tmp.join("dst.bin");
        let payload = b"idempotent payload".to_vec();
        fs::write(&src, &payload).unwrap();

        copy_with_verify(&src, &dst).expect("first copy ok");
        copy_with_verify(&src, &dst).expect("second copy ok (idempotent)");

        assert_eq!(fs::read(&dst).unwrap(), payload);
        assert!(!part_path(&dst).exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn copy_with_verify_recovers_from_leftover_part() {
        let tmp = std::env::temp_dir().join(format!("cwv_part_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let src = tmp.join("src.bin");
        let dst = tmp.join("dst.bin");
        let payload = b"recovered payload".to_vec();
        fs::write(&src, &payload).unwrap();

        let stale = part_path(&dst);
        fs::write(&stale, b"GARBAGE LEFTOVER FROM A CRASH").unwrap();

        copy_with_verify(&src, &dst).expect("recovers from leftover *.part");

        assert_eq!(fs::read(&dst).unwrap(), payload, "stale part overwritten");
        assert!(!part_path(&dst).exists(), "*.part removed after rename");

        let _ = fs::remove_dir_all(&tmp);
    }
}
