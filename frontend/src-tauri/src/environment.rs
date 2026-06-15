//! PATH 해결 + 외부 도구(ruby/bundle/uv/ffmpeg/gem) 탐색·실행.
//!
//! lib.rs god 파일에서 분리. 순수 코드 이동 — 로직·동작 무변경.

use crate::AppState;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

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

// ── PATH 해결 ───────────────────────────────────────

pub fn resolve_shell_path() -> String {
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

pub fn refresh_path(state_path: &str) -> String {
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
pub fn which(cmd: &str, path: &str) -> Option<String> {
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
pub fn get_version(abs_path: &str, args: &[&str]) -> Option<String> {
    Command::new(abs_path)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.lines().next().unwrap_or("").trim().to_string())
}

/// 절대 경로로 Command를 생성하고 환경변수를 설정한다
pub fn tool_command(abs_path: &str, path: &str) -> Command {
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

pub fn run_cmd_with_tools(
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

pub fn run_shell_script(script: &str, path: &str) -> Result<String, String> {
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

/// PATH에서 도구들을 찾아 절대 경로를 반환한다
/// rbenv/pyenv 실제 바이너리를 시스템보다 우선한다
pub fn discover_tools(path: &str) -> ToolPaths {
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

/// 시스템 환경 확인 — 도구를 찾아 절대 경로 + 버전을 저장
#[tauri::command]
pub fn check_environment(app: AppHandle) -> EnvironmentStatus {
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
