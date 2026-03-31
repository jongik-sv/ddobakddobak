// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // macOS GUI 앱은 launchd 환경에서 실행되어 최소 PATH만 가짐.
    // 로그인 쉘의 환경변수를 프로세스 레벨에 설정하여 rbenv 등 사용자 도구를 찾을 수 있게 한다.
    let _ = fix_path_env::fix();
    app_lib::run();
}
