# STT 용어 자동 학습 (stt-term-autolearn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완료된 회의의 AI 원본 요약과 사람 최종본의 차이에서 STT 오인식 쌍(틀린 표기 → 바른 용어)을 자동 추출해 레벨별 "STT 오인식(자동)" 도메인 파일에 등록하고, 관리자가 설정 탭에서 레벨 이동·되돌리기·오인식 기록을 관리하게 한다.

**Architecture:** `summaries`에 AI 원본(`ai_notes_markdown`)과 사람 편집 시각(`human_edited_at`)을 둔다. 사람 편집 30분 뒤(디바운스) 또는 AI가 덮어쓰거나 지우기 직전(스냅샷)에 `stt_term_learning_runs`를 만든다. `SttTermLearningJob`이 줄 diff → LLM 후보 + feedback 쌍 → 필터 5종 → 조상 체인 중복 방지 등록 순서로 처리하고, 판정은 `stt_term_learning_items`에, 오인식은 `stt_misrecognitions`에 남긴다. 등록은 기존 용어 줄 규약(`DomainFile`)을 그대로 쓴다. `DomainReferenceBuilder`는 자동 파일을 교정 블록에만 넣고, 교정 블록에 1500자를 먼저 예약한다. 관리자 API는 `Api::V1::Admin::SttTerm*` 컨트롤러로 두고, 프론트는 설정의 "STT 용어 학습" 탭(①~⑦)과 요약 패널 ⋯ "AI 원본과 비교" 모달로 만든다.

**Tech Stack:** Rails 8.1 + SQLite(ActiveJob: prod solid_queue · dev async), RSpec + FactoryBot, `diff-lcs` gem(Gemfile 기본 그룹으로 명시 승격), React + TypeScript + ky + vitest + Testing Library, Tauri.

**Spec:** `docs/superpowers/specs/2026-11-23-stt-term-autolearn-design.md` (시안: 메인 체크아웃 `tasks/stt-term-autolearn/sources/stt-term-autolearn-draft.html`, 탭 ①~⑦)

## Global Constraints

- 작업 위치: worktree `/Users/jji/project/ddobakddobak-stt-autolearn` (브랜치 `feature/stt-term-autolearn`). 메인 체크아웃(`/Users/jji/project/ddobakddobak`)과 그곳 dev 서버·DB는 건드리지 않는다.
- 러닝 dev 서버에 실요청하지 않고 실 `settings.yaml`을 읽거나 쓰지 않는다. 신규 spec 전부: ① `spec/support/stt_term_learning_settings.rb`의 전역 stub(Task 1)이 `AppSettings.stt_term_learning`을 기본값으로 고정한다. ② 잡 spec은 `allow(AppSettings).to receive(:refresh_env_if_changed!)`를 추가한다(`ApplicationJob` before_perform이 settings.yaml을 stat/load 하기 때문). ③ 설정 저장 spec은 `stub_const("AppSettings::SETTINGS_PATH", tmp_path)` 패턴(`spec/requests/api/v1/settings_whiteboard_spec.rb:11-16`)을 쓴다.
- 마이그레이션은 **컬럼 추가·새 테이블만** 한다. 테이블 재생성형(rename/change_column/NOT NULL 추가로 SQLite가 테이블을 다시 만드는 것)은 금지한다(FK CASCADE 자식 전멸 함정). 마이그레이션은 **Task 1 한 곳**에서만 추가하고 `db/schema.rb`도 그 태스크에서만 재생성한다. 병렬 태스크가 schema.rb를 동시에 고치지 않게 하기 위해서다.
- SQLite LIKE는 반드시 `LIKE ? ESCAPE '\\'` + `sanitize_sql_like`.
- `Api::V1::*` 안에서 모델은 `::User`처럼 최상위 상수로 참조한다. 서비스 네임스페이스 `SttTermLearning`도 컨트롤러 안에서는 `::SttTermLearning::...`로 쓴다(`Api::V1::Admin::SttTermLearning...` 상수와 충돌 방지). 그래서 컨트롤러 이름은 `SttTermLearningController`·`SttTermRunsController`·`SttMisrecognitionsController`로 하고, `Admin::SttTermLearning` 모듈은 만들지 않는다.
- 새 autoload 디렉터리(`app/services/stt_term_learning/`)가 생기므로 dev 서버는 재시작해야 반영된다(이 worktree에서는 서버를 띄우지 않는다).
- admin 가드는 `ApplicationController#require_admin!`이다(로컬 모드는 통과, 서버 모드는 admin만). 프론트 `showAdminSettings = isAdmin || isLocalMode`와 일치한다. 403 spec은 `include_context "server mode"`로 작성한다.
- 관리자 화면 조회 범위에서 **남의 personal 프로젝트**(`Project#blocks_admin_override?(user)`)는 뺀다(ext API·`meeting_admin?` 선례). 학습 자체는 모든 회의에서 돈다.
- 학습 잡은 `limits_concurrency to: 1, key: ->(*) { "stt_term_learning" }`로 전역 직렬화한다. 도메인 파일 쓰기는 트랜잭션 안에서 `reload` 후 한다(관리자 이동과의 lost update 축소).
- 사람 작성 파일의 줄에 오인식을 더할 때는 **그 줄의 용어 표기·분류·설명을 보존**한다. `merge_terms!`를 쓰지 않고 Task 3의 `DomainFile#apply_learning!`를 쓴다.
- 스냅샷·학습 실패는 원래 동작(재요약·초기화·STT 재생성·AI 저장)을 막지 않는다. 호출부에서 `rescue => e` 후 로그만 남긴다.
- 절단(`TranscriptRedactionService`)은 스냅샷 지점에서 제외한다. Summary 모델 콜백(`before_update`/`before_destroy`)으로 스냅샷을 걸지 않는다. 명시적 호출 지점만 쓴다.
- 고정 값: 디바운스 기본 `30`분(설정 범위 5..1440), confidence 기본 `0.6`(0.0..1.0), 교정 블록 선예약 `1500`자, 전체 캡 `8000`자, 새 줄 설명 `≤60`자, 기본 분류 `"STT"`, 자동 파일 `auto_kind = "stt_auto"`, 이름 접두 `"STT 오인식(자동)"`, 이름 ≤100자, 필터 2 길이(1자 이하·30자 초과 제외).
- 프론트 검증: `npx tsc -p tsconfig.app.json --noEmit` 0 errors + `npx vite build` 성공 + 해당 vitest green. bare `tsc`는 거짓 green이므로 쓰지 않는다.
- Tauri 확인창은 `src/lib/confirmDialog.ts`의 `confirmDialog()`만 쓴다. `window.confirm` 직접 호출은 금지.
- 커밋: 스텝의 "Commit"은 `git add <이 태스크가 새로 만든 파일 경로들> && git commit -m "<msg>" -- <이 태스크가 만든/고친 전체 경로>` 형태로 한다(pathspec 커밋). `git add -A`·`git add .`·push는 금지. 메시지 끝에 세션 attribution 줄을 붙인다.

## Review Focus

1. **사람 작성 줄에 병합할 때 원 표기 보존**: `- **MES** [시스템명] (발음: 엠에스): 제조실행시스템` 줄에 "엠이에스"를 병합하면 용어·분류·설명은 그대로 두고 오인식만 늘어나야 한다(LLM 값으로 덮어쓰기 금지). → Task 3·6 테스트.
2. **디바운스 시각 정밀도**: 잡 인자로 넘긴 `edited_at`과 DB에서 읽은 `human_edited_at`이 직렬화·정밀도 차이로 영원히 불일치해 학습이 조용히 안 도는 경우. 둘 다 `iso8601(6)` 문자열로 비교하고, `perform_enqueued_jobs` 왕복으로 검증한다. → Task 7 테스트.
3. **feedback이 전사까지 고친 쌍**: feedback으로 "우판→후판"을 넣으면 전사·요약이 모두 바뀌므로, 같은 쌍을 LLM이 diff에서 다시 내도 전사 필터(3)에 걸리면 안 된다. 합칠 때 source는 `feedback`으로 남겨 면제를 유지한다. → Task 5 테스트.
4. **인용 마커·표 줄 잡음**: 회의록 줄에는 `⟦t:1234/s:...⟧` 마커가 붙어 있다. 마커만 다른 줄이 diff hunk로 잡혀 LLM 비용을 쓰거나 오후보가 되면 안 된다. diff 전에 `LlmPrompts::CitationMarkers.strip_all`로 지운다. → Task 5 테스트.
5. **자동 파일만 있는 회의·레벨 없는 회의**: 실효 세트가 자동 파일뿐이면 `DomainReferenceBuilder.build`가 nil이 아니라 교정 블록만 반환해야 한다. 폴더·프로젝트가 모두 없는 회의는 새 줄 등록을 `skipped_no_level`로 건너뛰어야 한다(크래시 금지). → Task 4·6 테스트.

---

## 의존 관계 / 병렬 스트림

- **T0 → T1**은 직렬이다. 그 뒤 백엔드와 프론트 두 스트림으로 나눈다(프론트는 Task 12의 JSON 계약만 보고 stub으로 진행).
- 백엔드:
  - T1 뒤 {T2, T3, T5} 병렬(파일 겹침 없음).
  - T4는 T2·T3 뒤(`meetings_controller.rb`를 T2와 공유).
  - T6은 T3·T5 뒤, T9는 T3 뒤. {T4, T6, T9} 병렬.
  - T7은 T6 뒤, T10은 T6 뒤, T11은 T9 뒤.
  - T8은 T4·T7 뒤(`meetings_controller.rb`, 두 잡 파일, 절단 서비스).
  - T12는 T8·T10·T11 뒤.
- 같은 파일을 건드리는 태스크는 직렬로 둔다: `meetings_controller.rb`(T2→T4→T8→T12), `config/routes.rb`(T12만), 두 잡 파일(T2→T8), `SettingsContent.tsx`(T14만), `AiSummaryPanel.tsx`(T17만).
- 프론트:
  - T13 → T14.
  - T14가 ③④⑤⑥⑦ placeholder 파일을 만들어 두므로 {T15, T16}은 서로의 파일을 건드리지 않고 병렬로 간다.
  - T17은 T13 뒤면 언제든 된다.
- T18(전체 검증)이 마지막이다.

---

### Task 0: Worktree 준비와 기준선 기록

**Files:** (코드 변경 없음)

- [ ] **Step 1: 백엔드 준비**

Run:
```bash
cd /Users/jji/project/ddobakddobak-stt-autolearn/backend && bundle check && mkdir -p storage \
  && bin/rails db:schema:load && RAILS_ENV=test bin/rails db:schema:load
```
Expected: `The Gemfile's dependencies are satisfied`, 에러 없이 종료. (worktree 전용 `storage/*.sqlite3`가 생성된다. 처음부터 마이그레이션하지 않는다.)

- [ ] **Step 2: 프론트 준비**

Run: `cd /Users/jji/project/ddobakddobak-stt-autolearn/frontend && npm ci`
Expected: `added N packages`, exit 0.

- [ ] **Step 3: 기준선 측정**

Run:
```bash
cd /Users/jji/project/ddobakddobak-stt-autolearn/backend && bundle exec rspec 2>&1 | tail -3
cd /Users/jji/project/ddobakddobak-stt-autolearn/frontend && npx tsc -p tsconfig.app.json --noEmit | tail -3; npx vitest run 2>&1 | tail -4; npx vite build 2>&1 | tail -2
```
Expected: rspec `N examples, 0 failures`(실패가 있으면 목록을 기록해 사전 존재 실패로 분류), tsc 출력 없음(0 errors), vitest `Tests N passed`, vite `built in`. 숫자는 `tasks/stt-term-autolearn/` 쪽 log가 아니라 이 태스크 보고에 남긴다(T18 비교용).

---

### Task 1: 스키마·모델 골격·설정 읽기

**Files:**
- Modify: `backend/Gemfile` (기본 그룹에 `gem "diff-lcs", "~> 1.6"`), `backend/Gemfile.lock`
- Create: `backend/db/migrate/20261123000001_add_ai_original_to_summaries.rb`
- Create: `backend/db/migrate/20261123000002_add_auto_owner_to_domain_files.rb`
- Create: `backend/db/migrate/20261123000003_create_stt_term_learning_runs.rb`
- Create: `backend/db/migrate/20261123000004_create_stt_term_learning_items.rb`
- Create: `backend/db/migrate/20261123000005_create_stt_misrecognitions.rb`
- Create: `backend/db/migrate/20261123000006_create_stt_term_move_logs.rb`
- Modify: `backend/db/schema.rb` (재생성)
- Create: `backend/app/models/stt_term_learning_run.rb`, `stt_term_learning_item.rb`, `stt_misrecognition.rb`, `stt_term_move_log.rb`
- Create: `backend/spec/factories/stt_term_learning.rb` (`:stt_term_learning_run`, `:stt_term_learning_item`, `:stt_misrecognition` 팩토리. 이후 병렬 태스크가 각자 만들지 않게 여기서 한 번에 만든다)
- Modify: `backend/app/models/meeting.rb` (`has_many :stt_term_learning_runs, dependent: :delete_all`)
- Modify: `backend/app/models/domain_file.rb` (`AUTO_KIND_STT = "stt_auto"`, `scope :stt_auto`, `#stt_auto?`, `#global_auto?`)
- Modify: `backend/app/services/app_settings.rb`
- Create: `backend/spec/support/stt_term_learning_settings.rb`
- Test: `backend/spec/models/stt_term_learning_models_spec.rb`, `backend/spec/services/app_settings_stt_term_learning_spec.rb`

**Interfaces:**
- Produces (스키마):
  - `summaries`: `ai_notes_markdown :text`, `ai_generated_at :datetime`, `human_edited_at :datetime` (모두 null 허용).
  - `domain_files`: `auto_kind :string`, `auto_owner_type :string`, `auto_owner_id :bigint`. 인덱스 두 개:
    - unique `[auto_kind, auto_owner_type, auto_owner_id]` where `"auto_kind IS NOT NULL"`, name `idx_domain_files_auto_owner`
    - unique `[auto_kind]` where `"auto_kind = 'stt_auto' AND auto_owner_type IS NULL"`, name `idx_domain_files_auto_global` (SQLite는 NULL을 서로 다른 값으로 보므로 전역 자동 파일 1개를 보장하려면 이 부분 인덱스가 필요하다)
  - `stt_term_learning_runs`:
    - `meeting_id` not null, FK `on_delete: :cascade`
    - `summary_id` null 허용, FK `on_delete: :nullify` (regenerate_notes가 스냅샷 직후 summaries를 지운다)
    - `trigger :string` not null, `status :string` not null default `"queued"`
    - `ai_text :text`, `human_text :text`, `transcript_text :text`, `input_digest :string`
    - `llm_model :string`, `llm_skipped_reason :string`, `error :text`
    - `started_at`, `finished_at`, timestamps
    - 인덱스: `[meeting_id, input_digest]`, `[status]`
  - `stt_term_learning_items`:
    - `run_id` not null, FK → runs `on_delete: :cascade`
    - `wrong`, `correct`, `wrong_key`, `correct_key` (string, not null)
    - `category :string`, `definition :string`, `confidence :float`
    - `source :string` not null (`llm_diff`/`feedback`), `verdict :string` not null, `reason :string`
    - `domain_file_id` null 허용, FK `on_delete: :nullify`
    - `level_owner_type :string`, `level_owner_id :bigint`
    - `change :text` (JSON)
    - `misrecognition_id` null 허용, FK `on_delete: :nullify`
    - `revert_result :string`, timestamps
    - 인덱스: `[domain_file_id, correct_key]`
  - `stt_misrecognitions`:
    - `project_id` not null, FK `on_delete: :cascade`
    - `wrong`, `correct`, `wrong_key`, `correct_key` not null
    - `status` not null default `"undecided"`, `hit_count :integer` default 0 not null
    - `first_meeting_id`·`last_meeting_id` null 허용, FK → meetings `on_delete: :nullify`
    - `last_seen_at`, timestamps
    - unique `[project_id, wrong_key, correct_key]`
  - `stt_term_move_logs`: `actor_id` (FK users, null 허용, `on_delete: :nullify`), `moves :text` (JSON), `result :text` (JSON), timestamps.
- Produces (모델):
  - `SttTermLearningRun`: `TRIGGERS = %w[idle pre_overwrite manual]`, `STATUSES = %w[queued running done failed reverted]`, `belongs_to :meeting`, `belongs_to :summary, optional: true`, `has_many :items, class_name: "SttTermLearningItem", foreign_key: :run_id, dependent: :delete_all`.
  - `SttTermLearningItem`:
    - `SOURCES = %w[llm_diff feedback]`
    - `VERDICTS = %w[registered merged_existing already_known skipped_excluded skipped_invalid skipped_not_in_transcript skipped_conflict skipped_low_confidence skipped_no_level]`
    - `APPLIED_VERDICTS = %w[registered merged_existing already_known]`
    - `belongs_to :run, class_name: "SttTermLearningRun"`, `belongs_to :domain_file, optional: true`, `belongs_to :misrecognition, class_name: "SttMisrecognition", optional: true`
    - `#change_data -> Hash` (JSON parse, nil이면 `{}`)
  - `SttMisrecognition`: `STATUSES = %w[confirmed undecided excluded]`, scopes `confirmed`/`undecided`/`excluded`, `belongs_to :project`, `belongs_to :first_meeting/:last_meeting, class_name: "Meeting", optional: true`.
  - `SttTermMoveLog`: `belongs_to :actor, class_name: "User", optional: true`.
  - `DomainFile#stt_auto?` → `auto_kind == "stt_auto"`. `#global_auto?` → `stt_auto? && auto_owner_type.nil? && project_id.nil?`. 프로젝트 삭제로 `project_id`가 nullify된 프로젝트 레벨 자동 파일은 `auto_owner_type == "Project"`가 남아 있으므로 전역으로 오인하지 않는다.
- Produces (설정):
  - `AppSettings::STT_TERM_LEARNING_DEFAULTS = { "enabled" => true, "idle_minutes" => 30, "min_confidence" => 0.6 }.freeze`
  - `AppSettings.stt_term_learning(cfg = nil) -> Hash` (문자열 키 3개, 클램프 적용)
  - `AppSettings.save_stt_term_learning!(attrs) -> Hash` (load → `cfg["stt_term_learning"]` 병합 → `save!`)

- [ ] **Step 1: 실패 테스트 작성**

`spec/services/app_settings_stt_term_learning_spec.rb`는 `stt_settings_io: true` 메타데이터와 tmp `SETTINGS_PATH` stub을 쓴다.
```ruby
it "키가 없으면 기본값" do
  expect(AppSettings.stt_term_learning({})).to eq("enabled" => true, "idle_minutes" => 30, "min_confidence" => 0.6)
end
it "범위를 벗어난 값은 클램프" do
  cfg = { "stt_term_learning" => { "enabled" => false, "idle_minutes" => 1, "min_confidence" => 3 } }
  expect(AppSettings.stt_term_learning(cfg)).to eq("enabled" => false, "idle_minutes" => 5, "min_confidence" => 1.0)
end
it "save_stt_term_learning! 은 다른 키를 보존하고 병합 저장" do
  File.write(tmp_path, { "whiteboard" => { "web_mode" => "copy" } }.to_yaml)
  AppSettings.save_stt_term_learning!("idle_minutes" => 45)
  expect(YAML.safe_load(File.read(tmp_path))).to include("whiteboard" => { "web_mode" => "copy" },
    "stt_term_learning" => hash_including("idle_minutes" => 45))
end
```
`spec/models/stt_term_learning_models_spec.rb`:
```ruby
it "run 삭제 시 items 가 함께 지워진다(FK cascade)"
it "summary 삭제 시 run.summary_id 가 nil 이 된다(FK nullify)" do
  summary.destroy; expect(run.reload.summary_id).to be_nil
end
it "전역 자동 파일은 두 개 만들 수 없다" do
  create(:domain_file, auto_kind: "stt_auto", name: "A")
  expect { create(:domain_file, auto_kind: "stt_auto", name: "B") }.to raise_error(ActiveRecord::RecordNotUnique)
end
it "global_auto? 는 auto_owner_type 이 남은 고아 파일을 전역으로 보지 않는다" do
  f = create(:domain_file, auto_kind: "stt_auto", auto_owner_type: "Project", auto_owner_id: 999, project_id: nil)
  expect(f.global_auto?).to be(false)
end
it "misrecognition (project, wrong_key, correct_key) 유니크"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/stt_term_learning_models_spec.rb spec/services/app_settings_stt_term_learning_spec.rb`
Expected: FAIL (`uninitialized constant SttTermLearningRun`, `undefined method stt_term_learning`)

- [ ] **Step 3: Gemfile·마이그레이션·모델·설정 구현**

Gemfile 기본 그룹(`gem "rubyzip"` 아래)에 `gem "diff-lcs", "~> 1.6"`를 넣고 `bundle install`(lock에 1.6.2가 이미 있어 DEPENDENCIES만 바뀐다)을 실행한다. 마이그레이션은 `add_column`/`add_index`/`create_table`/`add_reference`만 쓴다. FK는 `foreign_key: { on_delete: ... }`로 건다. 그다음 `bin/rails db:migrate && RAILS_ENV=test bin/rails db:schema:load`를 실행한다(worktree 로컬 DB). `spec/support/stt_term_learning_settings.rb`:
```ruby
RSpec.configure do |config|
  config.before do |example|
    next if example.metadata[:stt_settings_io]
    allow(AppSettings).to receive(:stt_term_learning).and_return(AppSettings::STT_TERM_LEARNING_DEFAULTS.dup)
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: 위 두 spec + `bundle exec rspec spec/models spec/services/app_settings_spec.rb`
Expected: PASS, 기존 model spec 회귀 없음. `git diff db/schema.rb`에 6개 마이그레이션 내용만 있다.

- [ ] **Step 5: Commit** — `feat(stt-learn): 학습 스키마·모델·설정 읽기`

---

### Task 2: AI 원본 보관과 사람 편집 시각

**Files:**
- Modify: `backend/app/models/summary.rb`
- Modify: `backend/app/jobs/meeting_summarization_job.rb:473-474` (final `summary.update!`)
- Modify: `backend/app/jobs/file_transcription_job.rb:218-219`
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (`update_notes` 672~, `feedback` 534~)
- Test: `backend/spec/models/summary_ai_original_spec.rb`, `backend/spec/jobs/meeting_summarization_job_ai_original_spec.rb`, `backend/spec/jobs/file_transcription_job_spec.rb`(케이스 추가), `backend/spec/requests/api/v1/meetings_human_edit_spec.rb`

**Interfaces:**
- Produces:
  - `Summary#write_ai_final!(notes_markdown) -> true`: `update!(notes_markdown:, ai_notes_markdown: notes_markdown, ai_generated_at: now, generated_at: now, human_edited_at: nil)`. `human_edited_at`을 nil로 돌리면 대기 중인 디바운스 잡이 불일치로 스킵된다.
  - `Summary#mark_human_edited!(at = Time.current) -> String`: `update_column(:human_edited_at, at)` 후 `reload.human_edited_at.iso8601(6)`을 반환한다(Task 8 스케줄 인자).
  - `Summary#learnable?` → `summary_type == "final" && ai_notes_markdown.present?`.
- 사람 편집·feedback·오타사전 적용(`MeetingGlossaryApplier`)·절단은 `ai_notes_markdown`을 쓰지 않는다(`SUMMARY_COLS`에 넣지 않는다).

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# summary_ai_original_spec
it "write_ai_final! 은 notes 와 ai_notes 를 같은 값으로, human_edited_at 은 nil 로" do
  s = create(:summary, summary_type: "final", human_edited_at: 1.hour.ago)
  s.write_ai_final!("# AI")
  expect(s.reload).to have_attributes(notes_markdown: "# AI", ai_notes_markdown: "# AI", human_edited_at: nil)
  expect(s.ai_generated_at).to be_present
end
# meeting_summarization_job_ai_original_spec (LLM stub: 기존 meeting_summarization_job_spec 의 final 경로 stub 패턴 재사용)
it "final 저장 시 ai_notes_markdown 도 기록"
it "realtime 저장은 ai_notes_markdown 을 쓰지 않는다"
# file_transcription_job_spec 추가
it "업로드 final 요약 저장 시 ai_notes_markdown 도 기록"
# meetings_human_edit_spec
it "update_notes 는 human_edited_at 을 찍고 ai_notes_markdown 은 그대로" do
  patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "사람 수정" }, as: :json
  expect(final.reload).to have_attributes(notes_markdown: "사람 수정", ai_notes_markdown: "AI 원본")
  expect(final.human_edited_at).to be_within(5.seconds).of(Time.current)
end
it "feedback 은 human_edited_at 을 찍고 ai_notes_markdown 은 그대로(교정은 notes 에만)"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec <위 파일들>` → FAIL (`undefined method write_ai_final!`)

- [ ] **Step 3: 구현**

두 잡의 `summary.update!(notes_markdown:, generated_at:)`를 `summary.write_ai_final!(notes_markdown)`로 바꾼다. `update_notes`는 `summary.update!` 직후 `summary.mark_human_edited!`를 호출한다(`find_or_create_active_summary`가 build한 신규 행도 저장된 뒤라 id가 있다). `feedback`은 `apply_glossary_entries!` 뒤 `@meeting.active_summary&.mark_human_edited!`를 호출한다. reapply_glossary·apply_glossary_entry는 바꾸지 않는다(스펙상 사람 편집 시각은 update_notes·feedback 전용).

- [ ] **Step 4: 통과 확인** — 위 spec + `bundle exec rspec spec/jobs/meeting_summarization_job_spec.rb spec/jobs/file_transcription_job_spec.rb spec/requests/api/v1/meetings_feedback_spec.rb spec/requests/api/v1/meetings_spec.rb` → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): final 요약 AI 원본 보관·사람 편집 시각`

---

### Task 3: 용어 줄 조작 헬퍼·레벨 체인·자동 도메인 파일

**Files:**
- Modify: `backend/app/models/domain_file.rb`
- Create: `backend/app/services/stt_term_learning/level.rb`, `level_chain.rb`, `auto_domain_file.rb`
- Test: `backend/spec/models/domain_file_learning_spec.rb`, `backend/spec/services/stt_term_learning/level_chain_spec.rb`, `backend/spec/services/stt_term_learning/auto_domain_file_spec.rb`

**Interfaces:**
- Produces (`DomainFile`):
  - `#find_term(key) -> Hash|nil`: `parse_terms` 항목(`:term, :category, :mispronunciations, :definition, :line_no`) 중 `normalize_key(term) == key`인 첫 항목.
  - `#apply_learning!(merges: {}, new_terms: []) -> Hash{String => String}`: 저장은 **한 번만** 한다.
    - `merges`(`{term_key => [variants]}`): 기존 줄의 term·category·definition은 그대로 두고 오인식만 `merge_mispronunciations`로 합집합한다.
    - `new_terms`(`[{term:, category:, definition:, mispronunciations:}]`): 끝에 붙인다. 같은 key가 이미 있으면 merges 규칙으로 처리한다.
    - 반환값은 `{term_key => line_after}`(바뀐 줄만).
    - 바뀐 게 없으면 저장하지 않고 `{}`를 반환한다.
  - `#remove_term_line!(key) -> String|nil`: 지운 원래 줄을 반환하고 저장한다.
  - `#remove_mispronunciation!(key, variant) -> Boolean`: 저장한다.
  - `#term_line(key) -> String|nil`.
- Produces (`SttTermLearning::Level`, 값 객체 `Struct.new(:type, :owner)`. type은 `"Folder"|"Project"|"global"`):
  - `.global`, `.for(owner)`, `.from_ref(type:, id:) -> Level` (없으면 `ActiveRecord::RecordNotFound`)
  - `#key -> "Folder:12"|"Project:3"|"global"`, `#ref -> {type:, id:}` (global은 id nil), `#name`, `#project_id`
  - `#linked_files -> Array<DomainFile>`: Folder/Project는 `owner.domain_files.order("domain_file_links.id")`, global은 `[DomainFile.stt_auto.find_by(auto_owner_type: nil, project_id: nil)].compact`
  - `#parent -> Level|nil`: folder → 부모 folder, 없으면 project. project → global. global → nil.
  - `#descendant_levels -> Array<Level>`: 자기 자신 제외, kept 폴더만. Folder → `subtree_ids` 폴더들. Project → 프로젝트의 모든 폴더. global → 모든 프로젝트 + 그 폴더들.
- Produces (`SttTermLearning::LevelChain`):
  - `.for_meeting(meeting) -> Array<Level>`: `[folder, *folder.ancestor_records, project, global]`. 없는 단계는 빠지고 global은 항상 있다. 회의 자체 링크는 넣지 않는다(스펙 5.5 체인 정의).
  - `.upward_from(level) -> Array<Level>`: level 자신부터 parent를 따라 global까지.
- Produces (`SttTermLearning::AutoDomainFile`):
  - `NAME_PREFIX = "STT 오인식(자동)"`
  - `.find_for(level) -> DomainFile|nil`
  - `.find_or_create_for!(level, fallback_creator:) -> DomainFile`: 만든 뒤 링크(`DomainFileLink.find_or_create_by!(domain_file:, owner: level.owner)`, global은 링크 없음)를 보장한다. 사람이 링크를 지웠으면 다시 링크한다. `ActiveRecord::RecordNotUnique`면 재조회한다.
  - 이름 규칙:
    - global: `"STT 오인식(자동)"`
    - project: `"STT 오인식(자동) · #{project.name}"`
    - folder: `"STT 오인식(자동) · #{조상→자신 이름 '/' join} [F#{id}]"` (경로를 잘라 전체 ≤100자. 끝의 `[F id]`는 자르지 않는다)
  - creator: `::User.where(role: "admin").order(:id).first || fallback_creator`
  - `project_id`: folder → `folder.project_id`, project → `id`, global → nil.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# domain_file_learning_spec
it "apply_learning! merges 는 사람 줄의 용어·분류·설명을 보존하고 오인식만 추가" do
  f = create(:domain_file, content: "머리말\n- **MES** [시스템명] (발음: 엠에스): 제조실행시스템")
  lines = f.apply_learning!(merges: { "mes" => ["엠이에스"] })
  expect(f.reload.content).to eq("머리말\n- **MES** [시스템명] (오인식: 엠에스, 엠이에스): 제조실행시스템")
  expect(lines).to eq("mes" => "- **MES** [시스템명] (오인식: 엠에스, 엠이에스): 제조실행시스템")
end
it "이미 있는 변형이면 저장하지 않고 {} 반환" do
  expect { expect(f.apply_learning!(merges: { "mes" => ["엠에스"] })).to eq({}) }.not_to change { f.reload.updated_at }
end
it "new_terms 는 끝에 append, 분류 없으면 [분류] 생략"
it "remove_term_line! 은 그 줄만 지우고 자유 텍스트는 보존, 원래 줄 반환"
it "remove_mispronunciation! 은 변형 하나만 제거(마지막 하나면 (오인식:) 괄호 자체 제거)"
# level_chain_spec
it "for_meeting: 가까운 폴더 → 상위 폴더 → 프로젝트 → global" do
  expect(described_class.for_meeting(meeting).map(&:key)).to eq(["Folder:#{child.id}", "Folder:#{parent.id}", "Project:#{project.id}", "global"])
end
it "폴더 없는 회의는 [Project, global]"
it "Level#parent·descendant_levels(휴지통 폴더 제외)"
# auto_domain_file_spec
it "폴더 레벨 자동 파일 생성 + 폴더에 링크, 두 번째 호출은 같은 파일"
it "같은 이름 폴더 두 개도 [F id] 로 이름 충돌 없음"
it "아주 긴 경로도 100자 이하, [F id] 보존"
it "전역 자동 파일은 링크 없이 project_id nil"
it "creator 는 첫 admin, admin 이 없으면 fallback_creator"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/models/domain_file_learning_spec.rb spec/services/stt_term_learning` → FAIL

- [ ] **Step 3: 구현** — 위 시그니처대로. `apply_learning!`는 `content.split("\n", -1)`로 줄 배열을 만들고 `TERM_LINE_REGEX`로 key→index를 잡은 뒤, `format_term_line(기존 term, 기존 category, 기존 definition, merged)`로 그 줄만 교체한다.

- [ ] **Step 4: 통과 확인** — 위 spec + `bundle exec rspec spec/models/domain_file_spec.rb` → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): 용어 줄 헬퍼·레벨 체인·자동 도메인 파일`

---

### Task 4: 전역 자동 파일 실효 세트와 교정 블록 선예약

**Files:**
- Modify: `backend/app/models/meeting.rb:130-176` (`effective_domain_files`)
- Modify: `backend/app/services/domain_reference_builder.rb`
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (`inherited_domain_files_json` ~1029, `inherited_owner_domain_file_ids` ~1047)
- Test: `backend/spec/services/domain_reference_builder_spec.rb`(수정·추가), `backend/spec/models/meeting_effective_domain_files_global_spec.rb`, `backend/spec/requests/api/v1/meeting_domain_files_spec.rb`(추가)

**Interfaces:**
- Consumes: `DomainFile#stt_auto?`, `#global_auto?`, `DomainFile.stt_auto` (Task 1).
- Produces:
  - `effective_domain_files` 끝(project 뒤)에 전역 자동 파일 `{ file:, source: "global", owner: nil }`이 붙는다. 이미 seen이거나 회의가 exclude한 파일이면 붙지 않는다.
  - 회의 도메인 API의 inherited 항목: `source: "global"`, `owner_name: "전역(공용)"`.
  - `inherited_owner_domain_file_ids`에 전역 자동 파일 id가 포함된다(선택으로 중복 링크하지 못하게 조용히 drop).
  - `DomainReferenceBuilder::CORRECTION_RESERVE = 1500`.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# meeting_effective_domain_files_global_spec
it "전역 자동 파일은 링크 없이 모든 회의 실효 세트 맨 끝(source global)"
it "회의가 exclude 하면 빠진다"
it "프로젝트 삭제로 nullify 된 프로젝트 자동 파일(auto_owner_type=Project)은 전역으로 붙지 않는다"
# domain_reference_builder_spec 추가
it "자동 파일은 파일 블록(## 헤더)에 넣지 않고 교정 쌍만 쓴다" do
  auto = create(:domain_file, auto_kind: "stt_auto", auto_owner_type: "Project", auto_owner_id: project.id,
                project: project, name: "STT 오인식(자동) · P", content: "- **후판** [STT] (오인식: 우판): ")
  DomainFileLink.create!(owner: project, domain_file: auto)
  result = described_class.build(meeting)
  expect(result).not_to include("## STT 오인식(자동)")
  expect(result).to eq("#{DomainReferenceBuilder::CORRECTION_HEADER}우판→후판")
end
it "사람 파일이 8000자를 채워도 교정 블록이 살아남는다(선예약), 전체 ≤ 8000" do
  big = create(:domain_file, creator: user, name: "A", content: "가" * 8000)
  auto = (자동 파일, "- **후판** (오인식: 우판): ")
  result = described_class.build(meeting)
  expect(result).to include("…(이하 생략)")
  expect(result).to end_with("우판→후판")
  expect(result.length).to be <= 8000
end
it "파일이 작으면 교정 블록은 1500자를 넘어서도 남은 자리를 다 쓴다(기존 동작 보존)"
```
기존 예제 `"파일 블록에서 이미 캡을 다 채웠으면 교정 블록을 아예 붙이지 않는다"`는 이름과 기대값을 `"사람 파일이 캡을 채워도 선예약된 교정 블록은 붙는다"` / `include("씨지엘→CGL")`로 바꾼다. **다른 기존 예제의 기대값은 하나도 바꾸지 않는다.** 바뀌면 알고리즘 오류다.

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/services/domain_reference_builder_spec.rb spec/models/meeting_effective_domain_files_global_spec.rb` → FAIL

- [ ] **Step 3: 구현**

`DomainReferenceBuilder.build`를 두 패스로 바꾼다.
```ruby
all_files = meeting.effective_domain_files.map { |e| e[:file] }.reject { |f| f.content.blank? }
return nil if all_files.empty?
block_files = all_files.reject(&:stt_auto?)

# 1패스: 교정 블록을 최대 CORRECTION_RESERVE 로 만들어 실제 길이만큼만 예약
pre = build_correction_block(all_files, CORRECTION_RESERVE)
reserved = pre ? pre.length + 2 : 0

# 파일 블록: 캡 = MAX_TOTAL_CHARS - reserved (기존 루프 그대로, remaining 계산만 이 캡 기준)
blocks, used = build_file_blocks(block_files, MAX_TOTAL_CHARS - reserved)

# 2패스: 파일 블록이 남긴 자리 전부로 다시 만든다(greedy 접두사라 pre ⊆ 결과, 기존보다 나빠지지 않음)
remaining_for_correction = MAX_TOTAL_CHARS - used - 2
correction = build_correction_block(all_files, remaining_for_correction) if remaining_for_correction > 0
blocks << correction if correction
blocks.empty? ? nil : blocks.join("\n\n")
```
`build_file_blocks(files, cap) -> [blocks, used]`는 기존 루프를 그대로 옮긴 private 클래스 메서드다. `effective_domain_files`의 global 추가는 `excluded_ids`·`seen`을 그대로 따른다.

- [ ] **Step 4: 통과 확인** — 위 spec + `bundle exec rspec spec/requests/api/v1/meeting_domain_files_spec.rb spec/jobs/meeting_summarization_job_spec.rb` → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): 전역 자동 파일 실효 세트·교정 블록 1500자 선예약`

---

### Task 5: 줄 diff와 후보 추출(LLM + feedback)

**Files:**
- Create: `backend/app/services/stt_term_learning/line_diff.rb`, `candidate.rb`, `candidate_extractor.rb`
- Create: `backend/app/services/llm_prompts/stt_term_learning_prompts.rb`
- Modify: `backend/app/services/llm_service.rb` (`extract_domain_terms` 옆에 메서드 추가, `model_name` reader)
- Test: `backend/spec/services/stt_term_learning/line_diff_spec.rb`, `candidate_extractor_spec.rb`, `backend/spec/services/llm_service_stt_misrecognitions_spec.rb`

**Interfaces:**
- Produces:
  - `SttTermLearning::LineDiff.ops(a_text, b_text) -> Array<{op: "equal"|"delete"|"insert", text: String}>`: 양쪽에 `LlmPrompts::CitationMarkers.strip_all` 적용 → 줄별 `rstrip` → `Diff::LCS.sdiff`. `!`(change)는 delete+insert 두 op로 펼친다.
  - `SttTermLearning::LineDiff.hunks(ops) -> Array<{removed: [String], added: [String]}>`: 연속된 비-equal 묶음. 공백만 다른 줄 쌍은 제외한다.
  - `SttTermLearning::Candidate = Struct.new(:wrong, :correct, :category, :definition, :confidence, :source, keyword_init: true)`, `#wrong_key`/`#correct_key` (`DomainFile.normalize_key`).
  - `LlmService#model_name -> String|nil` (`@config[:model]`)
  - `LlmService#extract_stt_misrecognitions(hunks_text, hints_text) -> Array|nil`: `call_llm_json(LlmPrompts::SttTermLearningPrompts::SYSTEM_PROMPT, user_content)`. 배열이 아니면 nil. 예외는 nil + 로그(`extract_domain_terms` 패턴).
  - `LlmPrompts::SttTermLearningPrompts::SYSTEM_PROMPT`: 출력은 JSON 배열 `[{"wrong","correct","category","definition","confidence"}]`. 요점은 "STT가 소리를 잘못 받아 적은 용어 교정만. 표현 다듬기·내용 추가·삭제·서식 변경은 제외", definition ≤60자, confidence 0~1, 해당 없으면 `[]`. (`llm_prompts.rb` include 목록에는 넣지 않고 완전정규화 이름으로 참조한다. domain_terms_prompts 선례.)
  - `SttTermLearning::CandidateExtractor.new(run).call -> { candidates: Array<Candidate>, llm_model: String|nil, llm_skipped_reason: String|nil }`
    - `MAX_HUNKS_CHARS = 12_000`: hunk 텍스트를 이 길이에서 자른다.
    - hunk가 없으면 LLM을 호출하지 않는다.
    - LLM은 `LlmService.new(llm_config: run.meeting.creator&.effective_llm_config)`. 생성자의 `LlmService::NotConfiguredError`를 잡아 `llm_skipped_reason: "llm_not_configured"`로 두고 (가)만 건너뛴다.
    - 힌트: 프로젝트 `SttMisrecognition.confirmed`(hit_count 내림차순 30개)와 `.excluded`(30개)를 `"확정: 우판→후판\n제외: 논의했다→협의했다"` 형태로 만든다.
    - (나) feedback: `run.meeting.glossary_entries.where(enabled: true, match_type: "literal")`의 from_text→to_text, `source: "feedback", confidence: 1.0`.
    - 합치기: key `[wrong_key, correct_key]`가 같으면 **source는 feedback**으로 두고, category·definition은 LLM 값이 있으면 그것을 쓴다.
    - LLM 항목의 definition은 60자로 truncate한다. category가 blank면 `"STT"`.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# line_diff_spec
it "인용 마커만 다른 줄은 equal" do
  ops = described_class.ops("- 우판 압연 ⟦t:1000/s:A⟧", "- 우판 압연 ⟦t:2000/s:B⟧")
  expect(ops.map { _1[:op] }).to eq(["equal"])
end
it "바뀐 줄은 delete+insert, hunks 로 묶인다" do
  ops = described_class.ops("a\n우판 압연\nc", "a\n후판 압연\nc")
  expect(described_class.hunks(ops)).to eq([{ removed: ["우판 압연"], added: ["후판 압연"] }])
end
# candidate_extractor_spec (LlmService 는 instance_double 로 stub, 실 LLM 호출 없음)
it "hunk 가 없으면 LLM 을 호출하지 않고 feedback 후보만"
it "LLM 결과를 Candidate(source llm_diff) 로 정규화, category 빈값은 STT, definition 60자 컷"
it "feedback 과 LLM 이 같은 쌍이면 하나로, source=feedback, LLM definition 채택" do
  meeting.glossary_entries.create!(from_text: "우판", to_text: "후판", match_type: "literal")
  allow(llm).to receive(:extract_stt_misrecognitions).and_return([{ "wrong" => "우판", "correct" => "후판", "definition" => "두꺼운 강판", "confidence" => 0.9 }])
  c = described_class.new(run).call[:candidates]
  expect(c.size).to eq(1)
  expect(c.first).to have_attributes(source: "feedback", definition: "두꺼운 강판")
end
it "NotConfiguredError 면 llm_skipped_reason=llm_not_configured, feedback 후보는 유지"
it "힌트에 확정·제외 쌍을 넣어 호출한다"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/services/stt_term_learning/line_diff_spec.rb spec/services/stt_term_learning/candidate_extractor_spec.rb spec/services/llm_service_stt_misrecognitions_spec.rb` → FAIL

- [ ] **Step 3: 구현** — 시그니처대로. `require "diff/lcs"`는 `line_diff.rb` 맨 위에 둔다.

- [ ] **Step 4: 통과 확인** — 위 spec → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): 줄 diff·LLM/feedback 후보 추출`

---

### Task 6: 필터·조상 체인 중복 방지 등록·오인식 기록

**Files:**
- Create: `backend/app/services/stt_term_learning/candidate_filter.rb`, `registrar.rb`
- Modify: `backend/app/models/stt_misrecognition.rb` (`.record!`)
- Test: `backend/spec/services/stt_term_learning/candidate_filter_spec.rb`, `registrar_spec.rb`, `backend/spec/models/stt_misrecognition_spec.rb`

**Interfaces:**
- Consumes: `Candidate`(T5), `LevelChain`/`Level`/`AutoDomainFile`/`DomainFile#find_term`/`#apply_learning!`(T3).
- Produces:
  - `SttTermLearning::CandidateFilter.new(meeting:, transcript_text:, min_confidence:).verdict_for(candidate) -> [String|nil, String|nil]`. 통과하면 `[nil, nil]`, 아니면 `[verdict, reason]`. 처음 걸린 필터 하나만 낸다.
    1. 프로젝트의 `SttMisrecognition.excluded`에 같은 key 쌍이 있음 → `skipped_excluded`
    2. `wrong_key == correct_key`, 어느 쪽이든 길이 ≤1 또는 >30, 어느 쪽이든 `/\A[\p{N}\p{P}\p{S}\s]+\z/` → `skipped_invalid`
    3. **source `llm_diff`만**: `transcript_text`(공백 제거·downcase)에 `wrong`(공백 제거·downcase)이 없음 → `skipped_not_in_transcript`
    4. 실효 세트(`meeting.effective_domain_files`)의 어떤 용어 줄에서 `wrong_key`가 오인식인데 그 줄 term key ≠ `correct_key` → `skipped_conflict`
    5. **source `llm_diff`만**: `confidence.to_f < min_confidence` → `skipped_low_confidence`
  - `SttTermLearning::Registrar.new(meeting, fallback_creator: meeting.creator)`
    - `#register(candidate) -> { verdict:, domain_file:, level:, change: Hash|nil }`: 쓰기는 보류해 두고 결과만 낸다.
    - `#flush! -> void`: 보류한 쓰기를 파일마다 `apply_learning!` **한 번**으로 저장한다. `change[:line]`은 flush 뒤 확정값으로 채운다.
  - `change` JSON:
    - `{ "kind" => "add_line", "domain_file_id", "term_key", "line" }`: 새 줄, 또는 같은 실행에서 새로 만든 줄에 합친 경우
    - `{ "kind" => "add_mispronunciation", "domain_file_id", "term_key", "wrong" }`: 기존 줄에 병합
    - `already_known`이면 `nil`
  - `SttMisrecognition.record!(project_id:, wrong:, correct:, status:, meeting:) -> SttMisrecognition`
    - upsert 후 `hit_count += 1`, `last_seen_at`·`last_meeting_id` 갱신, `first_meeting_id ||=`
    - 상태 규칙: 기존 excluded는 유지한다. `confirmed`는 덮어쓴다. `undecided`는 기존 confirmed를 강등하지 않는다.
  - 오인식 기록 대상 판정:
    - `APPLIED_VERDICTS` → confirmed
    - `skipped_conflict`·`skipped_low_confidence` → undecided
    - `skipped_excluded` → hit만 증가
    - `skipped_invalid`·`skipped_not_in_transcript`·`skipped_no_level` → 기록하지 않는다(스펙 갭 참조. 문장 다듬기로 ⑤가 오염되는 것을 막는다)
    - 회의에 project가 없으면 기록하지 않는다.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# candidate_filter_spec — 5종 + feedback 면제
it "excluded 쌍 → skipped_excluded"
it "wrong==correct / 1자 / 31자 / 숫자·기호만 → skipped_invalid"
it "LLM 후보 wrong 이 전사에 없으면 skipped_not_in_transcript (공백 무시: '우 판' 전사도 '우판' 일치)"
it "feedback 후보는 전사에 없어도 통과"
it "같은 wrong 이 실효 세트에 다른 용어로 등록돼 있으면 skipped_conflict"
it "LLM confidence 0.5 < 0.6 → skipped_low_confidence, feedback 은 면제"
# registrar_spec
it "체인 어디에도 없으면 가장 가까운 폴더 자동 파일에 새 줄 → registered, 폴더에 링크" do
  r = registrar.register(cand("우판", "후판", definition: "두꺼운 강판")); registrar.flush!
  expect(r[:verdict]).to eq("registered")
  expect(SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(child)).content)
    .to eq("- **후판** [STT] (오인식: 우판): 두꺼운 강판")
end
it "상위 폴더 사람 파일에 같은 용어가 있으면 그 줄에 병합 → merged_existing, 원 줄 정의 보존" do
  human = create(:domain_file, content: "- **MES** [시스템명]: 제조실행시스템"); DomainFileLink.create!(owner: parent, domain_file: human)
  r = registrar.register(cand("엠이에스", "mes")); registrar.flush!
  expect(r[:verdict]).to eq("merged_existing")
  expect(human.reload.content).to eq("- **MES** [시스템명] (오인식: 엠이에스): 제조실행시스템")
  expect(r[:change]).to eq("kind" => "add_mispronunciation", "domain_file_id" => human.id, "term_key" => "mes", "wrong" => "엠이에스")
end
it "프로젝트·전역 자동 파일까지 올라가 찾는다(가장 가까운 레벨 우선)"
it "이미 오인식에 있으면 already_known, 파일 미변경"
it "형제·자손 폴더에만 같은 용어가 있으면 건드리지 않고 내 폴더에 새 줄(하위 비간섭)"
it "같은 실행에서 correct 같은 두 쌍 → 한 줄에 오인식 2개, 저장 1회, 두 change 모두 add_line·같은 line"
it "폴더 없는 회의는 프로젝트 자동 파일"
it "폴더·프로젝트 모두 없는 회의는 skipped_no_level"
# stt_misrecognition_spec
it "record! 는 hit_count 증가, excluded 유지, confirmed 를 undecided 로 강등하지 않음"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/services/stt_term_learning/candidate_filter_spec.rb spec/services/stt_term_learning/registrar_spec.rb spec/models/stt_misrecognition_spec.rb` → FAIL

- [ ] **Step 3: 구현**

`Registrar#register`의 조회 순서는 아래와 같다. 같은 실행에서 보류한 새 줄을 먼저 보고, 그다음 체인을 가까운 레벨부터 본다. 레벨 안에서는 링크 id 순으로 보며, 사람 파일과 자동 파일을 구분하지 않는다.
```ruby
def locate(key)
  if (pending = @pending_new[key]) # { file:, level:, term: {...} } — 이번 실행에서 새로 만들 줄
    return [pending[:level], pending[:file], :pending]
  end
  @chain.each do |level|
    level.linked_files.each do |file|
      file = (@reloaded[file.id] ||= file.reload)
      entry = file.find_term(key)
      return [level, file, entry] if entry
    end
  end
  nil
end
# 판정
# - entry==:pending         → pending 줄 mispronunciations 에 wrong 추가, verdict registered, change add_line(line 은 flush 후 채움)
# - entry 있고 오인식 key에 wrong_key(또는 보류 merges 에 있음) → already_known
# - entry 있음              → @merges[file.id][key] << wrong, verdict merged_existing, change add_mispronunciation
# - 없음 → target = @chain.find { _1.type != "global" } (없으면 skipped_no_level)
#          file = AutoDomainFile.find_or_create_for!(target, fallback_creator:) → @pending_new[key] 등록, verdict registered
```

- [ ] **Step 4: 통과 확인** — 위 spec → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): 필터 5종·조상 체인 중복 방지 등록·오인식 기록`

---

### Task 7: 스냅샷·처리기·학습 잡(디바운스)

**Files:**
- Create: `backend/app/services/stt_term_learning/snapshot.rb`, `processor.rb`, `scheduler.rb`
- Create: `backend/app/jobs/stt_term_learning_job.rb`
- Test: `backend/spec/services/stt_term_learning/snapshot_spec.rb`, `processor_spec.rb`, `backend/spec/jobs/stt_term_learning_job_spec.rb`

**Interfaces:**
- Consumes: `Summary#learnable?`·`#mark_human_edited!`(T2), `CandidateExtractor`(T5), `CandidateFilter`·`Registrar`·`SttMisrecognition.record!`(T6), `AppSettings.stt_term_learning`(T1).
- Produces:
  - `SttTermLearning::Snapshot.capture!(summary, trigger:, force: false) -> SttTermLearningRun|nil`. 아래 중 하나면 nil을 반환한다.
    - 설정 off
    - `!summary.learnable?`
    - trigger `pre_overwrite`인데 `notes_markdown == ai_notes_markdown`
    - `force`가 아니고 같은 회의에 `input_digest`가 같은 run이 `queued/running/done/reverted` 상태로 있음. `reverted`를 넣어야 관리자가 되돌린 용어를 같은 텍스트 재스냅샷이 다시 등록하지 않는다. `failed`는 재시도를 위해 넣지 않는다.
  - 생성 내용:
    - `input_digest = Digest::SHA256.hexdigest("#{ai}\u0000#{human}")`
    - `transcript_text = meeting.transcripts.order(:started_at_ms).pluck(:content).join("\n")`
    - `status: "queued"`
  - `SttTermLearning::Snapshot.before_overwrite!(meeting) -> SttTermLearningRun|nil`: 대상은 `meeting.summaries.find_by(summary_type: "final")`. capture(`trigger: "pre_overwrite"`) 후 `SttTermLearningJob.perform_later(run_id: run.id)`. **모든 예외를 rescue하고 로그를 남긴 뒤 nil을 반환한다.**
  - `SttTermLearning::Snapshot.manual!(meeting) -> SttTermLearningRun|nil`: 활성 final로 `capture!(trigger: "manual", force: true)` 후 enqueue.
  - `SttTermLearning::Scheduler.schedule_idle!(summary, edited_at_iso) -> void`: `learnable?`이고 설정이 켜져 있을 때만 `SttTermLearningJob.set(wait: settings["idle_minutes"].minutes).perform_later(summary_id: summary.id, edited_at: edited_at_iso)`.
  - `SttTermLearningJob#perform(run_id: nil, summary_id: nil, edited_at: nil)`: `queue_as :default`, `limits_concurrency to: 1, key: ->(*) { "stt_term_learning" }` (`respond_to?` 가드 포함, meeting_summarization_job.rb:6 패턴).
  - `SttTermLearning::Processor.new(run).call -> SttTermLearningRun`
    1. `queued`가 아니면 no-op.
    2. `running`·`started_at`을 기록한다.
    3. 추출은 트랜잭션 밖에서 한다(LLM 호출).
    4. 트랜잭션 안에서 후보마다 필터를 거치고, 통과하면 Registrar에 넘긴 뒤 `flush!`, 이어서 items 생성과 misrecognition 기록을 한다.
    5. `done`·`finished_at`·`llm_model`·`llm_skipped_reason`을 기록한다.
    6. 예외가 나면 롤백하고 `failed` + `error`(500자 truncate)를 남긴다.

- [ ] **Step 1: 실패 테스트 작성** (모든 잡 spec에 `allow(AppSettings).to receive(:refresh_env_if_changed!)`, LLM은 `instance_double`)
```ruby
# snapshot_spec
it "AI 원본과 같으면 pre_overwrite 스냅샷 안 만듦"
it "다르면 ai/human/전사 텍스트와 digest 를 담은 queued run 생성"
it "같은 digest 의 done run 이 있으면 idle·pre_overwrite 는 nil, manual(force) 은 생성"
it "reverted run 과 같은 digest 면 pre_overwrite 는 nil, failed run 과 같으면 생성"
it "설정 off 면 nil" do
  allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => false, "idle_minutes" => 30, "min_confidence" => 0.6)
  expect(described_class.capture!(summary, trigger: "idle")).to be_nil
end
it "realtime 행·ai_notes 없는 행은 nil"
it "before_overwrite! 는 내부 예외가 나도 raise 하지 않고 nil"
# processor_spec
it "후보 → items(verdict·source·level·change) 저장, run done"
it "LLM 미설정이면 llm_skipped_reason 기록, feedback 쌍은 등록"
it "등록 중 예외 → 도메인 파일 변경 롤백, run failed + error"
# stt_term_learning_job_spec — 디바운스는 반드시 enqueue→perform 왕복으로 검증
include ActiveJob::TestHelper
it "편집 후 스케줄된 잡이 그대로 돌면 run 을 만든다" do
  iso = summary.mark_human_edited!
  SttTermLearning::Scheduler.schedule_idle!(summary, iso)
  expect { perform_enqueued_jobs }.to change(SttTermLearningRun, :count).by(1)
end
it "그 사이 다시 편집했으면 이전 잡은 스킵(새 잡만 run 생성)" do
  iso1 = summary.mark_human_edited!(1.minute.ago); SttTermLearning::Scheduler.schedule_idle!(summary, iso1)
  iso2 = summary.mark_human_edited!;               SttTermLearning::Scheduler.schedule_idle!(summary, iso2)
  expect { perform_enqueued_jobs }.to change(SttTermLearningRun, :count).by(1)
end
it "30분 대기로 enqueue 된다" do
  freeze_time do
    expect { SttTermLearning::Scheduler.schedule_idle!(summary, iso) }
      .to have_enqueued_job(SttTermLearningJob).with(summary_id: summary.id, edited_at: iso).at(30.minutes.from_now)
  end
end
it "summary 가 지워졌거나 run 이 지워졌으면 no-op(예외 없음)"
it "AI 가 다시 써서 human_edited_at 이 nil 이 됐으면 스킵"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/services/stt_term_learning/snapshot_spec.rb spec/services/stt_term_learning/processor_spec.rb spec/jobs/stt_term_learning_job_spec.rb` → FAIL

- [ ] **Step 3: 구현** — 잡의 디바운스 판정:
```ruby
def perform(run_id: nil, summary_id: nil, edited_at: nil)
  run = if run_id
    SttTermLearningRun.find_by(id: run_id)
  else
    summary = Summary.find_by(id: summary_id)
    # 문자열 iso8601(6) 끼리 비교 — Time 직렬화·DB 정밀도 차이로 영구 불일치하는 함정 차단
    fresh = summary && summary.human_edited_at&.iso8601(6) == edited_at
    fresh ? SttTermLearning::Snapshot.capture!(summary, trigger: "idle") : nil
  end
  SttTermLearning::Processor.new(run).call if run
end
```

- [ ] **Step 4: 통과 확인** — 위 spec → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): 스냅샷·처리기·30분 디바운스 학습 잡`

---

### Task 8: 트리거 배선과 절단 정리

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (`update_notes`, `feedback`, `regenerate_notes`(518 `destroy_all` 직전), `reset_content`(`purge_transcription_content!` 직전), `regenerate_stt`(`purge_transcription_content!` 직전))
- Modify: `backend/app/jobs/meeting_summarization_job.rb` (final `write_ai_final!` 직전), `backend/app/jobs/file_transcription_job.rb` (`write_ai_final!` 직전)
- Create: `backend/app/services/stt_term_learning/redaction_cleanup.rb`
- Modify: `backend/app/services/transcript_redaction_service.rb` (트랜잭션 안 `summaries.destroy_all` 다음 줄)
- Test: `backend/spec/requests/api/v1/meetings_stt_learning_triggers_spec.rb`, `backend/spec/jobs/meeting_summarization_job_ai_original_spec.rb`(추가), `backend/spec/requests/api/v1/transcripts_spec.rb`(redact 추가)

**Interfaces:**
- Consumes: `Snapshot.before_overwrite!`, `Scheduler.schedule_idle!`(T7), `Summary#mark_human_edited!`(T2).
- Produces:
  - `SttTermLearning::RedactionCleanup.call(meeting) -> void`: 그 회의의 runs·items를 삭제하고(`delete_all`), `stt_misrecognitions`의 `first_meeting_id`·`last_meeting_id`가 그 회의면 nil로 바꾼다. 도메인 파일 줄과 오인식 행은 유지한다.
  - 절단은 summaries를 전부 destroy하므로 "남은 요약 행의 ai_notes 비우기"는 대상 행이 없다(스펙 갭으로 보고).

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# meetings_stt_learning_triggers_spec (완료 회의 + final{ai:"AI", notes:"사람"})
it "update_notes 는 idle 학습 잡을 30분 뒤로 건다" do
  expect { patch ".../update_notes", params: { notes_markdown: "사람2" }, as: :json }
    .to have_enqueued_job(SttTermLearningJob).with(summary_id: final.id, edited_at: kind_of(String))
end
it "feedback 도 idle 학습 잡을 건다"
it "regenerate_notes 는 summaries 삭제 전에 pre_overwrite run 을 만든다" do
  expect { post ".../regenerate_notes" }.to change { SttTermLearningRun.where(trigger: "pre_overwrite").count }.by(1)
  expect(SttTermLearningRun.last).to have_attributes(ai_text: "AI", human_text: "사람", summary_id: nil)
end
it "reset_content·regenerate_stt 도 전사가 지워지기 전 transcript_text 를 담아 스냅샷"
it "AI 원본과 같으면 스냅샷 없음"
it "스냅샷이 실패해도 regenerate_notes 는 200" do
  allow(SttTermLearning::Snapshot).to receive(:capture!).and_raise("boom")
  post ".../regenerate_notes"; expect(response).to have_http_status(:ok)
end
# meeting_summarization_job_ai_original_spec 추가
it "AI final 이 사람 편집본을 덮어쓰기 직전 pre_overwrite run 생성"
# transcripts_spec (redact) 추가
it "절단은 학습 run 을 만들지 않고 기존 run·item 을 삭제, 오인식 기록의 회의 id 는 nil, 도메인 줄은 유지"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/requests/api/v1/meetings_stt_learning_triggers_spec.rb spec/jobs/meeting_summarization_job_ai_original_spec.rb spec/requests/api/v1/transcripts_spec.rb` → FAIL

- [ ] **Step 3: 구현**

`update_notes`/`feedback`은 `iso = summary.mark_human_edited!` 다음 `SttTermLearning::Scheduler.schedule_idle!(summary, iso)`를 부른다(T2에서 단 `mark_human_edited!` 호출을 이 형태로 바꾼다). feedback은 활성 요약이 없을 수 있으므로 `if (s = @meeting.active_summary)`로 가드한다(nil에서 500 금지. 테스트 추가: "요약 없는 회의 feedback 도 200, 잡 없음"). 덮어쓰기·삭제 5지점에는 `SttTermLearning::Snapshot.before_overwrite!(@meeting)`(잡에서는 `meeting`)를 **삭제·덮어쓰기 바로 앞줄**에 넣는다. 절단 서비스에는 `SttTermLearning::RedactionCleanup.call(@meeting)`을 트랜잭션 안에 넣어 롤백 시 함께 되돌아가게 한다.

- [ ] **Step 4: 통과 확인** — 위 spec + `bundle exec rspec spec/requests/api/v1/meetings_spec.rb spec/requests/api/v1/meetings_feedback_spec.rb spec/jobs` → PASS

- [ ] **Step 5: Commit** — `feat(stt-learn): 편집·덮어쓰기 트리거 배선·절단 시 학습 데이터 삭제`

---

### Task 9: 용어 이동·삭제·적용 회의 수

**Files:**
- Create: `backend/app/services/stt_term_learning/term_mover.rb`, `impact_counter.rb`
- Test: `backend/spec/services/stt_term_learning/term_mover_spec.rb`, `impact_counter_spec.rb`

**Interfaces:**
- Consumes: `Level`·`AutoDomainFile`·`DomainFile` 헬퍼(T3), `SttTermMoveLog`(T1).
- Produces:
  - `SttTermLearning::TermMover.new(actor:).apply!(moves) -> { moved: Integer, merged: Integer }`
    - moves 항목: `{ domain_file_id:, term_keys: [String] | nil(=파일의 모든 용어 줄), target: Level, copy: false, merge_descendants: false }`
    - **전체가 트랜잭션 하나**다. 실패하면 전부 롤백하고 `SttTermLearning::TermMover::Error`를 raise한다.
    - 한 줄 처리: `entry = source.find_term(key)`(없으면 Error) → `copy`가 아니면 `source.remove_term_line!(key)` → 대상 `AutoDomainFile.find_or_create_for!(target, fallback_creator: actor)`에 key가 있으면 `apply_learning!(merges:)`(대상 정의 우선, merged += 1), 없으면 `new_terms`(원 term·category·definition·mispronunciations 그대로)로 넣는다. 사람 작성 줄도 같은 규칙이다(a안: 원 파일에서 그 줄만 빠진다).
    - `merge_descendants`: `target.descendant_levels`의 링크 파일 중 같은 key 줄을 지우고 그 오인식을 대상 줄에 합친다.
    - 끝에 `SttTermMoveLog.create!(actor:, moves: <요청 JSON>, result: <요약 JSON>)`.
  - `SttTermLearning::TermMover.new(actor:).delete!(items) -> Integer`: items는 `[{domain_file_id:, term_key:}]`. 트랜잭션 하나이고 감사 로그를 남긴다.
  - `SttTermLearning::ImpactCounter.count(level, domain_file_id: nil) -> Integer`
    - 범위: global → `Meeting.kept`, Project → `Meeting.kept.where(project_id:)`, Folder → `Meeting.kept.where(folder_id: folder.subtree_ids)`
    - `domain_file_id`를 주면 `DomainFileLink.excluded.where(owner_type: "Meeting", domain_file_id:)`의 회의를 뺀다.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
it "폴더 자동 파일의 줄을 프로젝트로 올리면 원 줄 삭제 + 프로젝트 자동 파일 생성·링크 + 새 줄"
it "대상에 같은 용어가 있으면 오인식만 합집합(대상 정의 보존), merged=1"
it "copy: true 면 원 줄 유지"
it "사람 작성 파일 줄을 옮기면 그 줄만 원 파일에서 빠지고 나머지 내용·자유 텍스트 보존"
it "merge_descendants: 하위 폴더 2곳의 같은 용어를 지우고 오인식을 대상 줄에 모은다"
it "term_keys nil 이면 파일의 용어 줄 전부(자유 텍스트는 남김)"
it "여러 move 중 하나가 실패(없는 key)하면 전부 롤백하고 Error"
it "이동 감사 로그를 남긴다"
# impact_counter_spec
it "폴더는 서브트리 회의 수, 휴지통 회의 제외"
it "그 파일을 exclude 한 회의는 빼고 센다"
it "global 은 전체 kept 회의"
```

- [ ] **Step 2: 실패 확인** — `bundle exec rspec spec/services/stt_term_learning/term_mover_spec.rb spec/services/stt_term_learning/impact_counter_spec.rb` → FAIL
- [ ] **Step 3: 구현** — 시그니처대로.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `feat(stt-learn): 용어 레벨 이동·일괄 적용·적용 회의 수`

---

### Task 10: 회의 단위 되돌리기·제외 항목 수동 등록

**Files:**
- Create: `backend/app/services/stt_term_learning/reverter.rb`, `manual_registration.rb`
- Test: `backend/spec/services/stt_term_learning/reverter_spec.rb`, `manual_registration_spec.rb`

**Interfaces:**
- Consumes: items `change` JSON(T6), `Registrar`(T6), `DomainFile#remove_term_line!`/`#remove_mispronunciation!`/`#term_line`(T3).
- Produces:
  - `SttTermLearning::Reverter.new(run).call -> { reverted: Integer, skipped_item_ids: [Integer] }`
    - run이 `done`이 아니면 `SttTermLearning::Reverter::Error`.
    - 트랜잭션 하나에서 items를 **id 역순**으로 처리한다.
    - `add_line`: 현재 `term_line(key) == change["line"]`이면 줄을 지우고 `revert_result: "reverted"`. 줄이 없으면 `"already_absent"`. 다르면 `"skipped_changed"`(사람이 그 사이 고침).
    - `add_mispronunciation`: 그 줄에 wrong이 있으면 `remove_mispronunciation!` 후 `"reverted"`. 없으면(줄도 없으면) `"skipped_changed"`.
    - `misrecognition_id`가 있는 item은 `hit_count -= 1`(0 미만 금지). 0이 되면 `status: "undecided"`(excluded는 유지).
    - 끝에 `run.update!(status: "reverted")`.
  - `SttTermLearning::ManualRegistration.call(item) -> SttTermLearningItem`
    - 대상: `skipped_*` verdict 중 `skipped_invalid`·`skipped_no_level`을 뺀 item. 그 외는 Error.
    - `Registrar`로 강제 등록(필터 생략)하고 flush한다. item의 verdict·change·domain_file·level을 갱신하고 misrecognition을 confirmed로 기록한다(excluded였어도 confirmed로 바꾼다. 관리자 명시 행동).
    - run이 `reverted`면 Error.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
it "등록 3건(새 줄 2·병합 1) 되돌리면 새 줄 삭제·병합 오인식 제거, run reverted, hit_count 차감"
it "그 사이 사람이 새 줄 설명을 고쳤으면 그 항목만 skipped_changed 로 남기고 나머지는 되돌린다" do
  result = described_class.new(run).call
  expect(result[:skipped_item_ids]).to eq([edited_item.id])
  expect(edited_item.reload.revert_result).to eq("skipped_changed")
end
it "같은 실행에서 한 줄에 합친 두 항목(add_line 2개)은 첫 처리에서 줄 삭제, 두 번째는 already_absent"
it "hit_count 0 이 되면 undecided"
it "done 이 아닌 run 은 Error"
# manual_registration_spec
it "skipped_not_in_transcript 항목을 등록하면 registered + 도메인 줄 + 오인식 confirmed"
it "excluded 오인식이어도 수동 등록 시 confirmed 로"
it "skipped_invalid 는 Error"
```

- [ ] **Step 2: 실패 확인** → FAIL · **Step 3: 구현** · **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `feat(stt-learn): 회의 단위 되돌리기·제외 항목 수동 등록`

---

### Task 11: 관리자 조회용 트리·용어 인덱스

**Files:**
- Create: `backend/app/services/stt_term_learning/admin_scope.rb`, `tree_builder.rb`, `term_index.rb`
- Test: `backend/spec/services/stt_term_learning/tree_builder_spec.rb`, `term_index_spec.rb`

**Interfaces:**
- Consumes: `Level`(T3), `ImpactCounter`(T9), items(T1/T6).
- Produces:
  - `SttTermLearning::AdminScope.projects(user) -> ActiveRecord::Relation<Project>`: 남의 personal 프로젝트는 뺀다.
  - `SttTermLearning::TreeBuilder.new(user).call -> Hash` (Task 12 계약의 `tree` 응답 그대로)
    - `term_count` = 그 레벨 링크 파일들의 용어 줄 수(key 중복 제거)
    - `new_count` = 최근 `NEW_WINDOW = 7.days` 안에 끝난 run(reverted 제외) 중 그 레벨에 `registered`된 items 수
    - `promote_candidates` = 이 레벨에는 없고 서로 다른 **자식 폴더 서브트리 2곳 이상**에 있는 key 목록(`[{ term:, folder_ids: [...] }]`)
  - `SttTermLearning::TermIndex.new(user).rows(level: nil, include_descendants: false) -> Array<Hash>`
    - level이 nil이면 전 레벨(⑦)을 낸다.
    - 행 필드는 Task 12 계약의 `TermRow`.
    - `source`:
      - 자동 파일이면 최신 적용 item(`APPLIED_VERDICTS`, run 미-reverted, `domain_file_id`·`correct_key` 일치)의 source가 feedback일 때 `"feedback"`, 아니면 `"auto"`
      - 사람 파일이면 적용 item이 있을 때 `"human_merged"`, 없으면 `"human"`
    - `meeting_ids` = 그 items의 run.meeting_id(고유 값, 최대 20개)
    - `applied_meeting_count` = `ImpactCounter.count(level, domain_file_id:)`
    - `duplicate_group` = 같은 프로젝트(전역 행은 제외) 안에서 같은 key가 2개 이상 레벨에 있으면 `"#{project_id}:#{key}"`
    - `merge_target` = 그 그룹 행들 레벨의 최저 공통 조상(폴더 → 공통 조상 폴더, 없으면 프로젝트)

- [ ] **Step 1: 실패 테스트 작성**
```ruby
it "tree: 전역·프로젝트·폴더(parent_id 포함) 노드와 term_count"
it "남의 personal 프로젝트는 tree·terms 에서 빠진다"
it "형제 폴더 두 곳에 같은 용어 → 부모 레벨 promote_candidates"
it "rows: 자동 파일 줄 source auto/feedback, 사람 파일 human/human_merged, meeting_ids"
it "include_descendants: 하위 폴더 줄 포함"
it "두 폴더에 같은 key → 같은 duplicate_group, merge_target 은 공통 부모 폴더"
it "reverted run 의 item 은 source·meeting_ids 계산에서 제외"
```
- [ ] **Step 2: 실패 확인** → FAIL · **Step 3: 구현** · **Step 4: 통과 확인** → PASS
- [ ] **Step 5: Commit** — `feat(stt-learn): 관리자 트리·용어 인덱스 조회`

---

### Task 12: 관리자 API·라우트·회의 "AI 원본과 비교"

**Files:**
- Create: `backend/app/controllers/api/v1/admin/stt_term_learning_controller.rb`, `stt_term_runs_controller.rb`, `stt_misrecognitions_controller.rb`
- Modify: `backend/config/routes.rb` (admin namespace 198~ 안, meetings member 블록)
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (`ai_original` 액션, `before_action :set_meeting`·`:authorize_meeting_control!` 목록에 추가. `reject_if_locked!`에는 넣지 않는다)
- Test: `backend/spec/requests/api/v1/admin/stt_term_learning_spec.rb`, `stt_term_runs_spec.rb`, `stt_misrecognitions_spec.rb`, `backend/spec/requests/api/v1/meetings_ai_original_spec.rb`

**Interfaces (JSON 계약 — 프론트 T13~T17이 이 모양대로 stub한다):**
- 공통: 컨트롤러 3개 모두 `before_action :authenticate_user!, :require_admin!`. `LevelRef = { type: "global"|"Project"|"Folder", id: number|null }`. `LevelInfo = LevelRef & { name: string, path: string[] }`.
- `GET /api/v1/admin/stt_term_learning/tree` →
  `{ global: { term_count, new_count }, projects: [ { id, name, term_count, new_count, promote_candidates: [{ term, folder_ids }], folders: [ { id, name, parent_id, term_count, new_count, promote_candidates } ] } ] }`
- `GET /api/v1/admin/stt_term_learning/terms?level_type=&level_id=&include_descendants=1` (level 생략 = 전체) →
  `{ terms: TermRow[] }`
  - `TermRow = { row_id: "<file_id>:<key>", term, key, category, definition, mispronunciations: string[], domain_file: { id, name, auto: boolean }, level: LevelInfo, source: "auto"|"feedback"|"human"|"human_merged", meeting_ids: number[], is_new: boolean, applied_meeting_count: number, duplicate_group: string|null, merge_target: LevelInfo|null }`
- `POST /api/v1/admin/stt_term_learning/impact` `{ targets: [{ level: LevelRef, domain_file_id?: number }] }` → `{ counts: number[] }`
- `POST /api/v1/admin/stt_term_learning/moves` `{ moves: [{ domain_file_id, term_keys: string[]|null, target: LevelRef, copy?: boolean, merge_descendants?: boolean }] }` → 200 `{ moved, merged }` / 422 `{ error }`(전부 롤백)
- `POST /api/v1/admin/stt_term_learning/terms/delete` `{ items: [{ domain_file_id, term_key }] }` → `{ deleted }`
- `GET|PUT /api/v1/admin/stt_term_learning/settings` `{ enabled: boolean, idle_minutes: number, min_confidence: number }` → 같은 모양(클램프 반영)
- `GET /api/v1/admin/stt_term_learning/runs?status=` →
  `{ runs: RunSummary[], pending: [{ meeting: MeetingRef, summary_id, human_edited_at, eta }] }`
  - `RunSummary = { id, meeting: MeetingRef, trigger, status, registered_count, skipped_count, no_change: boolean, error: string|null, llm_skipped_reason: string|null, created_at, finished_at }`
  - `MeetingRef = { id, title, level: LevelInfo|null }`
  - pending = learnable final 중 `human_edited_at`이 있고 그 시각 이후 run이 없는 것. `eta = human_edited_at + idle_minutes`. 최대 50개. 남의 personal 프로젝트는 뺀다.
- `GET /api/v1/admin/stt_term_learning/runs/:id` →
  `{ run: RunSummary & { ai_generated_at, human_edited_at, diff: DiffOp[], items: RunItem[] } }`
  - `DiffOp = { op: "equal"|"delete"|"insert", text }`
  - `RunItem = { id, wrong, correct, source, verdict, reason, domain_file: { id, name }|null, level: LevelInfo|null, revert_result }`
- `POST .../runs/:id/revert` → `{ run: RunSummary, reverted, skipped_item_ids }` (Error → 422)
- `POST .../runs/:id/rerun` (failed run만, 같은 텍스트로 새 queued run 복제 후 enqueue) → 202 `{ run }`
- `POST .../meetings/:meeting_id/analyze` (`Snapshot.manual!`) → 202 `{ run }` / 422 `{ error: "AI 원본이 없는 회의입니다" }`
- `POST .../runs/:run_id/items/:id/register` → `{ item: RunItem }` (Error → 422)
- `GET .../misrecognitions?status=&q=` (q는 wrong/correct LIKE ESCAPE) →
  `{ misrecognitions: [{ id, wrong, correct, status, hit_count, meeting_ids, registered: { domain_file_id, term_key, level: LevelInfo }|null, last_seen_at }], counts: { total, undecided } }`
  - `registered` = 그 misrecognition의 최신 적용 item 위치. ⬆/⬇ 버튼은 이 값으로 `moves`를 호출한다.
- `PATCH .../misrecognitions/:id` `{ status, correct? }` → `{ misrecognition }`
  - `confirmed`로 바꾸면 `last_meeting`이 있을 때 그 회의 Registrar로 등록(필터 생략)한다. 없으면 프로젝트 레벨에 등록한다.
- `GET /api/v1/meetings/:id/ai_original` (회의 편집 권한 `authorize_meeting_control!`) →
  `{ available: boolean, ai_generated_at, human_edited_at, diff: DiffOp[] }`. 대상은 활성 요약이 `learnable?`일 때만이고, 아니면 `available: false, diff: []`.

- [ ] **Step 1: 실패 테스트 작성**
```ruby
# 각 admin spec
context "server mode" do
  include_context "server mode"
  it "비관리자 403" do
    login_as(member); get "/api/v1/admin/stt_term_learning/tree"
    expect(response).to have_http_status(:forbidden)
  end
end
it "tree/terms 응답이 계약 키를 갖는다"
it "moves 성공 200, 실패 시 422 + 도메인 파일 변경 없음"
it "settings PUT 은 tmp settings.yaml 에 저장(stt_settings_io: true, SETTINGS_PATH stub)"
it "runs index 에 pending(대기) 항목, show 에 diff·items"
it "revert·rerun·analyze·item register"
it "misrecognitions q 에 '%' 가 들어가도 리터럴 매치"
# meetings_ai_original_spec
it "소유자·협업자·admin 은 diff 열람, 열람만 가능한 사용자는 403"
it "AI 원본 없는 회의는 available false"
```
- [ ] **Step 2: 실패 확인** → FAIL (라우트 없음)
- [ ] **Step 3: 구현** — 라우트는 `namespace :admin` 안에 `scope "stt_term_learning", controller: ... ` 형태로 위 경로를 만든다. 서비스 에러(`TermMover::Error`, `Reverter::Error`, `ManualRegistration::Error`)는 422 `{ error: e.message }`로 매핑한다. 컨트롤러에서는 `::SttTermLearning::...`, `::User`, `::Meeting`으로 참조한다.
- [ ] **Step 4: 통과 확인** — 위 spec + `bundle exec rspec spec/requests` → PASS
- [ ] **Step 5: Commit** — `feat(stt-learn): 관리자 API·AI 원본 비교 엔드포인트`

---

### Task 13: 프론트 API 클라이언트·타입·전역 상속 라벨

**Files:**
- Create: `frontend/src/api/sttTermLearning.ts`, `frontend/src/api/sttTermLearning.test.ts`
- Modify: `frontend/src/api/domainFiles.ts:37-40` (`source: 'folder' | 'project' | 'global'`)
- Modify: `frontend/src/components/meeting/DomainFilesPanel.tsx:159` (global이면 `전역(공용)`)
- Create: `frontend/src/components/ui/LineDiffView.tsx` + `LineDiffView.test.tsx` (T15·T17 공용이라 여기서 만든다)
- Test: `frontend/src/components/meeting/DomainFilesPanel.test.tsx`(케이스 추가)

**Interfaces:**
- Produces:
  - 타입: Task 12 계약과 같은 이름 `LevelRef, LevelInfo, TreeResponse, TermRow, RunSummary, RunDetail, RunItem, DiffOp, PendingRun, Misrecognition, SttLearningSettings, MoveRequest`
  - 함수(`apiClient` 경로에는 선행 슬래시 없음):
    - `getTree()`, `getTerms(params?: { level?: LevelRef; includeDescendants?: boolean })`
    - `getImpact(targets)`, `applyMoves(moves)`, `deleteTerms(items)`
    - `getSettings()`, `updateSettings(s)`
    - `getRuns(status?)`, `getRun(id)`, `revertRun(id)`, `rerunRun(id)`, `analyzeMeeting(meetingId)`, `registerItem(runId, itemId)`
    - `getMisrecognitions(params?)`, `updateMisrecognition(id, body)`
    - `getAiOriginal(meetingId)`
  - `LineDiffView` props `{ ops: DiffOp[]; collapseEqual?: boolean }`. delete는 취소선과 붉은 배경, insert는 초록 배경으로 그린다. `collapseEqual`이면 연속 equal 3줄 이상을 `… N줄 동일`로 접는다.

- [ ] **Step 1: 실패 테스트 작성** (`adminUsers.test.ts` 패턴으로 `./client` mock)
```ts
it('applyMoves 는 admin/stt_term_learning/moves 로 POST', async () => {
  post.mockReturnValue({ json: () => Promise.resolve({ moved: 1, merged: 0 }) })
  await applyMoves([{ domain_file_id: 3, term_keys: ['후판'], target: { type: 'Project', id: 1 } }])
  expect(post).toHaveBeenCalledWith('admin/stt_term_learning/moves', { json: { moves: [{ domain_file_id: 3, term_keys: ['후판'], target: { type: 'Project', id: 1 } }] } })
})
it('getTerms 는 level 을 level_type/level_id/include_descendants searchParams 로')
it('getAiOriginal 은 meetings/:id/ai_original GET')
// DomainFilesPanel.test.tsx
it('source global 상속 파일은 "전역(공용)" 라벨')
// LineDiffView.test.tsx
it('delete/insert 를 구분 표시, collapseEqual 이면 긴 equal 구간 접힘')
```
- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/api/sttTermLearning.test.ts src/components/meeting/DomainFilesPanel.test.tsx` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — vitest PASS + `npx tsc -p tsconfig.app.json --noEmit` 0
- [ ] **Step 5: Commit** — `feat(stt-learn): 프론트 API 클라이언트·전역 상속 라벨`

---

### Task 14: 설정 탭 셸·① 레벨 트리/용어 표·② 이동 창

**Files:**
- Modify: `frontend/src/components/settings/SettingsContent.tsx` (TABS에 `{ id: 'sttLearning', label: 'STT 용어 학습' }`, `isAdmin || isLocalMode` 분기 안)
- Modify: `frontend/src/components/settings/SettingsContent.test.tsx` (탭 개수 기대 5→6, 새 탭 mock)
- Create: `frontend/src/components/settings/sttTermLearning/SttTermLearningTab.tsx` (하위 탭 7개: `레벨별 용어`·`처리 내역`·`설정`·`오인식 기록`·`등록 흐름`·`전체 용어`. 시안의 ② 이동은 창이라 탭이 아니다)
- Create: `.../sttTermLearning/levelTree.ts` + `levelTree.test.ts`
- Create: `.../sttTermLearning/LevelTreeView.tsx` + `LevelTreeView.test.tsx`
- Create: `.../sttTermLearning/MoveTermsDialog.tsx` + `MoveTermsDialog.test.tsx`
- Create(placeholder, T15/T16이 교체): `RunHistoryView.tsx`, `LearningSettingsView.tsx`, `MisrecognitionsView.tsx`, `FlowGuideView.tsx`, `AllTermsView.tsx`. 각각 `export default function X() { return <div data-testid="x-placeholder" /> }`.

**Interfaces:**
- Consumes: T13 API·타입.
- Produces:
  - `levelTree.ts`:
    - `type LevelNode = { ref: LevelRef; name: string; termCount: number; newCount: number; children: LevelNode[]; promoteCandidates: { term: string; folder_ids: number[] }[] }`
    - `buildLevelTree(tree: TreeResponse): LevelNode` (루트 = global)
    - `levelKey(ref): string`, `findPath(root, ref): LevelNode[]`
    - `parentOf(root, ref): LevelNode | null`, `childrenOf(root, ref): LevelNode[]`
    - `relationTo(root, current, candidate): 'up' | 'current' | 'down' | 'other'`
  - `MoveTermsDialog` props: `{ rows: TermRow[]; tree: LevelNode; initialTarget?: LevelRef; onClose(): void; onApplied(): void }`
    - 트리에서 대상을 고르면 `getImpact`로 `전 → 후` 회의 수를 보여 준다.
    - 체크박스 "하위 폴더에 있는 같은 용어도 함께 올려 합치기"(`merge_descendants`)·"원래 레벨에도 남겨 두기(복사)"(`copy`).
    - 확인 버튼 문구: `"{대상 이름}로 {올리기|내리기|옮기기}"`.

- [ ] **Step 1: 실패 테스트 작성**
```ts
// levelTree.test.ts
it('folders 의 parent_id 로 중첩 트리를 만들고 루트는 global')
it('relationTo: 조상 up, 자손 down, 형제 가지 other')
// SettingsContent.test.tsx
it('admin: STT 용어 학습 탭이 있고 누르면 SttTermLearningTab 렌더')
it('member: STT 용어 학습 탭 없음')
// LevelTreeView.test.tsx (api 모듈 vi.mock)
it('트리 노드 클릭 → 그 레벨 getTerms 호출, 행에 오인식→용어·출처·도메인 파일 표시')
it('promote_candidates 가 있으면 "상위로 올릴 후보 N건" 안내')
it('행 ⬆ 는 부모 레벨로 applyMoves(term_keys 1개) 후 목록 새로고침')
it('체크 2건 후 "레벨 이동…" → MoveTermsDialog 에 2행')
it('삭제는 confirmDialog 확인 후 deleteTerms, 취소면 호출 안 함')
// MoveTermsDialog.test.tsx
it('대상 선택 시 getImpact 로 적용 회의 수 전→후 표시')
it('merge_descendants·copy 체크가 applyMoves 페이로드에 반영')
it('applyMoves 실패(422) 시 오류 문구 표시, onApplied 호출 안 함')
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/settings` → FAIL
- [ ] **Step 3: 구현** — 확인창은 `confirmDialog`, 모달은 `src/components/ui/Dialog.tsx`를 쓴다.
- [ ] **Step 4: 통과 확인** — vitest PASS, tsc 0
- [ ] **Step 5: Commit** — `feat(stt-learn): 설정 탭·레벨 트리·이동 창`

---

### Task 15: ③ 처리 내역·④ 설정·⑤ 오인식 기록·⑥ 등록 흐름

**Files:**
- Replace: `.../sttTermLearning/RunHistoryView.tsx`, `LearningSettingsView.tsx`, `MisrecognitionsView.tsx`, `FlowGuideView.tsx` (+ 각 `.test.tsx`)

**Interfaces:**
- Consumes: T13 API·`LineDiffView`, T14 `MoveTermsDialog`·`levelTree`.

- [ ] **Step 1: 실패 테스트 작성**
```ts
// RunHistoryView.test.tsx
it('run 상세의 "지금 다시 분석" 은 analyzeMeeting(run.meeting.id) 호출, 422 면 오류 문구')
it('runs + pending 목록: 등록 N·제외 N, 대기는 "대기 · N분 후", failed 는 "다시 실행" 버튼(rerunRun)')
it('run 선택 → getRun, diff 와 판정 표(쌍·판정·근거·등록 위치)')
it('"이 회의 등록 전부 되돌리기" 는 confirmDialog 후 revertRun, skipped 항목은 "사람이 수정해 건너뜀" 표시')
it('제외 항목 "등록" → registerItem')
// LearningSettingsView.test.tsx
it('사용 토글·대기 분·confidence 를 updateSettings 로 저장, 추출 LLM 은 "회의 생성자의 요약 LLM" 안내 문구')
// MisrecognitionsView.test.tsx
it('상태 필터(전체/확정/미정/제외) + 검색어로 getMisrecognitions, 상태 전환은 updateMisrecognition')
it('registered 가 있으면 ⬆ 버튼 → applyMoves(부모 레벨)')
// FlowGuideView.test.tsx
it('등록 순서 1~6 단계 문구 렌더')
```
- [ ] **Step 2: 실패 확인** → FAIL · **Step 3: 구현** · **Step 4: 통과 확인** — vitest PASS, tsc 0
- [ ] **Step 5: Commit** — `feat(stt-learn): 처리 내역·설정·오인식 기록·등록 흐름 화면`

---

### Task 16: ⑦ 전체 용어·변경 예정 일괄 적용

**Files:**
- Create: `.../sttTermLearning/stagedChanges.ts` + `stagedChanges.test.ts`
- Replace: `.../sttTermLearning/AllTermsView.tsx` (+ `AllTermsView.test.tsx`)

**Interfaces:**
- Consumes: T13 API(`getTerms` 전체, `getImpact`, `applyMoves`), T14 `levelTree`.
- Produces:
  - `type StagedChange = { rowId: string; domainFileId: number; termKey: string; from: LevelInfo; to: LevelRef }`
  - `stageChange(list, change): StagedChange[]`: 같은 rowId면 교체하고, `to`가 `from`과 같으면 제거한다.
  - `toMoveRequests(list): MoveRequest[]`: `domain_file_id`와 `to`가 같은 것끼리 `term_keys`를 묶는다.

- [ ] **Step 1: 실패 테스트 작성**
```ts
// stagedChanges.test.ts
it('같은 행 재선택은 교체, 원래 레벨로 되돌리면 제거')
it('toMoveRequests 는 같은 파일·같은 대상끼리 term_keys 묶음')
// AllTermsView.test.tsx
it('전체 용어 표: 필터(프로젝트·출처·중복만·올릴 후보만), duplicate_group 행은 "중복" 강조')
it('레벨 칸 클릭 → 트리 선택 → "변경 예정" 배지, 하단에 "변경 N건 — 용어 ⬆ 대상 (적용 회의 a→b)"')
it('"변경 적용" 은 applyMoves 한 번 호출 후 목록 재조회, "모두 취소" 는 비움')
it('"공통 상위로 합치기" 는 merge_target 으로 그룹 행 전부 변경 예정에 추가')
it('적용 실패(422) 시 변경 예정 유지 + 오류 표시')
```
- [ ] **Step 2: 실패 확인** → FAIL · **Step 3: 구현** · **Step 4: 통과 확인** — vitest PASS, tsc 0
- [ ] **Step 5: Commit** — `feat(stt-learn): 전체 용어 변경 예정 일괄 적용`

---

### Task 17: 요약 패널 ⋯ "AI 원본과 비교" 모달

**Files:**
- Create: `frontend/src/components/meeting/AiOriginalDiffModal.tsx` + `AiOriginalDiffModal.test.tsx`
- Modify: `frontend/src/components/meeting/AiSummaryPanel.tsx`
  - optional prop 하나 `canCompareAiOriginal?: boolean`(기본 false)
  - true이고 `!hideExpand`일 때만 헤더 우측에 `MoreHorizontal` ⋯ 버튼 → 메뉴 항목 하나 "AI 원본과 비교" → 모달
  - 변경을 이 prop·버튼·모달 마운트로 최소화한다. 메인 체크아웃에 이 파일의 미커밋 변경이 있어 머지 충돌 면적을 줄여야 한다.
- Modify: `frontend/src/pages/MeetingPage.tsx:919` (`canCompareAiOriginal={canEdit}`), `frontend/src/components/meeting/meetingDetailTabs.tsx:139` (같은 값)
- Test: `frontend/src/components/meeting/AiSummaryPanel.test.tsx`(케이스 추가)

**Interfaces:**
- Consumes: `getAiOriginal`·`LineDiffView`(T13).
- Produces: `AiOriginalDiffModal` props `{ meetingId: number; onClose(): void }`.

- [ ] **Step 1: 실패 테스트 작성**
```ts
it('canCompareAiOriginal 이면 ⋯ 메뉴에 "AI 원본과 비교", 기본(false)·전체보기 모달 안(hideExpand)에서는 ⋯ 없음')
it('메뉴 클릭 → 모달이 getAiOriginal 호출 후 LineDiffView 렌더, AI 생성·마지막 사람 수정 시각 표시')
it('available false 면 "이 회의에는 AI 원본이 없습니다(기능 도입 전 회의 또는 녹음 중)" 안내')
```
- [ ] **Step 2: 실패 확인** → FAIL · **Step 3: 구현** · **Step 4: 통과 확인** — `npx vitest run src/components/meeting` PASS(기존 AiSummaryPanel 테스트 회귀 없음), tsc 0
- [ ] **Step 5: Commit** — `feat(stt-learn): 요약 패널 AI 원본과 비교`

---

### Task 18: 전체 검증

**Files:** (코드 변경 없음. 실패가 나면 해당 태스크로 되돌아가 고친다)

- [ ] **Step 1: 백엔드 전체** — `cd backend && bundle exec rspec 2>&1 | tail -3` → `0 failures`. 개수는 T0 기준선 + 신규. T0의 사전 존재 실패만 남아야 한다.
- [ ] **Step 2: settings.yaml 무오염 확인** — `ls /Users/jji/project/ddobakddobak-stt-autolearn/settings.yaml*` → 파일 없음.
- [ ] **Step 3: 프론트 전체** — `cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx vitest run 2>&1 | tail -4 && npx vite build 2>&1 | tail -2` → tsc 출력 없음, vitest all passed, `built in`.
- [ ] **Step 4: 정적 점검** — `grep -rn "window.confirm" frontend/src/components/settings/sttTermLearning frontend/src/components/meeting/AiOriginalDiffModal.tsx` → 없음. `grep -rn "LIKE ?" backend/app/controllers/api/v1/admin backend/app/services/stt_term_learning | grep -v ESCAPE` → 없음.
- [ ] **Step 5: 수동 E2E 체크리스트 작성** — 서버를 띄우지 않으므로 사용자에게 넘길 항목만 보고에 적는다.
  1. 완료 회의 요약을 고친 뒤 30분 지나면 ③에 처리 내역이 뜬다.
  2. 다음 요약 프롬프트에 교정 쌍이 들어간다.
  3. ⑦ 변경 적용 뒤 회의 도메인 패널에 자동 파일이 보인다.
  4. 절단 뒤 ③에서 해당 회의 내역이 사라진다.
  5. 실서버 배포 시 마이그레이션 6건 적용과 `bundle install`(diff-lcs 기본 그룹 승격)이 필요하다.

---

## 스펙 갭·빌더 결정

| # | 스펙 | 이 계획의 결정 |
|---|---|---|
| G1 | "AI 원본과 비교" 권한이 §5.1은 편집 가능자, §5.9는 열람 권한자로 서로 다르다. | `authorize_meeting_control!`(소유자·협업자·admin)을 쓴다. §5.1과 시안 "관리자·소유자"에 맞춘 것이다. |
| G2 | 시안 ⑥은 "모든 후보는 ⑤에 남김(제외 포함)"이라 하고, 스펙 §5.6은 상태 규칙만 있다. | 필터 2(invalid)·3(not_in_transcript)·no_level은 ⑤에 기록하지 않는다. 문장 다듬기 오염을 막기 위해서다. ③ 처리 내역 items에는 남는다. |
| G3 | §5.2는 digest가 같으면 스킵하라고만 한다. | 수동 "지금 다시 분석"은 force로 우회한다. 스킵 대상 상태는 `queued/running/done/reverted`다. |
| G4 | 시안 ⑤의 "검색 확장" 표는 스펙 비목표(검색 안 씀)와 충돌한다. | 스펙을 따라 구현하지 않는다. |
| G5 | 관리자 화면 범위가 정해져 있지 않다. | 남의 personal 프로젝트는 숨긴다(ext API 선례). |
| G6 | 시안 ②는 하위 탭이다. | 이동은 창(Dialog)으로 하고 하위 탭은 6개로 둔다. |
| G7 | 내보내기·가져오기의 AI 원본 처리가 정해져 있지 않다. | 프로젝트·회의 내보내기/가져오기(`summaries.map(&:attributes)` + `sanitize`)는 `ai_notes_markdown`·`human_edited_at`을 자동으로 함께 옮긴다. 그대로 둔다(원하면 제외로 바꿀 수 있다). |
| G8 | §5.8a는 절단 시 "남은 요약 행의 ai_notes 비우기"를 요구한다. | 절단이 summaries를 전부 destroy하므로 대상 행이 없다. runs·items 삭제와 오인식 회의 id nil만 구현한다. |
| G9 | §5.5 중복 방지 체인에 회의 자체 링크 파일이 들어가는지 정해져 있지 않다. | 스펙 정의대로 넣지 않는다(폴더→…→전역). 필터 4(conflict)는 회의 레벨을 포함한 실효 세트로 판정한다. |
| G10 | 노트 diff 없이 feedback만 있는 편집의 처리가 정해져 있지 않다. | idle 실행은 그대로 돌아 feedback 쌍만 등록한다. pre_overwrite는 스펙대로 notes ≠ ai일 때만 돈다. |
| G11 | 폴더 이름 변경 후 자동 파일 이름 처리가 정해져 있지 않다. | 따라가지 않는다(`[F id]`로 식별). |
| G12 | 되돌리기와 이동의 관계가 정해져 있지 않다. | 이동된 줄은 되돌리기에서 `skipped_changed`로 건너뛴다. 이동 감사 로그(`stt_term_move_logs`)는 기록만 하고 되돌리기 UI는 없다(§5.7 "최소 감사 로그" 허용). |
| G13 | dev 환경의 30분 타이머 내구성이 정해져 있지 않다. | dev는 ActiveJob `async`라 서버를 재시작하면 30분 타이머가 사라진다. prod solid_queue는 영속이다. |
| G14 | 배포 영향이 정해져 있지 않다. | `diff-lcs`를 Gemfile 기본 그룹으로 올리므로 실서버 `bundle install`이 필요하다. 마이그레이션은 6건이다. |
| G15 | 머지 충돌 위험이 있다. | 메인 체크아웃(`fix/summary-table-handle-overflow`)에 `AiSummaryPanel.tsx` 미커밋 변경이 있다. T17은 prop 하나·버튼·모달 마운트로 최소화한다. |

## Self-Review 결과 (작성자 점검)

- **스펙 대응**:

  | 스펙 | 태스크 |
  |---|---|
  | 5.1 | T2, T8 |
  | 5.2 | T7, T8 (manual: T12 analyze + T15 버튼) |
  | 5.3 | T5 |
  | 5.4 | T6 |
  | 5.5 | T3, T4, T6 |
  | 5.6 | T6, T12, T15 |
  | 5.7 | T9, T14, T16 |
  | 5.8 | T10, T12, T15 |
  | 5.8a | T8 |
  | 5.9 | T12~T17 |
  | 5.10 | T1, T12, T15 |
  | 7 테스트 기준 | 각 태스크 Step 1 |

- **타입 일관성**:
  - `Summary#mark_human_edited! -> String(iso8601(6))`는 T2에서 정의하고 T7·T8에서 쓴다.
  - `Level#ref`·`LevelRef`는 백엔드 T3와 계약 T12, 프론트 T13에서 같은 모양이다.
  - `apply_learning!`(T3)는 T6·T9에서 쓴다.
  - `change` JSON 키(`kind/domain_file_id/term_key/line/wrong`)는 T6에서 정의하고 T10에서 쓴다.
- **비율**: 코드 블록은 비자명 알고리즘(교정 선예약 2패스, 조상 체인 조회 순서, 디바운스 비교)과 테스트 assertion에만 썼다.
