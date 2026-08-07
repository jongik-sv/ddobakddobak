# 구현 요청: 연결 회의 시드 마커 무동작(inert) 배지화

## 문제

"연결 회의"(previous_meeting) 시드가 이전 회의 회의록을 마커 포함 그대로 복사해서, 이전 회의의 시간 태그 `⟦t:<ms>/s:화자⟧`를 현재 회의에서 클릭하면 **현재 회의 오디오** 기준으로 엉뚱하게 seek 된다. 재연결 시에도 옛 마커가 그대로 남는다.

## 확정 결정 (사용자 승인, 2026-08-07)

이전 회의 유래 마커는 **클릭 무동작(inert) 배지**로 표시:
- 시드 시 마커에 출처 회의 ID 각인: `⟦t:...⟧` → `⟦m:<이전회의id>/t:...⟧` (기존 챗 전용 포맷 재활용, 새 포맷 발명 금지)
- 이미 `m:`인 마커는 그대로 둠 (연쇄 연결 A→B→C에서 원출처 보존)
- 배지: 클릭해도 아무 동작 없음, 색은 화자색 대신 **고정 중립색**(회색 계열), 툴팁 `이전 회의: <회의명> · <화자> · <시간>`
- 회의명 해석: 회의 상세 응답에 `citation_meetings: {id: 제목}` 맵 추가(백엔드가 활성 요약 텍스트에서 `m:` id 스캔, 삭제/접근불가 회의는 "이전 회의" 폴백). 연쇄 연결이면 한 문서에 여러 이전 회의 id가 공존하므로 직전 회의만 해석하는 방식은 불가.
- 기존 데이터 소급 없음 (이미 시드된 옛 `t:` 마커는 현행 유지)

## 조사 실측 (2026-08-07, 재확인 불필요한 앵커)

**Backend:**
- 연결 회의: `meeting.rb:8` `belongs_to :previous_meeting`, 시드 = `meeting.rb:543-558` `seed_summary_from_previous!` — 요약 0개일 때만 이전 회의 `current_notes_markdown` 전체를 첫 Summary(realtime)로 복사(멱등, 요약 있으면 no-op). 호출 = `meeting_summarization_job.rb:172`
- 마커 포맷 정의: `backend/app/services/llm_prompts/citation_markers.rb:15,18` — `⟦t:<ms>[|/]s:<화자>⟧`(회의 ID 없음) / `⟦m:<meetingId>/t:<ms>/s:<화자>⟧`(챗 전용)
- LLM 마커 보존 지시: `citation_prompts.rb:11` "기존 ⟦t:..⟧ 마커 보존" — **`m:` 포맷 언급 없음** (보완 필요)
- 재연결: `meetings_controller.rb:288-291` update가 컬럼만 갱신, 재시드 없음

**Frontend:**
- 정규식: `frontend/src/lib/citationMarkers.ts:3` `CITATION_RE`(t:), `:6` `FOLDER_CITATION_RE`(m:) — 이미 존재
- `stripCitationMarkers`(citationMarkers.ts) — **t:만 지움**, m: 미처리
- 회의록 렌더러: `frontend/src/components/meeting/citationInline.tsx` — `CITATION_RE`만 파싱, citation 노드 props `{ms, speaker}`, 역직렬화 `inlineCitationsToMarkers`가 `⟦t:...⟧`로만 되돌림
- 배지: `frontend/src/components/meeting/TimestampBadge.tsx` — `speakerColor(speaker)` 색, onClick=onSeek(ms), 툴팁 `화자 · 시간`
- 화자 재해석: citationInline.tsx render가 `window.__ddobakSpeakerAt`(ms)로 **현재 회의 전사 기준** 화자를 재해석 — 이전 회의 마커에 적용하면 엉뚱한 화자
- 챗의 m: 처리 참고: `ChatMarkdown.tsx:7-14` — **m: 먼저 치환 후 t: 치환** (오매칭 방지 순서)

## 구현 항목

**Backend:**
1. `seed_summary_from_previous!`: 복사 직전 `⟦t:...⟧` → `⟦m:<previous_meeting_id>/t:...⟧` 재작성 (이미 `m:`인 것 skip). 재작성 유틸은 citation_markers.rb에 두고 spec 작성
2. `citation_prompts.rb` 보존 지시에 `⟦m:...⟧`도 보존 대상 명시 (요약 틱에서 파괴 방지)
3. 백엔드 마커 스트립 경로(내보내기·D'Flow 전송 등 — grep으로 전수 확인)에 `m:` 포맷 추가
4. 회의 상세 응답에 `citation_meetings` 맵 추가 (활성 요약 스캔, 폴백 처리)

**Frontend:**
5. `citationInline.tsx`: m: 파싱 추가(**m: 먼저**), citation 노드에 `meetingId` prop(default 0). **역직렬화도 meetingId 있으면 `⟦m:.../t:...⟧`로 복원 필수** — 빠뜨리면 편집 저장 한 번에 출처 소실
6. `TimestampBadge`: `meetingId`(또는 inert/외부 표시) prop 추가 — 있으면 button 대신 span(클릭 무동작), 고정 중립색, 툴팁 `이전 회의: <회의명> · <화자> · <시간>`. 회의명은 `citation_meetings` 맵에서, 없으면 "이전 회의"
7. 이전 회의 마커는 `__ddobakSpeakerAt` 재해석 금지 — 마커에 박힌 화자 그대로
8. `stripCitationMarkers`(프론트)도 m: 포맷 지우도록 확장 (사용처 grep 전수 확인)

## 규칙 (필수 준수)

- **feature 브랜치 먼저 생성** 후 작업 (main 워킹트리 직접 작업 금지). 예: `feature/prev-meeting-citation-inert`
- 구현은 **서브에이전트 방식**(코딩=sonnet), 메인 세션은 오케스트레이션·검증만
- 커밋·푸시는 사용자 명시 요청 시에만
- 러닝 dev 서버(puma)에 실요청·settings.yaml 수정 금지, QA는 spec/stub만
- 마이그레이션 없음 (이번 작업은 스키마 무변경 — citation_meetings는 응답 계산 필드)

## 검증 게이트

- backend: 추가·수정 spec + 기존 dflow/meeting/summarization 관련 spec green (`bundle exec rspec`)
- frontend: `cd frontend && npx tsc -p tsconfig.app.json` **전체 0 에러**(bare tsc 금지) + `npx vite build` 성공 + 관련 vitest
- 마커 왕복 테스트 필수: `m:` 마커가 파싱→BlockNote→저장 왕복 후에도 보존되는지
- 스트립 전수: `stripCitationMarkers`·백엔드 스트립 사용처 grep으로 빠짐없이 m: 처리 확인

## 산출·기록

- `tasks/prev-meeting-citation-inert/` 에 log.md append (worker 호출·검증 결과)
- 완료 보고: 변경 파일, 검증 결과, 설계와 다른 결정+사유
