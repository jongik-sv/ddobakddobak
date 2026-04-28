# 회의 UX 4종 개선 — 설계

날짜: 2026-04-27
범위: Decision log 위치 / Mermaid 최소 가독 크기 / 참석자 입력 / LLM "선택 안함"

---

## 1. Decision log를 메모 영역 하단으로 이동

### 현재
- `MeetingPage.tsx`, `MeetingLivePage.tsx` 데스크톱 패널: AI 요약 패널 하단(`max-h-[40%]`)에 `<DecisionList>` 부착
- 모바일: `summary` 탭의 AI 요약 아래에 `<DecisionList>` 부착

### 변경
- `<DecisionList>`를 메모 패널/탭의 메모 에디터 **아래**로 이동.
- 메모 토글이 OFF면 Decision log도 함께 숨김(현재 메모와 한 묶음).
- `MeetingPage` 메모 패널 (defaultSize 30%): 상단 메모 헤더 + 에디터(flex-1) + 하단 DecisionList(scrollable, `max-h-[40%]`).
- `MeetingLivePage` 메모 패널: 메모(60%) + 오타수정(40%) → 메모(50%) + DecisionList(20%) + 오타수정(30%)? 너무 빠듯하므로 단순화: 메모(45%) + DecisionList(25%) + 오타수정(30%).
- 모바일 `summary` 탭에서 DecisionList 제거 → `memo` 탭 하단에 추가.

### 영향 파일
- `frontend/src/pages/MeetingPage.tsx`
- `frontend/src/pages/MeetingLivePage.tsx`

---

## 2. Mermaid 최소 가독 크기

### 현재
- `[&>svg]:max-w-full [&>svg]:h-auto` — SVG가 컨테이너 폭에 맞춰 축소되어 좁은 패널에서는 가독성 저하.
- 컨테이너에 `overflow-x-auto`는 이미 있음.

### 변경
- 렌더 컨테이너 SVG에 `min-width: 480px` 적용 → 좁은 칼럼에서는 SVG가 480px를 유지하고, 컨테이너의 `overflow-x-auto`로 좌우 스크롤이 발생.
- 폭 옵션(`compact|normal|wide|full`)은 유지하되 `compact`도 컨테이너 폭이 480px 미만이 되지 않도록 그대로 둠 (사용자가 명시적으로 작게 두는 옵션은 보존).
- 빈 mermaid 블록 편집 영역의 `min-h-[240px]`는 그대로 유지.

### 영향 파일
- `frontend/src/components/meeting/mermaidBlock.tsx`

---

## 3. 회의 참석자 입력

### 데이터 모델
- `meetings` 테이블에 `attendees: text` 컬럼 추가 (자유 입력, 줄바꿈/콤마 구분 자유).
- 기존 `meeting_participants`(실시간 접속자)와는 별개의 메타데이터.

### Backend
- 마이그레이션: `add_attendees_to_meetings.rb` (text, null 허용).
- `meetings_controller.rb`:
  - `update`/`create` strong-params에 `:attendees` 추가.
  - `meeting_json`에 `attendees` 직렬화.
  - LLM 호출 경로(`refine_notes`, `build_prompt`)에 `attendees:` kwarg 전달.
- `LlmService#refine_notes`/`#build_prompt`/`#apply_feedback`: `attendees:` 옵션 추가 → 사용자 컨텍스트 `parts`에 `참석자: ...` 라인 삽입.
- `MeetingSummarizationJob`, `FileTranscriptionJob` 호출부에서 `meeting.attendees` 전달.

### Frontend
- `EditMeetingDialog`에 "참석자" textarea(rows=2) 추가, placeholder "쉼표 또는 줄바꿈으로 구분".
- `api/meetings.ts`의 `Meeting`/`updateMeeting` 타입에 `attendees?: string \| null` 추가.
- `MeetingPage`, `MeetingLivePage`의 `handleEditMeetingConfirm`에 `attendees` 전달.

### 회의록 양식
- `docs/회의록-양식.md`: 모든 섹션 헤더 위에 `## 참석자` 행 추가 (참석자가 있을 경우).
- `config.yaml`의 `meeting_types[].sections_prompt`: 첫 항목으로 `## 참석자 (입력된 참석자 목록 그대로 표시. 없으면 생략)` 추가.

### 영향 파일
- `backend/db/migrate/<ts>_add_attendees_to_meetings.rb`
- `backend/app/models/meeting.rb` (validation 불필요)
- `backend/app/controllers/api/v1/meetings_controller.rb`
- `backend/app/services/llm_service.rb`
- `backend/app/jobs/meeting_summarization_job.rb`, `file_transcription_job.rb`
- `frontend/src/api/meetings.ts`
- `frontend/src/components/meeting/EditMeetingDialog.tsx`
- `frontend/src/pages/MeetingPage.tsx`, `MeetingLivePage.tsx`
- `docs/회의록-양식.md`
- `config.yaml`

---

## 4. LLM "선택 안함" 옵션

### 변경
- `UserLlmSettings.tsx`의 `PROVIDER_OPTIONS` 첫 항목으로 `{ id: 'none', name: '선택 안함', description: '서버 기본 LLM 사용' }` 추가.
- `provider === 'none'` 일 때:
  - API Key / Base URL / 모델 입력 영역 모두 숨김.
  - 액션 버튼은 "저장"만 노출 → `handleReset()` 호출 (서버는 빈 provider로 업데이트되어 서버 기본 LLM 사용으로 폴백).
- 선택 시 `setProvider('none')` 외 추가 상태 초기화.

### 영향 파일
- `frontend/src/components/settings/UserLlmSettings.tsx`

---

## 검증 계획
- 프론트엔드: `npm run build`(혹은 vite 빌드) + 타입체크.
- 백엔드: `bin/rails db:migrate` + 기존 컨트롤러 스펙(있다면) 실행.
- UI 동작은 사용자 확인 필요 (브라우저 수동 테스트).

## 비고
- DB 마이그레이션 추가는 운영 DB에 영향. 사용자 환경에서 `db:migrate` 수동 실행 필요.
- attendees 자유 텍스트는 길이 제한 두지 않음 (text). 추후 chip 입력으로 확장 가능.
