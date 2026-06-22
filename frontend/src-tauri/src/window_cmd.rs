use tauri::{AppHandle, Manager};

/// 프론트/트레이의 "완전 종료" 경로. app.exit(0) → WindowEvent::Destroyed → 기존 정리(kill_child).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// "main" 창을 표시+포커스. 예약 트리거(Task 5)·알림 클릭(Task 9)에서 재사용.
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
