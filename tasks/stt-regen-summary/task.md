# Task: stt-regen-summary — STT 재생성 시 요약까지 자동 실행
- status: done (미커밋, 수동 E2E 잔여)
- created: 2026-11-12
- 요청: "Stt 재 실행시 요약까지 같이 진행해줘. 대신 요약도 같이 실행한다는 메시지를 보여줘"
- branch/worktree: feature/stt-regen-summary @ /Users/jji/project/ddobakddobak-stt-summary (화이트보드 작업과 격리)
- workers_approved: Agent 서브에이전트(sonnet 구현) — 사용자 상시 지시
## 결정
- regenerate_stt 경로만 화자분리 ON이어도 요약 강제(파일 업로드 경로 동작 무변경)
- 확인 다이얼로그·재전사 다이얼로그·진행 메시지에 "요약도 이어서 생성" 표시
