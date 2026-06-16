# 회의록 전체보기 모달 + AI 챗 예상질문 — 설계

작성일: 2026-06-16 / 브랜치: feat/ai-chat

독립 기능 2개. 각각 별도 TDD 구현.

---

## A. 회의록 전체보기 모달

### 목적
AI 회의록을 큰 모달로 "한눈에 크게" 본다. 읽기 목적.

### 설계
- **신규** `frontend/src/components/meeting/AiSummaryFullViewModal.tsx`
  - 기존 `frontend/src/components/ui/Dialog.tsx` 재사용.
  - 크기: 데스크톱 `w-full max-w-5xl max-h-[90vh] ... flex flex-col`, 모바일 `fixed inset-0 h-dvh`(SettingsModal 패턴). `useMediaQuery`로 분기.
  - 헤더: "AI 회의록" + 닫기(X, lucide). Esc/백드롭 닫기(Dialog 기본).
  - 본문: `<AiSummaryPanel meetingId={meetingId} editable={false} isRecording={false} hideExpand />` — 같은 컴포넌트 그대로 마운트, 읽기전용.
- **AiSummaryPanel.tsx 변경**
  - 헤더(라인 ~166 우측 컨트롤 영역)에 확대 아이콘 버튼(Maximize2) 추가 → 내부 `showFullView` state 토글, `<AiSummaryFullViewModal>` 렌더.
  - 신규 prop `hideExpand?: boolean` — 모달 안에서 마운트된 인스턴스는 확대 버튼 숨김(재귀 방지). 기본 false.
  - 자체 완결형 → 모든 마운트 포인트(MeetingLivePage, MeetingViewerPage, MeetingPage/meetingDetailTabs, 모바일 탭)가 페이지 수정 없이 자동으로 확대 기능 획득.

### 읽기전용 근거
"한눈에 크게 보기" = 읽기 목적. 같은 회의록을 편집 에디터 2개가 동시 마운트→동시 저장하면 데이터손실 버그류(방금 수정한 Ctrl+Z 손실) 재발 위험. 편집은 인라인 패널에서. 향후 편집형 필요 시 `editable` 플립만.

### 테스트 (frontend, vitest)
- AiSummaryPanel: 확대 버튼 렌더(기본), `hideExpand`면 미렌더.
- 확대 버튼 클릭 → 모달 표시(AI 회의록 헤더 2번째 인스턴스 or testid). 닫기 → 모달 사라짐.
- 기존 AiSummaryPanel 테스트 mock(useCreateBlockNote에 transact 포함)과 정합.

---

## B. AI 챗 답변 후 예상질문 3건

### 목적
각 어시스턴트 답변 뒤 후속 질문 3건 칩. 클릭 시 즉시 자동 질문(이어가기).

### 현 상태 (탐색 결과)
- 답변 = plain string in `chat_messages.content`. suggestions 컬럼 없음.
- `MeetingChatJob`(backend/app/jobs/meeting_chat_job.rb): `LlmService#answer_question(system, user)` → plain string → content 저장 → ActionCable broadcast(`meeting_<id>_chat_<user_id>`).
- 시스템 프롬프트 `MEETING_CHAT_SYSTEM_PROMPT`(backend/app/services/llm_prompts.rb:255-270).
- 프론트 `AiChatPanel.tsx` plain 렌더, `chatStore.send(meetingId, content)`(범용), `applyUpdate`가 broadcast 머지. `api/chat.ts` `ChatMessage` 타입.

### 설계
1. **마이그레이션**: `add_column :chat_messages, :suggestions_json, :text, default: "[]", null: false`.
2. **ChatMessage 모델**: `suggestions` accessor — `JSON.parse(suggestions_json)` 안전 파싱(실패 시 `[]`), `suggestions=`는 배열→JSON 직렬화. 항상 문자열 배열.
3. **프롬프트 확장**: `MEETING_CHAT_SYSTEM_PROMPT`에 지시 추가 — 답변 본문 출력 후, 마지막 줄에 정확히 한 번 센티넬 + JSON 배열(한국어 질문 3개, 회의 내용에 근거, 본문에서 이미 답한 것 제외). 형식 예:
   ```
   <<<FOLLOWUPS>>>["질문1","질문2","질문3"]
   ```
4. **MeetingChatJob 파싱**: raw 답변에서 `<<<FOLLOWUPS>>>` 기준 split → 앞=clean content, 뒤=JSON.parse(배열, 문자열만, 최대 3개). 파싱 실패/센티넬 없음 → content=raw 전체, suggestions=[] (**graceful**). content/suggestions_json 저장, broadcast payload에 `suggestions` 추가.
5. **컨트롤러 serialize**(ChatMessagesController): 응답에 `suggestions` 배열 포함.
6. **프론트**:
   - `api/chat.ts` `ChatMessage`에 `suggestions?: string[]`.
   - `chatStore`: 변경 거의 없음(applyUpdate가 필드 머지). 타입만.
   - `AiChatPanel.tsx`: status==='complete' 어시스턴트 메시지 아래 `suggestions`(≤3) 칩 버튼 렌더. 클릭 → `send(meetingId, q)` 즉시 자동전송. 빈 배열이면 미렌더.

### 동작/경계
- 칩은 어시스턴트 메시지별로 그 메시지의 suggestions를 렌더(보통 최신 답변에서 클릭).
- 답변 본문은 기존 plain 렌더 유지(이번 변경 아님).
- 파싱 실패는 절대 답변을 깨지 않음(graceful 폴백).

### 테스트
- 백엔드(rspec):
  - ChatMessage accessor: 정상/깨진 JSON→[].
  - MeetingChatJob: 센티넬 포함 응답→content 분리+suggestions 3개 저장+broadcast 포함. 센티넬 없음→suggestions=[], content=raw.
  - ChatMessagesController serialize: suggestions 포함.
- 프론트(vitest):
  - AiChatPanel: suggestions 있는 complete 메시지→칩 N개 렌더. 칩 클릭→send 호출(해당 질문). suggestions 없으면 칩 없음.

---

## 구현 순서
A, B 독립 → 병렬 가능(파일 비중첩). 각각 TDD(red→green→refactor) + 적대적 리뷰 + 전체 vitest/rspec/tsc green.

## 비고
- 커밋 정책: 명시 요청 전까지 미커밋(작업트리 누적). 이 spec 문서도 미커밋.
- 관련: [[project_ai_chat_feature]], [[project_summary_undo_dataloss]]
