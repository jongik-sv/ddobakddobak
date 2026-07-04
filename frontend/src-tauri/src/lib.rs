#[cfg(desktop)]
mod audio;

#[cfg(desktop)]
mod tray;

#[cfg(desktop)]
mod window_cmd;

#[cfg(desktop)]
mod scheduler;

#[cfg(desktop)]
mod assertion;

mod bridge;
mod mdns;

// Mutex poison 복구 헬퍼(lock_safe). 모든 모듈에서 공유.
mod sync_ext;

// health 체크 + LAN 서버 스캔(디스커버리). lib.rs에서 분리.
mod network;

// PATH 해결 + 외부 도구 탐색/실행. lib.rs에서 분리.
mod environment;

// 로컬 서비스 오케스트레이션(설치·셋업·Rails/Sidecar 기동). lib.rs에서 분리.
mod services;

// EOS 누수 컷(순수 헬퍼) — 모든 타깃에서 컴파일·호스트 테스트. cohere_ffi가 사용.
mod text_post;

// 모델 경로 해석/스테이징 복사. command는 android-gated지만 순수 헬퍼+테스트는
// 비게이트라 호스트에서 검증된다.
mod model_path;

// ── 온디바이스 STT (Android 전용) ──
// sherpa C-API in-process 전사. 데스크톱 STT는 sidecar 경로라 미사용.
#[cfg(target_os = "android")]
mod cohere_ffi;
#[cfg(target_os = "android")]
mod stt;

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;

// 분리된 모듈에서 run() 진입점이 직접 쓰는 것만 가져온다.
use environment::{discover_tools, resolve_shell_path, ToolPaths};
use services::{detect_project_dir, kill_child};

// ── State ───────────────────────────────────────────

pub struct AppState {
    backend_process: Mutex<Option<Child>>,
    sidecar_process: Mutex<Option<Child>>,
    project_dir: PathBuf,
    shell_path: Mutex<String>,
    tool_paths: Mutex<ToolPaths>,
}

// ── App Entry ───────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    // ── 데스크톱 전용: 프로세스 오케스트레이션 + 네이티브 오디오 ──
    #[cfg(desktop)]
    let builder = {
        let project_dir = detect_project_dir();
        let shell_path = resolve_shell_path();
        let tool_paths = discover_tools(&shell_path);

        log::info!("project_dir={}", project_dir.display());
        log::info!(
            "초기 도구 경로: ruby={:?} bundle={:?} uv={:?}",
            tool_paths.ruby, tool_paths.bundle, tool_paths.uv
        );

        builder
            .manage(AppState {
                backend_process: Mutex::new(None),
                sidecar_process: Mutex::new(None),
                project_dir,
                shell_path: Mutex::new(shell_path),
                tool_paths: Mutex::new(tool_paths),
            })
            .manage(audio::AudioCaptureState::default())
            .manage(audio::RecorderState::default())
            .manage(assertion::AssertionState::default())
            .invoke_handler(tauri::generate_handler![
                environment::check_environment,
                services::install_dependencies,
                services::check_first_run,
                services::run_initial_setup,
                services::start_services,
                services::stop_services,
                network::check_health,
                network::scan_lan_servers,
                audio::start_system_audio_capture,
                audio::stop_system_audio_capture,
                audio::is_system_audio_capturing,
                audio::start_recording,
                audio::stop_recording,
                audio::pause_recording,
                audio::resume_recording,
                audio::feed_recorder_mic,
                audio::delete_recording,
                audio::list_orphan_recordings,
                audio::read_recording,
                window_cmd::quit_app,
                window_cmd::show_main_window,
                assertion::set_recording,
            ])
            .on_window_event(|window, event| match event {
                // 닫기(빨간 X): 파괴도 숨김도 하지 않는다 — prevent_close로 OS 종료만 막고,
                // 프론트 ClosePrompt 모달이 백그라운드(hide)/완전종료(quit_app)를 결정(Task 3).
                // 여기서 hide하면 모달 응답 전에 창이 숨어 순서가 깨진다.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                }
                // 진짜 종료(quit_app/cmd+Q → app.exit): 자식 프로세스 정리.
                tauri::WindowEvent::Destroyed => {
                    let state = window.state::<AppState>();
                    kill_child(&state.backend_process);
                    kill_child(&state.sidecar_process);
                    window.state::<assertion::AssertionState>().force_release();
                }
                _ => {}
            })
    };

    // ── 모바일 전용: 서버모드 클라이언트 (로컬 서비스/오디오 없음) + 인앱 루프백 브릿지 ──
    // 주의: Android는 여기에 더해 아래 android 블록이 STT 핸들러를 추가한다. iOS는
    // 이 모바일 핸들러만 갖는다(온디바이스 STT 비목표).
    #[cfg(all(mobile, not(target_os = "android")))]
    let builder = builder
        .manage(std::sync::Arc::new(bridge::BridgeState::default()))
        .invoke_handler(tauri::generate_handler![
            network::check_health,
            network::scan_lan_servers,
            bridge::bridge_port,
            bridge::set_bridge_target,
            bridge::probe_url,
            mdns::mdns_browse,
        ]);

    // ── Android 전용: 모바일 브릿지 핸들러 + 온디바이스 STT (sherpa C-API) ──
    // generate_handler!는 개별 엔트리에 #[cfg]를 못 붙이므로, Android는 모바일
    // 핸들러 목록에 STT command를 합쳐 한 번에 등록한다.
    #[cfg(target_os = "android")]
    let builder = builder
        .manage(std::sync::Arc::new(bridge::BridgeState::default()))
        .manage(stt::CohereState::default())
        .invoke_handler(tauri::generate_handler![
            network::check_health,
            network::scan_lan_servers,
            bridge::bridge_port,
            bridge::set_bridge_target,
            bridge::probe_url,
            mdns::mdns_browse,
            model_path::resolve_model_paths,
            model_path::cohere_model_status,
            model_path::ensure_cohere_model,
            model_path::download_cohere_model,
            model_path::delete_cohere_model,
            stt::stt_load,
            stt::stt_transcribe,
            // dev 전용 온디바이스 FFI smoke (본문 debug-gated, release는 no-op).
            stt::dev_ffi_smoke,
        ]);

    builder
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    // 이웃 윈도우 PC의 _dosvc(Delivery Optimization) 방송이 규격 위반이라
                    // mdns-sd 파서가 패킷마다 ERROR를 뱉음 — 또박또박 무관 소음이라 묵음.
                    .level_for("mdns_sd", log::LevelFilter::Off)
                    .build(),
            )?;

            // 데스크톱: 로그인 시 자동 시작(macOS LaunchAgent). 모바일 미지원.
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            // 데스크톱: Rails(13323)를 _ddobak._tcp 로 LAN에 광고.
            // ServiceDaemon은 manage로 보관해 앱 수명 동안 살려둔다(drop 시 unregister).
            #[cfg(desktop)]
            {
                match mdns::advertise(13323) {
                    Ok(daemon) => {
                        app.manage(daemon);
                    }
                    Err(e) => log::warn!("mDNS advertise 실패(디스커버리만 영향): {e}"),
                }
            }

            // 데스크톱: 메뉴바/시스템 트레이 아이콘 생성.
            #[cfg(desktop)]
            {
                if let Err(e) = tray::create_tray(app.handle()) {
                    log::warn!("트레이 생성 실패: {e}");
                }
            }

            // 데스크톱: 예약 회의 백그라운드 폴 루프 시작.
            #[cfg(desktop)]
            scheduler::spawn(app.handle().clone());

            // 모바일: 인앱 루프백 리버스 프록시 브릿지 기동.
            #[cfg(mobile)]
            {
                let state = app
                    .state::<std::sync::Arc<bridge::BridgeState>>()
                    .inner()
                    .clone();
                tauri::async_runtime::spawn(bridge::serve(state));
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
