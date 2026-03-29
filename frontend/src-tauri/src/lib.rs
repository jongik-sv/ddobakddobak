mod audio;

use serde::Serialize;
use std::net::SocketAddr;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// ── Types ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentStatus {
    pub ruby: Option<String>,
    pub uv: Option<String>,
    pub ffmpeg: Option<String>,
    pub platform: String,
    pub all_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthStatus {
    pub backend: bool,
    pub sidecar: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub step: String,
    pub message: String,
    pub done: bool,
    pub error: Option<String>,
}

// ── State ───────────────────────────────────────────

pub struct AppState {
    backend_process: Mutex<Option<Child>>,
    sidecar_process: Mutex<Option<Child>>,
    project_dir: PathBuf,
    shell_path: String,
}

// ── PATH 해결 ───────────────────────────────────────

/// macOS 앱은 Finder에서 실행 시 기본 PATH만 가진다.
/// 사용자의 로그인 쉘에서 전체 PATH를 가져온다.
fn resolve_shell_path() -> String {
    let default_path = std::env::var("PATH").unwrap_or_default();

    // 이미 homebrew나 uv 경로가 포함되어 있으면 (터미널에서 실행) 그대로 사용
    if default_path.contains("homebrew") || default_path.contains(".local/bin") {
        return default_path;
    }

    // 사용자의 로그인 쉘에서 PATH 가져오기
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let resolved = path.trim().to_string();
                if !resolved.is_empty() {
                    log::info!("Resolved shell PATH: {}", &resolved[..resolved.len().min(100)]);
                    return resolved;
                }
            }
        }
    }

    // 폴백: macOS 공통 경로 추가
    let home = dirs::home_dir().unwrap_or_default();
    let extra_paths: Vec<String> = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        home.join(".local/bin").to_string_lossy().to_string(),
        home.join(".cargo/bin").to_string_lossy().to_string(),
        home.join(".rbenv/shims").to_string_lossy().to_string(),
    ];
    let mut full_path = default_path;
    for p in &extra_paths {
        if !p.is_empty() && !full_path.contains(p.as_str()) {
            full_path = format!("{}:{}", p, full_path);
        }
    }
    full_path
}

// ── Helpers ─────────────────────────────────────────

/// PATH가 적용된 Command 생성
fn shell_command(cmd: &str, path: &str) -> Command {
    let mut c = Command::new(cmd);
    c.env("PATH", path);
    c
}

fn command_output(cmd: &str, args: &[&str], path: &str) -> Option<String> {
    shell_command(cmd, path)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.lines().next().unwrap_or("").trim().to_string())
}

fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

fn run_cmd(
    cmd: &str,
    args: &[&str],
    dir: &Path,
    envs: &[(&str, &str)],
    path: &str,
) -> Result<String, String> {
    let mut command = shell_command(cmd, path);
    command.args(args).current_dir(dir);
    for (k, v) in envs {
        command.env(k, v);
    }
    let output = command
        .output()
        .map_err(|e| format!("{} 실행 실패: {}", cmd, e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!("{} 실패:\n{}\n{}", cmd, stderr, stdout))
    }
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

fn kill_child(proc: &Mutex<Option<Child>>) {
    if let Some(mut child) = proc.lock().unwrap().take() {
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

fn detect_project_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    } else {
        std::env::current_dir().unwrap_or_default()
    }
}

// ── Tauri Commands ──────────────────────────────────

/// 시스템 환경 확인 (ruby, uv, ffmpeg 설치 여부)
#[tauri::command]
fn check_environment(app: AppHandle) -> EnvironmentStatus {
    let state = app.state::<AppState>();
    let path = &state.shell_path;

    let ruby = command_output("ruby", &["--version"], path);
    let uv = command_output("uv", &["--version"], path);
    let ffmpeg = command_output("ffmpeg", &["-version"], path);
    let all_ready = ruby.is_some() && uv.is_some() && ffmpeg.is_some();
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);

    EnvironmentStatus {
        ruby,
        uv,
        ffmpeg,
        platform,
        all_ready,
    }
}

/// 첫 실행 여부 확인 (appData/db 디렉토리 존재 확인)
#[tauri::command]
fn check_first_run(app: AppHandle) -> Result<bool, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(!data_dir.join("db").exists())
}

/// 초기 설정 실행 (bundle install, uv sync, DB 초기화)
#[tauri::command]
fn run_initial_setup(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let project_dir = state.project_dir.clone();
    let path = state.shell_path.clone();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // 데이터 디렉토리 생성
    for sub in &["db", "models", "audio"] {
        std::fs::create_dir_all(data_dir.join(sub)).map_err(|e| e.to_string())?;
    }

    // 1. bundle install
    emit_progress(&app, "bundle_install", "Rails 의존성 설치 중...");
    run_cmd("bundle", &["install"], &project_dir.join("backend"), &[], &path)?;

    // 2. uv sync
    emit_progress(&app, "uv_sync", "Python 의존성 설치 중...");
    run_cmd("uv", &["sync"], &project_dir.join("sidecar"), &[], &path)?;

    // 3. DB 초기화
    emit_progress(&app, "db_setup", "데이터베이스 초기화 중...");
    let db_path = data_dir.join("db").join("production.sqlite3");
    run_cmd(
        "bin/rails",
        &["db:prepare"],
        &project_dir.join("backend"),
        &[
            ("RAILS_ENV", "production"),
            ("DB_PATH", db_path.to_str().unwrap_or_default()),
        ],
        &path,
    )?;

    // 완료
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

/// Rails(3001) + Sidecar(8000) 서비스 시작
#[tauri::command]
fn start_services(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let project_dir = state.project_dir.clone();
    let path = state.shell_path.clone();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("db").join("production.sqlite3");
    let audio_dir = data_dir.join("audio");
    let models_dir = data_dir.join("models");
    let speaker_dbs_dir = data_dir.join("speaker_dbs");

    // 디렉토리 생성
    for dir in [&audio_dir, &models_dir, &speaker_dbs_dir] {
        std::fs::create_dir_all(dir).ok();
    }

    // Rails 서버 (port 3001)
    if is_port_open(3001) {
        log::info!("Backend already running on port 3001");
    } else {
        log::info!("Starting Rails server on port 3001...");
        let backend = shell_command("bin/rails", &path)
            .args(["server", "-p", "3001", "-b", "127.0.0.1"])
            .current_dir(project_dir.join("backend"))
            .env("RAILS_ENV", "production")
            .env("DB_PATH", db_path.to_str().unwrap_or_default())
            .env("AUDIO_DIR", audio_dir.to_str().unwrap_or_default())
            .env("RAILS_LOG_TO_STDOUT", "1")
            .spawn()
            .map_err(|e| format!("Rails 서버 시작 실패: {}", e))?;

        *state.backend_process.lock().unwrap() = Some(backend);
    }

    // Sidecar (port 8000)
    if is_port_open(8000) {
        log::info!("Sidecar already running on port 8000");
    } else {
        log::info!("Starting Sidecar on port 8000...");
        let sidecar = shell_command("uv", &path)
            .args([
                "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000",
            ])
            .current_dir(project_dir.join("sidecar"))
            .env("MODELS_DIR", models_dir.to_str().unwrap_or_default())
            .env("SPEAKER_DBS_DIR", speaker_dbs_dir.to_str().unwrap_or_default())
            .spawn()
            .map_err(|e| format!("Sidecar 시작 실패: {}", e))?;

        *state.sidecar_process.lock().unwrap() = Some(sidecar);
    }

    Ok(())
}

/// 서비스 종료
#[tauri::command]
fn stop_services(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    kill_child(&state.backend_process);
    kill_child(&state.sidecar_process);
    log::info!("All services stopped");
    Ok(())
}

/// 서비스 헬스 체크 (TCP 포트 연결 확인)
#[tauri::command]
fn check_health() -> HealthStatus {
    HealthStatus {
        backend: is_port_open(3001),
        sidecar: is_port_open(8000),
    }
}

// ── App Entry ───────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let project_dir = detect_project_dir();
    let shell_path = resolve_shell_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            backend_process: Mutex::new(None),
            sidecar_process: Mutex::new(None),
            project_dir,
            shell_path,
        })
        .manage(audio::AudioCaptureState::default())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            check_first_run,
            run_initial_setup,
            start_services,
            stop_services,
            check_health,
            audio::start_system_audio_capture,
            audio::stop_system_audio_capture,
            audio::is_system_audio_capturing,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                kill_child(&state.backend_process);
                kill_child(&state.sidecar_process);
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
