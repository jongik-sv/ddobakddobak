// [BBDBG] 임시 계측 헬퍼 — B-B 디버깅용. JS console.log는 release WebView에서 logcat에 안 닿으므로
// tauri-plugin-log 커맨드(plugin:log|log)로 보내 Rust log → logcat(RustStdoutStderr 태그)에 출력.
// 디버깅 종료 후 이 파일 + 호출부 전부 제거 예정. grep "BBDBG"로 일괄 제거.
export function bbdbg(msg: string): void {
  // 콘솔에도 남김(devtools 붙을 때용) — 무해.
  try {
    console.log('[BBDBG] ' + msg)
  } catch {
    /* ignore */
  }
  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('plugin:log|log', { level: 4, message: '[BBDBG] ' + msg }).catch(() => {}))
    .catch(() => {})
}
