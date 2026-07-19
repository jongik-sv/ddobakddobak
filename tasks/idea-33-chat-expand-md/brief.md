# idea.md 33 — AI 챗 답변 확대 보기 + MD 저장

## 요구사항 (idea.md:142)
"AI 챗의 AI 답변을 크게 키워서 볼 수 있도록 해줘. md 파일 저장도 되면 좋겠다. 물론 마커는 빼고 파일로 저장해야된다."

## 배경 (조사 결과 — 파일 위치)
- 렌더러: `frontend/src/components/meeting/ChatMarkdown.tsx` — react-markdown + remarkGfm, `markersToSeekLinks()`로 인용 마커→링크 치환, `rehypeChatBr()`로 `<br>` 리터럴 처리 (`BR_RAW_RE`).
- 호출부: `frontend/src/components/meeting/AiChatPanel.tsx:114` — 완료된 assistant 메시지에 `<ChatMarkdown content={m.content} ... />`.
- 마커: `frontend/src/lib/citationMarkers.ts` — `CITATION_RE`(`⟦t:<ms>|s:<speaker>⟧`), `FOLDER_CITATION_RE`(`⟦m:<id>/t:<ms>/s:<speaker>⟧`), **`stripCitationMarkers()` 이미 존재**.
- 확대 모달 선례: `frontend/src/components/meeting/ChatMermaid.tsx` — 공용 `frontend/src/components/ui/Dialog.tsx`(createPortal, closeOnBackdrop/Esc, 배경 스크롤 잠금)로 확대 보기 구현. 이 패턴 따를 것.
- 다운로드 유틸: `frontend/src/lib/download.ts` — `downloadBlob(blob, filename)`이 IS_TAURI 분기(브라우저=`<a download>`, Tauri=plugin-dialog save+plugin-fs) 자동 처리. **그대로 사용, 재구현 금지.**
- 메시지 타입: `frontend/src/api/chat.ts` — `ChatMessage { id, role, content, status: 'pending'|'streaming'|'complete'|'error', ... }`.

## 구현 사양

### 1. Export 유틸 (신규): `frontend/src/lib/chatExport.ts`
- `export function chatAnswerToMarkdown(content: string): string`
  - `stripCitationMarkers()`로 인용 마커 전부 제거 (인라인 + 크로스미팅).
  - `<br>` 리터럴(`<br>`, `<br/>`, `<br />`, 대소문자 무관, 인라인 포함)을 `\n`으로 치환.
  - 마커 제거로 생긴 줄 끝 잉여 공백 정리. 그 외 마크다운 문법은 원본 유지.
  - 끝에 개행 1개로 정리.
- `export function downloadChatAnswer(content: string): Promise<void>` (또는 유사) — 위 함수 결과를 `text/markdown` Blob으로 `downloadBlob()` 호출. 파일명 `ai-answer-YYYYMMDD-HHmmss.md` (로컬 시각).

### 2. 확대 보기 모달 (신규 컴포넌트): `frontend/src/components/meeting/ChatExpandDialog.tsx`
- 공용 `Dialog` 사용. ChatMermaid 확대 모달 패턴 참조.
- 카드 크게: `max-w-4xl` 급 + `max-h-[90vh]` + 내부 스크롤.
- 본문 폰트 확대: 채팅 본문보다 큰 크기 (예: text-base~lg 급 + prose 스케일 상향). 기존 스타일 토큰(bg-card, border-border 등) 준수.
- 내용은 `ChatMarkdown` 재사용 — AiChatPanel에서 넘기던 것과 동일한 props(onSeek 등) 전달해 타임스탬프 배지 클릭 동작 유지.
- 모달 헤더에 닫기 버튼 + "MD 저장" 버튼 배치.

### 3. AiChatPanel 통합
- `status === 'complete'`인 assistant 메시지에만 액션 노출: 확대 보기 버튼 + MD 저장 버튼.
- 기존 UI 밀도 해치지 않게 작은 아이콘 버튼 (프로젝트의 기존 아이콘/버튼 관례 확인 후 동일 방식 — lucide 등 사용 여부는 코드에서 확인). 메시지 버블 하단 or hover 노출 중 기존 관례에 맞는 쪽.
- 스트리밍/에러/유저 메시지에는 미노출.

### 4. 테스트 (vitest, TDD)
- `chatAnswerToMarkdown` 단위 테스트: (a) 인라인 마커 제거, (b) 크로스미팅 마커 제거, (c) `<br>` 변형들 → 개행, (d) 일반 마크다운(코드블록, 표, mermaid 펜스) 원본 보존, (e) 마커 제거 후 줄끝 공백 정리.
- 기존 테스트 러너: `cd frontend && npx vitest run <새 테스트 파일>`.

## 제약
- **커밋 금지.** 파일 수정만. (커밋은 사용자 명시 요청 시에만.)
- 기존 파일 수정 최소화 — AiChatPanel 통합부 외 리팩토링 금지.
- 타입체크 게이트: `cd frontend && npx tsc -p tsconfig.app.json` — 기준선 ~24개 에러 사전 존재. **새/수정 파일에서 신규 에러 0** 확인.
- 빌드 게이트: `cd frontend && npx vite build` 성공.
- i18n: 이 프로젝트 UI 문자열 처리 방식(하드코딩 한글 vs i18n 키) 확인 후 동일 방식.
