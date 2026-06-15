//! 로컬 서비스 오케스트레이션 — 의존성 설치, 초기 셋업, Rails/Sidecar 기동·종료.
//!
//! lib.rs god 파일에서 분리. 순수 코드 이동 — 로직·동작 무변경.

use crate::environment::{
    discover_tools, get_version, refresh_path, run_cmd_with_tools, run_shell_script, tool_command,
    which, EnvironmentStatus,
};
use crate::network::is_port_open;
use crate::sync_ext::LockExt;
use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub step: String,
    pub message: String,
    pub done: bool,
    pub error: Option<String>,
}

fn emit_progress(app: &AppHandle, step: &str, message: &str) {
    app.emit(
        "setup-progress",
        SetupProgress {
            step: step.to_string(),
            message: message.to_string(),
            done: false,
            error: None,
        },
    )
    .ok();
}

pub fn kill_child(proc: &Mutex<Option<Child>>) {
    if let Some(mut child) = proc.lock_safe().take() {
        #[cfg(unix)]
        {
            let pid = child.id();
            Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output()
                .ok();
            std::thread::sleep(Duration::from_secs(2));
        }
        child.kill().ok();
        child.wait().ok();
    }
}

pub fn detect_project_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    } else {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(macos_dir) = exe_path.parent() {
                if let Some(contents_dir) = macos_dir.parent() {
                    let resources = contents_dir.join("Resources");
                    if resources.exists() {
                        return resources;
                    }
                }
            }
        }
        std::env::current_dir().unwrap_or_default()
    }
}

fn work_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        app.state::<AppState>().project_dir.clone()
    } else {
        app.path().app_data_dir().unwrap_or_default()
    }
}

fn sync_resources_to_data(resources_dir: &Path, data_dir: &Path) -> Result<(), String> {
    for name in &["backend", "sidecar", "config.yaml"] {
        let src = resources_dir.join(name);
        let dst = data_dir.join(name);
        if !src.exists() { continue; }
        if src.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::copy(&src, &dst).map_err(|e| format!("파일 복사 실패 {}: {}", name, e))?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("디렉토리 생성 실패: {}", e))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("디렉토리 읽기 실패 {:?}: {}", src, e))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("파일 복사 실패 {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

// ── Tauri Commands ──────────────────────────────────

/// 누락된 의존성을 자동 설치 (Homebrew → Ruby, uv, ffmpeg)
#[tauri::command]
pub fn install_dependencies(app: AppHandle) -> Result<EnvironmentStatus, String> {
    let state = app.state::<AppState>();
    let mut path = state.shell_path.lock_safe().clone();

    // 1. Homebrew
    if which("brew", &path).is_none() {
        emit_progress(&app, "homebrew", "Homebrew 설치 중... (시간이 걸릴 수 있습니다)");
        run_shell_script(
            "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
            &path,
        )?;
        path = refresh_path(&path);
        if !path.contains("/opt/homebrew/bin") {
            path = format!("/opt/homebrew/bin:/opt/homebrew/sbin:{}", path);
        }
    }

    // 2. Ruby
    if which("ruby", &path).is_none() {
        emit_progress(&app, "ruby", "Ruby 설치 중...");
        run_shell_script("brew install ruby", &path)?;
        path = refresh_path(&path);
    }

    // 3. Bundler
    if which("bundle", &path).is_none() {
        emit_progress(&app, "bundler", "Bundler 설치 중...");
        if let Some(gem_path) = which("gem", &path) {
            run_shell_script(&format!("{} install bundler", gem_path), &path)?;
        } else {
            run_shell_script("gem install bundler", &path)?;
        }
    }

    // 4. uv
    if which("uv", &path).is_none() {
        emit_progress(&app, "uv", "uv (Python 패키지 매니저) 설치 중...");
        run_shell_script("curl -LsSf https://astral.sh/uv/install.sh | sh", &path)?;
        path = refresh_path(&path);
        let home = dirs::home_dir().unwrap_or_default();
        let uv_bin = home.join(".local/bin").to_string_lossy().to_string();
        if !path.contains(&uv_bin) {
            path = format!("{}:{}", uv_bin, path);
        }
    }

    // 5. ffmpeg
    if which("ffmpeg", &path).is_none() {
        emit_progress(&app, "ffmpeg", "ffmpeg 설치 중...");
        run_shell_script("brew install ffmpeg", &path)?;
        path = refresh_path(&path);
    }

    *state.shell_path.lock_safe() = path.clone();

    // 도구 재탐색 + 저장
    let tools = discover_tools(&path);
    let ruby_ver = tools.ruby.as_ref().and_then(|p| get_version(p, &["--version"]));
    let uv_ver = tools.uv.as_ref().and_then(|p| get_version(p, &["--version"]));
    let ffmpeg_ver = tools.ffmpeg.as_ref().and_then(|p| get_version(p, &["-version"]));
    let all_ready = ruby_ver.is_some() && uv_ver.is_some() && ffmpeg_ver.is_some();

    *state.tool_paths.lock_safe() = tools;

    if all_ready {
        emit_progress(&app, "deps_done", "모든 의존성 설치 완료!");
    }

    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    Ok(EnvironmentStatus { ruby: ruby_ver, uv: uv_ver, ffmpeg: ffmpeg_ver, platform, all_ready })
}

/// 셋업 필요 여부 확인
#[tauri::command]
pub fn check_first_run(app: AppHandle) -> Result<bool, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let work = work_dir(&app);
    if !data_dir.join("db").exists() {
        log::info!("check_first_run: DB 없음 → setup 필요");
        return Ok(true);
    }
    if !work.join("backend").join("Gemfile").exists() {
        log::info!("check_first_run: backend 소스 없음 → setup 필요");
        return Ok(true);
    }
    if !work.join("backend").join(".bundle").exists() {
        log::info!("check_first_run: gems 미설치 → setup 필요");
        return Ok(true);
    }
    Ok(false)
}

/// 초기 설정 (소스 복사, bundle install, uv sync, DB 초기화)
#[tauri::command]
pub fn run_initial_setup(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let project_dir = state.project_dir.clone();
    let path = state.shell_path.lock_safe().clone();
    let tools = state.tool_paths.lock_safe().clone();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    for sub in &["db", "models", "audio", "speaker_dbs"] {
        std::fs::create_dir_all(data_dir.join(sub)).map_err(|e| e.to_string())?;
    }

    // 프로덕션: Resources → appData 복사
    if !cfg!(debug_assertions) {
        emit_progress(&app, "copy_source", "앱 소스 복사 중...");
        sync_resources_to_data(&project_dir, &data_dir)?;
    }

    let work = work_dir(&app);

    // 1. bundle install (절대 경로 사용)
    emit_progress(&app, "bundle_install", "Rails 의존성 설치 중...");
    log::info!("bundle install: bundle={:?}", tools.bundle);
    run_cmd_with_tools("bundle", &["install"], &work.join("backend"), &[], &tools, &path)?;

    // 2. uv sync (절대 경로 사용)
    emit_progress(&app, "uv_sync", "Python 의존성 설치 중...");
    log::info!("uv sync: uv={:?}", tools.uv);
    let uv_extra = if cfg!(target_os = "macos") {
        "--extra=macos"
    } else if cfg!(target_os = "windows") {
        "--extra=windows"
    } else {
        "--extra=linux-cpu"
    };
    run_cmd_with_tools("uv", &["sync", uv_extra], &work.join("sidecar"), &[], &tools, &path)?;

    // 3. DB 초기화 (bin/rails는 상대 경로이므로 ruby를 통해 실행)
    emit_progress(&app, "db_setup", "데이터베이스 초기화 중...");
    let db_path = data_dir.join("db").join("production.sqlite3");
    run_cmd_with_tools(
        "ruby",
        &["bin/rails", "db:prepare"],
        &work.join("backend"),
        &[
            ("RAILS_ENV", "production"),
            ("DB_PATH", db_path.to_str().unwrap_or_default()),
        ],
        &tools,
        &path,
    )?;

    app.emit(
        "setup-progress",
        SetupProgress {
            step: "done".to_string(),
            message: "초기 설정이 완료되었습니다!".to_string(),
            done: true,
            error: None,
        },
    )
    .ok();

    Ok(())
}

/// Rails(13323) + Sidecar(13324) 서비스 시작
#[tauri::command]
pub fn start_services(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let path = state.shell_path.lock_safe().clone();
    let tools = state.tool_paths.lock_safe().clone();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let work = work_dir(&app);
    let db_path = data_dir.join("db").join("production.sqlite3");
    let audio_dir = data_dir.join("audio");
    let models_dir = data_dir.join("models");
    let speaker_dbs_dir = data_dir.join("speaker_dbs");

    for dir in [&audio_dir, &models_dir, &speaker_dbs_dir] {
        std::fs::create_dir_all(dir).ok();
    }

    // 프로덕션: 소스 미복사 시 복사
    if !cfg!(debug_assertions) && !work.join("backend").join("Gemfile").exists() {
        let resources = state.project_dir.clone();
        sync_resources_to_data(&resources, &data_dir)?;
    }

    // Rails (절대 경로로 ruby 실행)
    if is_port_open(13323) {
        log::info!("Backend already running on port 13323");
    } else {
        let ruby_path = tools.ruby.as_deref().unwrap_or("ruby");
        log::info!("Starting Rails: ruby={} work={}", ruby_path, work.join("backend").display());

        let mut backend = tool_command(ruby_path, &path)
            .args(["bin/rails", "server", "-p", "13323", "-b", "0.0.0.0"])
            .current_dir(work.join("backend"))
            .env("SERVER_MODE", "true")
            .env("RAILS_ENV", "production")
            .env("DB_PATH", db_path.to_str().unwrap_or_default())
            .env("AUDIO_DIR", audio_dir.to_str().unwrap_or_default())
            .env("RAILS_LOG_TO_STDOUT", "1")
            .env("SOLID_QUEUE_IN_PUMA", "1")
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Rails 서버 시작 실패: {}", e))?;

        std::thread::sleep(Duration::from_secs(2));
        match backend.try_wait() {
            Ok(Some(status)) => {
                let stderr = backend.stderr.take()
                    .map(|mut s| { let mut buf = String::new(); std::io::Read::read_to_string(&mut s, &mut buf).ok(); buf })
                    .unwrap_or_default();
                log::error!("Rails 즉시 종료 (code={}): {}", status, stderr.chars().take(500).collect::<String>());
                return Err(format!("Rails 서버가 즉시 종료됨: {}", stderr.chars().take(300).collect::<String>()));
            }
            Ok(None) => log::info!("Rails 프로세스 실행 중 (pid={})", backend.id()),
            Err(e) => log::warn!("Rails 상태 확인 실패: {}", e),
        }
        *state.backend_process.lock_safe() = Some(backend);
    }

    // Sidecar (절대 경로로 uv 실행)
    if is_port_open(13324) {
        log::info!("Sidecar already running on port 13324");
    } else {
        let uv_path = tools.uv.as_deref().unwrap_or("uv");
        log::info!("Starting Sidecar: uv={} work={}", uv_path, work.join("sidecar").display());

        let mut sidecar = tool_command(uv_path, &path)
            .args(["run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "13324"])
            .current_dir(work.join("sidecar"))
            .env("MODELS_DIR", models_dir.to_str().unwrap_or_default())
            .env("SPEAKER_DBS_DIR", speaker_dbs_dir.to_str().unwrap_or_default())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Sidecar 시작 실패: {}", e))?;

        std::thread::sleep(Duration::from_secs(2));
        match sidecar.try_wait() {
            Ok(Some(status)) => {
                let stderr = sidecar.stderr.take()
                    .map(|mut s| { let mut buf = String::new(); std::io::Read::read_to_string(&mut s, &mut buf).ok(); buf })
                    .unwrap_or_default();
                log::error!("Sidecar 즉시 종료 (code={}): {}", status, stderr.chars().take(500).collect::<String>());
                return Err(format!("Sidecar가 즉시 종료됨: {}", stderr.chars().take(300).collect::<String>()));
            }
            Ok(None) => log::info!("Sidecar 프로세스 실행 중 (pid={})", sidecar.id()),
            Err(e) => log::warn!("Sidecar 상태 확인 실패: {}", e),
        }
        *state.sidecar_process.lock_safe() = Some(sidecar);
    }

    Ok(())
}

/// 서비스 종료
#[tauri::command]
pub fn stop_services(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    kill_child(&state.backend_process);
    kill_child(&state.sidecar_process);
    log::info!("All services stopped");
    Ok(())
}
