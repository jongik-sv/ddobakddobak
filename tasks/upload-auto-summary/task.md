# Task: upload-auto-summary — 파일 업로드 시 화자분리 ON이어도 회의록까지 자동 생성
- status: done (미커밋, 수동 E2E 잔여)
- created: 2026-11-16
- 요청: "파일을 업로드 하면 화자분리, 회의록 생성까지 되게 하자. 사람들이 불편해 한다."
- branch/worktree: feature/upload-auto-summary @ /Users/jji/project/ddobakddobak-upload-summary (origin/main f6b73024 기준)
- target_repo: /Users/jji/project/ddobakddobak-upload-summary, write_scope: backend/**, frontend/src/**
- workers_approved: Agent 서브에이전트(sonnet 구현) — 사용자 상시 지시
## 결정
- FileTranscriptionJob의 "화자분리 ON → 요약 스킵" 분기 제거: 모든 경로(웹 업로드·ext API·STT 재생성)가 요약까지 생성
- 화자분리 실행 여부는 기존대로 서버 설정(AppSettings.diarization_config)을 따름
- perform 시그니처의 force_summary 인자는 큐에 남은 잡 호환을 위해 받되 무시
