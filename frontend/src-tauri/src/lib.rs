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

#[derive(Debug, Clone, Serialize, Default)]
pub struct ToolPaths {
    pub ruby: Option<String>,
    pub bundle: Option<String>,
    pub uv: Option<String>,
    pub ffmpeg: Option<String>,
    pub gem: Option<String>,
}

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
    shell_path: Mutex<String>,
    tool_paths: Mutex<ToolPaths>,
}

// ── PATH 해결 ───────────────────────────────────────

fn resolve_shell_path() -> String {
    let default_path = std::env::var("PATH").unwrap_or_default();

    let mut base_path = default_path.clone();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let resolved = path.trim().to_string();
                if !resolved.is_empty() {
                    base_path = resolved;
                }
            }
        }
    }

    // macOS 공통 경로를 PATH 앞에 보강
    let home = dirs::home_dir().unwrap_or_default();
    let priority_paths: Vec<String> = vec![
        rbenv_real_bin_dir().unwrap_or_default(),
        home.join(".rbenv/shims").to_string_lossy().to_string(),
        home.join(".local/bin").to_string_lossy().to_string(),
        home.join(".cargo/bin").to_string_lossy().to_string(),
        home.join(".pyenv/shims").to_string_lossy().to_string(),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    for p in priority_paths.iter().rev() {
        if !p.is_empty() {
            let mut paths: Vec<&str> = base_path.split(':').filter(|s| *s != p).collect();
            paths.insert(0, p);
            base_path = paths.join(":");
        }
    }
    base_path
}

fn refresh_path(state_path: &str) -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut base_path = state_path.to_string();
    if let Ok(output) = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let resolved = path.trim().to_string();
                if !resolved.is_empty() {
                    base_path = resolved;
                }
            }
        }
    }

    let home = dirs::home_dir().unwrap_or_default();
    let priority_paths: Vec<String> = vec![
        rbenv_real_bin_dir().unwrap_or_default(),
        home.join(".rbenv/shims").to_string_lossy().to_string(),
        home.join(".local/bin").to_string_lossy().to_string(),
        home.join(".cargo/bin").to_string_lossy().to_string(),
        home.join(".pyenv/shims").to_string_lossy().to_string(),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    for p in priority_paths.iter().rev() {
        if !p.is_empty() {
            let mut paths: Vec<&str> = base_path.split(':').filter(|s| *s != p).collect();
            paths.insert(0, p);
            base_path = paths.join(":");
        }
    }
    base_path
}

// ── Helpers ─────────────────────────────────────────

/// rbenv의 실제 Ruby 바이너리 디렉토리 (shims가 아님)
fn rbenv_real_bin_dir() -> Option<String> {
    let home = dirs::home_dir()?;
    let rbenv_root = home.join(".rbenv");
    let version = std::fs::read_to_string(rbenv_root.join("version")).ok()?;
    let version = version.trim();
    let bin_dir = rbenv_root.join("versions").join(version).join("bin");
    if bin_dir.exists() {
        Some(bin_dir.to_string_lossy().to_string())
    } else {
        None
    }
}

/// PATH에서 실행파일의 절대 경로를 찾는다
fn which(cmd: &str, path: &str) -> Option<String> {
    if cmd.contains('/') {
        if Path::new(cmd).exists() {
            return Some(cmd.to_string());
        }
        return None;
    }
    for dir in path.split(':') {
        if dir.is_empty() { continue; }
        let candidate = Path::new(dir).join(cmd);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// 절대 경로로 실행파일의 버전을 가져온다
fn get_version(abs_path: &str, args: &[&str]) -> Option<String> {
    Command::new(abs_path)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.lines().next().unwrap_or("").trim().to_string())
}

/// 절대 경로로 Command를 생성하고 환경변수를 설정한다
fn tool_command(abs_path: &str, path: &str) -> Command {
    let mut c = Command::new(abs_path);
    c.env("PATH", path);

    // rbenv 환경 변수 설정
    let home = dirs::home_dir().unwrap_or_default();
    let rbenv_root = home.join(".rbenv");
    if rbenv_root.exists() {
        c.env("RBENV_ROOT", &rbenv_root);
        if let Ok(version) = std::fs::read_to_string(rbenv_root.join("version")) {
            let version = version.trim().to_string();
            if !version.is_empty() {
                c.env("RBENV_VERSION", &version);
                // GEM_HOME/GEM_PATH
                let gem_dir = rbenv_root.join("versions").join(&version).join("lib/ruby/gems");
                if let Ok(entries) = std::fs::read_dir(&gem_dir) {
                    if let Some(Ok(entry)) = entries.into_iter().next() {
                        let gem_path = entry.path().to_string_lossy().to_string();
                        c.env("GEM_HOME", &gem_path);
                        c.env("GEM_PATH", &gem_path);
                    }
                }
            }
        }
    }
    c
}

/// 도구의 절대 경로 또는 이름으로 Command를 생성 (tool_paths에서 먼저 찾고, 없으면 which)
fn make_command(cmd: &str, tools: &ToolPaths, path: &str) -> Command {
    let abs = match cmd {
        "ruby" => tools.ruby.clone(),
        "bundle" => tools.bundle.clone(),
        "uv" => tools.uv.clone(),
        "ffmpeg" => tools.ffmpeg.clone(),
        "gem" => tools.gem.clone(),
        _ => None,
    };
    let resolved = abs
        .or_else(|| which(cmd, path))
        .unwrap_or_else(|| cmd.to_string());
    tool_command(&resolved, path)
}

/// Ruby 기반 도구(bundle, gem)인지 확인
fn is_ruby_tool(cmd: &str) -> bool {
    matches!(cmd, "bundle" | "gem")
}

fn run_cmd_with_tools(
    cmd: &str,
    args: &[&str],
    dir: &Path,
    envs: &[(&str, &str)],
    tools: &ToolPaths,
    path: &str,
) -> Result<String, String> {
    // Ruby 기반 도구(bundle, gem)는 shebang이 /usr/bin/env ruby를 사용하므로
    // 시스템 Ruby로 실행될 수 있다. 이를 방지하기 위해
    // ruby <tool_path> <args...> 형태로 실행한다.
    let mut command = if is_ruby_tool(cmd) {
        let ruby_abs = tools.ruby.as_deref().unwrap_or("ruby");
        let tool_abs = match cmd {
            "bundle" => tools.bundle.clone(),
            "gem" => tools.gem.clone(),
            _ => None,
        }
        .or_else(|| which(cmd, path))
        .unwrap_or_else(|| cmd.to_string());

        log::info!("Ruby 도구 실행: {} {} {:?}", ruby_abs, tool_abs, args);
        let mut c = tool_command(ruby_abs, path);
        c.arg(&tool_abs);
        c
    } else {
        make_command(cmd, tools, path)
    };

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

fn run_shell_script(script: &str, path: &str) -> Result<String, String> {
    let output = Command::new("/bin/bash")
        .args(["-c", script])
        .env("PATH", path)
        .output()
        .map_err(|e| format!("스크립트 실행 실패: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("스크립트 실패: {}", stderr))
    }
}

fn is_port_open(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
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

/// PATH에서 도구들을 찾아 절대 경로를 반환한다
/// rbenv/pyenv 실제 바이너리를 시스템보다 우선한다
fn discover_tools(path: &str) -> ToolPaths {
    // rbenv 실제 바이너리 경로를 최우선으로 체크
    let rbenv_bin = rbenv_real_bin_dir();

    let find = |cmd: &str| -> Option<String> {
        // 1순위: rbenv 실제 바이너리
        if let Some(ref dir) = rbenv_bin {
            let candidate = Path::new(dir).join(cmd);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        // 2순위: PATH 탐색 (시스템 경로 제외)
        for dir in path.split(':') {
            if dir.starts_with("/System/") || dir == "/usr/bin" || dir == "/usr/sbin" {
                continue;
            }
            let candidate = Path::new(dir).join(cmd);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        // 3순위: 시스템 경로 포함 전체 PATH
        which(cmd, path)
    };

    ToolPaths {
        ruby: find("ruby"),
        bundle: find("bundle"),
        uv: find("uv"),
        ffmpeg: find("ffmpeg"),
        gem: find("gem"),
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

/// 시스템 환경 확인 — 도구를 찾아 절대 경로 + 버전을 저장
#[tauri::command]
fn check_environment(app: AppHandle) -> EnvironmentStatus {
    let state = app.state::<AppState>();

    // PATH 새로고침
    let refreshed = refresh_path(&state.shell_path.lock().unwrap());
    *state.shell_path.lock().unwrap() = refreshed.clone();
    let path = refreshed;

    // 도구 탐색 — 절대 경로 저장
    let tools = discover_tools(&path);
    log::info!(
        "도구 경로: ruby={:?} bundle={:?} uv={:?} ffmpeg={:?}",
        tools.ruby, tools.bundle, tools.uv, tools.ffmpeg
    );

    let ruby_ver = tools.ruby.as_ref().and_then(|p| get_version(p, &["--version"]));
    let uv_ver = tools.uv.as_ref().and_then(|p| get_version(p, &["--version"]));
    let ffmpeg_ver = tools.ffmpeg.as_ref().and_then(|p| get_version(p, &["-version"]));

    let all_ready = ruby_ver.is_some() && uv_ver.is_some() && ffmpeg_ver.is_some();

    // 절대 경로를 state에 저장
    *state.tool_paths.lock().unwrap() = tools;

    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    EnvironmentStatus { ruby: ruby_ver, uv: uv_ver, ffmpeg: ffmpeg_ver, platform, all_ready }
}

/// 누락된 의존성을 자동 설치 (Homebrew → Ruby, uv, ffmpeg)
#[tauri::command]
fn install_dependencies(app: AppHandle) -> Result<EnvironmentStatus, String> {
    let state = app.state::<AppState>();
    let mut path = state.shell_path.lock().unwrap().clone();

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

    *state.shell_path.lock().unwrap() = path.clone();

    // 도구 재탐색 + 저장
    let tools = discover_tools(&path);
    let ruby_ver = tools.ruby.as_ref().and_then(|p| get_version(p, &["--version"]));
    let uv_ver = tools.uv.as_ref().and_then(|p| get_version(p, &["--version"]));
    let ffmpeg_ver = tools.ffmpeg.as_ref().and_then(|p| get_version(p, &["-version"]));
    let all_ready = ruby_ver.is_some() && uv_ver.is_some() && ffmpeg_ver.is_some();

    *state.tool_paths.lock().unwrap() = tools;

    if all_ready {
        emit_progress(&app, "deps_done", "모든 의존성 설치 완료!");
    }

    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    Ok(EnvironmentStatus { ruby: ruby_ver, uv: uv_ver, ffmpeg: ffmpeg_ver, platform, all_ready })
}

/// 셋업 필요 여부 확인
#[tauri::command]
fn check_first_run(app: AppHandle) -> Result<bool, String> {
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
fn run_initial_setup(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let project_dir = state.project_dir.clone();
    let path = state.shell_path.lock().unwrap().clone();
    let tools = state.tool_paths.lock().unwrap().clone();
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
fn start_services(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let path = state.shell_path.lock().unwrap().clone();
    let tools = state.tool_paths.lock().unwrap().clone();
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
            .args(["bin/rails", "server", "-p", "13323", "-b", "127.0.0.1"])
            .current_dir(work.join("backend"))
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
        *state.backend_process.lock().unwrap() = Some(backend);
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

/// 서비스 헬스 체크
#[tauri::command]
fn check_health() -> HealthStatus {
    HealthStatus {
        backend: is_port_open(13323),
        sidecar: is_port_open(13324),
    }
}

// ── App Entry ───────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let project_dir = detect_project_dir();
    let shell_path = resolve_shell_path();
    let tool_paths = discover_tools(&shell_path);

    log::info!("project_dir={}", project_dir.display());
    log::info!("초기 도구 경로: ruby={:?} bundle={:?} uv={:?}", tool_paths.ruby, tool_paths.bundle, tool_paths.uv);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            backend_process: Mutex::new(None),
            sidecar_process: Mutex::new(None),
            project_dir,
            shell_path: Mutex::new(shell_path),
            tool_paths: Mutex::new(tool_paths),
        })
        .manage(audio::AudioCaptureState::default())
        .manage(audio::RecorderState::default())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            install_dependencies,
            check_first_run,
            run_initial_setup,
            start_services,
            stop_services,
            check_health,
            audio::start_system_audio_capture,
            audio::stop_system_audio_capture,
            audio::is_system_audio_capturing,
            audio::start_recording,
            audio::stop_recording,
            audio::pause_recording,
            audio::resume_recording,
            audio::feed_recorder_mic,
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
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
