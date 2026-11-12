# brief: fe-integration (sonnet)
target_repo: /Users/jji/project/ddobakddobak
write_scope(frontend/ 기준): src/components/meeting/ExportButton*, src/components/settings/MeetingSettingsTab*, src/stores/whiteboardStore.ts, src/lib/whiteboard/runner.ts, src/api/settings*, 토스트 컴포넌트+전역 마운트, src-tauri/src/whiteboard.rs(detect_claude만)
정본: design.md §2·3·7·10, 시안 sources/whiteboard-export-draft.html, workers/*/result.md
## 할 일
1. detect_claude를 async+spawn_blocking으로 바꾼다.
2. api: get/updateWhiteboardSettings.
3. runner.ts: detectLocalClaude(비Tauri·invoke 실패→null), generateBoardLocal(material) = invoke→parseBoardResponse→실패 시 buildRetrySuffix 1회→classifyWhiteboardFailure.
4. whiteboardStore(zustand, meetingId별 idle|running|done|error).
5. ExportButton §10: 패널 열 때 material·route 선로딩, 파일명 buildWhiteboardFilename, downloadBlob(text/html). 패널 닫힌 채 완료되면 전용 토스트 버튼(useToastStore는 메시지 전용). 자동 다운로드 금지.
6. MeetingSettingsTab §10 관리자 구역.
## 테스트
ExportButton: 요약 없음 비활성, local 성공·재요청·실패 문구, copy 성공·클립보드 실패 textarea, html 확장자. 설정 탭: 라디오, claude 없음 disabled, PUT. API·invoke는 vi.mock.
## Do NOT
dev 서버 요청, settings.yaml, 백엔드, 커밋·stash·checkout.
## 리포트
vitest 전체, tsc -p tsconfig.app.json, vite build, cargo check, 수동 E2E 체크리스트.
