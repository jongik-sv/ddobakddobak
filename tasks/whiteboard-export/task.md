# Task: whiteboard-export — 회의록 내보내기에 화이트보드(.html) 추가

- status: done (미커밋. 잔여: 데스크톱 Tauri 실기기 E2E·Windows 빌드·실서버 마이그·실서버 claude 확인)
- created: 2026-11-12
- branch: feature/whiteboard-export
- target_repo: /Users/jji/project/ddobakddobak
- workers_approved: Agent 서브에이전트(코딩=sonnet, 조사=haiku, 설계·리뷰=세션 최상위) — 사용자 착수 지시문 "구현은 서브에이전트에 맡긴다"(2026-11-12)
  - write_scope: frontend/src/**, frontend/src-tauri/src/**, frontend/src-tauri/Cargo.toml, backend/app/**, backend/config/routes.rb, backend/spec/**, backend/db/** (2단계, dev 서버 주의)
- 정본: design.md (지시문·스키마·분기표·인터페이스)
- sources/: whiteboard-export-draft.html(시안 v4), standard-board.html(템플릿 기준)

## 단계
1. 1단계(마이그 없음): lib/whiteboard, Tauri 커맨드, 설정 엔드포인트, ExportButton·관리자 UI
2. 2단계: 서버 모드(POST/GET whiteboard, WhiteboardExportJob, 마이그 1건, broadcast·토스트)

## 제약
- 러닝 dev 서버 실요청·실 settings.yaml 변경 금지. CLI는 stub
- 마이그 파일은 dev 서버 가동 중 db/migrate에 두지 않음
- 커밋은 요청 시 pathspec, 푸시 안 함
