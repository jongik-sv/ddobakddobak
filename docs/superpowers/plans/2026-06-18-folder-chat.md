# 폴더/프로젝트에게 묻기 (Folder/Project Cross-Meeting AI Q&A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 1건에 묶인 AI Chat을 폴더(재귀 하위폴더 포함)/프로젝트 전체 회의를 근거로 답하도록 확대한다(FTS5 retrieval + 출처 회의 인용).

**Architecture:** per-meeting 챗 스택(`chat_messages` 테이블·`AiChatPanel`·`chatStore`·`ChatChannel`)을 **폴리모픽 scope**로 일반화해 재사용한다. 신규 로직은 ①질문→키워드(경량 LLM) ②스코프∩인가 회의 → FTS top-K 컨텍스트 ③회의ID 포함 인용 마커에 집중. 답변은 batch + ActionCable broadcast(기존과 동일).

**Tech Stack:** Rails 7 (RSpec, FactoryBot, SQLite FTS5, ActionCable), React + TypeScript (zustand, react-markdown, vitest), 기존 LlmService(provider/CLI 추상화).

**Spec:** `docs/superpowers/specs/2026-06-18-folder-chat-design.md`

---

## File Structure

**Backend (create)**
- `db/migrate/<ts>_add_scope_to_chat_messages.rb` — scope_type/scope_id 추가, meeting_id nullable화(가드)
- `app/services/folder_chat_keywords.rb` — 질문→키워드(LLM, 폴백)
- `app/services/folder_chat_context.rb` — 스코프∩인가 회의 → FTS top-K → 예산 조립
- `app/jobs/folder_chat_job.rb` — 키워드→컨텍스트→LLM→broadcast
- `app/controllers/api/v1/scoped_chat_messages_controller.rb` — 폴더/프로젝트 챗 create/index
- specs: `spec/models/chat_message_scope_spec.rb`, `spec/services/folder_chat_keywords_spec.rb`, `spec/services/folder_chat_context_spec.rb`, `spec/jobs/folder_chat_job_spec.rb`, `spec/requests/api/v1/scoped_chat_messages_spec.rb`, `spec/channels/chat_channel_scope_spec.rb`

**Backend (modify)**
- `app/models/chat_message.rb` — scope 컬럼·검증·scope·meeting optional
- `app/services/llm_prompts.rb` — FOLDER_CHAT_KEYWORD_PROMPT, FOLDER_CHAT_SYSTEM_PROMPT, FOLDER_CHAT_CITATION_INSTRUCTION
- `app/channels/chat_channel.rb` — scope 파라미터 지원(legacy meeting_id 유지)
- `config/routes.rb` — folders/projects nested chat_messages

**Frontend (create)**
- `src/components/folder/FolderChatDrawer.tsx` — 우측 슬라이드오버 + 스코프 셀렉터
- specs: `FolderChatDrawer.test.tsx`, citationMarkers/ChatMarkdown 테스트 보강

**Frontend (modify)**
- `src/lib/citationMarkers.ts` — FOLDER_CITATION_RE(회의ID 포함)
- `src/components/meeting/ChatMarkdown.tsx` — cross-meeting 마커 → onSeekMeeting
- `src/api/chat.ts` — scoped 엔드포인트
- `src/stores/chatStore.ts` — scope 키 일반화
- `src/channels/chat.ts` — scope 채널 구독
- `src/components/meeting/AiChatPanel.tsx` — scope prop 일반화
- `src/components/meeting/RightTabsPanel.tsx`, `src/hooks/useLiveMobileTabs.tsx`, `src/pages/MeetingsPage.tsx`, `src/components/meeting/MeetingsHeader.tsx` — 호출부 갱신 + 진입점

---

## Task 1: 마이그레이션 — chat_messages 폴리모픽 scope (가드)

**Files:**
- Create: `backend/db/migrate/<ts>_add_scope_to_chat_messages.rb`
- Test: `backend/spec/models/chat_message_scope_spec.rb`

- [ ] **Step 1: 마이그레이션 작성 (row-count 가드)**

`backend/db/migrate/20260618000001_add_scope_to_chat_messages.rb` 생성 (파일명 타임스탬프는 `bin/rails g migration` 출력 또는 현재 시각으로):

```ruby
class AddScopeToChatMessages < ActiveRecord::Migration[7.2]
  disable_ddl_transaction! # SQLite 테이블 재생성(change_column_null) — 과거 와이프 연산 클래스. DDL 트랜잭션 밖에서 가드.

  def up
    before = exec_query("SELECT COUNT(*) AS c FROM chat_messages").first["c"].to_i

    add_column :chat_messages, :scope_type, :string, null: false, default: "meeting"
    add_column :chat_messages, :scope_id,   :integer

    # 기존 행 백필: 모두 meeting scope.
    execute "UPDATE chat_messages SET scope_id = meeting_id WHERE scope_id IS NULL"

    change_column_null :chat_messages, :meeting_id, true

    add_index :chat_messages, [:scope_type, :scope_id, :user_id, :created_at],
              name: "index_chat_messages_on_scope_and_user"

    after = exec_query("SELECT COUNT(*) AS c FROM chat_messages").first["c"].to_i
    raise "ABORT: chat_messages row count changed #{before}->#{after} (데이터 손실 의심)" unless before == after
    raise "ABORT: scope_id 백필 누락" if exec_query("SELECT COUNT(*) AS c FROM chat_messages WHERE scope_id IS NULL").first["c"].to_i.positive?
  end

  def down
    # folder/project 행이 있으면 meeting_id NOT NULL 복귀 불가 → 먼저 제거.
    execute "DELETE FROM chat_messages WHERE scope_type <> 'meeting'"
    remove_index :chat_messages, name: "index_chat_messages_on_scope_and_user"
    change_column_null :chat_messages, :meeting_id, false
    remove_column :chat_messages, :scope_id
    remove_column :chat_messages, :scope_type
  end
end
```

- [ ] **Step 2: 마이그레이션 실행**

Run: `cd backend && bin/rails db:migrate`
Expected: `add_column`/`change_column_null`/`add_index` 성공, abort raise 없음. `db/schema.rb`에 scope_type/scope_id + index 반영.

- [ ] **Step 3: 실패 테스트 작성 (모델 scope 회귀)**

`backend/spec/models/chat_message_scope_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe ChatMessage, "scope columns" do
  it "기존 meeting 챗은 scope_type=meeting 기본값을 가진다" do
    m = create(:chat_message)
    expect(m.scope_type).to eq("meeting")
  end

  it "folder scope 메시지를 meeting 없이 만들 수 있다" do
    msg = ChatMessage.create!(scope_type: "folder", scope_id: 7, user: create(:user),
                              role: "user", content: "폴더 질문", status: "complete")
    expect(msg).to be_persisted
    expect(msg.meeting_id).to be_nil
  end

  it "잘못된 scope_type을 거부한다" do
    msg = ChatMessage.new(scope_type: "team", scope_id: 1, user: create(:user), role: "user", content: "x")
    expect(msg).not_to be_valid
  end

  it "for_scope는 해당 scope 메시지만 반환한다" do
    u = create(:user)
    ChatMessage.create!(scope_type: "folder", scope_id: 1, user: u, role: "user", content: "a", status: "complete")
    ChatMessage.create!(scope_type: "folder", scope_id: 2, user: u, role: "user", content: "b", status: "complete")
    expect(ChatMessage.for_scope("folder", 1).pluck(:content)).to eq(["a"])
  end
end
```

- [ ] **Step 4: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/chat_message_scope_spec.rb`
Expected: FAIL (`scope_type` inclusion 검증·`for_scope` 미정의).

- [ ] **Step 5: 모델 갱신**

`backend/app/models/chat_message.rb`:

```ruby
class ChatMessage < ApplicationRecord
  belongs_to :meeting, optional: true
  belongs_to :user

  ROLES = %w[user assistant].freeze
  STATUSES = %w[pending complete error].freeze
  SCOPE_TYPES = %w[meeting folder project].freeze

  validates :role, inclusion: { in: ROLES }
  validates :status, inclusion: { in: STATUSES }
  validates :scope_type, inclusion: { in: SCOPE_TYPES }
  validates :content, presence: true, if: -> { role == "user" }

  scope :for_user, ->(user) { where(user: user) }
  scope :for_scope, ->(type, id) { where(scope_type: type, scope_id: id) }
  default_scope { order(:created_at) }

  # 어시스턴트 답변 뒤 예상질문(한국어). 항상 문자열 배열, 최대 3개.
  def suggestions
    parsed = JSON.parse(suggestions_json)
    return [] unless parsed.is_a?(Array)

    parsed.first(3).map(&:to_s)
  rescue JSON::ParserError, TypeError
    []
  end

  def suggestions=(value)
    arr = value.is_a?(Array) ? value.first(3).map(&:to_s) : []
    self.suggestions_json = arr.to_json
  end
end
```

- [ ] **Step 6: 테스트 실행 → 통과 + 기존 챗 회귀 확인**

Run: `cd backend && bundle exec rspec spec/models/chat_message_scope_spec.rb spec/models/chat_message_spec.rb spec/requests/api/v1/chat_messages_spec.rb spec/jobs/meeting_chat_job_spec.rb`
Expected: PASS 전부 (기존 meeting 챗 무회귀).

- [ ] **Step 7: 커밋**

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/chat_message.rb backend/spec/models/chat_message_scope_spec.rb
git commit -m "feat(chat): chat_messages 폴리모픽 scope(meeting|folder|project) + 가드 마이그레이션"
```

---

## Task 2: 프롬프트 — 키워드 추출 + 폴더챗 시스템 + 회의ID 인용

**Files:**
- Modify: `backend/app/services/llm_prompts.rb`

- [ ] **Step 1: 프롬프트 상수 추가**

`backend/app/services/llm_prompts.rb`의 `MEETING_CHAT_SYSTEM_PROMPT` 정의 뒤(같은 모듈 안)에 추가:

```ruby
  # 폴더/프로젝트 챗: 자연어 질문에서 FTS 검색 키워드를 뽑는다(경량 호출).
  FOLDER_CHAT_KEYWORD_PROMPT = <<~PROMPT.freeze
    너는 한국어 회의 검색 도우미다. 사용자의 질문에서 전문(full-text) 검색에 쓸 핵심 키워드만 뽑아라.
    규칙:
    - 명사·고유명사·핵심 동사 어근 위주. 조사·어미·불용어(그/저/뭐/어떻게/했어 등)는 제거한다.
    - 동의어·약어가 떠오르면 함께 넣어 recall을 높인다(예: "예산" → "예산","비용").
    - 5개 이하. 각 키워드는 공백 없는 단어 1개.
    - 출력은 JSON 배열만. 설명·코드펜스 금지. 예: ["예산","일정","포항공장"]
  PROMPT

  # 폴더/프로젝트 챗 시스템 프롬프트: 여러 회의의 검색 스니펫을 근거로 답한다(회의ID 인용).
  FOLDER_CHAT_SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 한 폴더(또는 프로젝트)에 속한 여러 회의의 내용을 근거로 질문에 답하는 회의 어시스턴트입니다.
    아래 "관련 회의 발췌"(여러 회의의 검색 스니펫)와 "회의 목차"를 근거로 답하세요.

    규칙:
    - 제공된 발췌·목차에 근거해 답합니다. 없는 내용을 지어내지 마세요.
    - 근거가 없으면 "관련 회의에서 확인되지 않습니다"라고 분명히 밝히세요.
    - 여러 회의에 걸친 질문이면 회의별로 구분해 정리하세요(어느 회의/언제인지 명시).
    - 전사는 음성인식 결과라 오탈자·환각이 섞일 수 있습니다. 불확실하면 불확실하다고 하세요.
    - 답변은 한국어로 간결하게. 필요하면 Markdown(불릿·표)을 사용하세요.
    - 이전 대화가 있으면 맥락을 이어서 답하세요.

    #{FOLDER_CHAT_CITATION_INSTRUCTION}

    예상 질문(후속):
    - 답변 본문을 모두 출력한 뒤, 맨 마지막 줄에 정확히 한 번 아래 형식으로 후속 질문 3개를 덧붙이세요.
    - 형식(센티넬 뒤에 JSON 배열, 정확히 3개): <<<FOLLOWUPS>>>["질문1","질문2","질문3"]
    - 적절한 후속 질문이 없으면 빈 배열로: <<<FOLLOWUPS>>>[]
    - 센티넬 줄은 본문이 아니므로 본문 안에서 절대 언급하지 마세요.
  PROMPT
```

`FOLDER_CHAT_CITATION_INSTRUCTION`은 위 두 상수보다 **먼저** 정의해야 참조된다. `MEETING_CHAT_SYSTEM_PROMPT` 앞(또는 상수 블록 상단)에 배치:

```ruby
  # 폴더/프로젝트 챗 인용 마커: 회의가 여러 개라 meeting_id를 마커에 포함한다(단일 회의 마커의 확장).
  FOLDER_CHAT_CITATION_INSTRUCTION = <<~MARKER.freeze
    ## 발화 근거 마커 (회의ID 포함)
    - 각 문장/항목 끝에 근거 발췌의 마커를 붙인다: ⟦m:<회의ID>/t:<ms>/s:<화자>⟧
      (예: 예산은 5천으로 확정됐다. ⟦m:142/t:125000/s:화자 1⟧)
    - m·ms·화자는 입력 "관련 회의 발췌"의 [회의:<id> ...][MM:SS|<ms>ms 화자] 에 실제 있는 값만 사용한다. 불명확하면 마커를 생략한다.
    - s에는 대괄호 안의 화자값(예: '화자 1')만 쓴다. 콜론 앞 이름은 s에 넣지 않는다.
    - 한 문장이 여러 발췌에 근거하면 발췌마다 별도 마커를 연달아 붙인다.
    - 마커는 문장 끝 또는 표 셀 안에만 붙이고, 코드블록 안에는 넣지 않는다.
  MARKER
```

- [ ] **Step 2: 로드 확인**

Run: `cd backend && bin/rails runner 'puts LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT.include?("관련 회의 발췌"); puts LlmPrompts::FOLDER_CHAT_KEYWORD_PROMPT.include?("JSON 배열"); puts LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT.include?("⟦m:")'`
Expected: `true` 3줄 (시스템 프롬프트에 인용 지시가 인터폴레이션됨).

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/llm_prompts.rb
git commit -m "feat(chat): 폴더챗 프롬프트(키워드추출·시스템·회의ID 인용 마커)"
```

---

## Task 3: FolderChatKeywords — 질문→키워드(LLM + 폴백)

**Files:**
- Create: `backend/app/services/folder_chat_keywords.rb`
- Test: `backend/spec/services/folder_chat_keywords_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/folder_chat_keywords_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe FolderChatKeywords do
  let(:user) { create(:user) }

  it "LLM이 준 JSON 배열을 키워드로 파싱한다" do
    fake = instance_double(LlmService, answer_question: '["예산","일정"]')
    allow(LlmService).to receive(:new).and_return(fake)
    expect(described_class.extract("지난달 예산 일정 정했어?", user: user)).to eq(%w[예산 일정])
  end

  it "코드펜스로 감싼 JSON도 파싱한다" do
    fake = instance_double(LlmService, answer_question: "```json\n[\"포항공장\"]\n```")
    allow(LlmService).to receive(:new).and_return(fake)
    expect(described_class.extract("포항공장 사례?", user: user)).to eq(["포항공장"])
  end

  it "LLM 실패 시 질문 토큰화로 폴백한다" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    expect(described_class.extract("예산 일정 확정", user: user)).to eq(%w[예산 일정 확정])
  end

  it "파싱 불가 응답이면 토큰화 폴백한다" do
    fake = instance_double(LlmService, answer_question: "키워드는 예산과 일정입니다")
    allow(LlmService).to receive(:new).and_return(fake)
    expect(described_class.extract("예산 일정", user: user)).to eq(%w[예산 일정])
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/folder_chat_keywords_spec.rb`
Expected: FAIL (`FolderChatKeywords` 미정의).

- [ ] **Step 3: 서비스 구현**

`backend/app/services/folder_chat_keywords.rb`:

```ruby
# 자연어 질문 → FTS 검색 키워드 배열. 경량 LLM 호출, 실패/파싱불가 시 토큰화 폴백(graceful).
class FolderChatKeywords
  MAX_KEYWORDS = 5

  def self.extract(question, user:)
    new(question, user).extract
  end

  def initialize(question, user)
    @question = question.to_s.strip
    @user = user
  end

  def extract
    return [] if @question.blank?

    config = @user.effective_chat_llm_config
    return fallback if config.blank?

    raw = LlmService.new(llm_config: config)
                    .answer_question(LlmPrompts::FOLDER_CHAT_KEYWORD_PROMPT, @question)
    parse(raw).presence || fallback
  rescue StandardError => e
    Rails.logger.warn "[FolderChatKeywords] #{e.message} — 토큰화 폴백"
    fallback
  end

  private

  def parse(raw)
    json = raw.to_s[/\[[^\]]*\]/m] # 코드펜스·잡설 안의 첫 JSON 배열
    return [] unless json

    arr = JSON.parse(json)
    return [] unless arr.is_a?(Array)

    arr.map { |w| w.to_s.strip }.reject(&:blank?).first(MAX_KEYWORDS)
  rescue JSON::ParserError
    []
  end

  def fallback
    @question.split(/\s+/).reject(&:blank?).first(MAX_KEYWORDS)
  end
end
```

- [ ] **Step 4: 테스트 실행 → 통과**

Run: `cd backend && bundle exec rspec spec/services/folder_chat_keywords_spec.rb`
Expected: PASS (4 examples).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/folder_chat_keywords.rb backend/spec/services/folder_chat_keywords_spec.rb
git commit -m "feat(chat): FolderChatKeywords — 질문→키워드 추출(LLM+토큰화 폴백)"
```

---

## Task 4: FolderChatContext — 스코프∩인가 → FTS top-K → 예산 조립

**Files:**
- Create: `backend/app/services/folder_chat_context.rb`
- Test: `backend/spec/services/folder_chat_context_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/folder_chat_context_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe FolderChatContext do
  let(:project) { create(:project) }
  let(:owner) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let(:child)  { create(:folder, project: project, parent: folder) }

  def transcript_for(meeting, content, ms: 1000)
    create(:transcript, meeting: meeting, speaker_label: "화자 1", content: content, started_at_ms: ms, sequence_number: 0)
  end

  it "폴더 + 재귀 하위폴더의 회의 발췌를 포함한다" do
    m1 = create(:meeting, project: project, folder: folder, creator: owner)
    m2 = create(:meeting, project: project, folder: child, creator: owner)
    transcript_for(m1, "예산은 오천만원입니다")
    transcript_for(m2, "예산 집행 일정은 칠월입니다")

    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: owner, keywords: %w[예산])
    expect(out[:system_prompt]).to eq(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT)
    expect(out[:user_content]).to include("오천만원").and include("칠월")
    expect(out[:user_content]).to include("[회의:#{m1.id}").and include("[회의:#{m2.id}")
  end

  it "접근 불가(공유 안 된 타인) 회의는 발췌에서 제외한다" do
    other = create(:user)
    private_m = create(:meeting, :private_meeting, project: project, folder: folder, creator: owner)
    transcript_for(private_m, "비밀 예산 내용")

    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: other, keywords: %w[예산])
    expect(out[:user_content]).not_to include("비밀 예산 내용")
  end

  it "프로젝트 스코프는 프로젝트 전체 회의를 대상으로 한다" do
    m = create(:meeting, project: project, folder: nil, creator: owner)
    transcript_for(m, "프로젝트 차원 예산")
    out = described_class.build(scope_type: "project", scope_id: project.id, user: owner, keywords: %w[예산])
    expect(out[:user_content]).to include("프로젝트 차원 예산")
  end

  it "발췌 라인에 회의ID·ms 원값을 노출해 인용에 쓰게 한다" do
    m = create(:meeting, project: project, folder: folder, creator: owner)
    transcript_for(m, "예산 확정", ms: 125_000)
    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: owner, keywords: %w[예산])
    expect(out[:user_content]).to include("125000ms")
    expect(out[:user_content]).to include("[회의:#{m.id}")
  end

  it "직전 대화 history를 scope 단위로 포함한다" do
    create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: owner, role: "user", content: "이전질문")
    create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: owner, role: "assistant", status: "complete", content: "이전답변")
    out = described_class.build(scope_type: "folder", scope_id: folder.id, user: owner, keywords: %w[예산])
    expect(out[:user_content]).to include("이전 대화:").and include("이전질문")
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/folder_chat_context_spec.rb`
Expected: FAIL (`FolderChatContext` 미정의).

- [ ] **Step 3: 서비스 구현**

`backend/app/services/folder_chat_context.rb`:

```ruby
# 폴더/프로젝트 챗 컨텍스트: 스코프 회의 ∩ 사용자 접근권 → FTS top-K 발췌 + 회의 목차 + history.
# ⚠️ SearchService#accessible_meeting_ids는 Meeting.kept만 쓰므로 재사용 금지 — 여기선 accessible_by(user)로 인가한다.
class FolderChatContext
  MAX_CHARS   = 120_000
  TOP_K       = 40       # FTS 발췌 행 상한
  SNIPPET_LEN = 32

  def self.build(scope_type:, scope_id:, user:, keywords:)
    new(scope_type, scope_id, user, keywords).build
  end

  def initialize(scope_type, scope_id, user, keywords)
    @scope_type = scope_type
    @scope_id   = scope_id
    @user       = user
    @keywords   = Array(keywords).reject(&:blank?)
  end

  def build
    parts = []
    parts << "스코프: #{@scope_type} ##{@scope_id} (회의 #{meeting_ids.size}건)"
    parts << "회의 목차:\n#{toc_block}" if toc_block.present?
    parts << "관련 회의 발췌:\n#{excerpts_block}" if excerpts_block.present?
    parts << history_block if history_block.present?
    { system_prompt: LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT, user_content: truncate(parts.join("\n\n")) }
  end

  private

  # 스코프 후보 회의 ∩ accessible_by(user) → id 배열.
  def meeting_ids
    @meeting_ids ||= begin
      scoped = case @scope_type
      when "folder"
        ids = Folder.find_by(id: @scope_id)&.subtree_ids || []
        Meeting.where(folder_id: ids)
      when "project"
        Meeting.where(project_id: @scope_id)
      else
        Meeting.none
      end
      scoped.merge(Meeting.accessible_by(@user)).pluck(:id)
    end
  end

  def fts_query
    @keywords.map { |w| "\"#{w.gsub('"', '')}\"*" }.join(" OR ")
  end

  # FTS top-K 발췌 — 회의ID·ms·화자·snippet. (transcripts_fts + summaries_fts)
  def excerpts_block
    return @excerpts_block if defined?(@excerpts_block)
    @excerpts_block = "" and return @excerpts_block if meeting_ids.empty? || @keywords.empty?

    placeholders = meeting_ids.map { "?" }.join(",")
    sql = <<~SQL
      SELECT t.meeting_id, t.started_at_ms, t.speaker_label, t.speaker_name, m.title AS meeting_title,
             snippet(transcripts_fts, 0, '', '', '…', #{SNIPPET_LEN}) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      JOIN meetings m ON m.id = t.meeting_id
      WHERE transcripts_fts MATCH ? AND t.meeting_id IN (#{placeholders})
      ORDER BY rank
      LIMIT #{TOP_K}
    SQL
    binds = [fts_query] + meeting_ids
    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([sql] + binds)
    )
    @excerpts_block = rows.map { |r|
      clock = format("%02d:%02d", r["started_at_ms"].to_i / 60000, (r["started_at_ms"].to_i / 1000) % 60)
      spk = r["speaker_label"].presence || "화자"
      "[회의:#{r['meeting_id']} #{r['meeting_title']}][#{clock}|#{r['started_at_ms']}ms #{spk}] #{r['snippet']}"
    }.join("\n")
  end

  # 회의 목차: 후보 회의 제목·날짜·brief_summary 한 줄(폭넓은 질문 대비).
  def toc_block
    return @toc_block if defined?(@toc_block)
    @toc_block = Meeting.where(id: meeting_ids).order(created_at: :desc).limit(100).map { |m|
      brief = m.brief_summary.to_s.strip.tr("\n", " ")
      "- [회의:#{m.id}] #{m.title} (#{m.created_at.to_date})#{brief.present? ? " — #{brief}" : ''}"
    }.join("\n")
  end

  def history_block
    return @history_block if defined?(@history_block)
    msgs = ChatMessage.for_scope(@scope_type, @scope_id).for_user(@user)
                      .where(status: "complete").order(:created_at).last(6)
    @history_block = msgs.any? ? "이전 대화:\n" + msgs.map { |m| "#{m.role == 'user' ? '사용자' : '어시스턴트'}: #{m.content}" }.join("\n") : ""
  end

  def truncate(text)
    text.length > MAX_CHARS ? text[0, MAX_CHARS] + "\n…(생략)…" : text
  end
end
```

- [ ] **Step 4: chat_message 팩토리에 scope 기본값 보강**

`backend/spec/factories/chat_messages.rb` — meeting 연관이 있어도 scope_type 기본이 채워지게(모델 default가 처리하지만 nil meeting 케이스 명시 허용). 변경 불필요하면 skip. nil meeting 생성 테스트가 통과하도록 다음 trait 추가:

```ruby
FactoryBot.define do
  factory :chat_message do
    association :meeting
    association :user
    role { "user" }
    content { "이번 회의에서 결정된 게 뭐야?" }
    status { "complete" }

    trait :folder_scope do
      meeting { nil }
      scope_type { "folder" }
      scope_id { 1 }
    end
  end
end
```

- [ ] **Step 5: 테스트 실행 → 통과**

Run: `cd backend && bundle exec rspec spec/services/folder_chat_context_spec.rb`
Expected: PASS (5 examples). FTS 인덱스는 `create(:transcript)`의 `after_create`(FtsIndexable) 콜백으로 채워진다.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/folder_chat_context.rb backend/spec/services/folder_chat_context_spec.rb backend/spec/factories/chat_messages.rb
git commit -m "feat(chat): FolderChatContext — 스코프∩인가 회의 FTS top-K 컨텍스트(회의ID 발췌)"
```

---

## Task 5: FolderChatJob — 키워드→컨텍스트→LLM→broadcast

**Files:**
- Create: `backend/app/jobs/folder_chat_job.rb`
- Test: `backend/spec/jobs/folder_chat_job_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/jobs/folder_chat_job_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe FolderChatJob, type: :job do
  let(:project) { create(:project) }
  let(:user) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let!(:question) { create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: user, role: "user", content: "예산?") }
  let!(:answer) { create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: user, role: "assistant", status: "pending", content: "") }

  before do
    allow(FolderChatKeywords).to receive(:extract).and_return(%w[예산])
    fake = instance_double(LlmService, answer_question: "예산은 오천입니다.")
    allow(LlmService).to receive(:new).and_return(fake)
  end

  it "답변을 채우고 complete로 표시한다" do
    expect(ActionCable.server).to receive(:broadcast).at_least(:once)
    FolderChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.content).to eq("예산은 오천입니다.")
    expect(answer.status).to eq("complete")
  end

  it "scope 채널로 broadcast한다" do
    expect(ActionCable.server).to receive(:broadcast).with(
      "chat_folder_#{folder.id}_#{user.id}",
      hash_including(status: "complete")
    )
    FolderChatJob.perform_now(answer.id)
  end

  it "current_user의 chat LLM config로 LlmService를 만든다" do
    user.update!(llm_provider: "anthropic", llm_api_key: "sk", llm_model: "claude-sonnet-4-6", chat_llm_model: "claude-haiku-4-5")
    fake = instance_double(LlmService, answer_question: "ok")
    expect(LlmService).to receive(:new).with(llm_config: hash_including(model: "claude-haiku-4-5")).and_return(fake)
    FolderChatJob.perform_now(answer.id)
  end

  it "LLM 실패 시 error로 표시·broadcast한다" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    expect(ActionCable.server).to receive(:broadcast).with(
      "chat_folder_#{folder.id}_#{user.id}",
      hash_including(status: "error", error_message: a_string_including("boom"))
    )
    FolderChatJob.perform_now(answer.id)
    expect(answer.reload.status).to eq("error")
  end

  it "followups 센티넬을 분리한다" do
    fake = instance_double(LlmService, answer_question: "본문\n<<<FOLLOWUPS>>>[\"q1\",\"q2\",\"q3\"]")
    allow(LlmService).to receive(:new).and_return(fake)
    FolderChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.content).to eq("본문")
    expect(answer.suggestions).to eq(%w[q1 q2 q3])
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/folder_chat_job_spec.rb`
Expected: FAIL (`FolderChatJob` 미정의).

- [ ] **Step 3: 잡 구현 (followups 로직은 MeetingChatJob과 공유)**

먼저 followups 분리를 모듈로 추출해 DRY 유지. `backend/app/jobs/concerns/chat_followups.rb`:

```ruby
# 답변 원문에서 <<<FOLLOWUPS>>> 뒤 JSON 배열(예상질문)을 분리한다. 센티넬/파싱 실패 시 graceful.
module ChatFollowups
  FOLLOWUPS_SENTINEL = "<<<FOLLOWUPS>>>".freeze

  def split_followups(raw)
    return [raw.to_s.strip, []] unless raw.to_s.include?(FOLLOWUPS_SENTINEL)

    body, _, tail = raw.partition(FOLLOWUPS_SENTINEL)
    parsed = JSON.parse(tail.strip)
    suggestions = parsed.is_a?(Array) ? parsed.first(3).map(&:to_s) : []
    [body.strip, suggestions]
  rescue JSON::ParserError
    [body.to_s.strip, []]
  end
end
```

`backend/app/jobs/folder_chat_job.rb`:

```ruby
class FolderChatJob < ApplicationJob
  include ChatFollowups
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    user = answer.user
    question = ChatMessage.for_scope(answer.scope_type, answer.scope_id).for_user(user)
                          .where(role: "user").where("created_at <= ?", answer.created_at)
                          .order(:created_at).last

    keywords = FolderChatKeywords.extract(question&.content.to_s, user: user)
    ctx = FolderChatContext.build(scope_type: answer.scope_type, scope_id: answer.scope_id, user: user, keywords: keywords)

    config = user.effective_chat_llm_config
    raise "LLM이 설정되어 있지 않습니다." if config.blank?

    raw = LlmService.new(llm_config: config).answer_question(ctx[:system_prompt], ctx[:user_content])
    content, suggestions = split_followups(raw.to_s)
    answer.update!(content: content, suggestions: suggestions, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast(msg)
    ActionCable.server.broadcast(
      "chat_#{msg.scope_type}_#{msg.scope_id}_#{msg.user_id}",
      { type: "chat_message_update", id: msg.id, role: msg.role,
        content: msg.content, status: msg.status, suggestions: msg.suggestions,
        error_message: msg.error_message, created_at: msg.created_at }
    )
  end
end
```

- [ ] **Step 4: MeetingChatJob을 공유 모듈로 리팩터(무회귀)**

`backend/app/jobs/meeting_chat_job.rb`에서 `FOLLOWUPS_SENTINEL`/`split_followups` 정의를 제거하고 `include ChatFollowups`로 교체(나머지 로직 동일):

```ruby
class MeetingChatJob < ApplicationJob
  include ChatFollowups
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    meeting = answer.meeting
    user = answer.user
    question = meeting.chat_messages.for_user(user).where(role: "user")
                      .where("created_at <= ?", answer.created_at).order(:created_at).last

    ctx = MeetingChatContext.build(meeting: meeting, user: user, question: question&.content.to_s)
    config = meeting.creator&.effective_chat_llm_config
    raise "이 회의의 LLM이 설정되어 있지 않습니다." if config.blank?

    raw = LlmService.new(llm_config: config).answer_question(ctx[:system_prompt], ctx[:user_content])
    content, suggestions = split_followups(raw.to_s)
    answer.update!(content: content, suggestions: suggestions, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast(msg)
    ActionCable.server.broadcast(
      "meeting_#{msg.meeting_id}_chat_#{msg.user_id}",
      { type: "chat_message_update", id: msg.id, role: msg.role,
        content: msg.content, status: msg.status, suggestions: msg.suggestions,
        error_message: msg.error_message, created_at: msg.created_at }
    )
  end
end
```

- [ ] **Step 5: 테스트 실행 → 통과 + MeetingChatJob 무회귀**

Run: `cd backend && bundle exec rspec spec/jobs/folder_chat_job_spec.rb spec/jobs/meeting_chat_job_spec.rb`
Expected: PASS 전부.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/jobs
git commit -m "feat(chat): FolderChatJob + ChatFollowups 공유 모듈(MeetingChatJob DRY)"
```

---

## Task 6: 라우트 + ScopedChatMessagesController (인가)

**Files:**
- Modify: `backend/config/routes.rb`
- Create: `backend/app/controllers/api/v1/scoped_chat_messages_controller.rb`
- Test: `backend/spec/requests/api/v1/scoped_chat_messages_spec.rb`

- [ ] **Step 1: 라우트 추가**

`backend/config/routes.rb`의 folders/projects 블록에 nested chat_messages 추가.

folders 블록(`resources :folders ... do`) 안에:

```ruby
        resources :chat_messages, only: %i[index create],
                  controller: "scoped_chat_messages", defaults: { scope_type: "folder" }
```

projects 블록(`resources :projects ... do`) 안에:

```ruby
        resources :chat_messages, only: %i[index create],
                  controller: "scoped_chat_messages", defaults: { scope_type: "project" }
```

- [ ] **Step 2: 실패 테스트 작성**

`backend/spec/requests/api/v1/scoped_chat_messages_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "Api::V1::ScopedChatMessages", type: :request do
  let(:project) { create(:project) }
  let(:owner) { project.creator }
  let(:folder) { create(:folder, project: project) }

  context "프로젝트 멤버(폴더 챗)" do
    before { login_as(owner) }

    it "user + pending assistant 생성 후 FolderChatJob enqueue" do
      expect {
        post "/api/v1/folders/#{folder.id}/chat_messages", params: { content: "예산?" }, as: :json
      }.to have_enqueued_job(FolderChatJob)
      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["user_message"]["content"]).to eq("예산?")
      expect(body["assistant_message"]["status"]).to eq("pending")
    end

    it "index는 본인 메시지만(scope 격리) 반환한다" do
      create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: owner, role: "user", content: "mine")
      create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: create(:user), role: "user", content: "theirs")
      get "/api/v1/folders/#{folder.id}/chat_messages", as: :json
      contents = response.parsed_body.map { |m| m["content"] }
      expect(contents).to include("mine")
      expect(contents).not_to include("theirs")
    end

    it "프로젝트 스코프 create" do
      expect {
        post "/api/v1/projects/#{project.id}/chat_messages", params: { content: "전체 예산?" }, as: :json
      }.to have_enqueued_job(FolderChatJob)
      expect(response).to have_http_status(:created)
    end
  end

  context "프로젝트 비멤버" do
    let(:outsider) { create(:user) }
    before { login_as(outsider) }

    it "폴더 챗을 거부한다(403)" do
      post "/api/v1/folders/#{folder.id}/chat_messages", params: { content: "x" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "프로젝트 챗을 거부한다(403)" do
      post "/api/v1/projects/#{project.id}/chat_messages", params: { content: "x" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end
end
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/scoped_chat_messages_spec.rb`
Expected: FAIL (컨트롤러 미정의 → 라우팅/상수 오류).

- [ ] **Step 4: 컨트롤러 구현**

`backend/app/controllers/api/v1/scoped_chat_messages_controller.rb`:

```ruby
module Api
  module V1
    class ScopedChatMessagesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_scope        # scope_type + scope_id 확정
      before_action :authorize_scope! # 폴더/프로젝트 접근 인가

      def index
        messages = ChatMessage.for_scope(@scope_type, @scope_id).for_user(current_user).order(:created_at)
        render json: messages.map { |m| serialize(m) }
      end

      def create
        content = params[:content].to_s.strip
        return render(json: { error: "질문을 입력하세요." }, status: :unprocessable_entity) if content.blank?

        user_msg = nil
        assistant_msg = nil
        ChatMessage.transaction do
          user_msg = ChatMessage.create!(scope_type: @scope_type, scope_id: @scope_id, user: current_user,
                                         role: "user", content: content, status: "complete")
          assistant_msg = ChatMessage.create!(scope_type: @scope_type, scope_id: @scope_id, user: current_user,
                                              role: "assistant", content: "", status: "pending")
        end
        FolderChatJob.perform_later(assistant_msg.id)
        render json: { user_message: serialize(user_msg), assistant_message: serialize(assistant_msg) }, status: :created
      end

      private

      def set_scope
        @scope_type = params[:scope_type]
        @scope_id   = (params[:folder_id] || params[:project_id]).to_i
      end

      # 인가: admin은 전체. 그 외 — folder는 소속 프로젝트 멤버십, project는 직접 멤버십.
      def authorize_scope!
        return if current_user.respond_to?(:admin?) && current_user.admin?

        project = case @scope_type
        when "folder"  then ::Folder.find_by(id: @scope_id)&.project
        when "project" then ::Project.find_by(id: @scope_id)
        end
        head :forbidden and return unless project&.member?(current_user)
      end

      def serialize(m)
        { id: m.id, role: m.role, content: m.content, status: m.status,
          suggestions: m.suggestions, error_message: m.error_message, created_at: m.created_at }
      end
    end
  end
end
```

> 참고: `::Folder`/`::Project`는 `reference_rails_user_namespace_trap`처럼 Api::V1 네임스페이스 오해석을 피하려 최상위(`::`) 상수로 쓴다. 개인 프로젝트는 멤버십이 있으므로 `member?`로 충분.

- [ ] **Step 5: 테스트 실행 → 통과**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/scoped_chat_messages_spec.rb`
Expected: PASS (5 examples).

- [ ] **Step 6: 커밋**

```bash
git add backend/config/routes.rb backend/app/controllers/api/v1/scoped_chat_messages_controller.rb backend/spec/requests/api/v1/scoped_chat_messages_spec.rb
git commit -m "feat(chat): 폴더/프로젝트 chat_messages 라우트 + ScopedChatMessagesController(인가)"
```

---

## Task 7: ChatChannel — scope 구독 지원 (legacy 유지)

**Files:**
- Modify: `backend/app/channels/chat_channel.rb`
- Test: `backend/spec/channels/chat_channel_scope_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/channels/chat_channel_scope_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe ChatChannel, type: :channel do
  let(:project) { create(:project) }
  let(:owner) { project.creator }
  let(:folder) { create(:folder, project: project) }

  it "멤버는 폴더 scope 스트림을 구독한다" do
    stub_connection current_user: owner
    subscribe(scope_type: "folder", scope_id: folder.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("chat_folder_#{folder.id}_#{owner.id}")
  end

  it "비멤버는 폴더 scope 구독을 거부당한다" do
    stub_connection current_user: create(:user)
    subscribe(scope_type: "folder", scope_id: folder.id)
    expect(subscription).to be_rejected
  end

  it "기존 meeting_id 구독은 그대로 동작한다(무회귀)" do
    meeting = create(:meeting, creator: owner)
    stub_connection current_user: owner
    subscribe(meeting_id: meeting.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("meeting_#{meeting.id}_chat_#{owner.id}")
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/channels/chat_channel_scope_spec.rb`
Expected: FAIL (scope 분기 미구현 → reject).

- [ ] **Step 3: 채널 갱신**

`backend/app/channels/chat_channel.rb`:

```ruby
class ChatChannel < ApplicationCable::Channel
  def subscribed
    if params[:scope_type].present?
      subscribe_scope(params[:scope_type], params[:scope_id])
    else
      subscribe_meeting(params[:meeting_id])
    end
  end

  private

  def subscribe_meeting(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return reject unless meeting && meeting_readable?(meeting)

    stream_from "meeting_#{meeting.id}_chat_#{current_user.id}"
  end

  def subscribe_scope(scope_type, scope_id)
    project = case scope_type
    when "folder"  then Folder.find_by(id: scope_id)&.project
    when "project" then Project.find_by(id: scope_id)
    end
    return reject unless scope_readable?(project)

    stream_from "chat_#{scope_type}_#{scope_id.to_i}_#{current_user.id}"
  end

  def scope_readable?(project)
    return false unless project
    return true if current_user.respond_to?(:admin?) && current_user.admin?

    project.member?(current_user)
  end

  # MeetingLookup#authorize_meeting_read! 와 동일 규칙(기존 동작 보존).
  def meeting_readable?(meeting)
    return true if current_user.respond_to?(:admin?) && current_user.admin?
    return true if meeting.owner?(current_user)
    return true if meeting.shared_visible?

    meeting.active_participants.exists?(user_id: current_user.id)
  end
end
```

- [ ] **Step 4: 테스트 실행 → 통과 + 기존 채널 스펙 무회귀**

Run: `cd backend && bundle exec rspec spec/channels`
Expected: PASS 전부.

- [ ] **Step 5: 백엔드 전체 회귀**

Run: `cd backend && bundle exec rspec`
Expected: 0 failures (기존 + 신규 전부 green).

- [ ] **Step 6: 커밋**

```bash
git add backend/app/channels/chat_channel.rb backend/spec/channels/chat_channel_scope_spec.rb
git commit -m "feat(chat): ChatChannel scope(folder|project) 구독 + meeting 무회귀"
```

---

## Task 8: FE 인용 마커 — 회의ID 포함(cross-meeting)

**Files:**
- Modify: `frontend/src/lib/citationMarkers.ts`
- Modify: `frontend/src/components/meeting/ChatMarkdown.tsx`
- Test: `frontend/src/lib/citationMarkers.test.ts` (없으면 생성), `frontend/src/components/meeting/ChatMarkdown.test.tsx`

- [ ] **Step 1: 실패 테스트 작성 (정규식)**

`frontend/src/lib/citationMarkers.test.ts`에 추가(파일 없으면 생성, 상단 `import { FOLDER_CITATION_RE } from './citationMarkers'`):

```ts
import { describe, it, expect } from 'vitest'
import { FOLDER_CITATION_RE } from './citationMarkers'

describe('FOLDER_CITATION_RE', () => {
  it('회의ID 포함 마커를 m/ms/speaker로 파싱한다', () => {
    const re = new RegExp(FOLDER_CITATION_RE.source, 'g')
    const m = re.exec('예산 확정. ⟦m:142/t:125000/s:화자 1⟧')
    expect(m?.[1]).toBe('142')
    expect(m?.[2]).toBe('125000')
    expect(m?.[3]).toBe('화자 1')
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/lib/citationMarkers.test.ts`
Expected: FAIL (`FOLDER_CITATION_RE` export 없음).

- [ ] **Step 3: 정규식 추가**

`frontend/src/lib/citationMarkers.ts` 상단(`CITATION_RE` 옆)에 추가:

```ts
/** cross-meeting 인용 마커 ⟦m:<meetingId>/t:<ms>/s:<speaker>⟧ — 폴더/프로젝트 챗 전용. */
export const FOLDER_CITATION_RE = /⟦m:(\d+)\/t:(\d+)[|/]s:([^⟧]+)⟧/g
```

- [ ] **Step 4: 정규식 테스트 통과**

Run: `cd frontend && npx vitest run src/lib/citationMarkers.test.ts`
Expected: PASS.

- [ ] **Step 5: ChatMarkdown 실패 테스트 (cross-meeting 링크)**

`frontend/src/components/meeting/ChatMarkdown.test.tsx`에 추가:

```tsx
it('회의ID 마커는 onSeekMeeting으로 라우팅되는 배지를 만든다', () => {
  const onSeekMeeting = vi.fn()
  render(<ChatMarkdown content={'결정. ⟦m:142/t:5000/s:화자 1⟧'} onSeekMeeting={onSeekMeeting} />)
  const badge = screen.getByRole('button')
  fireEvent.click(badge)
  expect(onSeekMeeting).toHaveBeenCalledWith(142, 5000)
})
```

(상단 import에 `fireEvent`,`screen`,`render`,`vi` 포함 — 기존 테스트 import 재사용.)

- [ ] **Step 6: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMarkdown.test.tsx`
Expected: FAIL (cross-meeting 미처리).

- [ ] **Step 7: ChatMarkdown 갱신**

`frontend/src/components/meeting/ChatMarkdown.tsx` — import에 `FOLDER_CITATION_RE` 추가하고 `markersToSeekLinks`·`a` 핸들러·시그니처를 확장:

```tsx
import { CITATION_RE, FOLDER_CITATION_RE } from '../../lib/citationMarkers'
```

```tsx
// 마커 → 마크다운 링크. 회의ID 마커(m:)는 cross-meeting 스킴, 일반 마커는 within-meeting 스킴.
function markersToSeekLinks(text: string): string {
  return text
    .replace(new RegExp(FOLDER_CITATION_RE.source, 'g'), (_m, mid, ms, sp) =>
      `[⏱](ddobak-seek-meeting:${mid}:${ms}:${encodeURIComponent(sp)})`)
    .replace(new RegExp(CITATION_RE.source, 'g'), (_m, ms, sp) =>
      `[⏱](ddobak-seek:${ms}:${encodeURIComponent(sp)})`)
}

function urlTransform(url: string): string {
  if (url.startsWith('ddobak-seek:') || url.startsWith('ddobak-seek-meeting:')) return url
  return defaultUrlTransform(url)
}
```

```tsx
export function ChatMarkdown({
  content, onSeek, onSeekMeeting,
}: {
  content: string
  onSeek?: (ms: number) => void
  onSeekMeeting?: (meetingId: number, ms: number) => void
}) {
  const components: Components = {
    ...MAP,
    a: ({ children, href }) => {
      if (href && href.startsWith('ddobak-seek-meeting:')) {
        // ddobak-seek-meeting:<meetingId>:<ms>:<encodedSpeaker>
        const [midStr, msStr, ...spParts] = href.slice('ddobak-seek-meeting:'.length).split(':')
        const meetingId = Number(midStr)
        const ms = Number(msStr)
        const sp = decodeURIComponent(spParts.join(':'))
        return (
          <TimestampBadge
            ms={ms}
            speaker={sp}
            onSeek={() => onSeekMeeting?.(meetingId, ms)}
            isAudioReady={!!onSeekMeeting}
          />
        )
      }
      if (href && href.startsWith('ddobak-seek:')) {
        const withoutScheme = href.slice('ddobak-seek:'.length)
        const colonIdx = withoutScheme.indexOf(':')
        if (colonIdx === -1) return <>{children}</>
        const ms = Number(withoutScheme.slice(0, colonIdx))
        const sp = decodeURIComponent(withoutScheme.slice(colonIdx + 1))
        return <TimestampBadge ms={ms} speaker={sp} onSeek={onSeek ?? (() => {})} isAudioReady={!!onSeek} />
      }
      return (
        <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{children}</a>
      )
    },
  }
  return (
    <div className="text-sm leading-relaxed break-words space-y-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {markersToSeekLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
```

> `TimestampBadge`가 `role="button"`이 아니면 테스트 셀렉터를 실제 렌더(예: `getByText('⏱')` 또는 title)로 맞춘다 — `TimestampBadge` 구현을 먼저 읽고 셀렉터 정합.

- [ ] **Step 8: 테스트 실행 → 통과**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMarkdown.test.tsx src/lib/citationMarkers.test.ts`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/lib/citationMarkers.ts frontend/src/lib/citationMarkers.test.ts frontend/src/components/meeting/ChatMarkdown.tsx frontend/src/components/meeting/ChatMarkdown.test.tsx
git commit -m "feat(chat): cross-meeting 인용 마커(⟦m:..⟧) → onSeekMeeting 라우팅"
```

---

## Task 9: FE 데이터 계층 — api/chat·chatStore·channels scope 일반화

**Files:**
- Modify: `frontend/src/api/chat.ts`, `frontend/src/stores/chatStore.ts`, `frontend/src/channels/chat.ts`
- Test: `frontend/src/stores/chatStore.test.ts` (없으면 생성)

- [ ] **Step 1: api/chat.ts — scope 헬퍼 추가**

`frontend/src/api/chat.ts` 하단에 추가(기존 meeting 함수 유지):

```ts
export type ChatScopeType = 'meeting' | 'folder' | 'project'

function scopePath(scopeType: ChatScopeType, scopeId: number): string {
  if (scopeType === 'folder') return `folders/${scopeId}/chat_messages`
  if (scopeType === 'project') return `projects/${scopeId}/chat_messages`
  return `meetings/${scopeId}/chat_messages`
}

export async function getScopedChatMessages(scopeType: ChatScopeType, scopeId: number): Promise<ChatMessage[]> {
  return apiClient.get(scopePath(scopeType, scopeId)).json()
}

export async function sendScopedChatMessage(
  scopeType: ChatScopeType, scopeId: number, content: string,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  return apiClient.post(scopePath(scopeType, scopeId), { json: { content } }).json()
}
```

- [ ] **Step 2: chatStore.ts — scope 키 일반화**

`frontend/src/stores/chatStore.ts`:

```ts
import { create } from 'zustand'
import { getScopedChatMessages, sendScopedChatMessage, type ChatMessage, type ChatScopeType } from '../api/chat'

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  load: (scopeType: ChatScopeType, scopeId: number) => Promise<void>
  send: (scopeType: ChatScopeType, scopeId: number, content: string) => Promise<void>
  applyUpdate: (msg: ChatMessage) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  loading: false,
  load: async (scopeType, scopeId) => {
    set({ loading: true })
    try {
      set({ messages: await getScopedChatMessages(scopeType, scopeId) })
    } finally {
      set({ loading: false })
    }
  },
  send: async (scopeType, scopeId, content) => {
    const res = await sendScopedChatMessage(scopeType, scopeId, content)
    set((s) => ({ messages: [...s.messages, res.user_message, res.assistant_message] }))
  },
  applyUpdate: (msg) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) })),
  reset: () => set({ messages: [], loading: false }),
}))
```

- [ ] **Step 3: channels/chat.ts — scope 구독**

`frontend/src/channels/chat.ts`:

```ts
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { useChatStore } from '../stores/chatStore'
import type { ChatMessage, ChatScopeType } from '../api/chat'

type ChatMessageUpdate = { type: string } & ChatMessage

export function subscribeChat(scopeType: ChatScopeType, scopeId: number): () => void {
  const consumer = createAuthenticatedConsumer()
  const channelParams =
    scopeType === 'meeting'
      ? { channel: 'ChatChannel', meeting_id: scopeId }
      : { channel: 'ChatChannel', scope_type: scopeType, scope_id: scopeId }
  const sub = consumer.subscriptions.create(channelParams, {
    received(data: ChatMessageUpdate) {
      if (data.type === 'chat_message_update') {
        useChatStore.getState().applyUpdate(data)
      }
    },
  })
  return () => {
    sub.unsubscribe()
    consumer.disconnect()
  }
}
```

- [ ] **Step 4: store 동작 테스트**

`frontend/src/stores/chatStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStore } from './chatStore'
import * as api from '../api/chat'

describe('chatStore scope', () => {
  beforeEach(() => useChatStore.getState().reset())

  it('load는 scope로 메시지를 가져온다', async () => {
    vi.spyOn(api, 'getScopedChatMessages').mockResolvedValue([
      { id: 1, role: 'user', content: 'q', status: 'complete', created_at: '' },
    ])
    await useChatStore.getState().load('folder', 7)
    expect(api.getScopedChatMessages).toHaveBeenCalledWith('folder', 7)
    expect(useChatStore.getState().messages).toHaveLength(1)
  })
})
```

- [ ] **Step 5: 테스트 실행 → 통과**

Run: `cd frontend && npx vitest run src/stores/chatStore.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋** (호출부는 Task 10에서 갱신 — 이 시점엔 타입 에러가 있을 수 있으니 빌드는 Task 10 후 검증)

```bash
git add frontend/src/api/chat.ts frontend/src/stores/chatStore.ts frontend/src/channels/chat.ts frontend/src/stores/chatStore.test.ts
git commit -m "feat(chat): FE 데이터계층 scope(meeting|folder|project) 일반화"
```

---

## Task 10: AiChatPanel scope화 + meeting 호출부 갱신

**Files:**
- Modify: `frontend/src/components/meeting/AiChatPanel.tsx`, `RightTabsPanel.tsx`, `frontend/src/hooks/useLiveMobileTabs.tsx`
- Test: `frontend/src/components/meeting/AiChatPanel.test.tsx`

- [ ] **Step 1: AiChatPanel 시그니처 scope화**

`frontend/src/components/meeting/AiChatPanel.tsx` 상단·본문:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { subscribeChat } from '../../channels/chat'
import { ChatMarkdown } from './ChatMarkdown'
import type { ChatScopeType } from '../../api/chat'

export function AiChatPanel({
  scopeType = 'meeting', scopeId, onSeek, onSeekMeeting, emptyHint,
}: {
  scopeType?: ChatScopeType
  scopeId: number
  onSeek?: (ms: number) => void
  onSeekMeeting?: (meetingId: number, ms: number) => void
  emptyHint?: string
}) {
  const { load, send } = useChatStore()
  const messages = useChatStore((s) => s.messages) ?? []
  const hasPending = messages.some((m) => m.status === 'pending')
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    load(scopeType, scopeId)
    const unsub = subscribeChat(scopeType, scopeId)
    return unsub
  }, [scopeType, scopeId, load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const submit = () => {
    const q = draft.trim()
    if (!q) return
    setDraft('')
    void send(scopeType, scopeId, q)
  }
  // ...(이하 렌더는 기존 유지. ChatMarkdown 사용처에 onSeekMeeting 전달, 빈 안내문은 emptyHint ?? 기존 문구)
```

기존 본문에서 `<ChatMarkdown content={m.content} onSeek={onSeek} />` → `onSeekMeeting={onSeekMeeting}` 추가. 빈 메시지 안내 `<p>이 회의 내용에 대해 무엇이든 물어보세요.</p>` → `{emptyHint ?? '이 회의 내용에 대해 무엇이든 물어보세요.'}`.

- [ ] **Step 2: meeting 호출부 갱신 (전수 grep)**

Run: `cd frontend && grep -rn "AiChatPanel" src --include="*.tsx" | grep -v test`
각 사용처에서 `meetingId={X}` → `scopeId={X}`(scopeType 생략 = 'meeting' 기본). 확인 대상:
- `src/components/meeting/RightTabsPanel.tsx`: `<AiChatPanel meetingId={meetingId} onSeek={onSeek} />` → `<AiChatPanel scopeId={meetingId} onSeek={onSeek} />`
- `src/components/meeting/meetingDetailTabs.tsx`: 동일 패턴 갱신
- `src/hooks/useLiveMobileTabs.tsx`: 동일 패턴 갱신

- [ ] **Step 3: AiChatPanel 테스트 갱신**

`frontend/src/components/meeting/AiChatPanel.test.tsx`의 props를 `scopeId`(필요시 `scopeType`)로 교체하고, store load/subscribe 모킹이 `('meeting', id)`로 호출되는지 확인하도록 수정.

- [ ] **Step 4: 타입·빌드 전수 검증** (feedback_full_compile_verify)

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 타입 에러 0, 빌드 성공. (incremental tsc 과신 금지 — build까지 확인.)

- [ ] **Step 5: 관련 FE 테스트**

Run: `cd frontend && npx vitest run src/components/meeting/AiChatPanel.test.tsx src/components/meeting`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/meeting/AiChatPanel.tsx frontend/src/components/meeting/RightTabsPanel.tsx frontend/src/components/meeting/meetingDetailTabs.tsx frontend/src/hooks/useLiveMobileTabs.tsx frontend/src/components/meeting/AiChatPanel.test.tsx
git commit -m "refactor(chat): AiChatPanel scope prop 일반화 + meeting 호출부 갱신"
```

---

## Task 11: FolderChatDrawer — 우측 슬라이드오버 + 스코프 셀렉터

**Files:**
- Create: `frontend/src/components/folder/FolderChatDrawer.tsx`
- Test: `frontend/src/components/folder/FolderChatDrawer.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/components/folder/FolderChatDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FolderChatDrawer } from './FolderChatDrawer'

vi.mock('../meeting/AiChatPanel', () => ({
  AiChatPanel: ({ scopeType, scopeId }: { scopeType: string; scopeId: number }) => (
    <div data-testid="panel">{scopeType}:{scopeId}</div>
  ),
}))

describe('FolderChatDrawer', () => {
  const base = { open: true, onClose: vi.fn(), folderId: 7, projectId: 3 }

  it('열리면 폴더 scope로 패널을 렌더한다', () => {
    render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    expect(screen.getByTestId('panel').textContent).toBe('folder:7')
  })

  it('스코프를 프로젝트 전체로 토글한다', () => {
    render(<MemoryRouter><FolderChatDrawer {...base} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /프로젝트 전체/ }))
    expect(screen.getByTestId('panel').textContent).toBe('project:3')
  })

  it('open=false면 렌더하지 않는다', () => {
    render(<MemoryRouter><FolderChatDrawer {...base} open={false} /></MemoryRouter>)
    expect(screen.queryByTestId('panel')).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/components/folder/FolderChatDrawer.test.tsx`
Expected: FAIL (컴포넌트 없음).

- [ ] **Step 3: 컴포넌트 구현**

`frontend/src/components/folder/FolderChatDrawer.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { AiChatPanel } from '../meeting/AiChatPanel'
import type { ChatScopeType } from '../../api/chat'

// 우측 슬라이드오버 폴더/프로젝트 챗. 스코프 셀렉터로 '이 폴더' ↔ '프로젝트 전체' 전환.
export function FolderChatDrawer({
  open, onClose, folderId, projectId, folderName,
}: {
  open: boolean
  onClose: () => void
  folderId?: number | null
  projectId?: number | null
  folderName?: string
}) {
  const navigate = useNavigate()
  const [scope, setScope] = useState<'folder' | 'project'>(folderId ? 'folder' : 'project')

  if (!open) return null

  const scopeType: ChatScopeType = scope
  const scopeId = scope === 'folder' ? folderId : projectId
  if (!scopeId) return null

  // cross-meeting 인용 클릭 → 해당 회의 페이지로 이동(+seek 파라미터). 자동 seek는 Task 12.
  const onSeekMeeting = (meetingId: number, ms: number) => {
    navigate(`/meetings/${meetingId}?t=${ms}`)
    onClose()
  }

  const tabBtn = (val: 'folder' | 'project', label: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setScope(val)}
      className={`px-2 py-1 text-xs rounded ${scope === val ? 'bg-blue-600 text-white' : 'text-gray-600'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-1">
            {tabBtn('folder', folderName ? `이 폴더: ${folderName}` : '이 폴더', !folderId)}
            {tabBtn('project', '프로젝트 전체', !projectId)}
          </div>
          <button type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0">
          <AiChatPanel
            key={`${scopeType}:${scopeId}`}
            scopeType={scopeType}
            scopeId={scopeId}
            onSeekMeeting={onSeekMeeting}
            emptyHint={scope === 'folder' ? '이 폴더의 회의들에 대해 물어보세요.' : '이 프로젝트의 회의들에 대해 물어보세요.'}
          />
        </div>
      </div>
    </div>
  )
}
```

> `key`로 scope 전환 시 AiChatPanel을 리마운트해 store load/subscribe가 새 scope로 재실행되게 한다. 라우트 `/meetings/:id`는 실제 회의 상세 경로로 맞춘다(라우터 정의 확인 — `MeetingPage`/`MeetingViewerPage` 경로).

- [ ] **Step 4: 테스트 실행 → 통과**

Run: `cd frontend && npx vitest run src/components/folder/FolderChatDrawer.test.tsx`
Expected: PASS (3 examples).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/folder/FolderChatDrawer.tsx frontend/src/components/folder/FolderChatDrawer.test.tsx
git commit -m "feat(chat): FolderChatDrawer 우측 슬라이드오버 + 스코프 셀렉터"
```

---

## Task 12: 진입점 — MeetingsPage "폴더에게 묻기" 버튼 + 인용 도착 seek

**Files:**
- Modify: `frontend/src/pages/MeetingsPage.tsx`, `frontend/src/components/meeting/MeetingsHeader.tsx`
- Modify(자동 seek): 회의 상세 페이지(`frontend/src/pages/MeetingPage.tsx` 또는 라우트가 가리키는 페이지)

- [ ] **Step 1: MeetingsHeader에 버튼 prop 추가**

`frontend/src/components/meeting/MeetingsHeader.tsx`를 읽고, 우측 액션 영역에 "폴더에게 묻기" 버튼을 추가한다. props에 `onAskFolder?: () => void`, `canAsk?: boolean` 추가:

```tsx
import { MessagesSquare } from 'lucide-react'
// ...props 타입에 추가: onAskFolder?: () => void; canAsk?: boolean
{canAsk && (
  <button
    type="button"
    onClick={onAskFolder}
    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
  >
    <MessagesSquare size={16} /> 폴더에게 묻기
  </button>
)}
```

(헤더의 기존 버튼 그룹 컨테이너 안에 배치 — 실제 JSX 위치는 파일 구조에 맞춘다.)

- [ ] **Step 2: MeetingsPage에 드로어 상태 + 연결**

`frontend/src/pages/MeetingsPage.tsx`:
- import 추가: `import { FolderChatDrawer } from '../components/folder/FolderChatDrawer'`
- 상태 추가: `const [askOpen, setAskOpen] = useState(false)`
- `selectedFolderId`(useFolderStore, 이미 구조분해됨)와 `currentProjectId`(useProjectStore, 이미 있음) 사용.
- `MeetingsHeader`에 prop 전달: `onAskFolder={() => setAskOpen(true)}` `canAsk={!!(selectedFolderId || currentProjectId)}`
- 렌더 말미(최상위 fragment 끝)에 드로어 추가:

```tsx
<FolderChatDrawer
  open={askOpen}
  onClose={() => setAskOpen(false)}
  folderId={selectedFolderId}
  projectId={currentProjectId}
  folderName={folders.find((f) => f.id === selectedFolderId)?.name}
/>
```

(`folders`는 이미 useFolderStore에서 구조분해됨. `FolderNode`에 `name`이 있는지 확인 후 사용, 없으면 `folderName` 생략.)

- [ ] **Step 3: 빌드·타입 검증**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 성공. 수동: 폴더 선택 → "폴더에게 묻기" 표시, 클릭 → 드로어 오픈.

- [ ] **Step 4: 인용 도착 자동 seek (회의 상세)**

회의 상세 페이지를 읽고(`grep -rn "RightTabsPanel\|onSeek" src/pages`로 onSeek 핸들러 보유 페이지 특정), URL `?t=<ms>` 파라미터를 읽어 오디오 준비 시 기존 seek 함수를 호출한다:

```tsx
import { useSearchParams } from 'react-router-dom'
// 컴포넌트 내부, 기존 seek 함수(예: handleSeek / player.seek)와 audioReady 상태가 있다고 가정:
const [searchParams] = useSearchParams()
useEffect(() => {
  const t = Number(searchParams.get('t'))
  if (t > 0 && audioReady) handleSeek(t) // 실제 seek 함수명/준비 플래그에 맞춘다
}, [searchParams, audioReady])
```

> 페이지의 실제 seek 핸들러·오디오 준비 신호 이름에 맞춰 연결한다. 핸들러를 못 찾으면 이 스텝은 "이동까지"로 축소하고 자동 seek는 후속 이슈로 로그(log.md)에 남긴다 — 침묵 누락 금지.

- [ ] **Step 5: 빌드 재검증 + 커밋**

Run: `cd frontend && npx tsc --noEmit && npm run build`

```bash
git add frontend/src/pages/MeetingsPage.tsx frontend/src/components/meeting/MeetingsHeader.tsx frontend/src/pages/MeetingPage.tsx
git commit -m "feat(chat): MeetingsPage 폴더에게 묻기 진입점 + 인용 도착 자동 seek"
```

---

## Task 13: 통합 검증 (전체 회귀 + E2E)

**Files:** 없음(검증 전용)

- [ ] **Step 1: 백엔드 전체 회귀**

Run: `cd backend && bundle exec rspec`
Expected: 0 failures.

- [ ] **Step 2: 프론트 전체 테스트 + 빌드**

Run: `cd frontend && npx vitest run && npm run build`
Expected: 0 failures, 빌드 성공.

- [ ] **Step 3: 수동 E2E (웹, dev 서버)**

`dev.sh`로 기동(LAN 노출, `feedback_dev_lan_access`). 시나리오:
1. 폴더 선택 → "폴더에게 묻기" → 드로어 오픈.
2. 질문 입력 → 답변 + 출처 회의 마커 표시(스트리밍 아님, 잠시 후 갱신).
3. 출처 마커 클릭 → 해당 회의로 이동(+가능하면 시각 점프).
4. 스코프 "프로젝트 전체" 토글 → 다른 폴더 회의도 근거에 포함.
5. 공유 안 된 타인 회의가 답변 근거에 절대 안 나오는지 확인(인가).
6. 예상질문 3개 클릭 → 자동 이어 질문.

- [ ] **Step 4: 결과 기록 + 마무리**

검증 결과를 메모리(`project_folder_chat_investigation`)에 갱신. 미해결(자동 seek 미연결 등) 있으면 명시. `superpowers:finishing-a-development-branch`로 머지/PR 결정.

---

## Self-Review (작성자 체크 — 완료)

- **스펙 커버리지**: 스코프(폴더 재귀/프로젝트) T4·T6, 인가 T4·T6·T7, 키워드추출 T3, retrieval/예산 T4, 인용(회의ID) T2·T8·T11·T12, 드로어/진입점 T11·T12, 마이그 가드 T1, 채널 T7, 토크나이저(unicode61 재사용) — FTS 쿼리 T4(별도 마이그 없음, §12 부합). ✔ 누락 없음.
- **플레이스홀더**: 코드 스텝 전부 실제 코드. T8의 `TimestampBadge` 셀렉터, T12의 seek 핸들러명은 "파일 읽고 정합" 지시 + 폴백 명시(침묵 누락 금지) — 의도적 컨텍스트 의존, placeholder 아님.
- **타입 일관성**: `ChatScopeType`(api/chat) → store/channel/panel/drawer 전부 동일. `scope_type`/`scope_id`(BE) ↔ FTS·잡·컨트롤러·채널 일치. broadcast 채널명 `chat_#{type}_#{id}_#{user}` 잡·채널·잡스펙 동일. 마커 `⟦m:/t:/s:⟧`(BE 프롬프트) ↔ `FOLDER_CITATION_RE`(FE) ↔ `ddobak-seek-meeting:` 스킴 일치.
