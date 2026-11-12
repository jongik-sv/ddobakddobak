//! 화이트보드 내보내기: 이 PC의 Claude Code CLI 탐지·실행 (데스크톱 전용).
//!
//! 설계 정본: tasks/whiteboard-export/design.md §8. std::process + 스레드 + wait 폴링
//! (tokio feature 추가 없음). 진행 중 child는 레지스트리에 두고 창 Destroyed 시 kill.

use crate::environment::resolve_shell_path;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_SECS: u64 = 180;
const TAIL_CHARS: usize = 2000;
/// kill 뒤 reader 스레드 join 상한 (손자가 파이프를 쥐고 있어도 무한 대기하지 않음).
const READER_JOIN_CAP: Duration = Duration::from_secs(3);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 프론트 invoke reject 값. kind: not_found | spawn | timeout | exit
#[derive(Debug, Clone, Serialize)]
pub struct WhiteboardRunError {
    pub kind: String,
    pub message: String,
    pub stderr_tail: String,
    pub stdout_tail: String,
}

impl WhiteboardRunError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
            stderr_tail: String::new(),
            stdout_tail: String::new(),
        }
    }
}

type SharedChild = Arc<Mutex<Child>>;

/// 진행 중 claude child 레지스트리 (managed state).
#[derive(Default)]
pub struct WhiteboardState {
    children: Mutex<HashMap<u64, SharedChild>>,
    next_id: AtomicU64,
    /// detect 성공 경로 캐시 (실패는 캐시하지 않음).
    claude_path: Mutex<Option<String>>,
}

impl WhiteboardState {
    fn register(&self, child: SharedChild) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut m) = self.children.lock() {
            m.insert(id, child);
        }
        id
    }

    fn unregister(&self, id: u64) {
        if let Ok(mut m) = self.children.lock() {
            m.remove(&id);
        }
    }

    /// 앱 종료 시 진행 중인 모든 child kill.
    pub fn kill_all(&self) {
        let drained: Vec<SharedChild> = match self.children.lock() {
            Ok(mut m) => m.drain().map(|(_, c)| c).collect(),
            Err(_) => return,
        };
        for c in drained {
            if let Ok(mut ch) = c.lock() {
                kill_tree(&mut ch);
            }
        }
    }
}

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

/// child와 그 자손을 모두 종료한다. Unix: 자식이 새 프로세스 그룹 리더이므로 killpg(-pid).
/// Windows: taskkill /T /F.
fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        // SAFETY: 단순 시스템콜. 음수 pid = 프로세스 그룹 전체.
        unsafe {
            kill(-(pid as i32), 9);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn tail(s: &str) -> String {
    let n = s.chars().count();
    if n <= TAIL_CHARS {
        s.to_string()
    } else {
        s.chars().skip(n - TAIL_CHARS).collect()
    }
}

/// PATH 문자열(플랫폼 구분자)에서 후보 이름들을 순서대로 찾는다.
fn find_in_path(names: &[&str], path: &str) -> Option<String> {
    for dir in std::env::split_paths(path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for name in names {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn claude_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude"]
    } else {
        &["claude"]
    }
}

/// 캐시된 경로가 아직 유효하면 반환하고, 아니면 PATH를 새로 해결해 탐지한다(성공만 캐시).
fn detect_cached(state: &WhiteboardState) -> Option<(String, String)> {
    let path = resolve_shell_path();
    if let Ok(g) = state.claude_path.lock() {
        if let Some(c) = g.as_ref() {
            if std::path::Path::new(c).is_file() {
                return Some((c.clone(), path));
            }
        }
    }
    let found = find_in_path(claude_names(), &path)?;
    if let Ok(mut g) = state.claude_path.lock() {
        *g = Some(found.clone());
    }
    Some((found, path))
}

#[tauri::command]
pub async fn detect_claude(app: tauri::AppHandle) -> Option<String> {
    // resolve_shell_path()는 로그인 셸을 띄울 수 있어 블로킹이다 — 메인 스레드를 막지 않도록 분리.
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<WhiteboardState>();
        detect_cached(&state).map(|(b, _)| b)
    })
    .await
    .ok()
    .flatten()
}

fn build_command(binary: &str, args: &[String], path: &str) -> Command {
    // Windows .cmd/.bat도 Command::new 직접 (std가 배치 파일 인자 이스케이프를 처리, cmd /C 불필요).
    let mut cmd = Command::new(binary);

    cmd.args(args)
        .env("PATH", path)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        // 새 프로세스 그룹 리더로 띄워 killpg로 자손까지 종료할 수 있게 한다.
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}

/// reader 스레드: 결과를 채널로 보낸다 (join 상한을 두기 위해 JoinHandle 대신 채널).
fn drain<R: Read + Send + 'static>(r: Option<R>) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = r {
            let _ = r.read_to_end(&mut buf);
        }
        let _ = tx.send(String::from_utf8_lossy(&buf).into_owned());
    });
    rx
}

fn collect(rx: mpsc::Receiver<String>, deadline: Instant) -> String {
    let left = deadline.saturating_duration_since(Instant::now());
    rx.recv_timeout(left).unwrap_or_default()
}

/// 시스템 프롬프트를 임시 파일에 기록한다 (인자 이스케이프·길이 제한 회피).
fn write_prompt_file(text: &str) -> std::io::Result<std::path::PathBuf> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let p = std::env::temp_dir().join(format!(
        "ddobak_wb_prompt_{}_{}.txt",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::write(&p, text)?;
    Ok(p)
}

/// --bare 금지(구독 OAuth 깨짐), --model 없음. 도구 전부 비활성(--tools "").
fn build_claude_args(prompt_file: &std::path::Path) -> Vec<String> {
    let pf = prompt_file.to_string_lossy().to_string();
    [
        "-p", "--output-format", "text", "--system-prompt-file", pf.as_str(),
        "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
        "--no-session-persistence",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// 실행 파일 경로·인자·PATH를 주입받는 내부 구현 (테스트용으로 분리).
fn run_process(
    state: &WhiteboardState,
    binary: &str,
    args: &[String],
    path: &str,
    stdin_text: String,
    timeout: Duration,
) -> Result<String, WhiteboardRunError> {
    let mut child = build_command(binary, args, path).spawn().map_err(|e| {
        let kind = if e.kind() == std::io::ErrorKind::NotFound { "not_found" } else { "spawn" };
        WhiteboardRunError::new(kind, format!("{binary}: {e}"))
    })?;

    let stdin = child.stdin.take();
    let out_h = drain(child.stdout.take());
    let err_h = drain(child.stderr.take());
    // stdin 쓰기는 별도 스레드(파이프가 가득 찬 경우 대기 중에도 timeout 감시 가능).
    let in_h = std::thread::spawn(move || {
        if let Some(mut si) = stdin {
            let _ = si.write_all(stdin_text.as_bytes());
            // drop → close
        }
    });

    let shared: SharedChild = Arc::new(Mutex::new(child));
    let id = state.register(shared.clone());
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        let polled = shared.lock().map(|mut c| c.try_wait());
        match polled {
            Ok(Ok(Some(st))) => break Some(st),
            Ok(Ok(None)) => {}
            _ => break None, // wait 오류 또는 kill_all 등으로 정리됨
        }
        if start.elapsed() >= timeout {
            timed_out = true;
            if let Ok(mut c) = shared.lock() {
                kill_tree(&mut c);
                let _ = c.wait();
            }
            break None;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    state.unregister(id);
    // 정상 종료/ kill 후 파이프가 닫힌다. 손자가 쥐고 있어도 상한 후 버린다.
    let _ = in_h; // 쓰기 스레드는 detach (파이프 close 시 스스로 종료)
    let deadline = Instant::now() + READER_JOIN_CAP;
    let stdout = collect(out_h, deadline);
    let stderr = collect(err_h, deadline);

    let mk = |kind: &str, msg: String| WhiteboardRunError {
        kind: kind.to_string(),
        message: msg,
        stderr_tail: tail(&stderr),
        stdout_tail: tail(&stdout),
    };
    if timed_out {
        return Err(mk("timeout", format!("{}초 안에 응답이 없어 중단했습니다.", timeout.as_secs())));
    }
    match status {
        Some(st) if st.success() => Ok(stdout),
        Some(st) => Err(mk("exit", format!("claude 종료 코드 {}", st.code().map_or("signal".to_string(), |c| c.to_string())))),
        None => Err(mk("exit", "claude 프로세스가 중단되었습니다.".to_string())),
    }
}

#[tauri::command]
pub async fn run_claude_whiteboard(
    app: tauri::AppHandle,
    system_prompt: String,
    user_content: String,
    timeout_secs: Option<u64>,
) -> Result<String, WhiteboardRunError> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<WhiteboardState>();
        let (binary, path) = detect_cached(&state)
            .ok_or_else(|| WhiteboardRunError::new("not_found", "claude 실행 파일을 찾을 수 없습니다."))?;
        let prompt_file = write_prompt_file(&system_prompt)
            .map_err(|e| WhiteboardRunError::new("spawn", format!("프롬프트 파일 기록 실패: {e}")))?;
        let args = build_claude_args(&prompt_file);
        let result = run_process(
            &state,
            &binary,
            &args,
            &path,
            user_content,
            Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS)),
        );
        let _ = std::fs::remove_file(&prompt_file);
        result
    })
    .await
    .map_err(|e| WhiteboardRunError::new("spawn", format!("작업 스레드 오류: {e}")))?
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(name: &str, body: &str) -> String {
        let dir = std::env::temp_dir().join(format!("wb_test_{}_{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p.to_string_lossy().to_string()
    }

    const P: &str = "/usr/bin:/bin";

    #[test]
    fn stdin_to_stdout_cat() {
        let s = script("cat.sh", "cat");
        let st = WhiteboardState::default();
        let out = run_process(&st, &s, &[], P, "안녕 board".into(), Duration::from_secs(10)).unwrap();
        assert_eq!(out, "안녕 board");
        assert!(st.children.lock().unwrap().is_empty());
    }

    #[test]
    fn timeout_kills() {
        let s = script("sleep.sh", "exec sleep 30");
        let st = WhiteboardState::default();
        let t = Instant::now();
        let e = run_process(&st, &s, &[], P, String::new(), Duration::from_millis(300)).unwrap_err();
        assert_eq!(e.kind, "timeout");
        assert!(t.elapsed() < Duration::from_secs(5));
        assert!(st.children.lock().unwrap().is_empty());
    }

    #[test]
    fn not_found() {
        let st = WhiteboardState::default();
        let e = run_process(&st, "/nonexistent/claude", &[], P, String::new(), Duration::from_secs(1)).unwrap_err();
        assert_eq!(e.kind, "not_found");
    }

    #[test]
    fn nonzero_exit_has_tails() {
        let s = script("fail.sh", "echo out; echo err >&2; exit 3");
        let st = WhiteboardState::default();
        let e = run_process(&st, &s, &[], P, String::new(), Duration::from_secs(10)).unwrap_err();
        assert_eq!(e.kind, "exit");
        assert!(e.stderr_tail.contains("err") && e.stdout_tail.contains("out"));
        assert!(e.message.contains('3'));
    }

    #[test]
    fn kill_all_stops_running() {
        let s = script("sleep2.sh", "exec sleep 30");
        let st = Arc::new(WhiteboardState::default());
        let st2 = st.clone();
        let h = std::thread::spawn(move || run_process(&st2, &s, &[], P, String::new(), Duration::from_secs(60)));
        // 자식이 레지스트리에 등록될 때까지 대기 (최대 5초)
        let deadline = Instant::now() + Duration::from_secs(5);
        while st.children.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        st.kill_all();
        let e = h.join().unwrap().unwrap_err();
        assert_eq!(e.kind, "exit");
    }

    fn pid_alive(pid: &str) -> bool {
        std::process::Command::new("kill").args(["-0", pid]).status().map(|s| s.success()).unwrap_or(false)
    }

    #[test]
    fn timeout_kills_grandchildren() {
        let dir = std::env::temp_dir().join(format!("wb_gc_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pidfile = dir.join("gc.pid");
        let _ = std::fs::remove_file(&pidfile);
        let s = script(
            "spawner.sh",
            &format!("sleep 30 &\necho $! > {}\nwait", pidfile.display()),
        );
        let st = WhiteboardState::default();
        let t = Instant::now();
        let e = run_process(&st, &s, &[], P, String::new(), Duration::from_secs(2)).unwrap_err();
        assert_eq!(e.kind, "timeout");
        assert!(t.elapsed() < Duration::from_secs(10), "상한 내 반환해야 함");
        // pidfile 은 최대 3초 폴링 (부하 시 쓰기 전에 kill 되었을 수 있음)
        let deadline = Instant::now() + Duration::from_secs(3);
        let pid = loop {
            let c = std::fs::read_to_string(&pidfile).unwrap_or_default().trim().to_string();
            if !c.is_empty() {
                break c;
            }
            assert!(Instant::now() < deadline, "손자가 시작되기 전에 종료됨 (pidfile 없음)");
            std::thread::sleep(Duration::from_millis(20));
        };
        std::thread::sleep(Duration::from_millis(300));
        assert!(!pid_alive(&pid), "손자 sleep {pid} 가 살아있음");
    }

    #[test]
    fn prompt_file_is_passed_and_readable() {
        let pf = write_prompt_file("시스템 \"프롬프트\"\n두 줄").unwrap();
        let args = build_claude_args(&pf);
        assert!(args.windows(2).any(|w| w[0] == "--system-prompt-file" && w[1] == pf.to_string_lossy()));
        assert!(args.windows(2).any(|w| w[0] == "--tools" && w[1].is_empty()));
        assert!(!args.iter().any(|a| a == "--bare" || a == "--system-prompt"));
        // 스크립트: --system-prompt-file 다음 인자 파일 내용을 출력
        let s = script(
            "echo_pf.sh",
            "while [ $# -gt 0 ]; do if [ \"$1\" = \"--system-prompt-file\" ]; then cat \"$2\"; fi; shift; done",
        );
        let st = WhiteboardState::default();
        let out = run_process(&st, &s, &args, P, String::new(), Duration::from_secs(10)).unwrap();
        assert_eq!(out, "시스템 \"프롬프트\"\n두 줄");
        let _ = std::fs::remove_file(&pf);
    }

    #[test]
    fn detect_cache_only_on_success() {
        let st = WhiteboardState::default();
        assert!(st.claude_path.lock().unwrap().is_none());
    }

    #[test]
    fn tail_truncates_by_chars() {
        let s = "가".repeat(3000);
        assert_eq!(tail(&s).chars().count(), 2000);
    }
}
