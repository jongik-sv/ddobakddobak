# result: fe-integration (요약)
- detect_claude async+spawn_blocking, api/settings get/updateWhiteboardSettings, lib/whiteboard/runner.ts(detectLocalClaude, generateBoardLocal, WhiteboardRunFailure)
- stores/whiteboardStore.ts(회의별 상태·panelOpen·notice·startLocal·save·reset), components/meeting/WhiteboardToast.tsx(App.tsx 마운트)
- ExportButton 두 줄 버튼·material/route 선로딩·local/copy 화면, MeetingSettingsTab 관리자 구역
- 신규 테스트 13, vitest 238 files/2199 pass, tsc 0, vite build OK, cargo check OK
- 수동 E2E 8항목(워커 리포트 원문은 대화 기록)
