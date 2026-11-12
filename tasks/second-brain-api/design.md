# 세컨드 브레인 API — 설계 (2026-08-30 확정)

requirements.md의 킥오프 결정 사항을 반영한 확정 설계. 섹션 1·2는 사용자 승인 완료, 3~6은 확정된 결정에서 도출.

## 킥오프 확정 결정

| 안건 | 결정 |
|---|---|
| v1 범위 | 읽기 + 제한적 쓰기 |
| 쓰기 범위 | 메모/노트 추가 · 요약 재생성 트리거 · 회의 생성(텍스트 전사 임포트 + 오디오 업로드) |
| API 형태 | REST 단일 (MCP는 후속 후보) |
| Claude 앱 | 1차 제외 (사내망 서버라 클라우드 샌드박스 도달 불가. 공개 엔드포인트 생기면 후속) |
| 뷰어 역할 | 신설하지 않음 — PAT 읽기 스코프로 해결 |
| 검색 | FTS + 벡터 하이브리드 (챗 내부 RRF 부품 재사용) |
| 스킬 배포 | 서버에서 zip 다운로드 |
| 아키텍처 | A안 — 별도 외부 네임스페이스 `/api/ext/v1` |

## 1. PAT 모델과 인증 (승인됨)

- 모델 `ApiToken`: `user_id`, `name`, `token_digest`(SHA-256, 유니크 인덱스), `token_prefix`(앞 8자 표시용), `scopes`(JSON 배열), `project_ids`(JSON, 선택), `folder_ids`(JSON, 선택), `expires_at`(필수), `revoked_at`, `last_used_at`.
- 토큰 문자열: `ddbk_` + 무작위 32바이트 base62. 평문은 발급 응답에서 한 번만 노출, DB에는 해시만. 목록 표시는 `token_prefix` 기반(기존 `TokenMasking` 관례 참조).
- 인증: `Authorization: Bearer ddbk_...`. 전용 concern(예: `Ext::AuthenticateApiToken`)이 처리. **기존 `authenticate_user!`/`resolve_current_user`/warden 절대 호출 금지** — 토큰 부재 시 로컬 admin 폴백 함정(application_controller.rb:37-41) 차단. 부재·무효·만료·폐기 = 전부 401.
- 유효 권한 = 소유 사용자 권한 ∩ 토큰 스코프 ∩ 프로젝트/폴더 범위 제한. 사용자 권한 초과 불가.
- 스코프 5종: `meetings:read`, `transcripts:read`, `summaries:read`, `search:read`, `meetings:write`. 엔드포인트별 `require_scope!`.
- 감사 로그 `api_token_audit_logs`: token_id, action(`meetings.show` 등), meeting_id(선택), path, ip, created_at.
- `last_used_at`은 1분 스로틀 갱신.
- Rate limit: `rack-attack` 신규 도입, `/api/ext/*` 한정. 토큰당 읽기 120회/분, 쓰기 20회/분.
- 토큰 관리(웹 UI용, JWT 인증, 내부 API): `GET/POST /api/v1/api_tokens`, `DELETE /api/v1/api_tokens/:id`(= revoke).

## 2. 외부 읽기 API (승인됨)

`Ext::V1::BaseController`가 PAT 인증·스코프 검사·감사 로그 공통 처리.

| 메서드·경로 | 스코프 | 내용 |
|---|---|---|
| `GET /api/ext/v1/me` | 인증만 | 토큰·사용자·스코프·만료 확인 (스킬의 연결 점검용) |
| `GET /api/ext/v1/projects` | meetings:read | 접근 가능 프로젝트 목록 |
| `GET /api/ext/v1/projects/:id/folders` | meetings:read | 폴더 트리 |
| `GET /api/ext/v1/meetings` | meetings:read | 목록. 필터 project_id/folder_id/날짜/상태 + 페이지네이션 |
| `GET /api/ext/v1/meetings/:id` | meetings:read | 상세 메타데이터 |
| `GET /api/ext/v1/meetings/:id/transcripts` | transcripts:read | 전사 전체(화자·ms 타임스탬프) |
| `GET /api/ext/v1/meetings/:id/summary` | summaries:read | final 요약(key_points/decisions/notes_markdown) |
| `GET /api/ext/v1/search` | search:read | 하이브리드 검색. q 필수, project_id/folder_id 선택 |

- **인가 정본**: 신설 `Meeting.ext_accessible_by(user)` = `accessible_by` ∪ 직접 협업(MeetingCollaborator) ∪ 폴더 상속 협업(FolderCollaborator, 조상 체인). UNION/OR 쿼리로 구현, N+1 금지. 목록·검색·단건 모두 이것 하나 사용. 토큰 project_ids/folder_ids 제한을 교집합. 기존 내부 API 무변경.
- **redact 정합성**: 전사·요약은 물리 삭제라 그대로 안전. `Block`·`MeetingAttachment`는 v1 외부 API에서 노출 금지(절단 미적용 소스).
- 응답: 화이트리스트 전용 serializer(`Ext::` concern, 수기 Hash 관례 유지). ISO8601. 오류 `{error:{code,message}}`, 401/403/404(범위 밖=존재 은폐 404)/409/429. 목록 `page`/`per_page` + `meta`.

## 3. 외부 쓰기 API (meetings:write)

| 메서드·경로 | 내용 |
|---|---|
| `POST /api/ext/v1/meetings` | 텍스트 전사 임포트로 회의 생성. body: title, project_id, folder_id?, transcripts[{speaker_name, content, started_at_ms?, ended_at_ms?}]. 상태 completed로 생성, FTS·임베딩은 기존 콜백(Embeddable) 자동 |
| `POST /api/ext/v1/meetings/:id/audio` | 오디오 파일 업로드 → 기존 STT 파이프라인 재사용(내부 `upload_audio`/transcription_queue 경로 조사 후 재사용). 처리 상태는 `GET /meetings/:id`의 status로 폴링 |
| `POST /api/ext/v1/meetings/:id/notes` | 에이전트 노트 append. Block에 `source` 컬럼 추가('user' 기본/'ext_api'), ext_api 노트만 `GET /meetings/:id/notes`로 조회 가능 |
| `POST /api/ext/v1/meetings/:id/summarize` | 요약 재생성 트리거. 기존 summarize 액션 로직 재사용. 실행 중이면 409 |

- 쓰기 인가 = control 티어 동치(소유자/협업자/admin, 기존 `authorize_meeting_control!` 로직 미러링 — ext 전용 구현).
- 쓰기 가드: `reject_if_locked!`·`reject_if_redacted!` 동치 적용(절단·잠금 회의 쓰기 409).
- redact 보증 확장: `TranscriptRedactionService`에 `source='ext_api'` Block 삭제 1건 추가(에이전트 노트도 절단 대상).
- 회의 생성 위치 인가: 대상 project/folder에 사용자 쓰기 권한 필수 + 토큰 범위 제한 준수.

## 4. 스킬·CLI 배포

- 저장소 원본: `ext_skill/` 폴더 —
  - `SKILL.md`: Claude Code용 스킬 본문(트리거·사용법).
  - `scripts/ddobak_api.py`: 표준 라이브러리만 사용(urllib)하는 단일 파일 CLI. 서브커맨드: me/projects/meetings/transcript/summary/search/create/note/summarize/upload-audio/dump(마크다운 덤프). 설정: env `DDOBAK_API_URL`, `DDOBAK_API_TOKEN`.
  - `AGENT.md`: 벤더 중립 사용 설명(타 LLM 에이전트용 — REST 계약 요약 + CLI 사용법).
  - `README.md`: 사람용 설치 안내.
- zip 배포: `GET /api/v1/skill_package`(JWT, 웹 설정 화면 다운로드 버튼) — 서버가 `ext_skill/`을 zip으로 묶고 `config.json`(서버 URL 자동 주입)을 동봉. PAT은 zip에 넣지 않음(발급 화면에서 별도 복사).

## 5. 웹 UI (설정 화면)

- 설정에 "API 토큰" 섹션 신설: 토큰 목록(이름·prefix·스코프·만료·마지막 사용), 발급 모달(이름·스코프 체크·만료일·프로젝트/폴더 제한), 발급 직후 1회 평문 표시+복사, 폐기 버튼, 스킬 zip 다운로드 버튼.
- 기존 설정 화면 패턴·컴포넌트 관례 준수.

## 6. 검증 계획

- rspec request spec 필수 커버: 토큰 만료/폐기/스코프 초과 401·403, 범위 밖 회의 404(IDOR), 검색 스코프 격리(타 사용자 데이터 미노출), redact 회의 쓰기 409, 프로젝트 제한 우회 시도, rate limit 429.
- 프론트: `tsc -p tsconfig.app.json` 0 에러 + vitest green (reference_frontend_real_typecheck 기준).
- 게이트: rspec 전체 green, 신규 스펙 포함.
- CLI: 로컬 dev 서버 대상 스모크는 수동 검증 항목으로 남김(실서버·러닝 dev 서버 실요청 금지 — feedback_no_live_server_mutation).

## 7. 구현 작업 분해 (feature/second-brain-api 브랜치)

같은 워킹트리 병렬 → **git add 금지, pathspec 커밋 필수** (reference_parallel_agent_git_pathspec_commit).

- **A. PAT 기반**: 마이그레이션(api_tokens, api_token_audit_logs, blocks.source), ApiToken 모델, Ext 인증 concern, require_scope!, 감사 로그, rack-attack, Ext::V1::BaseController, 내부 api_tokens CRUD 컨트롤러. — 선행
- **B. 읽기 API**: ext_accessible_by 스코프, me/projects/folders/meetings/transcripts/summary 컨트롤러+serializer. — A 후
- **C. 검색 API**: 하이브리드 검색 서비스(FolderChatContext의 FTS+RRF+TranscriptVectorSearch 부품 재사용, sidecar 실패 시 FTS 폴백 명시), /search 컨트롤러. — A 후, B와 병렬
- **D. 쓰기 API**: meetings 생성(텍스트), audio 업로드, notes, summarize + 가드 + redaction 서비스 확장. — A 후, B·C와 병렬
- **E. 프론트 UI**: API 토큰 설정 섹션. — A(내부 CRUD) 후, B~D와 병렬
- **F. 스킬·CLI·zip**: ext_skill/ + skill_package 엔드포인트. — API 계약(이 문서) 기준으로 A 후 병렬, 마지막에 실제 응답과 대조
- **G. 통합 검증**: 전체 rspec/tsc/vitest + 크로스 리뷰. — 전부 후

모델: 코딩=sonnet (feedback_model_tiering). 커밋은 feature 브랜치에만, main 머지·push 금지(feedback_no_auto_commit).
