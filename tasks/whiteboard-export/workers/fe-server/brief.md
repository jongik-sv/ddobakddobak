# brief: fe-server (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope(frontend/src/): lib/whiteboard/{route,runner}.ts·test, api/(whiteboard 함수), stores/whiteboardStore.ts, components/meeting/ExportButton*, components/meeting/WhiteboardToast.tsx, 회의 채널 핸들러(transcription_stream 구독 훅) 1곳
정본: tasks/whiteboard-export/design.md §11.3·§11.5 (API 계약 그대로; 백엔드는 다른 워커가 병렬 구현)
## 할 일
- api: postWhiteboard(id)·getWhiteboard(id) (§11.3 응답 타입).
- route serverEnabled=true. store에 startServer(meetingId, material digest)·applyServerStatus·onCableEvent.
- ExportButton route=server 화면(시안 wServer·wBusy), 패널 열 때 GET 복원·stale·403→copy 폴백, 서버 auth 문구.
- 회의 채널 수신부(기존 card extraction 등 type 분기 위치를 찾아)에 whiteboard_ready(→GET→done)·whiteboard_failed(→error) 추가. 패널 닫혀 있으면 기존 WhiteboardToast.
- board는 validateBoard로 재검증 후 렌더.
## 테스트
route 5분기 갱신(server 분기), store 서버 흐름, ExportButton server: 200 즉시 done·202→ready 이벤트→done·failed 문구·403 폴백·stale 표시, 채널 핸들러 type 분기. API는 vi.mock.
## Do NOT
백엔드·src-tauri 수정, 커밋, dev 서버 요청.
## 리포트
vitest 전체, tsc -p tsconfig.app.json, vite build.
