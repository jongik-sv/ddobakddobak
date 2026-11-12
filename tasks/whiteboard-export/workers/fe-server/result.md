# result: fe-server (요약)
- api/whiteboard.ts(post/get, 403·422 에러 클래스), route serverEnabled 기본 true
- store: source local|server, serverStale, startServer/refreshServer/onCableEvent, 서버 실행 중 자체 TranscriptionChannel 구독(connected 시 GET으로 유실 방지)
- ExportButton 서버 화면·GET 복원·stale·403→copy, channels/transcription.ts whiteboard_ready/failed
- 파일명 날짜: formatFilenameDate 공용 헬퍼(로컬 날짜, '미정' 유지), normalizeDate ISO+zone→로컬
- 설계 차이: 서버 not_found 문구 "서버 PC에서…", 서버 entry stale은 GET stale 사용
- vitest 240 files/2229 pass, tsc 0, vite build OK
