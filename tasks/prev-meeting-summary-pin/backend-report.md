# Task 3 (Backend) 리포트: 연결 회의 — 이전 회의 상단 고정 요약 + 코드 레벨 보호

## 변경 파일

- `backend/app/services/previous_meeting_notes.rb` (신규) — 절취선 분할/재조립 공유 유틸(`PreviousMeetingNotes.split/join/append_block`). Meeting과 Job이 공유하는 단일 소스. `split`은 절취선이 없는 텍스트에는 no-op(그대로 하단 취급)이라 이미 분할된 body를 다시 넣어도 안전(멱등).
- `backend/app/models/meeting.rb`:
  - `seed_summary_from_previous!` 재작성: previous 문서를 절취선 기준 분할 → 하단(body)만 1회 압축 → `### <제목>` 블록으로 상단(top)에 추가(연쇄 시 기존 top 그대로 승계) → `## 이전 회의 요약` 헤더 + 절취선으로 재조립해 시드. 압축 실패 시 원문(마커 각인 유지) 폴백하는 `condense_previous_meeting_body` private 헬퍼 추가.
  - `refresh_brief_summary!` 재작성(리뷰 fix): 인자로 받은 `notes_markdown`을 항상 `PreviousMeetingNotes.split`으로 먼저 나누고 **본문(body)만** brief_summary 추출 대상으로 삼는다. 단일 진입점이라 job.rb(이미 body만 넘김)·컨트롤러 4곳(전체 문서를 넘김) 전부 이 메서드 하나로 안전해진다 — 호출부마다 분할을 기억할 필요 없음. body가 비어 있으면(연결 직후 첫 틱 전) 갱신하지 않는다.
- `backend/app/services/llm_service.rb`:
  - `condense_previous_notes(notes, meeting_title:)` 신설. 실패/빈 결과는 nil.
  - `refine_notes`/`append_notes`에 `pinned_context:` 파라미터 추가(상단 고정 블록을 참고용으로만 user_content에 주입, `current_notes`에는 절대 섞지 않음).
  - `seeded_merge:` 파라미터·`seeded_merge_instruction` 호출 제거.
- `backend/app/services/llm_prompts/citation_markers.rb` — `CitationMarkers.strip_all(text)` 신규(마커 형식 무관 와일드카드 통삭제, `meeting.rb#extract_brief_summary`의 기존 하드코딩과 동일 패턴 재사용 — 그쪽을 이 메서드로 교체하진 않음, 별도 관심사).
- `backend/app/services/llm_prompts/notes_prompts.rb`:
  - `seeded_merge_instruction` 메서드 제거.
  - `CONDENSE_PREVIOUS_NOTES_SYSTEM_PROMPT` 신규: **결정사항·Action Items·핵심 결론만, 불릿 5~10개·300~800자 수준의 초간결 요약** 지시(사용자 결정으로 최초 "~25%/2000자" 안에서 축소). 인용 마커는 "넣지 않는다"고만 지시 — 마커 보존 지시는 없음(블록 헤더가 이미 출처를 표시하므로 근거 마커 불필요라는 사용자 판단).
- `backend/app/jobs/meeting_summarization_job.rb` — realtime·final 양쪽: `current_notes`(final은 `latest_full`/`meeting.current_notes_markdown`)를 `PreviousMeetingNotes.split`으로 분할 → LLM에는 하단(body)만 `current_notes`로, 상단은 `pinned_context:`로 전달 → 저장 직전 `PreviousMeetingNotes.join`으로 재조립. 분기 조건에서 `previous_meeting_id.present?`를 제거하고 `meeting.summary_restructure?`(및 final의 body-blank 폴백)만으로 refine/append를 결정 — 연결된 회의의 본문 처리가 비연결 회의와 동일해짐(핵심 재설계). `seeded_merge:` 인자 제거. 저장 여부·`refresh_brief_summary!` 판정 기준을 재조립본이 아닌 body(본문) 존재 여부로 변경.

## 마커 정책 (사용자 결정 2건 반영)

1. **압축 블록은 마커 없음이 기본값.** `condense_previous_notes`는 LLM 출력에서 `CitationMarkers.strip_all`로 마커를 코드 레벨로 전부 제거한다(프롬프트 지시 + 후처리 이중 방어 — LLM이 지시를 어겨도 확실히 제거).
2. **압축 실패 시 폴백 경로는 마커를 유지한다.** `seed_summary_from_previous!`에서 압축이 실패/빈 결과(nil)면 `stamp_source_meeting`으로 각인된 body 원문을 그대로 블록에 쓴다 — 이 경우엔 inert 배지(⟦m:..⟧)가 안전망 역할을 하므로 의도적으로 보존한다.

### spec (신규/갱신)

- `backend/spec/services/previous_meeting_notes_spec.rb` (신규) — split/join/append_block 단위 테스트(왕복 무손실, 헤더 중복 방지 포함).
- `backend/spec/models/meeting_previous_meeting_spec.rb` — 새 포맷(상단 블록·절취선)·압축 실패/nil 폴백(마커 유지)·연쇄(A→B→C, A 블록 재압축 안 됨, B 압축 블록엔 마커 없음)·절취선 없는 구 데이터 케이스 + **`#refresh_brief_summary!` 커버 spec 4건 신규**(연결 회의 body만 추출·비연결 회귀없음·body 빈 경우 미갱신·이중분할 안전).
- `backend/spec/requests/api/v1/meetings_previous_meeting_brief_summary_spec.rb` (신규) — `PATCH update_notes` end-to-end: 상단 포함 전체 문서를 저장해도 brief_summary는 본문만 반영.
- `backend/spec/jobs/meeting_summarization_job_previous_spec.rb` — 상단 보호·재조립 정확성·`previous_meeting_id`가 refine/append 분기에 관여하지 않음·A→B→C 연쇄 시나리오로 재작성.
- `backend/spec/services/llm_service_seeded_spec.rb` — `condense_previous_notes` 계약(마커 코드 레벨 스트립 포함, 마커만 남은 출력은 nil) + `pinned_context` 주입/미주입 검증.
- `backend/spec/services/llm_prompts_spec.rb`, `llm_prompts_relocation_spec.rb` — 제거된 `seeded_merge_instruction` 관련 테스트 삭제. `CONDENSE_PREVIOUS_NOTES_SYSTEM_PROMPT` 검증을 초간결(5~10개)·마커 비삽입·"보존" 지시 없음으로 갱신.
- `backend/spec/services/llm_prompts/citation_markers_spec.rb` — `.strip_all` 신규 테스트 4건.

## 설계와 다른 결정 + 사유

1. **restructure(재구조화) 모드도 previous_meeting_id 유무와 무관하게 처리** — 원인 체인 자체가 "재구조화 모드엔 보호 지시가 아예 안 붙는다"였으므로, 재구조화+연결 조합도 시드가 항상 절취선을 넣고 잡이 하단만 재작성하도록 통일했다.
2. **`meeting.previous_meeting_id.present?`를 refine/append 분기 조건에서 완전히 제거** — 이전 내용이 상단에 코드 레벨로 분리된 이상, 본문(하단) 처리는 비연결 회의와 동일해야 한다는 설계 원리를 그대로 따른 결과. `seeded_merge` 제거 지시의 자연스러운 귀결.
3. **final의 chronological 지시**: `!restructure? && previous_meeting_id.blank?` → `previous_meeting_id` 조건 제거, "증분+본문백지 폴백"이면 항상 chronological로 통일(2번과 동일 이유).
4. **저장/브리프 판정 기준을 body 기준으로 명시적으로 변경**: 상단이 존재하면 재조립본은 본문이 비어도 항상 present이므로, `body_result` 기준으로 판정해야 정확하다.
5. **(리뷰 반영) `refresh_brief_summary!`를 body 기준으로 단일화**: 최초 구현에서 job.rb 2곳만 body를 넘기도록 고쳤으나, 컨트롤러 4곳(글로서리 교정 3·update_notes 1)이 여전히 전체 문서를 넘겨 동일 버그가 남아 있었다(리뷰 지적). 각 호출부를 개별 수정하는 대신 `Meeting#refresh_brief_summary!` 안에서 항상 `PreviousMeetingNotes.split`을 적용하도록 단일화 — `split`이 절취선 없는 텍스트엔 no-op이라 job.rb의 기존 body 전달과도 충돌 없이 호환된다. 향후 새 호출부가 추가돼도 자동으로 안전하다.
6. **(사용자 결정) 압축 블록 마커 정책·압축 강도**: 최초 설계(brief)는 "마커 보존(핵심 항목만)"·"원문 ~25%/2000자"였으나, 사용자가 작업 중 두 차례 명시적으로 변경 지시 — (a) 블록 헤더가 이미 출처를 표시하므로 마커는 코드 레벨로 완전 제거, 폴백 경로만 마커 유지, (b) 압축 강도를 "정말 간단하게"(5~10개 불릿, 300~800자)로 상향. 위 "마커 정책"·"변경 파일" 절에 반영 완료.
7. **(리뷰 반영) `PreviousMeetingNotes.split`에 HEADER 가드 추가** — 구 `seeded_merge` 시절 문서는 LLM 지시로 절취선을 "논의 사항" 섹션 한가운데 인라인으로 삽입했다(상단 고정 구조 도입 이전 데이터, 리뷰어가 회의 138 실문서 형태로 재현). 이런 문서에서 첫 절취선만 보고 자르면 회의 자신의 제목·핵심 요약까지 "상단"으로 오인 동결되고 하단에 문서가 두 벌 남는 실버그였다. 절취선을 찾아도 그 앞에 `HEADER`(`## 이전 회의 요약`)가 `include?`로 존재하지 않으면(`start_with?` 금지 — 사용자가 문서 앞에 제목 한 줄만 붙여도 보호가 풀림) `[nil, 전체]`를 반환하도록 수정. 부수 효과: previous가 이런 구형 연결 회의면 시드가 이제 previous 전체를 새 블록 하나로 압축해 승계한다(전엔 HEADER 없는 조각을 그대로 상단 승계하려 시도).

## 테스트

- 타겟 spec 최종 재실행(신규 5 + 갱신 7 + 인접 spec 5, HEADER 가드 spec 3건 포함): `bundle exec rspec spec/services/previous_meeting_notes_spec.rb spec/models/meeting_previous_meeting_spec.rb spec/services/llm_service_seeded_spec.rb spec/jobs/meeting_summarization_job_previous_spec.rb spec/services/llm_prompts_spec.rb spec/services/llm_prompts_relocation_spec.rb spec/services/llm_service_spec.rb spec/services/llm_service_agenda_spec.rb spec/jobs/meeting_summarization_job_spec.rb spec/jobs/meeting_summarization_job_agenda_spec.rb spec/services/llm_prompts/citation_markers_spec.rb spec/requests/api/v1/meetings_previous_meeting_spec.rb spec/requests/api/v1/meetings_previous_meeting_brief_summary_spec.rb spec/models/meeting_spec.rb` → **333 examples, 0 failures**.
- 전체 스위트(`bundle exec rspec`) 이력(모두 이 브랜치 위에서 완주, 뒤로 갈수록 최신):
  1. brief_summary 중앙화 이전(마커 스트립/압축 강도만 반영): 2425 examples, 0 failures — stale.
  2. brief_summary 중앙화(리뷰 fix 1) 반영: 2436 examples, 0 failures — stale(HEADER 가드 이전).
  3. **HEADER 가드(리뷰 fix 2) 반영 최종본 — 최종 완주 결과**: **2439 examples, 0 failures** (10분 23초, `bundle exec rspec`). 이 브랜치의 최신 코드 기준.
- rubocop: 매 라운드 수정 파일 전체 검사, 내가 만든 offense는 총 1건(relocation spec 트레일링 빈 줄, 최초 라운드에서 즉시 수정)뿐. 나머지는 모두 손대지 않은 기존 라인의 pre-existing offense(git stash로 대조 확인).

## 우려

- LLM 압축(`condense_previous_notes`) 호출은 시드 시점(즉 realtime/final 잡 진입 시 동기)에 발생 — 이전 회의 본문이 길면 시드 1회에 한해 잡 실행 시간이 늘어날 수 있음(폴백은 있지만 지연 자체는 발생). 기존엔 이 LLM 호출이 없었으므로 새로 생긴 지연 요소.
- 프론트/마크다운 내보내기(markdown_exporter.rb)·챗 컨텍스트(meeting_chat_context.rb)·D'Flow 업로드는 브리프 지시대로 손대지 않았음 — 재조립된 전체 문서(`## 이전 회의 요약` 섹션 포함)를 그대로 소비한다. brief_summary(목록 미리보기)는 이번에 body 전용으로 고쳤지만, 이 세 경로는 "이전 회의 요약" 섹션이 함께 노출되는 것이 의도인지 별도 확인이 필요할 수 있음(개인 판단으로는 참고 맥락 포함이 자연스러워 손대지 않음).
- HEADER 가드는 "절취선 앞에 HEADER 문자열이 있는가"만 검사한다 — 극히 이론적으로 사용자가 본문 어딘가에 우연히 "## 이전 회의 요약" 문자열을 직접 타이핑하고 그 뒤에(같은 문서 내 어디든) 절취선이 있으면 가드가 통과해버릴 수 있다(실사용에서 발생 가능성은 낮다고 판단 — 이 헤더 문구를 사용자가 자연스럽게 쓸 일이 없음).

