# LLM 기반 회의 요약 서비스.
#
# Sidecar(Python)의 summarizer.py를 Rails로 이전한 것.
# Anthropic/OpenAI API를 직접 호출하거나, 로컬 CLI(claude/agy/codex) 를 실행하여
# 회의록 요약, 정제, Action Item 추출을 수행한다.
class LlmService
  include LlmPrompts

  class LlmError < StandardError; end

  CLI_TIMEOUT = ENV.fetch("LLM_CLI_TIMEOUT", "360").to_i # seconds — Claude/Gemini/Codex/GLM CLI 실행 제한

  CLI_PROVIDERS = %w[claude_cli gemini_cli codex_cli].freeze

  # @param llm_config [Hash, nil] 사용자별 LLM 설정 override
  #   { provider:, auth_token:, model:, base_url: }
  def initialize(llm_config: nil)
    @config = resolve_config(llm_config)
    @client = build_client
  end

  # 회의록 정제: 기존 노트 + 새 자막 → 통합 회의록.
  # chronological: 증분(흐름) 회의의 통짜 생성 시 주제별 재구성 대신 시간순 요약 지시.
  def refine_notes(current_notes, transcripts, meeting_title: "", meeting_type: "general", sections_prompt: nil, attendees: nil, verbosity: "standard", verbosity_context: :final, chronological: false, seeded_merge: false)
    transcript_text = format_transcripts(transcripts)
    return { "notes_markdown" => current_notes, "ok" => true } if transcript_text.blank?

    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    if current_notes.present?
      parts << "현재 회의록:\n#{current_notes}"
    else
      parts << "현재 회의록: (아직 없음 — 새로 작성해주세요)"
    end
    parts << "새로운 자막:\n#{transcript_text}"
    user_content = parts.join("\n\n")

    estimated_tokens = current_notes.length + transcript_text.length + 2048
    max_tokens = [ 4096, [ estimated_tokens, max_output_tokens ].min ].max

    system_prompt = if sections_prompt.present?
      REFINE_NOTES_SYSTEM_PROMPT.sub(DEFAULT_SECTION_STRUCTURE, sections_prompt)
    else
      REFINE_NOTES_SYSTEM_PROMPT
    end
    system_prompt = system_prompt + CHRONOLOGICAL_NOTES_INSTRUCTION if chronological
    system_prompt = apply_verbosity(system_prompt, verbosity, context: verbosity_context)
    # 이전 회의 통합+논의 절취선 지시는 분량 한도보다 우선해야 하므로 verbosity 뒤(맨 끝)에 붙인다.
    system_prompt = system_prompt + seeded_merge_instruction if seeded_merge

    result = call_llm_raw(system_prompt, user_content, max_tokens: max_tokens)
    notes = fix_mermaid_quotes(strip_markdown_fence(result))
    { "notes_markdown" => notes, "ok" => true }
  rescue => e
    Rails.logger.error "[LlmService] refine_notes failed: #{e.message}"
    # ok:false → 호출부가 transcript 미소비·미저장(무음 손실 차단, D8 anchor-C1)
    { "notes_markdown" => current_notes, "ok" => false }
  end

  # 증분(append-only) 모드: 새 자막만 시간대별 새 블록 하나로 요약. 기존 회의록 불변.
  # 시간 헤딩은 호출부(job)가 붙인다. 출력이 새 블록뿐이라 작음 → 틱 빠름.
  # 반환: { "block_markdown" =>, "ok" => }. ok:false 면 호출부가 transcript 미소비(무음 손실 차단).
  def append_notes(current_notes, transcripts, meeting_title: "", attendees: nil, verbosity: "standard")
    transcript_text = format_transcripts(transcripts)
    return { "block_markdown" => "", "ok" => true } if transcript_text.blank?

    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    parts << "기존 회의록(참고용 — 수정·반복 금지):\n#{current_notes}" if current_notes.present?
    parts << "새로운 자막:\n#{transcript_text}"
    user_content = parts.join("\n\n")

    system_prompt = apply_verbosity(APPEND_NOTES_SYSTEM_PROMPT, verbosity, context: :append)

    raw = call_llm_raw(system_prompt, user_content, max_tokens: max_output_tokens)
    block = fix_mermaid_quotes(strip_markdown_fence(raw))
    { "block_markdown" => block, "ok" => true }
  rescue => e
    Rails.logger.error "[LlmService] append_notes failed: #{e.message}"
    { "block_markdown" => "", "ok" => false }
  end

  # 구조화된 요약 (JSON): key_points, decisions, discussion_details, action_items
  def summarize(transcripts, type: "realtime", context: nil)
    transcript_text = format_transcripts(transcripts)
    user_content = "요약 유형: #{type}\n\n회의 트랜스크립트:\n#{transcript_text}"
    user_content += "\n\n이전 요약 컨텍스트:\n#{context}" if context.present?

    data = call_llm_json(SUMMARIZE_SYSTEM_PROMPT, user_content)
    return empty_summary unless data

    {
      "key_points" => data["key_points"] || [],
      "decisions" => data["decisions"] || [],
      "discussion_details" => data["discussion_details"] || [],
      "action_items" => data["action_items"] || []
    }
  rescue => e
    Rails.logger.error "[LlmService] summarize failed: #{e.message}"
    empty_summary
  end

  # Action Item 추출
  def summarize_action_items(transcripts)
    transcript_text = format_transcripts(transcripts)
    user_content = "회의 트랜스크립트:\n#{transcript_text}"

    data = call_llm_json(ACTION_ITEMS_SYSTEM_PROMPT, user_content)
    { "action_items" => data&.dig("action_items") || [] }
  rescue => e
    Rails.logger.error "[LlmService] summarize_action_items failed: #{e.message}"
    { "action_items" => [] }
  end

  # 사용자 피드백 반영
  def apply_feedback(current_notes, feedback, meeting_title: "", attendees: nil)
    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    if current_notes.present?
      parts << "현재 회의록:\n#{current_notes}"
    else
      parts << "현재 회의록: (아직 없음 — 피드백 내용을 바탕으로 새로 작성해주세요)"
    end
    parts << "사용자 피드백:\n#{feedback}"

    result = call_llm_raw(FEEDBACK_NOTES_SYSTEM_PROMPT, parts.join("\n\n"), max_tokens: max_output_tokens)
    { "notes_markdown" => fix_mermaid_quotes(strip_markdown_fence(result)) }
  rescue => e
    Rails.logger.error "[LlmService] apply_feedback failed: #{e.message}"
    { "notes_markdown" => current_notes }
  end

  # 외부 LLM용 프롬프트 조립 (LLM 호출 없음). 압축율 분량 지시 포함(통짜 생성 = final 캡).
  # 증분(restructure=false) 회의는 시간 흐름 요약 지시를 포함 — 주제별 재구성 금지.
  def build_prompt(current_notes, transcripts, meeting_title: "", sections_prompt: nil, attendees: nil, verbosity: "standard", restructure: true)
    system_prompt = if sections_prompt.present?
      REFINE_NOTES_SYSTEM_PROMPT.sub(DEFAULT_SECTION_STRUCTURE, sections_prompt)
    else
      REFINE_NOTES_SYSTEM_PROMPT
    end
    system_prompt = system_prompt + CHRONOLOGICAL_NOTES_INSTRUCTION unless restructure
    system_prompt = apply_verbosity(system_prompt, verbosity, context: :final)

    transcript_text = format_transcripts(transcripts)
    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    parts << (current_notes.present? ? "현재 회의록:\n#{current_notes}" : "현재 회의록: (아직 없음 — 새로 작성해주세요)")
    parts << "새로운 자막:\n#{transcript_text}" if transcript_text.present?
    user_content = parts.join("\n\n")

    {
      "prompt" => "# 회의록 작성 프롬프트\n\n" \
                  "아래 내용을 LLM(ChatGPT, Claude 등)에 그대로 붙여넣으면 회의록이 생성됩니다.\n\n" \
                  "---\n\n## 지시사항\n\n#{system_prompt}\n\n---\n\n## 입력 데이터\n\n#{user_content}"
    }
  end

  # LLM 연결 테스트
  def test_connection
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    call_llm_raw("You are a test.", "Hi", max_tokens: 5)
    elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).to_i
    { "success" => true, "response_time_ms" => elapsed_ms }
  rescue => e
    { "success" => false, "error" => e.message }
  end

  private

  # 압축율(verbosity) 분량 지시를 system 프롬프트 뒤에 append.
  # claude_cli 는 max_tokens 를 무시하므로 프롬프트의 글자수 캡이 출력량(=지연)의 유일한 레버.
  # context: :realtime(틱, 캡 작게) / :final(최종·파일전사, 캡 여유) / :append(증분 블록, 문체만)
  def apply_verbosity(system_prompt, verbosity, context: :final)
    key   = verbosity.to_s
    style = VERBOSITY_STYLES[key]
    limit = context == :append ? nil : VERBOSITY_CHAR_LIMITS.dig(context, key)
    return system_prompt unless VERBOSITY_LABELS.key?(key) && (style || limit)

    lines = [ "", "## 분량 지시 (#{VERBOSITY_LABELS[key]})" ]
    lines << style if style
    if limit
      # REFINE_NOTES 규칙의 "기존 내용 보존"과 충돌할 수 있으므로 우선순위를 명시 —
      # 두 지시가 동시에 만족 불가능해지면 모델 행동이 비결정적이 된다.
      lines << "회의록 전체 분량은 약 #{ActiveSupport::NumberHelper.number_to_delimited(limit)}자 이내로 유지하세요."
      lines << "이 분량 한도는 다른 규칙(기존 내용 보존 포함)보다 우선합니다 — 한도를 넘으면 오래된 세부 내용부터 압축해 요지만 남기세요."
    end
    system_prompt + lines.join("\n") + "\n"
  end

  def resolve_config(llm_config)
    if llm_config.present?
      {
        provider: llm_config[:provider] || llm_config["provider"] || "anthropic",
        auth_token: llm_config[:auth_token] || llm_config["auth_token"],
        model: llm_config[:model] || llm_config["model"],
        base_url: llm_config[:base_url] || llm_config["base_url"],
        max_output_tokens: (llm_config[:max_output_tokens] || llm_config["max_output_tokens"])&.to_i
      }
    else
      server_default_config
    end
  end

  def server_default_config
    provider = ENV.fetch("LLM_PROVIDER", "anthropic")
    {
      provider: provider,
      auth_token: provider == "openai" ? ENV["OPENAI_API_KEY"] : ENV["ANTHROPIC_AUTH_TOKEN"],
      model: ENV.fetch("LLM_MODEL", "claude-sonnet-4-20250514"),
      base_url: provider == "openai" ? ENV["OPENAI_BASE_URL"] : ENV["ANTHROPIC_BASE_URL"],
      max_output_tokens: ENV.fetch("LLM_MAX_OUTPUT_TOKENS", "10000").to_i
    }
  end

  def max_output_tokens
    @config[:max_output_tokens] || 10_000
  end

  def build_client
    case @config[:provider]
    when "openai"
      OpenAI::Client.new(
        access_token: @config[:auth_token],
        uri_base: @config[:base_url].presence,
        request_timeout: ENV.fetch("LLM_REQUEST_TIMEOUT", "600").to_i
      )
    when *CLI_PROVIDERS
      nil # CLI 프로바이더는 SDK 클라이언트 불필요 — 실행 시점에 Open3 로 호출
    else # anthropic (default)
      kwargs = { api_key: @config[:auth_token] }
      kwargs[:base_url] = @config[:base_url] if @config[:base_url].present?
      Anthropic::Client.new(**kwargs)
    end
  end

  # ── LLM 호출 ──

  def call_llm_raw(system, user_content, max_tokens: max_output_tokens)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    # 추론(thinking) 모델은 요약에 불필요 — 비활성 지시 주입(속도·본문 회복)
    if (directive = thinking_off_directive)
      system = "#{directive}\n\n#{system}"
    end

    result = case @config[:provider]
    when "openai"
      call_openai(system, user_content, max_tokens)
    when "claude_cli"
      call_claude_cli(system, user_content)
    when "gemini_cli"
      call_gemini_cli(system, user_content)
    when "codex_cli"
      call_codex_cli(system, user_content)
    else
      call_anthropic(system, user_content, max_tokens)
    end

    result = strip_think(result) # 새는 <think> 블록 제거(안전망)
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0
    Rails.logger.info "[LlmService] #{@config[:provider]}/#{@config[:model]} #{elapsed.round(1)}s | input=#{system.length + user_content.length}자 output=#{result.length}자"
    result
  end

  def call_anthropic(system, user_content, max_tokens)
    response = @client.messages.create(
      model: @config[:model],
      max_tokens: max_tokens,
      system: system,
      messages: [ { role: "user", content: user_content } ]
    )
    response.content.first.text
  end

  def call_openai(system, user_content, max_tokens)
    params = {
      model: @config[:model],
      max_tokens: max_tokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user_content }
      ]
    }
    response = @client.chat(parameters: params)
    response.dig("choices", 0, "message", "content") || ""
  end

  # ── 로컬 CLI 실행 (Claude Code / Gemini / Codex) ──

  def call_claude_cli(system, user_content)
    cli = ENV.fetch("CLAUDE_CLI_PATH", "claude")
    ensure_cli!(cli, "Claude Code CLI", "npm install -g @anthropic-ai/claude-code")
    # 요약은 순수 텍스트 생성 — 툴/플러그인/스킬/MCP/훅 전부 불필요.
    # 끄면 호출마다 ~/.claude(2GB 플러그인 등) 로딩 오버헤드가 사라진다.
    #   --setting-sources ""     : user/project/local 설정 미로드(플러그인·훅·CLAUDE.md skip)
    #   --strict-mcp-config      : --mcp-config 없으므로 MCP 서버 0개
    #   --disable-slash-commands : 스킬(슬래시 명령) 비활성
    # 주의: --bare는 OAuth/keychain을 안 읽어 구독 인증을 깨므로 금지(API키 강제).
    cmd = [ cli, "-p", "--output-format", "text", "--system-prompt", system,
            "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands" ]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    run_cli(cmd, user_content)
  end

  # Gemini CLI는 2026-06-18 종료 → Antigravity CLI(agy)로 대체.
  # agy v1.0.7 비대화형: `agy -p "<prompt>" --model "<표시명>" --dangerously-skip-permissions`
  #   - --model: `agy models` 표시명 그대로 전달 (예: "Gemini 3.5 Flash (Medium)").
  #     미지정/잘못된 값이면 agy 기본값으로 fallback(크래시 없음).
  #   - --dangerously-skip-permissions: 요약 작업은 비대화형이라 툴 권한 프롬프트로 멈추지 않게 함
  # GEMINI_CLI_PATH 도 하위호환으로 인정. provider 이름은 gemini_cli 유지.
  def call_gemini_cli(system, user_content)
    cli = ENV["AGY_CLI_PATH"].presence || ENV.fetch("GEMINI_CLI_PATH", "agy")
    ensure_cli!(cli, "Antigravity CLI", "curl -fsSL https://antigravity.google/cli/install.sh | bash")
    merged = "[시스템 지시]\n#{system}\n\n[사용자 입력]\n#{user_content}"
    cmd = [ cli, "-p", merged, "--dangerously-skip-permissions" ]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    run_cli(cmd, "")
  end

  def call_codex_cli(system, user_content)
    cli = ENV.fetch("CODEX_CLI_PATH", "codex")
    ensure_cli!(cli, "Codex CLI", "npm install -g @openai/codex")
    cmd = [ cli, "exec", "-" ]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    merged = "[시스템 지시]\n#{system}\n\n[사용자 입력]\n#{user_content}"
    run_cli(cmd, merged)
  end

  def ensure_cli!(cli, display_name, install_hint)
    return if cli.include?("/") && File.executable?(cli)
    return if system_which(cli)
    raise LlmError, "#{display_name}를 찾을 수 없습니다: '#{cli}'. #{install_hint}"
  end

  def system_which(bin)
    ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).any? do |dir|
      path = File.join(dir, bin)
      File.executable?(path) && !File.directory?(path)
    end
  end

  def run_cli(cmd, stdin_text)
    require "open3"
    Rails.logger.info "[LlmService] CLI exec: #{cmd.first} (#{stdin_text.length}자 stdin)"

    stdout_str = nil
    stderr_str = nil
    status = nil

    Open3.popen3(*cmd) do |stdin, stdout, stderr, wait_thr|
      stdin.write(stdin_text) unless stdin_text.to_s.empty?
      stdin.close

      unless wait_thr.join(CLI_TIMEOUT)
        Process.kill("KILL", wait_thr.pid) rescue nil
        wait_thr.join
        raise LlmError, "CLI 응답 시간이 초과되었습니다 (#{CLI_TIMEOUT}초): #{cmd.first}"
      end

      stdout_str = stdout.read.to_s
      stderr_str = stderr.read.to_s
      status = wait_thr.value
    end

    unless status&.success?
      err = stderr_str.to_s.strip
      raise LlmError, "CLI 오류 (코드 #{status&.exitstatus}): #{err.presence || '원인 불명'}"
    end
    stdout_str.strip
  end

  def call_llm_json(system, user_content)
    text = call_llm_raw(system, user_content)
    JSON.parse(extract_json(text))
  rescue JSON::ParserError
    nil
  end

  # ── 텍스트 처리 ──

  def format_transcripts(transcripts)
    return "" if transcripts.blank?
    transcripts.map { |t|
      speaker = t["speaker"] || t[:speaker] || "알 수 없음"
      text = t["text"] || t[:text] || ""
      "#{speaker}: #{text}"
    }.join("\n")
  end

  def extract_json(text)
    if (match = text.match(/```(?:json)?\s*([\s\S]*?)```/))
      match[1].strip
    else
      text.strip
    end
  end

  def strip_markdown_fence(text)
    text = text.strip
    if text.match?(/\A```(?:markdown)?\s*\n/)
      text = text.sub(/\A```(?:markdown)?\s*\n/, "")
      text = text.sub(/\n```\s*\z/, "")
    end
    text
  end

  # 추론 모델별 thinking 비활성 지시 (없으면 nil)
  def thinking_off_directive
    return nil if ENV["LLM_DISABLE_THINKING"] == "0"
    m = @config[:model].to_s
    return "detailed thinking off" if m.match?(/nemotron/i)
    return "/no_think"             if m.match?(/qwen3|qwen-3|qwq/i)
    ENV["LLM_DISABLE_THINKING"] == "1" ? "/no_think" : nil
  end

  # 출력에 새는 추론 블록 제거 (<think>, ◁think▷, <thinking>)
  def strip_think(text)
    return text if text.nil?
    text.gsub(/◁think▷.*?◁\/think▷/m, "")
        .gsub(/<think>.*?<\/think>/m, "")
        .gsub(/<thinking>.*?<\/thinking>/m, "")
        .strip
  end

  # Mermaid 코드블록 내 노드 라벨에 큰따옴표 자동 보정 + 줄바꿈 처리
  def fix_mermaid_quotes(text)
    text.gsub(/(```mermaid\s*\n)([\s\S]*?)(```)/) do
      prefix, body, suffix = $1, $2, $3
      body = quote_mermaid_labels(body)
      "#{prefix}#{body}#{suffix}"
    end
  end

  def quote_mermaid_labels(block)
    # Square brackets: A[label] → A["label"]
    block = block.gsub(/(^|\s|>|\|)(\w+)\[([^\]]+)\]/m) do
      "#{$1}#{$2}#{clean_label($3, '[', ']')}"
    end
    # Curly braces: A{label} → A{"label"}
    block = block.gsub(/(^|\s|>|\|)(\w+)\{([^}]+)\}/m) do
      "#{$1}#{$2}#{clean_label($3, '{', '}')}"
    end
    # Parentheses: A(label) → A("label")
    block.gsub(/(^|\s|>|\|)(\w+)\(([^)]+)\)/m) do
      "#{$1}#{$2}#{clean_label($3, '(', ')')}"
    end
  end

  def clean_label(content, open_b, close_b)
    clean = content.delete('"')
    clean = clean.gsub('\\n', "<br/>")
    clean = clean.gsub("\n", "<br/>").delete("\r")
    "#{open_b}\"#{clean}\"#{close_b}"
  end

  def empty_summary
    { "key_points" => [], "decisions" => [], "discussion_details" => [], "action_items" => [] }
  end
end
