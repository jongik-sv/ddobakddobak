# 폴더/프로젝트에게 묻기 (Folder/Project Cross-Meeting AI Q&A) — 설계

- 날짜: 2026-06-18
- 브랜치: `feat/folder-chat` (off `main`)
- idea.md #1 (Top picks 1번), 경쟁사 갭: Otter/Fireflies/Granola/Fathom/Zoom/Notion
- 관련 메모리: `project_folder_chat_investigation`, `project_ai_chat_feature`, `project_summary_chat_citation`, `project_meeting_sharing`, `project_per_user_settings`

## 1. 개요 / 목표

회의 1건에 묶인 AI Chat을 **폴더 / 프로젝트 단위**로 확대한다. "지난달 주간회의에서 예산 뭘 정했지?" 같은 질문을 폴더(재귀 하위폴더 포함) 또는 프로젝트 전체 회의를 근거로 답한다.

현재 per-meeting 챗(`MeetingChatContext`)은 **검색이 아니라 회의 1건 요약+전사 full-dump**(120k자 예산). N회의는 예산상 통째로 못 넣으므로 **retrieval(FTS5 top-K)** 이 필요하다. 검색 프리미티브(`SearchService`, `transcripts_fts`/`summaries_fts`)는 이미 있고 챗이 안 쓸 뿐이다.

**성공 기준**
- 폴더/프로젝트 회의목록 화면에서 "폴더에게 묻기" → 우측 드로어 챗.
- 답변이 근거 회의를 인용(어느 회의/시각)하고, 클릭 시 그 회의로 이동+재생 점프.
- 인가: 사용자가 접근 가능한 회의만 근거에 포함(공유 안 된 회의 누수 0).
- 기존 per-meeting 챗 무회귀.

## 2. 비목표 (YAGNI)

- 팀 전체 교차(멤버십 합집합) 스코프 — 이번 범위 제외(폴더+프로젝트만).
- 벡터/임베딩 RAG — FTS5 키워드 retrieval로 충분, 도입 안 함.
- 스트리밍 응답 — 기존 챗과 동일하게 batch(후속).
- 정기 다이제스트(idea Intelligence) — 별도 기능.
- trigram 토크나이저 마이그레이션 — MVP는 기존 unicode61 재사용, recall 부족 실측 시 후속(§12).

## 3. 사용자 시나리오

1. 사이드바에서 폴더(또는 프로젝트) 선택 → `DashboardPage`가 그 회의목록 표시.
2. 툴바 "폴더에게 묻기" 버튼 → 우측 슬라이드오버 드로어.
3. 드로어 헤더 스코프 셀렉터: `[이 폴더 ▾] / [프로젝트 전체]` (기본 = 현재 폴더).
4. 질문 입력 → 답변(근거 회의 인용 배지 포함) + 예상질문 3개.
5. 인용 배지 클릭 → 해당 회의 페이지로 이동 후 발화 시각으로 재생 점프.

## 4. 아키텍처

```
FE: DashboardPage ─[폴더에게 묻기]→ FolderChatDrawer
        └ AiChatPanel(scope) ── chatStore(scope-keyed) ── api/chat ── channels/chat(scope channel)
BE: ScopedChatMessagesController(create/index)
        └ ChatMessage(scope_type/scope_id) ─ FolderChatJob
              └ FolderChatKeywords(LLM 키워드 추출)
              └ FolderChatContext(인가 ∩ 스코프 회의 → FTS top-K → 예산 조립)
              └ LlmService.answer_question → ActionCable broadcast
```

핵심 원칙: **per-meeting 챗 스택을 일반화해 재사용**(테이블·모델·잡·FE store/panel 공유). 새 코드는 스코프 해석 + retrieval + 인가에 집중.

## 5. 데이터 모델 & 마이그레이션

`chat_messages` 현재: `meeting_id NOT NULL`, content, role, status, suggestions_json, user_id. scope 개념 없음.

**선택: 폴리모픽 스코프 컬럼 (단일 테이블 재사용)**
- `add_column :chat_messages, :scope_type, :string, null: false, default: "meeting"`
- `add_column :chat_messages, :scope_id, :integer`
- 백필: `UPDATE chat_messages SET scope_id = meeting_id`
- `change_column_null :chat_messages, :meeting_id, true` (folder/project 행은 meeting_id NULL)
- `add_index :chat_messages, [:scope_type, :scope_id, :user_id, :created_at]`

**⚠️ 마이그레이션 가드 (이 프로젝트 데이터전멸 이력 다수)**
- 참조: `reference_sqlite_fk_cascade_migration_wipe`, `project_db_wipe_recovery_2026_06_16`.
- `change_column_null`은 SQLite에서 테이블 재생성을 유발 → 과거 와이프가 난 바로 그 연산 클래스.
- 본 마이그는 **null 완화 + 컬럼 추가**(삭제·FK 재정의 없음)라 CASCADE 발화 요소는 없으나, 안전을 위해:
  - `disable_ddl_transaction!` + 마이그 내 **사전/사후 row count assert**(`COUNT(*)` 동일 보장, 불일치 시 raise).
  - 실행 전 dev DB 백업 권고(`backend/storage/development.sqlite3`).
- `down`: 컬럼 drop + `change_column_null meeting_id, false`는 folder/project 행 존재 시 실패 → down은 scope='meeting' 외 행을 먼저 삭제하도록 명시.

**대안(미채택)**: 별도 테이블 `scoped_chat_messages` → meeting_id NOT NULL 손 안 댐(마이그 위험 0)이나 모델·잡·FE store 이중화. DRY 손해가 마이그 위험보다 커서 폴리모픽 채택.

**모델 `ChatMessage`**
- `SCOPE_TYPES = %w[meeting folder project]`
- `validates :scope_type, inclusion: { in: SCOPE_TYPES }`
- `belongs_to :meeting, optional: true` (folder/project 행은 meeting 없음)
- `scope :for_scope, ->(type, id) { where(scope_type: type, scope_id: id) }`
- 기존 `for_user`, `default_scope order(:created_at)`, suggestions 유지.
- ⚠️ `default_scope` 함정: 기존 코드가 meeting 연관으로 접근 → 폴더 행이 안 섞이게 항상 scope 조건 동반.

## 6. 컨텍스트 빌더 `FolderChatContext` (+ 인가)

`MeetingChatContext`와 형제. 입력: `scope_type, scope_id, user, question_keywords`.

1. **스코프 → 후보 회의 집합**
   - folder: 해당 폴더 + **재귀 하위폴더** 전체의 meetings. (Folder.children 재귀; 사이클 가드는 기존 `ancestor_records` 패턴 참고)
   - project: `Meeting.where(project_id: scope_id)`
2. **인가 교집합 (필수)**: `Meeting.accessible_by(user)` 와 AND.
   - ⚠️ `SearchService#accessible_meeting_ids`는 `Meeting.kept`만 쓰고 `accessible_by`를 **안 한다** → 그대로 재사용 금지. FolderChatContext는 직접 `accessible_by(user)` 적용(공유 안 된 회의 누수 차단, `project_meeting_sharing`).
3. **FTS top-K**: 후보+인가된 meeting_ids로 `transcripts_fts`/`summaries_fts` MATCH. SELECT에 `t.started_at_ms`(인용 점프), `t.meeting_id`, `m.title`, `m.created_at`, snippet 포함. rank 정렬 top-K.
4. **예산 조립** (MAX_CHARS 예산):
   - top-K 스니펫(회의제목·날짜·시각·화자·snippet)
   - 후보 회의 **목차**(각 회의 title+date+brief_summary 한 줄) — 폭넓은 질문 대비
   - history(직전 N턴, `for_scope` + `for_user`)
   - 질문
5. system_prompt = 신규 `FOLDER_CHAT_SYSTEM_PROMPT` + `CITATION_MARKER_INSTRUCTION`(회의ID 확장판 §10).

## 7. 질문 → 검색 키워드 (경량 LLM 추출)

- 신규 `FolderChatKeywords` 서비스. `LlmPrompts::FOLDER_CHAT_KEYWORD_PROMPT`: 질문에서 **핵심 명사/고유명사 키워드 배열(JSON)** 추출(조사·불용어 제거). 한국어 교착어 → 어근 추출이 unicode61 prefix recall을 보완(시너지).
- 호출: `LlmService.new(llm_config: user.effective_chat_llm_config).answer_question(...)` 후 JSON 파싱. 실패 시 폴백 = 질문 토큰화(공백 분리)로 graceful.
- 추출 키워드 → FTS 쿼리: `SearchService#fts_query` 동일 규칙(`"word"*` prefix, OR) 재사용.
- LLM config = **`current_user`**.effective_chat_llm_config (회의챗은 creator, 폴더챗은 current_user — 차이 주의, `project_per_user_settings`).

## 8. 잡 & ActionCable

- 신규 `FolderChatJob`(MeetingChatJob 구조 차용): 키워드 추출 → FolderChatContext → LlmService → `split_followups` → broadcast.
- 채널: `chat_#{scope_type}_#{scope_id}_#{user_id}` (예: `chat_folder_12_5`). 기존 `meeting_#{id}_chat_#{user}`는 유지.
- broadcast 페이로드는 기존과 동일(id, role, content, status, suggestions, ...).

## 9. 라우트 & 컨트롤러

```ruby
resources :folders do
  resources :chat_messages, only: %i[index create], controller: "scoped_chat_messages",
            defaults: { scope_type: "folder" }
end
resources :projects do
  resources :chat_messages, only: %i[index create], controller: "scoped_chat_messages",
            defaults: { scope_type: "project" }
end
```
- `ScopedChatMessagesController`: `scope_type`(defaults), `scope_id`(folder_id/project_id param)로 인가 확인 → user+assistant(pending) 생성 → `FolderChatJob`. 직렬화는 기존 형식 재사용.
- 인가: folder = 접근 가능한 프로젝트 멤버십/회의 보유; project = `project.member?(user) || user.admin?`. (읽기 인가 헬퍼 신규 — MeetingLookup 패턴 참고)

## 10. 인용(Citation) — 회의ID 확장

기존 마커: `⟦t:<ms>/s:<화자>⟧` (단일 회의, FE `ddobak-seek:<ms>:<speaker>` → 현 회의 onSeek). 폴더챗은 N회의 횡단 → **마커에 회의 식별 추가**.
- 마커 확장: `⟦m:<meeting_id>/t:<ms>/s:<화자>⟧` (m 생략 시 = 현 회의, 기존 동작 불변 = 하위호환).
- `CITATION_MARKER_INSTRUCTION` 변형(`FOLDER_CHAT_CITATION_INSTRUCTION`): 각 근거에 출처 meeting_id 포함 지시. context에 `[회의:<id> <제목>(<날짜>)]` 헤더로 각 스니펫 라벨링 → 모델이 m 값 채움.
- FE `ChatMarkdown.markersToSeekLinks`: `m:` 파싱 추가. m 있으면 `ddobak-seek:<meetingId>:<ms>:<speaker>` 링크 → 클릭 시 **해당 회의로 라우팅 후 seek**(전역 `__ddobakSeek` 또는 라우터 네비). m 없으면 기존 동작.
- 회의 배지: 답변에 출처 회의 제목 칩 표시(클릭=이동).
- ⚠️ 정확한 마커 파싱/렌더 코드는 `project_summary_chat_citation`(merge c7dfd01) 구현을 읽고 그 규약에 맞춰 확장(inlineToMarkers 선처리 필수=크래시 회피).

## 11. 프론트엔드

- **`FolderChatDrawer`**(신규): 우측 슬라이드오버. 헤더에 스코프 셀렉터(이 폴더/프로젝트 전체) + 닫기. 본체 = `AiChatPanel`.
- **`AiChatPanel` 일반화**: `meetingId` 전용 → `{ scopeType, scopeId, onSeek }`. meeting 모드는 `scopeType="meeting"`으로 동일 동작(호출부 호환 래퍼 유지 또는 점진 교체, `feedback_full_compile_verify`로 전수검증).
- **`chatStore`**: meeting_id 키 → `(scopeType, scopeId)` 복합 키. load/send/subscribe 인자 일반화.
- **`api/chat.ts`**: `/folders/:id/chat_messages`, `/projects/:id/chat_messages` 추가.
- **`channels/chat.ts`**: 스코프 채널 구독 일반화.
- **진입점**: `DashboardPage` 툴바에 "폴더에게 묻기" 버튼(현재 선택된 폴더/프로젝트 컨텍스트). 폴더/프로젝트 미선택 시 버튼 숨김/비활성.
- 모바일: 드로어 풀스크린(기존 모바일 탭 패턴 참고).
- Tailwind: 시맨틱 토큰 함정(`project_tailwind_theme_tokens`) — 새 UI는 명시 색.

## 12. 토크나이저 결정

- MVP: 기존 `unicode61` + prefix(`"word"*`) **재사용**(마이그 0). 경량 LLM 키워드 추출이 조사 제거 → recall 보완.
- 후속(실측 게이트): recall 부족 체감 시 `trigram` 전환 PoC(교육폴더 등 실데이터로 unicode61 prefix vs trigram 비교). 전환은 FTS 재색인 + rank 특성 변화 동반 → 별도 작업.

## 13. 발언자 배지 통합

배지/인용 인프라는 main 머지 완료(`project_summary_chat_citation`, merge c7dfd01: 마커 `⟦t:ms/s:화자N⟧`, `__ddobakSeek` 전역핸들, 회의ID배지, BlockNote 표셀 렌더, export 마커 strip). 폴더챗은 이를 **재사용+회의ID 확장**(§10). 신규 마커 인프라 만들지 않음.

## 14. 에러 처리

- LLM config 미설정 → 기존처럼 assistant status=error + 메시지.
- 키워드 추출 실패 → 토큰화 폴백(graceful).
- FTS 결과 0 → "근거 회의를 찾지 못함" 안내(목차만으로 답하거나 모름 응답).
- 인가 위반 회의 → 후보에서 원천 제외(노출 0).
- 마이그 사후 count 불일치 → raise(부분 적용 차단).

## 15. 테스트 전략 (TDD)

- 모델: scope 검증, for_scope, meeting_id nullable 후 기존 meeting 챗 무회귀.
- `FolderChatContext`: 인가 교집합(공유 안 된 회의 제외), 재귀 하위폴더 수집, 예산 상한, 스니펫에 started_at_ms/meeting_id 포함.
- `FolderChatKeywords`: JSON 파싱, 실패 폴백.
- 컨트롤러: 폴더/프로젝트 인가(비멤버 403), create→job enqueue, index scope 격리.
- 마이그: 백필 정확성 + row count 불변(가드).
- FE: 마커 `m:` 파싱·타회의 링크, 드로어 스코프 토글, store 스코프 격리.
- 회귀: per-meeting 챗 기존 테스트 전부 green.

## 16. 리스크 & 미해결

- ⚠️ 마이그(meeting_id nullable) — §5 가드 필수. 최우선 리스크.
- ⚠️ `default_scope` + scope 혼선 — 모든 쿼리에 scope 조건 강제.
- 한국어 recall(unicode61) — §12, 실측 후속.
- 인가 누수 — `accessible_by` 직접 적용, SearchService 스코핑 재사용 금지.
- 인용 마커 정확 규약 — citation 구현(c7dfd01) 코드 정독 후 확장.
- 비용/지연 — 질문당 LLM 2회(키워드+답변). 키워드는 경량·짧음.

## 17. 구현 순서 (플랜 시드)

1. 마이그(가드) + ChatMessage 모델 scope화 + 기존 챗 무회귀 확인.
2. `FolderChatKeywords` + `FOLDER_CHAT_KEYWORD_PROMPT`.
3. `FolderChatContext`(인가·재귀·FTS·예산).
4. `FOLDER_CHAT_SYSTEM_PROMPT` + `FOLDER_CHAT_CITATION_INSTRUCTION`(회의ID 확장).
5. `FolderChatJob` + 스코프 ActionCable 채널.
6. 라우트 + `ScopedChatMessagesController`(인가).
7. FE: chatStore/api/channels 일반화 → AiChatPanel scope화.
8. FE: `FolderChatDrawer` + DashboardPage 진입점.
9. FE: ChatMarkdown `m:` 마커 + 타회의 점프.
10. E2E(웹) + 기기 검증.
