# STT 용어 자동 학습 (stt-term-autolearn) — 설계

- 작성: 2026-11-23
- 시안: `tasks/stt-term-autolearn/sources/stt-term-autolearn-draft.html` (v4, 탭 ①~⑦)
- 표기: **[사용자 결정]** = 사용자가 정함 · **[제안]** = Orchestrator 판단(사용자 이의 없음, 뒤집을 수 있음) · **[빌더 몫]** = 구현자가 정해도 되는 것

## 1. 의도

회의록은 AI가 만들고 사람이 고친다. 사람이 고친 것 중 상당수는 **STT가 잘못 알아들은 용어**(예: "후반" → "후판", "엠이에스" → "MES")다. 지금은 AI 원본이 덮어써져 사라지므로 이 교정 지식이 버려진다.

목표: **AI 원본과 사람 최종본의 차이에서 오인식 쌍(틀린 표기 → 바른 용어)을 자동으로 뽑아 도메인 파일에 등록**해, 다음 요약 때 `DomainReferenceBuilder`의 교정 블록("변형→용어")이 그대로 써먹게 한다. 관리자는 등록 위치(레벨)를 트리에서 보며 상위·하위로 옮긴다.

## 2. 목표 / 비목표 / 반목표

목표
- AI 원본과 사람 최종본을 둘 다 보관한다(신규 회의부터).
- 추출 → 등록 **완전 자동** [사용자 결정]. 관리자 승인 단계 없음.
- 등록 레벨 = 회의의 가장 가까운 폴더, 없으면 프로젝트 (B안) [사용자 결정].
- 상위 레벨에 같은 용어가 있으면 새 줄을 만들지 않고 그 줄에 오인식만 병합 → 도메인 중복 방지 [사용자 결정].
- 관리자는 폴더 단위·용어 단위로 상위/하위 이동, 전체 용어 화면에서 레벨 일괄 변경 [사용자 결정].
- 오인식 기록(등록 여부와 무관)을 보관해 추출·등록 정확도를 높인다 [사용자 결정].

비목표
- 오인식 기록으로 회의 검색 확장 — **안 함** [사용자 결정].
- 기존(이 기능 이전) 회의 소급 — AI 원본이 없으므로 대상 아님 [제안].
- 전사(transcript) 텍스트 자체 교정 — 기존 오타 사전(glossary_entries) 몫.

반목표 (이렇게 되면 실패)
- 사람이 문장을 다듬은 것(표현 수정·요약 보강)을 오인식으로 등록해 도메인 파일이 쓰레기로 차는 것.
- 사람이 쓴 도메인 파일을 자동 기능이 마구 고쳐 원작성자가 알아볼 수 없게 되는 것.
- 자동 파일이 커져 8000자 캡을 잡아먹고 사람이 만든 용어집이 프롬프트에서 잘려나가는 것.
- 사람 수정 직후 AI 재요약이 원본을 덮어써 학습 기회가 사라지는 것.

## 3. 현재 상태 (코드 근거, 2026-11-23)

- `summaries.notes_markdown` 하나를 AI와 사람이 번갈아 덮어쓴다.
  - AI: `meeting_summarization_job.rb:263`(realtime), `:473`(final), `file_transcription_job.rb:219`(final)
  - 사람: `meetings_controller.rb` `update_notes` → `meeting.last_user_edit_at` 갱신
  - 교정: `meeting_glossary_applier.rb:37`(feedback·오타사전 적용이 summary 갱신)
- 활성 요약 = `Meeting#active_summary`(완료 회의는 최초 final, 아니면 최신).
- 도메인 파일: `domain_files`(project_id nil = 전역 파일), `domain_file_links`(owner = Project/Folder/Meeting, Meeting만 exclude).
  - 용어 줄 규약 `- **용어** [분류] (오인식: 변형1, 변형2): 설명`, `DomainFile#merge_terms!`(normalize_key로 줄 교체, 오인식은 합집합).
- 실효 세트 `Meeting#effective_domain_files`: meeting > 가까운 folder > 먼 folder > project. **전역 레벨은 링크된 경우에만 적용**(자동 적용되는 "전역" 개념 없음).
- `DomainReferenceBuilder`: 파일 블록 + 교정 블록, 8000자 캡, 구체 레벨 우선 생존.
- 기존 `feedback` 엔드포인트: 사람이 준 정확한 from→to 쌍 → 회의 오타사전 upsert.
- `DomainTermExtractionService` + `LlmService#extract_domain_terms`: 요약에서 용어 추출(LLM = `meeting.creator.effective_llm_config`).

## 4. 접근 방법

**방법 1 — 레벨별 전용 자동 도메인 파일 (선택) [제안]**
레벨(폴더/프로젝트/전역)마다 "STT 오인식(자동)" 도메인 파일을 자동 생성·링크하고, 기존 용어 줄 표기와 `merge_terms!`를 재사용한다.
- 장점: `DomainReferenceBuilder`·회의 도메인 패널·기존 편집 UI가 손대지 않고 그대로 읽는다. 사람도 일반 도메인 파일처럼 열어 고칠 수 있다.
- 단점: 마크다운이 원천이라 "이 줄은 언제 어느 회의에서 왔나" 같은 메타데이터는 별도 테이블에 둬야 하고, 사람이 파일을 손으로 고치면 메타와 어긋날 수 있다(되돌리기는 best-effort).

**방법 2 — 별도 용어 테이블 + 프롬프트 직접 주입**
`stt_terms` 테이블에 용어·레벨을 두고 `DomainReferenceBuilder`에 새 소스로 끼운다.
- 장점: 이동·중복·되돌리기가 정확하다.
- 단점: 도메인 파일과 용어 체계가 둘로 갈라진다. 사람 작성 용어와의 중복 검사·병합 규칙(사용자 결정)이 결국 마크다운을 파싱해야 하므로 이점이 반감된다. UI 표면 전부 새로 만들어야 한다.

**방법 3 — 사람 작성 파일에 직접 기록**
레벨에 링크된 기존 파일 중 하나에 그냥 append.
- 탈락: 반목표 "사람 파일을 마구 고침"에 정면으로 걸리고, 어느 파일에 쓸지 규칙이 없다.

→ 방법 1. 메타데이터(출처·판정·되돌리기)는 처리 내역 테이블이 맡는다.

## 5. 설계

### 5.1 AI 원본 보관 [제안 — builder check 반영 개정]
- 대상 = **완료된 회의의 final 요약 행만**. 녹음 중(realtime 행) 편집은 학습 대상 아님 — 실시간 틱이 사람 수정본을 기반으로 다시 쓰므로(`summary_restructure`) 기준선이 성립하지 않는다 [제안].
- `summaries` 컬럼 추가: `ai_notes_markdown :text`, `ai_generated_at :datetime`, `human_edited_at :datetime`.
  - `human_edited_at` = **회의록 본문 사람 편집 시각 전용**. `meetings.last_user_edit_at`은 전사 수정·화자 변경·사전 적용에도 갱신되고 초기화 시 nil이 되므로 트리거·판정에 쓰지 않는다(builder check 정정 3).
  - `update_notes`·`feedback`이 `human_edited_at`을 갱신한다.
- AI가 final 행에 쓰는 경로(`meeting_summarization_job.rb:473`, `file_transcription_job.rb:219`)는 `notes_markdown`과 **같은 값**을 `ai_notes_markdown`에도 쓰고 `ai_generated_at`을 찍는다. 공용 헬퍼로 묶는다 [빌더 몫: 이름]. 사람 편집·feedback·오타사전 적용·절단은 `ai_notes_markdown`을 건드리지 않는다.
- 그 외 요약 행 생성 경로(이전 회의 시드 `summary_management.rb:81`, 사람이 처음 쓸 때 생성 `find_or_create_active_summary`, 프로젝트 가져오기 `project_importer.rb:398`, 회의 복원 `meeting_restorer.rb:147`)는 `ai_notes_markdown` nil → 학습 대상 아님. 가져오기·복원 시 값 복사 여부 [빌더 몫].
- **덮어쓰기·삭제 직전 스냅샷**: 다음 지점에서, 활성 final 행이 `ai_notes_markdown.present? && notes_markdown != ai_notes_markdown`이면 학습 실행을 **먼저 생성**(텍스트 스냅샷 저장 후 enqueue)한다.
  - 행을 지우는 곳: `regenerate_notes`(`meetings_controller.rb:518`), `reset_content`, `regenerate_stt` — 잡보다 먼저 `summaries.destroy_all`이 돌기 때문에 잡 안에서 하면 늦다(builder check 정정 1).
  - AI 잡이 기존 final 행을 덮어쓰는 곳(473·219, `update!` 직전).
  - **절단(redaction)은 제외** — 기밀 구간이 학습 데이터로 남으면 안 된다.
- 스냅샷에는 `ai_text`, `human_text`와 함께 **그 시점 전사 텍스트**(`transcript_text`)를 저장한다 — 초기화·STT 재생성이 전사를 새로 만들어도 필터 3이 옛 전사로 판정되게.
- 원본은 회의 화면 요약 ⋯ 메뉴 "AI 원본과 비교"로 본다(읽기 전용 diff) [제안]. 권한 = 회의 편집 가능자(소유자·협업자·admin) [제안].

### 5.2 트리거 [제안]
- final 행 `human_edited_at` 후 **30분 무편집**이면 실행. 재편집 시 타이머 재시작.
  - 구현: `update_notes`/`feedback`이 `SttTermLearningJob.set(wait: 30.minutes).perform_later(summary_id, edited_at)`를 걸고, 잡은 실행 시 `summary.human_edited_at == edited_at`일 때만 진행 → 디바운스. 전사 수정 등은 `human_edited_at`을 안 바꾸므로 영향 없음.
- 덮어쓰기·삭제 직전 스냅샷(5.1).
- 관리자 수동 "지금 다시 분석"(③ 처리 내역 화면).
- 같은 `input_digest`(ai_text+human_text)로 끝난 실행이 있으면 스킵.
- 설정 "STT 용어 학습 사용" off면 아무것도 안 함(기본 on).

### 5.3 후보 추출 [제안]
후보 = **(가) LLM diff 추출 + (나) feedback 쌍**.
- (가) ai_text vs human_text의 줄 단위 diff에서 바뀐 hunk만 LLM에 준다. 출력 JSON 배열 `{wrong, correct, category, definition, confidence}`. 프롬프트 요점: "STT가 소리를 잘못 받아 적은 용어 교정만. 표현 다듬기·내용 추가·삭제·서식 변경은 제외."
  - LLM = 기존 규칙대로 `meeting.creator&.effective_llm_config`(요약·용어 추출과 같은 LLM, 비용·데이터 경로 동일). 'LLM 선택 안함' 등으로 설정이 없으면 (가)는 건너뛰고 run에 사유 기록, (나)만 처리 [제안]. 시안 ④의 "서버 기본 LLM" 문구는 이 규칙으로 고친다.
  - `LlmService`에 메서드 추가(기존 `extract_domain_terms` 패턴) [빌더 몫: 이름·프롬프트 문구].
  - 오인식 기록(5.6)의 확정 쌍·제외 쌍을 프롬프트 힌트로 같이 준다(정확도 향상 용도).
  - 줄 diff: `diff-lcs`는 지금 rspec 전이 의존성뿐 → Gemfile 기본 그룹에 명시 추가하거나 직접 LCS 구현 [빌더 몫].
- (나) 이 회의의 feedback from→to 쌍(회의 오타사전 엔트리 중 이 회의 것). 사람이 직접 준 쌍이라 LLM 판정을 건너뛴다.
- 둘이 겹치면 하나로 합친다(normalize_key 기준).

### 5.4 필터 (오등록 방지) [제안]
후보마다 순서대로 판정, 처음 걸린 사유로 기록:
1. 오인식 기록에서 **제외**된 쌍 → `skipped_excluded`
2. wrong == correct(정규화 후), 길이 1자 이하, 30자 초과, 숫자·기호만 → `skipped_invalid`
3. **(가) LLM 후보만**: wrong 표기가 스냅샷 전사 텍스트에 실제로 있는가(공백 무시 부분일치) — 없으면 `skipped_not_in_transcript`. 사람 문장 다듬기 오인 방지의 핵심 방어선. **(나) feedback 쌍은 면제** — feedback은 전사 본문까지 고치므로(`MeetingGlossaryApplier`) 항상 걸려 버린다(builder check 질문 1).
4. 같은 wrong이 이미 **다른** 바른 용어로 실효 세트에 등록됨 → `skipped_conflict` (오인식 기록 '미정')
5. LLM confidence < 기준값 → `skipped_low_confidence`, 오인식 기록 '미정' [빌더 몫: 기본 0.6 정도]
통과 → 등록(5.5).

### 5.5 등록 위치와 중복 방지 [사용자 결정 + 제안]
레벨 체인(가까운 순): 회의 폴더 → 상위 폴더들 → 프로젝트 → 전역.
1. 체인 전체(각 레벨에 **링크된 모든 파일**, 사람 작성·자동 모두)에서 correct 용어(normalize_key)를 찾는다.
2. 찾으면 **가장 가까운 레벨의 그 줄**에 wrong을 오인식으로 병합(새 줄 없음) → `merged_existing`. 그 줄이 사람 작성 파일이면 그 파일에 병합 [사용자 결정]. 이미 오인식에 있으면 `already_known`(횟수만 증가).
3. 못 찾으면 **회의의 가장 가까운 폴더(없으면 프로젝트)의 자동 파일**에 새 줄 → `registered` [사용자 결정 B안].
4. 하위 폴더(형제·자손)에 같은 용어가 있어도 자동으로 건드리지 않는다 → 트리에 "상위로 올릴 후보" 표시 [제안].
- 같은 회의 실행 안에서 한 파일은 한 번만 저장(merge_terms! 일괄 호출).
- 새 줄 설명(definition)은 LLM이 준 짧은 설명(≤60자), 없으면 빈 문자열. 분류는 LLM 값 또는 "STT".

**자동 파일**: `domain_files`에 `auto_kind :string`(nil=일반, "stt_auto") + `auto_owner_type`/`auto_owner_id` 추가. 레벨당 1개(유니크). 이름은 `STT 오인식(자동)` + 레벨 표시(예: `STT 오인식(자동) · 생산/후판`) — (project_id, name) 유니크 때문 [빌더 몫: 이름 규칙, 100자 제한]. 필요할 때 생성하고 그 레벨 owner에 링크한다. creator = 시스템/관리자 [빌더 몫: 시스템 사용자 처리].

**전역 레벨** [사용자 결정 2026-11-23: 모든 회의에 자동 적용]: 지금은 전역 파일도 링크해야만 적용된다. 전역 자동 파일(`project_id nil`, auto_owner 없음)은 **모든 회의의 실효 세트 맨 끝(project 뒤)** 에 붙도록 `effective_domain_files`를 한 군데 확장한다. 관리자가 전역으로 올린 용어만 여기에 들어간다.

**캡 보호** [제안]: 자동 파일 줄은 짧게(설명 ≤60자). `DomainReferenceBuilder`는 자동 파일을 **파일 블록에서 빼고 교정 블록에만** 쓴다(같은 내용 이중 주입 방지). 지금 교정 블록은 파일 블록이 쓰고 **남은** 글자수만 받아, 사람 파일이 8000자를 채우면 학습 효과가 0이 된다(builder check 정정 7) → 교정 블록에 **최대 1500자를 먼저 예약**하고(실제 쓴 만큼만 차감) 나머지를 파일 블록이 쓴다. 기존 회의의 사람 파일 오인식 쌍도 같은 혜택을 받는다(동작 변화 — 기존 spec 기대값 갱신 필요). 회의 도메인 패널에는 자동 파일이 그대로 보인다.

### 5.6 오인식 기록 [사용자 결정 + 제안]
테이블 `stt_misrecognitions`: `project_id`, `wrong`, `correct`, `wrong_key`, `correct_key`, `status`(confirmed/undecided/excluded), `hit_count`, `first_meeting_id`, `last_meeting_id`, `last_seen_at`. 유니크 (project_id, wrong_key, correct_key).
- 등록·병합되면 confirmed, 필터 4·5에 걸리면 undecided, 관리자가 제외하면 excluded.
- 쓰임: 필터 1(제외), LLM 힌트(5.3), 관리자 화면 ⑤. **검색에는 안 씀** [사용자 결정].
- 회의 목록은 처리 내역(5.8)에서 역조회 [빌더 몫].

### 5.7 이동 (레벨 변경) [사용자 결정 + 제안]
- 단위: 용어 한 줄 / 여러 줄 일괄 / 폴더(레벨)의 자동 파일 전체.
- 이동 = 원래 파일에서 그 줄 제거 → 대상 레벨 자동 파일에 `merge_terms!`(대상에 같은 용어가 있으면 오인식 합집합).
- **사람 작성 파일의 줄을 옮길 때**: 그 한 줄만 원 파일에서 빼고 대상 레벨 자동 파일로 보낸다 (a안) [사용자 무응답 → 기본값으로 진행].
- 이동 창 ②: 트리 선택, 영향(적용 회의 수 전→후), "하위 레벨 같은 용어도 합치기" 체크, "복사(원본 유지)" 체크 [시안 그대로].
- 전체 용어 화면 ⑦: 모든 레벨 용어 한 표, 레벨 칸 클릭 → 트리 선택, **변경 예정**으로 쌓았다가 일괄 적용(적용 회의 수 변화 미리보기), 중복 행 강조 + "공통 상위로 합치기".
- 적용 회의 수 = 그 레벨(폴더 서브트리/프로젝트/전역)에 속한 회의 중 해당 파일을 exclude하지 않은 회의 수 [빌더 몫: 쿼리].
- 일괄 적용은 트랜잭션 하나. 중간 실패 시 전부 롤백.
- 이동도 처리 내역에 남겨 되돌릴 수 있게 한다(관리자 작업 로그) [제안, 빌더가 범위 줄여도 됨: 최소 감사 로그].

### 5.8 처리 내역과 되돌리기 [제안]
- `stt_term_learning_runs`: `meeting_id`, `summary_id`, `trigger`(idle/pre_overwrite/manual), `transcript_text`, `status`(queued/running/done/failed/reverted), `ai_text`, `human_text`, `input_digest`, `llm_model`, `error`, `started_at`, `finished_at`.
- `stt_term_learning_items`: `run_id`, `wrong`, `correct`, `source`(llm_diff/feedback), `verdict`(5.4·5.5 값들), `reason`, `domain_file_id`, `level_owner_type/id`, `change`(JSON: 어떤 파일에 줄 추가인지·오인식 추가인지, 되돌리기용).
- **회의 단위 되돌리기**: 그 실행의 항목들을 역순으로 — 추가한 줄 삭제, 병합한 오인식 제거(그 사이 사람이 바꿨으면 해당 항목만 건너뛰고 표시). run.status = reverted, 오인식 기록은 hit_count 차감(0이면 undecided).

### 5.8a 기밀 구간 절단 시 [사용자 결정 2026-11-23]
- 절단(`TranscriptRedactionService`)이 실행되면 그 회의의 `stt_term_learning_runs`·`items`(AI 원본·최종본·전사 스냅샷·판정)를 **삭제**하고, 남은 요약 행의 `ai_notes_markdown`도 비운다.
- 이미 도메인 파일에 등록된 용어 줄과 오인식 기록은 **유지**(단어일 뿐). 오인식 기록의 `first/last_meeting_id`가 그 회의면 nil로.
- 절단은 스냅샷 생성 지점에서도 제외(5.1).

### 5.9 화면 [사용자 결정 + 제안]
- 설정 > **"STT 용어 학습"** 탭, `role admin`만 [제안]. 하위 탭은 시안 ①~⑦ 그대로:
  ① 레벨 트리 + 용어 표(행별 ⬆ / ⬇▾ / ⋯, 일괄 선택) ② 이동 창 ③ 회의별 처리 내역(diff + 판정 + 되돌리기) ④ 설정(사용 on/off, 대기 시간 30분, confidence 기준, 중복 방지·오인식 기록 설명) ⑤ 오인식 기록(등록 위치 열, ⬆/⬇, 확정/미정/제외 전환) ⑥ 등록 흐름 설명 ⑦ 전체 용어
- 회의 화면: 요약 ⋯ 메뉴에 **"AI 원본과 비교"** 하나만 추가(읽기 전용 diff 모달) [제안]. 권한 = 회의 열람 권한자.
- API: `Api::V1::Admin::SttTermLearning*` 네임스페이스, admin 가드 [빌더 몫: 라우트 모양]. 모델은 `::User`로 참조(네임스페이스 함정).

### 5.10 설정값 저장 [제안]
사용 on/off·대기 분·confidence 기준은 서버 전역 설정. 기존 설정 저장소 패턴을 따른다 [빌더 몫: 어디에]. **테스트에서 실 `settings.yaml`을 건드리지 않게** 격리(기존 LLM 잡 spec 미격리 함정 있음).

## 6. 제약
- Rails + SQLite. 마이그는 dev 서버 가동 중 `db/migrate`에 두지 않는다(PendingMigrationError). 테이블 재생성형 마이그 금지(FK CASCADE 함정) — 컬럼 추가·새 테이블만.
- LIKE 검색 시 `ESCAPE '\'` 필수.
- 프론트 타입체크 = `npx tsc -p tsconfig.app.json` 0 + `vite build`.
- Tauri에서 확인창은 `confirmDialog` 헬퍼(window.confirm 금지).
- 러닝 dev 서버 실요청·실 settings.yaml 변경 금지. 커밋은 요청 시만, 푸시 안 함.

## 7. 테스트 기준
- 모델: ai_notes 보관(3경로), 사람 편집 시 ai_notes 불변, 재요약 직전 선실행.
- 서비스: 필터 5종, 중복 방지(가까운 상위 병합·사람 파일 병합·새 줄), 하위 비간섭, 자동 파일 생성·링크, 전역 실효 세트, 캡에서 자동 파일 블록 제외.
- 잡: 30분 디바운스(새 편집이면 스킵), digest 중복 스킵, 설정 off.
- 이동·일괄 적용·되돌리기(사람이 그 사이 고친 경우 포함).
- 컨트롤러: admin 가드(비관리자 403), AI 원본 비교 열람 권한.
- 프론트: 탭 렌더·이동 창·전체 용어 변경 예정/적용·처리 내역 되돌리기 (vitest, API stub).

## 8. 빌더에게 남긴 것
- 메서드·라우트·컴포넌트 이름, LLM 프롬프트 문구, 자동 파일 이름 규칙, confidence 기본값, 설정 저장 위치, 적용 회의 수 쿼리, diff 라이브러리(백엔드 줄 diff는 `diff-lcs` 계열 기존 의존성 있으면 재사용, 프론트는 기존 diff 표시 유틸 확인 후 재사용).
- 시스템 사용자(자동 파일 creator) 처리.
- 이동 감사 로그 범위.
