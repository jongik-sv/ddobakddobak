# Task 3 (Backend): 연결 회의 — 이전 회의 상단 고정 요약(회의별 블록) + 코드 레벨 보호

리포: /Users/jji/project/ddobakddobak, 브랜치 feature/prev-meeting-summary-pin (체크아웃됨). 커밋 금지.

## 문제 (실서버 실측, 2026-08-07)

연결 회의(previous_meeting) 요약에서 이전 회의록 내용이 침식·소실된다. 실측: 회의 138(이전=137, restructure=1, verbosity=standard)에서 137의 논의 소제목 11개 중 2개만 스텁으로 생존.

원인 체인 (재확인 불필요):
1. `meeting_summarization_job.rb:202,380` — `seeded_merge: previous_meeting_id.present? && !meeting.summary_restructure?` → 재구조화 모드에선 병합 보존 지시가 아예 안 붙음
2. refine이 매 틱 문서 전체를 LLM에 재작성시킴 — 이전 내용도 압축 재료. verbosity=standard면 침식 가속
3. 유실 가드 `llm_service.rb:675` `catastrophic_note_loss?`는 단일 틱 50% 붕괴만 차단 — 점진 침식 통과

## 확정 설계 (사용자 승인 2026-08-07)

**이전 회의 = 상단 고정 압축 요약, 코드 레벨 분리.** 프롬프트 지시 의존 금지 — 요약 틱이 상단을 LLM에 재작성시키지 않는 구조로.

문서 구조:
```
## 이전 회의 요약

### <회의 A 제목>
(A 압축 요약, m:A 마커 보존)

### <회의 B 제목>
(B 압축 요약, m:B 마커 보존)

**✂ ─ ─ ─ ─ ─ 이전 회의 / 현재 회의 ─ ─ ─ ─ ─**   ← 기존 Meeting::PREVIOUS_MEETING_CUT_LINE 재활용

<현재 회의 회의록 — 요약 틱이 작성하는 유일한 영역>
```

**연쇄 요구(사용자 명시): 몇 번을 연결해도 각 이전 회의의 요약 블록이 개별 유지**되어야 한다. 즉 C가 B를 연결하면: B 문서를 절취선으로 분할 → B의 상단(A 블록 등)은 **재압축 없이 그대로 승계** → B의 하단(본문)만 1회 압축해 새 `### <B 제목>` 블록으로 뒤에 추가. 각 회의는 정확히 1회만 압축되고 이후 불변.

## 구현 항목

1. **시드 개편** — `meeting.rb` `seed_summary_from_previous!`:
   - base(이전 회의 `current_notes_markdown`)를 절취선 기준 분할: `prev_section`(있으면) / `body`
   - `body`에 `stamp_source_meeting`(previous_meeting_id) 각인 (기존 로직 유지, m: 스킵 동일)
   - `body`를 LLM 1회 압축 → `### <이전 회의 제목>` 블록 생성. **압축 실패·LLM 불가 시 폴백 = 압축 없이 각인된 body 원문을 블록으로** (시드 자체는 실패시키지 말 것)
   - 새 문서 = `## 이전 회의 요약` 헤더 + 승계한 기존 블록들 + 새 블록 + 절취선. `prev_section`이 이미 `## 이전 회의 요약` 헤더를 갖고 있으면 중복 생성 금지
   - 이전 문서에 절취선이 없으면(구 데이터·비연쇄) 문서 전체를 body로 취급
2. **압축 LLM 메서드** — `llm_service.rb`에 신설 (예: `condense_previous_notes(notes, meeting_title:)`):
   - **사용자 요구: 간결하게 잘 요약된 블록.** 지시: 결정사항·Action Items·핵심 결론 위주 고밀도 요약, 세부 경위·중복 서술 제거, 목표 분량 원문의 ~25%(대략 상한 2000자 내외 가이드 — 하드컷 아님). 불릿 중심 간결체
   - `⟦m:..⟧`/`⟦t:..⟧` 마커는 유지하되 **인용 마커 남발 금지**(핵심 항목에만) — 마커 포함 시 원형 보존(CITATION_MARKER_INSTRUCTION 포함)
   - 출력은 마크다운 본문만
   - 실패 시 nil 반환 → 호출부 폴백
3. **요약 틱 보호** — `meeting_summarization_job.rb` realtime·final 양쪽:
   - `current_notes`를 절취선으로 분할 → 상단(이전 요약)은 **LLM에 current_notes로 전달하지 않음**. 하단만 refine/append/재구조화 대상
   - 문맥 연속성: user_content에 상단을 "이전 회의 요약(참고용 — 수정·재출력 금지)" 블록으로 별도 제공
   - 저장 시 재조립: 상단 + 절취선 + LLM 출력. 재조립 후 저장(가드도 하단 기준으로 평가되도록 위치 주의)
   - 절취선이 없으면(비연결·사용자가 절취선 삭제) 기존 동작 그대로(전체 전달) — 회귀 없음
   - `seeded_merge` 지시·파라미터는 새 구조에서 불필요해지면 제거(호출 2곳+`notes_prompts.rb`). 단 제거 시 relocation spec baseline 영향 확인
4. **분할 유틸** — 절취선 분할/재조립 함수는 한 곳(Meeting 또는 CitationMarkers 옆 적절한 모듈)에 두고 양쪽(시드·잡)이 공유. spec 필수
5. **spec**: 시드(신규 포맷·연쇄 승계·폴백·절취선 없는 구 데이터), 틱 보호(상단 불변 보장 — LLM stub이 하단만 받는지, 재조립 정확성), 압축 메서드(마커 보존 지시 포함 여부), 기존 관련 spec green

## 제약

- 마이그레이션 금지, 기존 데이터 소급 없음 (이미 침식된 문서 복구는 별도)
- 러닝 dev 서버 실요청·settings.yaml 수정 금지. LLM 호출은 spec에서 전부 stub
- **git commit 금지**
- frontend/ 수정 금지 (절취선·헤더는 일반 마크다운이라 프론트 변경 불요)
- `PREVIOUS_MEETING_CUT_LINE` 상수 문자열 변경 금지 (기존 데이터가 이 절취선을 이미 포함)

## 검증

- `cd backend && bundle exec rspec` 관련 파일(meeting, summarization job, llm_service, citation_markers, relocation) green — 가능하면 전체
- 연쇄 시나리오 spec: A→B→C 2단 연결에서 C 문서에 A·B 블록 개별 존재+A 블록 재압축 안 됨 검증

## 리포트

/private/tmp/claude-501/-Users-jji-project-ddobakddobak/1c96cc2b-0339-47db-b751-125c28895d09/scratchpad/sdd/task-3-report.md
변경 파일, spec 결과, 설계와 다른 결정+사유, 우려. 응답=상태+테스트 요약+우려만.
