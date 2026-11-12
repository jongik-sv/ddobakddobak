# brief: fe-lib (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: frontend/src/lib/whiteboard/**
정본: tasks/whiteboard-export/design.md §2~7 (반드시 전부 읽을 것). 템플릿 기준: tasks/whiteboard-export/sources/standard-board.html
## 할 일
frontend/src/lib/whiteboard/ 에 순수 모듈 + vitest:
- prompt.ts: WHITEBOARD_PROMPT_VERSION, WHITEBOARD_SYSTEM_PROMPT(§4.1 문자 그대로), buildWhiteboardUserContent, buildRetrySuffix, buildCopyInstruction(material, filename)
- material.ts: buildWhiteboardMaterial(exportData) (§3, 타입은 api/meetings/export.ts 재사용)
- schema.ts: 타입, extractJson, validateBoard (§5)
- render.ts: renderBoardHtml (§6). escape·CSP·태그필터·다크모드
- failure.ts: classifyWhiteboardFailure + 메시지 (§7)
- route.ts: resolveWhiteboardRoute (§2, 5분기)
- index.ts 재수출
## 테스트(필수)
분기 5가지, 검증 성공/실패/관대처리, 펜스 제거, escape(`<script>` 주입 문자열이 렌더 결과에 실행 가능 형태로 안 남음), CSP meta 존재, 복사 지시문 내용, 시스템 프롬프트 sha256 고정 테스트(값 계산해 상수로 박고 리포트에 hex 기재).
## Do NOT
- 이 폴더 밖 파일 수정 금지(ExportButton 등은 다른 워커). 커밋 금지. dev 서버 요청 금지.
## 검증·리포트
`cd frontend && npx vitest run src/lib/whiteboard` + `npx tsc -p tsconfig.app.json --noEmit` 결과, 공개 API 시그니처 목록, sha hex.
