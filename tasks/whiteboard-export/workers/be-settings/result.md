# result: be-settings (요약 원문 보존)
- settings_controller whiteboard/update_whiteboard(require_admin!, 422), routes GET/PUT settings/whiteboard
- LlmService.claude_cli_available? (cli_available?/cli_binary_for/system_which 클래스 메서드화, 인스턴스 위임)
- spec settings_whiteboard_spec.rb, 관련 spec 120 ex 0 fail(defined/random)
- settings.yaml diff 없음. 함정: 컨트롤러 SETTINGS_PATH 상수 복사 → stub 전에 컨트롤러 참조
- 응답 {"web_mode":"copy","server_claude_available":true}
