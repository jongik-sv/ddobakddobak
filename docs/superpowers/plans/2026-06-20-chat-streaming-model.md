# AI 챗 스트리밍 + 모델명 + 챗 모델 독립 설정 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 챗 답변을 실시간 스트리밍으로 출력하고, 답변 LLM 모델명을 표시하며, 회의록 작성 모델과 AI 챗 모델을 완전 분리(로컬 Ollama/LM Studio 포함)한다.

**Architecture:** 기존 ActionCable `ChatChannel` 재사용. `LlmService#answer_question`에 블록 형태 스트리밍 경로 추가(SDK native / CLI stdout 청크), 블록 없으면 현행 동기 유지. Job이 델타를 스로틀 broadcast(status `streaming`), 완료 시 `ChatMarkdown` 포맷·후속질문·model_name 저장. 챗 LLM은 User에 chat 전용 컬럼(provider/api_key/base_url/model)으로 독립.

**Tech Stack:** Rails 8 / RSpec, anthropic 1.28(`messages.stream`), ruby-openai 8.3(`stream:` proc), Open3, React/Zustand/Vitest, ActionCable.

## Global Constraints

- 하위호환 필수: `answer_question` 블록 없는 호출(요약·안건압축·test_connection 등) 전부 현행 동기 경로 유지.
- 기존 status 값(`pending`/`complete`/`error`) 불변, `streaming`만 추가.
- 마이그레이션은 전부 nullable add_column(기존 행 영향 0). 단순 add라 `disable_ddl_transaction!` 불요.
- 친절명/모델명 변환 실패는 절대 raise 금지 → `"AI"` 폴백.
- 로컬 모델 = `provider: "openai"` + `base_url`(Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`), api_key 옵셔널.
- VALID_PROVIDERS는 `anthropic`/`openai` 유지(CLI provider는 설정 UI 비노출).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 디렉토리: 백엔드 명령은 `cd backend`, 프론트는 `cd frontend`. 테스트 green 확인 후 커밋.

---

## 파일 구조

**백엔드 신규**
- `app/services/llm_model_name.rb` — 모델 id → 친절명 순수 변환
- `app/jobs/concerns/chat_streaming.rb` — 스트리밍 콜백·스로틀·broadcast 공통화
- `db/migrate/*_add_model_name_to_chat_messages.rb`
- `db/migrate/*_add_chat_llm_config_to_users.rb`

**백엔드 수정**
- `app/services/llm_service.rb` — `answer_question`/`call_llm_raw`/`run_cli`/`call_anthropic`/`call_openai`에 `&block` 스트리밍, `build_client` openai 키-nil 더미
- `app/models/user.rb` — `effective_chat_llm_config` 재정의 + `chat_llm_configured?`
- `app/jobs/meeting_chat_job.rb`, `app/jobs/folder_chat_job.rb` — ChatStreaming 사용
- `app/controllers/api/v1/chat_messages_controller.rb`, `scoped_chat_messages_controller.rb` — serialize에 model_name
- `app/controllers/api/v1/user/llm_settings_controller.rb` — chat_* params/response/test

**프론트 수정**
- `src/api/chat.ts` — `ChatStatus`에 `streaming`, `ChatMessage.model_name`
- `src/components/meeting/AiChatPanel.tsx` — assistant 헤더(봇+모델명), streaming 평문 렌더
- `src/api/userLlmSettings.ts` — chat_* 타입
- `src/components/settings/UserLlmSettings.tsx` — "AI 챗 모델" 섹션

---

## Phase A — 모델명 기반

### Task 1: LlmModelName 친절명 변환

**Files:**
- Create: `backend/app/services/llm_model_name.rb`
- Test: `backend/spec/services/llm_model_name_spec.rb`

**Interfaces:**
- Produces: `LlmModelName.humanize(model_id) -> String` (nil/blank → `"AI"`)

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/llm_model_name_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe LlmModelName do
  describe ".humanize" do
    it "claude 계열을 친절명으로 변환한다" do
      expect(described_class.humanize("claude-sonnet-4-20250514")).to eq("Claude Sonnet 4")
      expect(described_class.humanize("claude-opus-4-1-20250805")).to eq("Claude Opus 4")
      expect(described_class.humanize("claude-3-5-haiku-20241022")).to eq("Claude Haiku 3")
    end

    it "gpt 계열을 친절명으로 변환한다" do
      expect(described_class.humanize("gpt-4o")).to eq("GPT-4o")
      expect(described_class.humanize("gpt-5")).to eq("GPT-5")
    end

    it "로컬/오픈모델 이름을 prettify 한다" do
      expect(described_class.humanize("llama-3.1-8b-instruct")).to eq("Llama 3.1 8b Instruct")
      expect(described_class.humanize("qwen2.5-7b")).to eq("Qwen2.5 7b")
    end

    it "이미 친절한 CLI 표시명은 그대로 둔다" do
      expect(described_class.humanize("Gemini 3.5 Flash (Medium)")).to eq("Gemini 3.5 Flash (Medium)")
    end

    it "nil/blank 는 AI 로 폴백한다" do
      expect(described_class.humanize(nil)).to eq("AI")
      expect(described_class.humanize("")).to eq("AI")
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_model_name_spec.rb`
Expected: FAIL — `uninitialized constant LlmModelName`

- [ ] **Step 3: 구현**

`backend/app/services/llm_model_name.rb`:
```ruby
# LLM 모델 id 를 사람이 읽기 좋은 표시명으로 변환한다(순수 함수, 절대 raise 안 함).
class LlmModelName
  CLAUDE = /\Aclaude-(?:(\d+)-)?(opus|sonnet|haiku)-?(\d+)?/i
  GPT = /\Agpt-/i

  def self.humanize(model_id)
    s = model_id.to_s.strip
    return "AI" if s.blank?

    # 이미 공백/괄호가 있으면 친절한 표시명(CLI 등)으로 보고 그대로.
    return s if s.match?(/[ ()]/)

    if (m = s.match(CLAUDE))
      ver = m[3].presence || m[1] # claude-sonnet-4 → 4, claude-3-5-haiku → 3
      family = m[2].capitalize
      return ["Claude", family, ver].compact.join(" ").strip
    end

    if s.match?(GPT)
      return "GPT-" + s.sub(GPT, "")
    end

    prettify(s)
  rescue StandardError
    "AI"
  end

  # 끝의 날짜(-YYYYMMDD)·해시 제거, 하이픈→공백, 단어 첫글자 대문자.
  def self.prettify(s)
    s = s.sub(/-\d{8}\z/, "").sub(/-[0-9a-f]{7,}\z/i, "")
    s.split(/[-_]/).map { |w| w =~ /\A\d/ ? w : w.capitalize }.join(" ")
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_model_name_spec.rb`
Expected: PASS (5 examples)

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/services/llm_model_name.rb spec/services/llm_model_name_spec.rb
git commit -m "feat(chat): LlmModelName 친절명 변환(순수함수)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: chat_messages.model_name 컬럼

**Files:**
- Create: `backend/db/migrate/20260620000001_add_model_name_to_chat_messages.rb`
- Modify: `backend/db/schema.rb` (마이그레이션 실행으로 자동)

**Interfaces:**
- Produces: `ChatMessage#model_name` (string, nullable)

- [ ] **Step 1: 마이그레이션 작성**

`backend/db/migrate/20260620000001_add_model_name_to_chat_messages.rb`:
```ruby
class AddModelNameToChatMessages < ActiveRecord::Migration[8.0]
  def change
    add_column :chat_messages, :model_name, :string
  end
end
```

- [ ] **Step 2: 마이그레이션 실행**

Run: `cd backend && bundle exec rails db:migrate`
Expected: `add_column(:chat_messages, :model_name, :string)` 성공, schema.rb 갱신

- [ ] **Step 3: 컬럼 확인**

Run: `cd backend && bundle exec rails runner "puts ChatMessage.column_names.include?('model_name')"`
Expected: `true`

- [ ] **Step 4: 커밋**

```bash
cd backend && git add db/migrate/20260620000001_add_model_name_to_chat_messages.rb db/schema.rb
git commit -m "feat(chat): chat_messages.model_name 컬럼(답변시점 모델 보존)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — LlmService 스트리밍

### Task 3: SDK 스트리밍 (anthropic/openai)

**Files:**
- Modify: `backend/app/services/llm_service.rb`
- Test: `backend/spec/services/llm_service_spec.rb`

**Interfaces:**
- Consumes: `LlmService#answer_question(system, user_content, &block)`
- Produces: 블록 주면 텍스트 델타를 `block.call(delta)`로 방출하며 전체 텍스트 반환. 블록 없으면 현행 동기.

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/llm_service_spec.rb` 끝에 추가:
```ruby
RSpec.describe LlmService, "streaming" do
  # anthropic 스트림 흉내: stream.text 가 델타 enumerable 을 반환.
  let(:fake_stream) do
    Struct.new(:deltas) do
      def text = deltas
    end.new(["안녕", "하세", "요"])
  end

  def svc
    s = LlmService.new(llm_config: { provider: "anthropic", auth_token: "k", model: "claude-sonnet-4-20250514" })
    client = instance_double("Anthropic::Client")
    messages = instance_double("Anthropic::Resources::Messages")
    allow(client).to receive(:messages).and_return(messages)
    allow(messages).to receive(:stream).and_return(fake_stream)
    s.instance_variable_set(:@client, client)
    s
  end

  it "블록을 주면 델타를 순서대로 방출하고 전체를 반환한다" do
    seen = []
    full = svc.answer_question("sys", "user") { |d| seen << d }
    expect(seen).to eq(["안녕", "하세", "요"])
    expect(full).to eq("안녕하세요")
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb -e "streaming"`
Expected: FAIL — `answer_question` 가 블록을 무시(현행은 `call_llm_raw` 동기), `messages.stream` 미호출

- [ ] **Step 3: 구현 — answer_question + call_llm_raw 블록 경로**

`backend/app/services/llm_service.rb`:

`answer_question` 교체:
```ruby
  def answer_question(system_prompt, user_content, &block)
    call_llm_raw(system_prompt, user_content, &block)
  end
```

`call_llm_raw` 의 provider 분기를 블록 인지로 교체(기존 `result = case ...` 부분):
```ruby
  def call_llm_raw(system, user_content, max_tokens: max_output_tokens, &block)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    if (directive = thinking_off_directive)
      system = "#{directive}\n\n#{system}"
    end

    result = case @config[:provider]
    when "openai"
      block ? call_openai_stream(system, user_content, max_tokens, &block) : call_openai(system, user_content, max_tokens)
    when "claude_cli"
      call_claude_cli(system, user_content, &block)
    when "gemini_cli"
      call_gemini_cli(system, user_content, &block)
    when "codex_cli"
      call_codex_cli(system, user_content, &block)
    else
      block ? call_anthropic_stream(system, user_content, max_tokens, &block) : call_anthropic(system, user_content, max_tokens)
    end
```
(이후 t0 로그·return 부분은 현행 유지)

`call_anthropic` 아래에 스트리밍 메서드 추가:
```ruby
  def call_anthropic_stream(system, user_content, max_tokens, &block)
    stream = @client.messages.stream(
      model: @config[:model],
      max_tokens: max_tokens,
      system: system,
      messages: [ { role: "user", content: user_content } ]
    )
    full = +""
    stream.text.each do |delta|
      next if delta.nil? || delta.empty?
      full << delta
      block.call(delta)
    end
    full
  end

  def call_openai_stream(system, user_content, max_tokens, &block)
    full = +""
    @client.chat(parameters: {
      model: @config[:model],
      max_tokens: max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user_content }
      ],
      stream: proc do |chunk, _bytesize|
        delta = chunk.dig("choices", 0, "delta", "content")
        next if delta.nil? || delta.empty?
        full << delta
        block.call(delta)
      end
    })
    full
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb`
Expected: PASS (streaming + 기존 전부)

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/services/llm_service.rb spec/services/llm_service_spec.rb
git commit -m "feat(chat): LlmService SDK 스트리밍(anthropic/openai &block)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: CLI 스트리밍 (run_cli 청크)

**Files:**
- Modify: `backend/app/services/llm_service.rb`
- Test: `backend/spec/services/llm_service_spec.rb`

**Interfaces:**
- Consumes: `run_cli(cmd, stdin_text, &block)`
- Produces: CLI provider도 블록 주면 stdout 청크를 방출하며 전체 반환

- [ ] **Step 1: 실패 테스트 작성**

`spec/services/llm_service_spec.rb` streaming describe 안에 추가:
```ruby
  it "CLI provider 도 stdout 청크를 방출한다" do
    s = LlmService.new(llm_config: { provider: "claude_cli", model: "claude-sonnet-4-20250514" })
    # run_cli 를 청크 스텁: 블록에 두 청크 전달, 전체 반환
    allow(s).to receive(:run_cli) do |_cmd, _stdin, &blk|
      blk&.call("부분1 ")
      blk&.call("부분2")
      "부분1 부분2"
    end
    seen = []
    full = s.answer_question("sys", "user") { |d| seen << d }
    expect(seen).to eq(["부분1 ", "부분2"])
    expect(full).to eq("부분1 부분2")
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb -e "CLI provider"`
Expected: FAIL — `call_claude_cli` 가 블록 미전달

- [ ] **Step 3: 구현 — CLI 메서드 + run_cli 청크 루프**

`call_claude_cli`/`call_gemini_cli`/`call_codex_cli` 시그니처에 `&block` 추가하고 `run_cli(cmd, stdin, &block)` 로 전달. 예:
```ruby
  def call_claude_cli(system, user_content, &block)
    cli = ENV.fetch("CLAUDE_CLI_PATH", "claude")
    ensure_cli!(cli, "Claude Code CLI", "npm install -g @anthropic-ai/claude-code")
    cmd = [ cli, "-p", "--output-format", "text", "--system-prompt", system,
            "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands" ]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    run_cli(cmd, user_content, &block)
  end
```
(`call_gemini_cli`, `call_codex_cli` 도 동일하게 `&block` 추가 후 `run_cli(..., &block)`)

`run_cli` 의 stdout 읽기를 청크 루프로 교체:
```ruby
  def run_cli(cmd, stdin_text, &block)
    require "open3"
    Rails.logger.info "[LlmService] CLI exec: #{cmd.first} (#{stdin_text.length}자 stdin)"

    stdout_str = +""
    stderr_str = nil
    status = nil

    Open3.popen3(*cmd) do |stdin, stdout, stderr, wait_thr|
      stdin.write(stdin_text) unless stdin_text.to_s.empty?
      stdin.close

      if block
        # 스트리밍: stdout 을 청크로 읽어 방출. 타임아웃은 전체 한도로 별도 감시.
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + CLI_TIMEOUT
        begin
          loop do
            chunk = stdout.readpartial(4096)
            stdout_str << chunk
            block.call(chunk)
            if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
              Process.kill("KILL", wait_thr.pid) rescue nil
              raise LlmError, "CLI 응답 시간이 초과되었습니다 (#{CLI_TIMEOUT}초): #{cmd.first}"
            end
          end
        rescue EOFError
          # 정상 종료
        end
        stderr_str = stderr.read.to_s
        status = wait_thr.value
      else
        unless wait_thr.join(CLI_TIMEOUT)
          Process.kill("KILL", wait_thr.pid) rescue nil
          wait_thr.join
          raise LlmError, "CLI 응답 시간이 초과되었습니다 (#{CLI_TIMEOUT}초): #{cmd.first}"
        end
        stdout_str = stdout.read.to_s
        stderr_str = stderr.read.to_s
        status = wait_thr.value
      end
    end

    unless status&.success?
      err = stderr_str.to_s.strip
      raise LlmError, "CLI 오류 (코드 #{status&.exitstatus}): #{err.presence || '원인 불명'}"
    end
    stdout_str.strip
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb`
Expected: PASS (CLI 청크 + 기존)

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/services/llm_service.rb spec/services/llm_service_spec.rb
git commit -m "feat(chat): LlmService CLI 스트리밍(run_cli readpartial 청크)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — Jobs 스트리밍

### Task 5: ChatStreaming concern

**Files:**
- Create: `backend/app/jobs/concerns/chat_streaming.rb`
- Test: `backend/spec/jobs/chat_streaming_spec.rb`

**Interfaces:**
- Produces:
  - `stream_answer(answer, config, system_prompt, user_content, model_name) -> String` (전체 답변, 내부에서 throttled broadcast)
  - `broadcast_chat(answer, model_name:)` — payload 빌드 후 broadcast (토픽은 `broadcast_topic(answer)`)
  - 포함 잡은 `broadcast_topic(answer) -> String` 구현 필요
- Consumes: `LlmService#answer_question(&block)`, `LlmModelName.humanize`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/jobs/chat_streaming_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe ChatStreaming do
  # concern 을 포함한 더미 잡으로 단위 테스트.
  let(:dummy_class) do
    Class.new do
      include ChatStreaming
      attr_reader :topic
      def initialize(topic) = @topic = topic
      def broadcast_topic(_answer) = @topic
    end
  end

  let(:user) { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  let(:answer) { meeting.chat_messages.create!(user: user, role: "assistant", content: "", status: "pending") }

  it "델타를 누적해 throttle 간격마다 broadcast 하고 전체를 반환한다" do
    job = dummy_class.new("topic_x")
    config = { provider: "anthropic", auth_token: "k", model: "claude-sonnet-4-20250514" }

    fake = instance_double(LlmService)
    allow(LlmService).to receive(:new).and_return(fake)
    allow(fake).to receive(:answer_question) do |_sys, _user, &blk|
      ("a" * 200).each_char { |c| blk.call(c) } # 200자 → 글자 임계(80) 두 번 이상 flush
      "a" * 200
    end

    broadcasts = []
    allow(job).to receive(:broadcast_chat) { |a, model_name:| broadcasts << [a.status, model_name] }

    full = job.stream_answer(answer, config, "sys", "q", "Claude Sonnet 4")
    expect(full).to eq("a" * 200)
    expect(broadcasts.size).to be >= 1
    expect(broadcasts.all? { |s, m| s == "streaming" && m == "Claude Sonnet 4" }).to be true
    expect(answer.reload.content).to eq("a" * 200) # 마지막 update_column 까지 반영
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/chat_streaming_spec.rb`
Expected: FAIL — `uninitialized constant ChatStreaming`

- [ ] **Step 3: 구현**

`backend/app/jobs/concerns/chat_streaming.rb`:
```ruby
# 챗 잡 공통 스트리밍: LlmService 델타를 스로틀하며 assistant 메시지에 누적·broadcast.
# 포함 잡은 broadcast_topic(answer) 를 구현해야 한다.
module ChatStreaming
  THROTTLE_MS = 150
  THROTTLE_CHARS = 80

  private

  def stream_answer(answer, config, system_prompt, user_content, model_name)
    buffer = +""
    last_flush = now_ms
    last_len = 0

    full = LlmService.new(llm_config: config).answer_question(system_prompt, user_content) do |delta|
      buffer << delta
      if (now_ms - last_flush) >= THROTTLE_MS || (buffer.length - last_len) >= THROTTLE_CHARS
        answer.update_column(:content, buffer)
        answer.status = "streaming"
        broadcast_chat(answer, model_name: model_name)
        last_flush = now_ms
        last_len = buffer.length
      end
    end
    full.to_s
  end

  def broadcast_chat(answer, model_name:)
    ActionCable.server.broadcast(
      broadcast_topic(answer),
      { type: "chat_message_update", id: answer.id, role: answer.role,
        content: answer.content, status: answer.status,
        suggestions: answer.suggestions, model_name: model_name,
        error_message: answer.error_message, created_at: answer.created_at }
    )
  end

  def now_ms
    Process.clock_gettime(Process::CLOCK_MONOTONIC) * 1000
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/chat_streaming_spec.rb`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/jobs/concerns/chat_streaming.rb spec/jobs/chat_streaming_spec.rb
git commit -m "feat(chat): ChatStreaming concern(스로틀 broadcast 공통화)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: MeetingChatJob / FolderChatJob 스트리밍 적용

**Files:**
- Modify: `backend/app/jobs/meeting_chat_job.rb`, `backend/app/jobs/folder_chat_job.rb`
- Test: `backend/spec/jobs/meeting_chat_job_spec.rb`, `backend/spec/jobs/folder_chat_job_spec.rb`

**Interfaces:**
- Consumes: `ChatStreaming#stream_answer`, `LlmModelName.humanize`, `ChatFollowups#split_followups`

- [ ] **Step 1: 실패 테스트 작성 (MeetingChatJob)**

`backend/spec/jobs/meeting_chat_job_spec.rb` 에 추가(기존 셋업 패턴 따라 user/meeting/messages 생성):
```ruby
  it "스트리밍으로 답변을 누적하고 complete 시 model_name 을 저장한다" do
    fake = instance_double(LlmService)
    allow(LlmService).to receive(:new).and_return(fake)
    allow(fake).to receive(:answer_question) do |_sys, _user, &blk|
      blk.call("답변 ")
      blk.call("내용")
      "답변 내용"
    end
    allow(MeetingChatContext).to receive(:build).and_return({ system_prompt: "s", user_content: "u" })

    described_class.perform_now(assistant.id)
    assistant.reload
    expect(assistant.status).to eq("complete")
    expect(assistant.content).to eq("답변 내용")
    expect(assistant.model_name).to be_present
  end
```
(`assistant` = pending assistant 메시지. 기존 spec 의 let/before 패턴 재사용. creator 의 effective_chat_llm_config 가 present 하도록 user.llm_provider/llm_api_key 설정 or stub)

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/meeting_chat_job_spec.rb`
Expected: FAIL — model_name 미저장 / 스트리밍 미적용

- [ ] **Step 3: 구현 (MeetingChatJob)**

`backend/app/jobs/meeting_chat_job.rb`:
```ruby
class MeetingChatJob < ApplicationJob
  include ChatFollowups
  include ChatStreaming
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

    model_name = LlmModelName.humanize(config[:model])
    raw = stream_answer(answer, config, ctx[:system_prompt], ctx[:user_content], model_name)
    content, suggestions = split_followups(raw)
    answer.update!(content: content, suggestions: suggestions, model_name: model_name, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast_topic(msg)
    "meeting_#{msg.meeting_id}_chat_#{msg.user_id}"
  end

  def broadcast(msg)
    broadcast_chat(msg, model_name: msg.model_name)
  end
end
```

- [ ] **Step 4: 구현 (FolderChatJob)**

`backend/app/jobs/folder_chat_job.rb` 동일 패턴:
```ruby
class FolderChatJob < ApplicationJob
  include ChatFollowups
  include ChatStreaming
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    user = answer.user
    question = ChatMessage.for_scope(answer.scope_type, answer.scope_id).for_user(user)
                          .where(role: "user").where("created_at <= ?", answer.created_at)
                          .order(:created_at).last

    expansion = FolderChatQueryExpansion.expand(question&.content.to_s, user: user)
    ctx = FolderChatContext.build(scope_type: answer.scope_type, scope_id: answer.scope_id, user: user,
                                  keywords: expansion.keywords, expansions: expansion.expansions, query_text: question&.content)

    config = user.effective_chat_llm_config
    raise "LLM이 설정되어 있지 않습니다." if config.blank?

    model_name = LlmModelName.humanize(config[:model])
    raw = stream_answer(answer, config, ctx[:system_prompt], ctx[:user_content], model_name)
    content, suggestions = split_followups(raw)
    answer.update!(content: content, suggestions: suggestions, model_name: model_name, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast_topic(msg)
    "chat_#{msg.scope_type}_#{msg.scope_id}_#{msg.user_id}"
  end

  def broadcast(msg)
    broadcast_chat(msg, model_name: msg.model_name)
  end
end
```

- [ ] **Step 5: 두 잡 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/meeting_chat_job_spec.rb spec/jobs/folder_chat_job_spec.rb`
Expected: PASS

- [ ] **Step 6: 컨트롤러 serialize 에 model_name 추가**

`backend/app/controllers/api/v1/chat_messages_controller.rb` 와 `scoped_chat_messages_controller.rb` 의 `serialize` 둘 다:
```ruby
      def serialize(m)
        { id: m.id, role: m.role, content: m.content, status: m.status,
          suggestions: m.suggestions, model_name: m.model_name,
          error_message: m.error_message, created_at: m.created_at }
      end
```

- [ ] **Step 7: 커밋**

```bash
cd backend && git add app/jobs/meeting_chat_job.rb app/jobs/folder_chat_job.rb \
  app/controllers/api/v1/chat_messages_controller.rb app/controllers/api/v1/scoped_chat_messages_controller.rb \
  spec/jobs/meeting_chat_job_spec.rb spec/jobs/folder_chat_job_spec.rb
git commit -m "feat(chat): 챗 잡 스트리밍 적용 + model_name 저장·직렬화

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase D — 프론트 스트리밍 + 모델명

### Task 7: 프론트 타입 (streaming status, model_name)

**Files:**
- Modify: `frontend/src/api/chat.ts`

**Interfaces:**
- Produces: `ChatStatus = 'pending' | 'streaming' | 'complete' | 'error'`, `ChatMessage.model_name?: string | null`

- [ ] **Step 1: 타입 수정**

`frontend/src/api/chat.ts`:
```ts
export type ChatStatus = 'pending' | 'streaming' | 'complete' | 'error'

export interface ChatMessage {
  id: number
  role: ChatRole
  content: string
  status: ChatStatus
  /** 답변 LLM 친절명(예: "Claude Sonnet 4"). 어시스턴트만. */
  model_name?: string | null
  suggestions?: string[]
  error_message?: string | null
  created_at: string
}
```

- [ ] **Step 2: 타입체크**

Run: `cd frontend && npx tsc --noEmit`
Expected: 신규 에러 0 (사전존재 에러는 main 동일 — 신규만 확인)

- [ ] **Step 3: 커밋**

```bash
cd frontend && git add src/api/chat.ts
git commit -m "feat(chat): ChatMessage streaming status + model_name 타입

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: AiChatPanel 헤더 + streaming 평문 렌더

**Files:**
- Modify: `frontend/src/components/meeting/AiChatPanel.tsx`
- Test: `frontend/src/components/meeting/AiChatPanel.test.tsx`

**Interfaces:**
- Consumes: `ChatMessage.model_name`, `status === 'streaming'`

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/components/meeting/AiChatPanel.test.tsx` 에 추가(기존 렌더 헬퍼/스토어 셋업 패턴 따라):
```tsx
it('assistant 헤더에 모델명을 표시한다', () => {
  // messages 에 complete assistant + model_name 주입 후 렌더
  // (기존 테스트의 store seed 패턴 사용)
  seedMessages([
    { id: 1, role: 'assistant', content: '답변', status: 'complete', model_name: 'Claude Sonnet 4', created_at: 't' },
  ])
  render(<AiChatPanel scopeId={1} />)
  expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument()
})

it('streaming 상태는 평문으로 렌더한다(ChatMarkdown 미사용)', () => {
  seedMessages([
    { id: 2, role: 'assistant', content: '부분 답변', status: 'streaming', created_at: 't' },
  ])
  render(<AiChatPanel scopeId={1} />)
  expect(screen.getByText('부분 답변')).toBeInTheDocument()
})

it('model_name 없으면 AI 로 표시한다', () => {
  seedMessages([
    { id: 3, role: 'assistant', content: '답변', status: 'complete', created_at: 't' },
  ])
  render(<AiChatPanel scopeId={1} />)
  expect(screen.getByText('AI')).toBeInTheDocument()
})
```
(`seedMessages` = 기존 테스트가 store 를 채우는 방식. 기존 파일의 헬퍼명을 그대로 사용하고, 없으면 `useChatStore.setState({ messages: [...] })` 로 대체)

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/AiChatPanel.test.tsx`
Expected: FAIL — 헤더/평문 미구현

- [ ] **Step 3: 구현 — assistant 헤더 + 렌더 분기**

`frontend/src/components/meeting/AiChatPanel.tsx` 의 assistant 메시지 블록 수정. 봇 아이콘 인라인 컴포넌트 추가(파일 상단):
```tsx
function ModelBadge() {
  return (
    <span
      aria-hidden
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-gray-600 text-[11px]"
    >
      🤖
    </span>
  )
}
```

메시지 map 의 assistant 가지에 헤더 추가 + streaming 분기. 기존 버블 `<div>` 바로 위(assistant일 때만):
```tsx
{m.role === 'assistant' && (
  <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
    <ModelBadge />
    <span>{m.model_name ?? 'AI'}</span>
  </div>
)}
```

버블 내부 렌더 분기에 streaming 추가(기존 pending/error/complete 분기 안):
```tsx
{m.status === 'pending' && m.role === 'assistant' ? (
  <span data-testid="chat-typing" className="text-gray-400">…답변 작성 중</span>
) : m.status === 'streaming' && m.role === 'assistant' ? (
  <span className="whitespace-pre-wrap">{m.content}</span>
) : m.status === 'error' ? (
  <span className="text-red-500">답변 실패: {m.error_message}</span>
) : m.role === 'assistant' && m.status === 'complete' ? (
  <ChatMarkdown content={m.content} onSeek={onSeek} onSeekMeeting={onSeekMeeting} />
) : (
  m.content
)}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/components/meeting/AiChatPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd frontend && git add src/components/meeting/AiChatPanel.tsx src/components/meeting/AiChatPanel.test.tsx
git commit -m "feat(chat): AiChatPanel 모델명 헤더 + streaming 평문 렌더

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase E — 챗 모델 독립 설정 (§8)

### Task 9: User chat_llm_* 컬럼

**Files:**
- Create: `backend/db/migrate/20260620000002_add_chat_llm_config_to_users.rb`

**Interfaces:**
- Produces: `User#chat_llm_provider`, `#chat_llm_api_key`, `#chat_llm_base_url` (chat_llm_model 기존)

- [ ] **Step 1: 마이그레이션 작성**

`backend/db/migrate/20260620000002_add_chat_llm_config_to_users.rb`:
```ruby
class AddChatLlmConfigToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :chat_llm_provider, :string
    add_column :users, :chat_llm_api_key, :text
    add_column :users, :chat_llm_base_url, :string
  end
end
```

- [ ] **Step 2: 마이그레이션 실행**

Run: `cd backend && bundle exec rails db:migrate`
Expected: 3 컬럼 추가, schema.rb 갱신

- [ ] **Step 3: 확인**

Run: `cd backend && bundle exec rails runner "puts(%w[chat_llm_provider chat_llm_api_key chat_llm_base_url].all? { |c| User.column_names.include?(c) })"`
Expected: `true`

- [ ] **Step 4: 커밋**

```bash
cd backend && git add db/migrate/20260620000002_add_chat_llm_config_to_users.rb db/schema.rb
git commit -m "feat(chat): users chat_llm_provider/api_key/base_url 컬럼

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: effective_chat_llm_config 재정의

**Files:**
- Modify: `backend/app/models/user.rb`
- Test: `backend/spec/models/user_spec.rb`

**Interfaces:**
- Produces: `User#effective_chat_llm_config` (독립 우선/폴백), `User#chat_llm_configured?`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/models/user_spec.rb` 에 추가:
```ruby
  describe "#effective_chat_llm_config (독립 설정)" do
    let(:user) do
      create(:user, llm_provider: "anthropic", llm_api_key: "sumkey",
                    llm_model: "claude-sonnet-4-20250514", llm_enabled: true)
    end

    it "챗 설정이 없으면 요약 config(+chat_llm_model override)로 폴백한다" do
      user.update!(chat_llm_model: "claude-3-5-haiku-20241022")
      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("anthropic")
      expect(cfg[:auth_token]).to eq("sumkey")
      expect(cfg[:model]).to eq("claude-3-5-haiku-20241022")
    end

    it "chat_llm_provider 가 있으면 독립 config 를 쓴다" do
      user.update!(chat_llm_provider: "openai", chat_llm_api_key: "chatkey",
                   chat_llm_model: "gpt-4o", chat_llm_base_url: "https://api.openai.com/v1")
      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("openai")
      expect(cfg[:auth_token]).to eq("chatkey")
      expect(cfg[:model]).to eq("gpt-4o")
      expect(cfg[:base_url]).to eq("https://api.openai.com/v1")
    end

    it "로컬(키 없음 + base_url)도 인정한다" do
      user.update!(chat_llm_provider: "openai", chat_llm_api_key: nil,
                   chat_llm_model: "llama-3.1-8b", chat_llm_base_url: "http://localhost:11434/v1")
      expect(user.chat_llm_configured?).to be true
      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("openai")
      expect(cfg[:base_url]).to eq("http://localhost:11434/v1")
      expect(cfg[:model]).to eq("llama-3.1-8b")
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/user_spec.rb -e "독립 설정"`
Expected: FAIL — 현행 폴백만 존재, chat_llm_configured? 없음

- [ ] **Step 3: 구현**

`backend/app/models/user.rb` 의 `effective_chat_llm_config` 교체 + 헬퍼 추가:
```ruby
  # AI Chat용 LLM 설정. chat_llm_* 가 설정되면 provider·키·base_url·모델까지 완전 독립.
  # 없으면 요약 config + (chat_llm_model || ENV["CHAT_LLM_MODEL"]) 모델 override(현행 폴백).
  def effective_chat_llm_config
    if chat_llm_configured?
      {
        provider: chat_llm_provider,
        auth_token: chat_llm_api_key,
        model: chat_llm_model,
        base_url: chat_llm_base_url
      }.compact
    else
      cfg = effective_llm_config
      return cfg if cfg.blank?

      chat_model = chat_llm_model.presence || ENV["CHAT_LLM_MODEL"].presence
      chat_model ? cfg.merge(model: chat_model) : cfg
    end
  end

  # 챗 독립 설정 존재 여부. provider 만 있으면 인정(로컬은 base_url 만으로 키 불요).
  def chat_llm_configured?
    chat_llm_provider.present?
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/user_spec.rb`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/models/user.rb spec/models/user_spec.rb
git commit -m "feat(chat): effective_chat_llm_config 완전 독립(요약/챗 분리)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: build_client openai 로컬 키-nil 대응

**Files:**
- Modify: `backend/app/services/llm_service.rb`
- Test: `backend/spec/services/llm_service_spec.rb`

**Interfaces:**
- Consumes: `@config[:auth_token]` nil 가능(로컬)

- [ ] **Step 1: 실패 테스트 작성**

`spec/services/llm_service_spec.rb` 에 추가:
```ruby
  it "openai 로컬(키 없음 + base_url)도 클라이언트를 만든다" do
    svc = LlmService.new(llm_config: { provider: "openai", model: "llama-3.1-8b",
                                       base_url: "http://localhost:11434/v1" })
    expect { svc.send(:build_client) }.not_to raise_error
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb -e "로컬"`
Expected: FAIL 또는 PASS 확인 — ruby-openai 가 nil token 에서 에러나면 FAIL(에러 시 더미 주입 필요)

- [ ] **Step 3: 구현 — openai 분기 키 더미**

`backend/app/services/llm_service.rb` `build_client` 의 openai 가지:
```ruby
    when "openai"
      OpenAI::Client.new(
        access_token: @config[:auth_token].presence || "local",
        uri_base: @config[:base_url].presence,
        request_timeout: ENV.fetch("LLM_REQUEST_TIMEOUT", "600").to_i
      )
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/services/llm_service.rb spec/services/llm_service_spec.rb
git commit -m "feat(chat): openai 로컬 키-nil 더미(Ollama/LM Studio)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: llm_settings_controller chat_* 파라미터

**Files:**
- Modify: `backend/app/controllers/api/v1/user/llm_settings_controller.rb`
- Test: `backend/spec/requests/api/v1/user/llm_settings_spec.rb` (없으면 생성)

**Interfaces:**
- Consumes: `params[:llm_settings][:chat_provider|chat_api_key|chat_base_url|chat_model]`
- Produces: response `llm_settings.chat_*`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/requests/api/v1/user/llm_settings_spec.rb` (기존 있으면 추가, 인증 헬퍼 패턴 따름):
```ruby
require "rails_helper"

RSpec.describe "User LLM settings chat config", type: :request do
  let(:user) { create(:user) }
  before { sign_in_as(user) } # 프로젝트 인증 헬퍼명에 맞춤

  it "챗 독립 설정을 저장하고 응답에 노출한다" do
    put "/api/v1/user/llm_settings", params: {
      llm_settings: {
        provider: "anthropic", api_key: "sumkey", model: "claude-sonnet-4-20250514",
        chat_provider: "openai", chat_api_key: "chatkey",
        chat_model: "gpt-4o", chat_base_url: "http://localhost:11434/v1"
      }
    }, as: :json
    expect(response).to have_http_status(:ok)
    user.reload
    expect(user.chat_llm_provider).to eq("openai")
    expect(user.chat_llm_api_key).to eq("chatkey")
    expect(user.chat_llm_base_url).to eq("http://localhost:11434/v1")
    body = JSON.parse(response.body)
    expect(body.dig("llm_settings", "chat_provider")).to eq("openai")
    expect(body.dig("llm_settings", "chat_api_key_masked")).to be_present
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/llm_settings_spec.rb`
Expected: FAIL — chat_* 미저장/미노출

- [ ] **Step 3: 구현**

`backend/app/controllers/api/v1/user/llm_settings_controller.rb`:

`normalize_params` permit·매핑 확장:
```ruby
        def normalize_params
          p = params.require(:llm_settings).permit(
            :provider, :api_key, :model, :base_url, :chat_llm_model,
            :chat_provider, :chat_api_key, :chat_model, :chat_base_url
          )

          attrs = {
            llm_provider: p[:provider],
            llm_model: p[:model],
            llm_base_url: p[:base_url].presence,
            chat_llm_model: (p[:chat_model].presence || p[:chat_llm_model].presence),
            chat_llm_provider: p[:chat_provider].presence,
            chat_llm_base_url: p[:chat_base_url].presence
          }

          # llm_api_key: 빈문자열=유지, nil=삭제, 값=갱신
          attrs[:llm_api_key] = p[:api_key] if p.key?(:api_key) && p[:api_key] != ""
          # chat_llm_api_key: 동일 규약
          attrs[:chat_llm_api_key] = p[:chat_api_key] if p.key?(:chat_api_key) && p[:chat_api_key] != ""

          attrs
        end
```

`update` 의 초기화 분기에 chat_* nil 추가:
```ruby
          if attrs[:llm_provider].blank?
            current_user.update!(
              llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil,
              chat_llm_model: nil, chat_llm_provider: nil, chat_llm_api_key: nil, chat_llm_base_url: nil,
              llm_enabled: true
            )
            return render json: build_response
          end
```

`build_response` 의 `llm_settings` 해시에 chat_* 추가:
```ruby
              chat_provider: current_user.chat_llm_provider,
              chat_model: current_user.chat_llm_model,
              chat_base_url: current_user.chat_llm_base_url,
              chat_api_key_masked: mask_token(current_user.chat_llm_api_key),
              chat_configured: current_user.chat_llm_configured?,
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/llm_settings_spec.rb`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
cd backend && git add app/controllers/api/v1/user/llm_settings_controller.rb spec/requests/api/v1/user/llm_settings_spec.rb
git commit -m "feat(chat): llm_settings 컨트롤러 챗 독립설정 params/response

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: 설정 UI "AI 챗 모델" 섹션

**Files:**
- Modify: `frontend/src/api/userLlmSettings.ts`, `frontend/src/components/settings/UserLlmSettings.tsx`
- Test: `frontend/src/components/settings/UserLlmSettings.test.tsx`

**Interfaces:**
- Consumes: response `llm_settings.chat_*`, update params `chat_*`

- [ ] **Step 1: API 타입 확장**

`frontend/src/api/userLlmSettings.ts` 의 `UserLlmSettingsResponse.llm_settings` 에 추가:
```ts
    chat_provider?: string | null
    chat_model?: string | null
    chat_base_url?: string | null
    chat_api_key_masked?: string | null
    chat_configured?: boolean
```
`UserLlmSettingsUpdateParams.llm_settings` 에 추가:
```ts
    chat_provider?: string | null
    chat_api_key?: string
    chat_model?: string | null
    chat_base_url?: string | null
```

- [ ] **Step 2: 실패 테스트 작성**

`frontend/src/components/settings/UserLlmSettings.test.tsx` 에 추가(기존 mock/render 패턴 따름):
```tsx
it('AI 챗 모델 섹션을 표시하고 저장 payload 에 chat_* 를 담는다', async () => {
  renderSettings() // 기존 헬퍼
  // 챗 섹션 토글/입력
  const chatProvider = await screen.findByLabelText(/AI 챗.*제공자|챗 제공자/i)
  fireEvent.change(chatProvider, { target: { value: 'openai' } })
  const chatBase = screen.getByLabelText(/챗.*base ?url|챗 엔드포인트/i)
  fireEvent.change(chatBase, { target: { value: 'http://localhost:11434/v1' } })
  fireEvent.click(screen.getByRole('button', { name: /저장/ }))
  await waitFor(() => {
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_settings: expect.objectContaining({ chat_provider: 'openai', chat_base_url: 'http://localhost:11434/v1' }),
      }),
    )
  })
})
```
(`renderSettings`/`updateSpy` = 기존 테스트 헬퍼·mock 명에 맞춤)

- [ ] **Step 3: 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/UserLlmSettings.test.tsx`
Expected: FAIL — 챗 섹션 없음

- [ ] **Step 4: 구현 — 챗 섹션**

`frontend/src/components/settings/UserLlmSettings.tsx`:
- 상태 추가: `chatProvider`, `chatApiKey`, `chatModel`, `chatBaseUrl` (기존 provider/apiKey/model/baseUrl state 패턴 따라 useState + 초기값 = response chat_*).
- 기존 LLM 폼 아래에 섹션 추가(요약 설정 카드 뒤):
```tsx
<section className="mt-6 border-t border-gray-200 pt-4">
  <h3 className="text-sm font-semibold text-gray-800">AI 챗 모델 (선택)</h3>
  <p className="mb-2 text-xs text-gray-500">비워두면 회의록 작성 모델과 동일하게 사용합니다. 로컬(Ollama/LM Studio)은 제공자=openai + 엔드포인트만 입력(키 선택).</p>

  <label className="block text-xs text-gray-600" htmlFor="chat-provider">챗 제공자</label>
  <select id="chat-provider" value={chatProvider} onChange={(e) => setChatProvider(e.target.value)}
          className="mb-2 w-full rounded border px-2 py-1 text-sm">
    <option value="">요약 모델과 동일</option>
    <option value="anthropic">anthropic</option>
    <option value="openai">openai (로컬 포함)</option>
  </select>

  <label className="block text-xs text-gray-600" htmlFor="chat-base">챗 엔드포인트 (base URL)</label>
  <input id="chat-base" value={chatBaseUrl} onChange={(e) => setChatBaseUrl(e.target.value)}
         placeholder="http://localhost:11434/v1 (Ollama)" className="mb-2 w-full rounded border px-2 py-1 text-sm" />

  <label className="block text-xs text-gray-600" htmlFor="chat-key">챗 API 키 (로컬이면 선택)</label>
  <input id="chat-key" type="password" value={chatApiKey} onChange={(e) => setChatApiKey(e.target.value)}
         placeholder={settings.chat_api_key_masked ?? ''} className="mb-2 w-full rounded border px-2 py-1 text-sm" />

  <label className="block text-xs text-gray-600" htmlFor="chat-model">챗 모델</label>
  <input id="chat-model" value={chatModel} onChange={(e) => setChatModel(e.target.value)}
         placeholder="예: gpt-4o / llama-3.1-8b" className="w-full rounded border px-2 py-1 text-sm" />
</section>
```
- 저장 핸들러의 update payload 에 chat_* 포함:
```tsx
  chat_provider: chatProvider || null,
  chat_base_url: chatBaseUrl || null,
  chat_model: chatModel || null,
  chat_api_key: chatApiKey, // 빈문자열=유지 규약
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run src/components/settings/UserLlmSettings.test.tsx`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd frontend && git add src/api/userLlmSettings.ts src/components/settings/UserLlmSettings.tsx src/components/settings/UserLlmSettings.test.tsx
git commit -m "feat(chat): 설정 UI 'AI 챗 모델' 독립 섹션(로컬 base_url)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 최종 검증 (머지 전)

- [ ] **백엔드 풀 스위트**: `cd backend && bundle exec rspec` — 전부 green (회귀 0)
- [ ] **프론트 풀 스위트**: `cd frontend && npx vitest run` — 전부 green
- [ ] **프론트 빌드**: `cd frontend && npx tsc --noEmit` — 신규 에러 0 (사전존재 에러는 main 대비 동일)
- [ ] **수동 E2E**(dev 재시작 후): ① 회의 AI 챗 질문 → 답변이 토큰 단위로 흘러나옴 + 헤더에 모델명 ② 설정에서 챗 provider=openai+로컬 base_url 저장 → 챗이 로컬 모델로 응답, 헤더에 로컬 모델명 ③ 폴더/프로젝트 챗 동일
- [ ] sidecar/Rails dev 재시작 필요(새 concern·autoload·마이그레이션). [[reference_zeitwerk_new_concern_restart]]·[[feedback_rails_pending_migration_trap]] 유의

---

## Self-Review 결과

- **Spec 커버리지**: §1 모델명(T1,T2,T6,T8) · §2 스트리밍(T3,T4,T5,T6,T7,T8) · §3/§8 독립설정(T9,T10,T11,T12,T13) — 전 섹션 매핑됨.
- **Placeholder**: 없음. 모든 코드 블록 실제 내용.
- **타입 일관성**: `stream_answer`/`broadcast_chat`/`broadcast_topic`(T5↔T6), `chat_llm_configured?`(T10↔T12), `model_name`(T2↔T6↔T7↔T8) 시그니처 일치.
- **주의(실행자)**: 기존 spec 의 인증 헬퍼명(`sign_in_as` 등)·프론트 테스트 헬퍼명(`seedMessages`/`renderSettings`/`updateSpy`)은 **실제 파일 컨벤션으로 치환**할 것. 없으면 직접 store/mock 셋업.
