# LLM 기반 회의 요약 서비스.
#
# Sidecar(Python)의 summarizer.py를 Rails로 이전한 것.
# Anthropic/OpenAI API를 직접 호출하거나, 로컬 CLI(claude/agy/codex) 를 실행하여
# 회의록 요약, 정제, Action Item 추출을 수행한다.
class LlmService
  include LlmPrompts
  # 순수 텍스트 유틸은 TextFormatter 모듈로 추출. include 로 기존 private 인스턴스 메서드 계약도 보존.
  include LlmService::TextFormatter
  # 설정 해석 + 클라이언트 구성은 ClientFactory 모듈로 추출(동일 패턴).
  include LlmService::ClientFactory

  class LlmError < StandardError; end

  # 사용자 노출용 오류 메시지 상한 (broadcast·DB 영속 기록 공통 truncate)
  USER_ERROR_MAX_LENGTH = 300
  # allowlist 밖 예외를 치환하는 일반 문구 — 내부 정보(호스트:포트·경로·stderr) 유출 차단
  GENERIC_USER_ERROR = "요약 생성 중 오류가 발생했습니다".freeze

  # 예외 → 사용자 노출용 메시지 정규화(allowlist). LlmError 는 우리가 직접 작성한 한국어
  # 안내문만 담으므로 통과(truncate 만), 그 외 예외 원문은 내부 호스트:포트·파일 경로·
  # CLI stderr 가 섞일 수 있어 일반 문구로 치환한다. 원문은 호출부가 Rails.logger 로만 남긴다.
  # broadcast·summary_error 영속 기록 등 참가자 전원에게 노출되는 모든 경로에서 사용할 것.
  def self.user_facing_error_message(error)
    return GENERIC_USER_ERROR unless error.is_a?(LlmError)
    error.message.to_s.truncate(USER_ERROR_MAX_LENGTH)
  end

  # 클라우드 프로바이더(anthropic/openai 계열)의 사용 가능 모델 id 목록 — 설정 UI의 '모델 새로고침'.
  # 프로바이더의 표준 `/v1/models` 엔드포인트를 그대로 조회한다(로컬 ollama/lmstudio 는 프론트가
  # 직접 조회하므로 대상 아님, CLI 도 아님). 새 모델이 나와도 하드코딩 목록 갱신·재배포 없이 최신화된다.
  # base_url override 로 z.ai(anthropic 호환)·openai 호환 서버(nvidia 등)도 지원. 실패 시 LlmError.
  def self.list_models(provider:, api_key:, base_url: nil)
    case provider
    when "openai"
      base = base_url.presence || "https://api.openai.com/v1"
      data = http_get_json("#{base.chomp('/')}/models", { "Authorization" => "Bearer #{api_key}" })
      extract_model_ids(data)
    when "anthropic"
      base = base_url.presence || "https://api.anthropic.com"
      data = http_get_json("#{base.chomp('/')}/v1/models",
                           { "x-api-key" => api_key.to_s, "anthropic-version" => "2023-06-01" })
      extract_model_ids(data)
    else
      []
    end
  end

  # OpenAI/Anthropic `/v1/models` 응답({ "data" => [{ "id" => ... }] })에서 모델 id 만 정렬·중복제거.
  def self.extract_model_ids(data)
    list = data.is_a?(Hash) ? (data["data"] || data[:data]) : nil
    return [] unless list.is_a?(Array)
    list.filter_map { |m| m.is_a?(Hash) ? (m["id"] || m[:id]) : nil }.uniq.sort
  end

  # 인증 헤더를 붙여 GET → JSON 파싱. 타임아웃 짧게(설정 UI 인터랙션용). 2xx 아니면 LlmError.
  def self.http_get_json(url, headers)
    require "net/http"
    uri = URI.parse(url)
    raise LlmError, "잘못된 URL 입니다" unless uri.is_a?(URI::HTTP)

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = (uri.scheme == "https")
    http.open_timeout = 5
    http.read_timeout = 10

    req = Net::HTTP::Get.new(uri)
    headers.each { |k, v| req[k] = v }
    res = http.request(req)
    raise LlmError, "모델 목록 조회 실패 (HTTP #{res.code})" unless res.is_a?(Net::HTTPSuccess)

    JSON.parse(res.body.to_s)
  end

  CLI_TIMEOUT = ENV.fetch("LLM_CLI_TIMEOUT", "600").to_i # seconds — Claude/Gemini/Codex/GLM CLI 실행 제한

  CLI_PROVIDERS = %w[claude_cli gemini_cli codex_cli].freeze

  # @param llm_config [Hash, nil] 사용자별 LLM 설정 override
  #   { provider:, auth_token:, model:, base_url: }
  def initialize(llm_config: nil)
    @config = resolve_config(llm_config)
    @client = build_client
  end

  # 회의록 정제: 기존 노트 + 새 자막 → 통합 회의록.
  # chronological: 증분(흐름) 회의의 통짜 생성 시 주제별 재구성 대신 시간순 요약 지시.
  def refine_notes(current_notes, transcripts, meeting_title: "", meeting_type: "general", sections_prompt: nil, attendees: nil, verbosity: "standard", verbosity_context: :final, chronological: false, seeded_merge: false, agenda_reference: nil)
    transcript_text = TextFormatter.format_transcripts(transcripts)
    return { "notes_markdown" => current_notes, "ok" => true } if transcript_text.blank?

    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    parts << agenda_reference_block(agenda_reference) if agenda_reference.present?
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
    system_prompt = system_prompt + "\n\n" + LlmPrompts::CITATION_MARKER_INSTRUCTION
    # 이전 회의 통합+논의 절취선 지시는 분량 한도보다 우선해야 하므로 verbosity 뒤(맨 끝)에 붙인다.
    system_prompt = system_prompt + seeded_merge_instruction if seeded_merge

    result = call_llm_raw(system_prompt, user_content, max_tokens: max_tokens)
    notes = TextFormatter.fix_mermaid_quotes(TextFormatter.strip_markdown_fence(result))
    # thinking 누출 방어(solo 2026-07 commit 6209fad 이식, 회의38: 8k자→727자 추론쓰레기로
    # 누적 노트가 통째 소실된 사고): refine 출력이 기존 노트를 대량 유실하면 오염으로 간주,
    # 기존 노트 보존 + ok:false로 재시도 유도(D8 anchor-C1과 동일 계약: 호출부 미저장·미소비).
    if catastrophic_note_loss?(current_notes, notes)
      Rails.logger.error "[LlmService] refine_notes: catastrophic note loss guard triggered (#{current_notes.to_s.length}자 → #{notes.length}자)"
      # "error" 사유는 호출부가 사용자에게 레포트한다 (기존 {"ok"=>false} 계약 유지 + 필드 추가).
      return { "notes_markdown" => current_notes, "ok" => false,
               "error" => "요약 결과가 기존 회의록을 대량 유실해 저장을 거부했습니다 (#{current_notes.to_s.length}자 → #{notes.length}자)" }
    end
    { "notes_markdown" => notes, "ok" => true }
  rescue => e
    Rails.logger.error "[LlmService] refine_notes failed: #{e.message}"
    # ok:false → 호출부가 transcript 미소비·미저장(무음 손실 차단, D8 anchor-C1)
    # error 는 사용자 노출용으로 정규화 — 예외 원문은 위 로그에만 남긴다.
    { "notes_markdown" => current_notes, "ok" => false, "error" => self.class.user_facing_error_message(e) }
  end

  # 증분(append-only) 모드: 새 자막만 시간대별 새 블록 하나로 요약. 기존 회의록 불변.
  # 시간 헤딩은 호출부(job)가 붙인다. 출력이 새 블록뿐이라 작음 → 틱 빠름.
  # 반환: { "block_markdown" =>, "ok" => }. ok:false 면 호출부가 transcript 미소비(무음 손실 차단).
  def append_notes(current_notes, transcripts, meeting_title: "", attendees: nil, verbosity: "standard", agenda_reference: nil)
    transcript_text = TextFormatter.format_transcripts(transcripts)
    return { "block_markdown" => "", "ok" => true } if transcript_text.blank?

    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    parts << agenda_reference_block(agenda_reference) if agenda_reference.present?
    parts << "기존 회의록(참고용 — 수정·반복 금지):\n#{current_notes}" if current_notes.present?
    parts << "새로운 자막:\n#{transcript_text}"
    user_content = parts.join("\n\n")

    system_prompt = apply_verbosity(APPEND_NOTES_SYSTEM_PROMPT, verbosity, context: :append)

    raw = call_llm_raw(system_prompt, user_content, max_tokens: max_output_tokens)
    block = TextFormatter.fix_mermaid_quotes(TextFormatter.strip_markdown_fence(raw))
    { "block_markdown" => block, "ok" => true }
  rescue => e
    Rails.logger.error "[LlmService] append_notes failed: #{e.message}"
    # error 는 사용자 노출용으로 정규화 — 예외 원문은 위 로그에만 남긴다.
    { "block_markdown" => "", "ok" => false, "error" => self.class.user_facing_error_message(e) }
  end

  # 구조화된 요약 (JSON): key_points, decisions, discussion_details, action_items
  def summarize(transcripts, type: "realtime", context: nil)
    transcript_text = TextFormatter.format_transcripts(transcripts)
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
    transcript_text = TextFormatter.format_transcripts(transcripts)
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
    { "notes_markdown" => TextFormatter.fix_mermaid_quotes(TextFormatter.strip_markdown_fence(result)) }
  rescue => e
    Rails.logger.error "[LlmService] apply_feedback failed: #{e.message}"
    { "notes_markdown" => current_notes }
  end

  # 외부 LLM용 프롬프트 조립 (LLM 호출 없음). 압축율 분량 지시 포함(통짜 생성 = final 캡).
  # 증분(restructure=false) 회의는 시간 흐름 요약 지시를 포함 — 주제별 재구성 금지.
  def build_prompt(current_notes, transcripts, meeting_title: "", sections_prompt: nil, attendees: nil, verbosity: "standard", restructure: true, agenda_reference: nil)
    system_prompt = if sections_prompt.present?
      REFINE_NOTES_SYSTEM_PROMPT.sub(DEFAULT_SECTION_STRUCTURE, sections_prompt)
    else
      REFINE_NOTES_SYSTEM_PROMPT
    end
    system_prompt = system_prompt + CHRONOLOGICAL_NOTES_INSTRUCTION unless restructure
    system_prompt = apply_verbosity(system_prompt, verbosity, context: :final)

    transcript_text = TextFormatter.format_transcripts(transcripts)
    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    parts << "참석자: #{attendees}" if attendees.present?
    parts << agenda_reference_block(agenda_reference) if agenda_reference.present?
    parts << (current_notes.present? ? "현재 회의록:\n#{current_notes}" : "현재 회의록: (아직 없음 — 새로 작성해주세요)")
    parts << "새로운 자막:\n#{transcript_text}" if transcript_text.present?
    user_content = parts.join("\n\n")

    {
      "prompt" => "# 회의록 작성 프롬프트\n\n" \
                  "아래 내용을 LLM(ChatGPT, Claude 등)에 그대로 붙여넣으면 회의록이 생성됩니다.\n\n" \
                  "---\n\n## 지시사항\n\n#{system_prompt}\n\n---\n\n## 입력 데이터\n\n#{user_content}"
    }
  end

  # 회의 Q&A: 컨텍스트 빌더가 만든 system/user를 호출.
  # 블록을 주면 텍스트 델타를 순서대로 yield하고 전체 텍스트를 반환 (스트리밍).
  # 블록 없으면 기존 동기 경로 그대로.
  def answer_question(system_prompt, user_content, &block)
    call_llm_raw(system_prompt, user_content, &block)
  end

  # 안건 자료 압축: 업로드 시점에 LLM 으로 요약해 max_chars 미만으로 줄인다.
  # 입력 토큰 캡이 없으므로(LLM 호출부에 입력 길이 제한 없음) 반환·실패 모두 하드 트렁케이트로
  # 길이를 강제한다. blank 면 LLM 을 호출하지 않고 "" 반환.
  def compress_agenda(text, max_chars: 8000)
    text = text.to_s
    return "" if text.strip.blank?

    compressed = call_llm_raw(COMPRESS_AGENDA_SYSTEM_PROMPT, text)
    TextFormatter.truncate_chars(TextFormatter.strip_markdown_fence(compressed), max_chars)
  rescue => e
    Rails.logger.error "[LlmService] compress_agenda failed: #{e.message}"
    # 압축 실패 시 원본을 캡까지 잘라 폴백(주입 자체는 가능하게).
    TextFormatter.truncate_chars(text, max_chars)
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

  # 안건 자료 블록: 회의록 작성 시 참고만 하고 그대로 베끼지 말라는 가드를 라벨에 명시한다.
  def agenda_reference_block(agenda_reference)
    "안건 자료(참고용 — 회의 내용 우선, 그대로 복사하지 말 것):\n#{agenda_reference}"
  end

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

  # @config[:max_output_tokens] 런타임 접근자 — call_llm_raw 기본인자/여러 호출부에서 bare 로
  # 쓰여 인스턴스에 남겨둔다(설정 구성이 아니라 @config 접근). resolve_config/build_client 만 추출.
  def max_output_tokens
    @config[:max_output_tokens] || 10_000
  end

  # @config 로 클라이언트를 만드는 zero-arg 래퍼. 본문은 ClientFactory.build_client(config) 로 추출.
  # include 된 1-arg build_client(config) 를 이 인스턴스 메서드가 가려, 기존 zero-arg 계약을 보존한다.
  def build_client
    ClientFactory.build_client(@config)
  end

  # ── LLM 호출 ──

  def call_llm_raw(system, user_content, max_tokens: max_output_tokens, &block)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)

    # A안(실행시점 폴백): 개인 CLI provider 인데 그 바이너리가 이 머신에 없으면(원격 서버 등)
    # 디스패치 전에 서버 기본 LLM 으로 @config 를 선제 교체한다. 동기·JSON·스트리밍 모든 공개 경로가
    # call_llm_raw 로 모이므로 여기 한 곳이면 충분하다.
    maybe_fallback_from_missing_cli!

    # 추론(thinking) 모델은 요약에 불필요 — 비활성 지시 주입(속도·본문 회복)
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
    params = {
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
    }
    params[:reasoning_effort] = openai_reasoning_effort if openai_reasoning_effort
    @client.chat(parameters: params)
    full
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
    params[:reasoning_effort] = openai_reasoning_effort if openai_reasoning_effort
    response = @client.chat(parameters: params)
    response.dig("choices", 0, "message", "content") || ""
  end

  # Gemini(OpenAI-호환)에서 thinking을 끄는 reasoning_effort 값 — solo(Rust 코어, 2026-07
  # commit 6209fad)에서 이식한 **원본 Rails엔 없는 의도적 divergence**(회의38 thinking 누출
  # 방어: gemini flash가 최종 마크다운 대신 자기 추론을 뱉어 refine_notes가 누적 노트를
  # 덮어쓴 사고). Google 문서(ai.google.dev/gemini-api/docs/openai): gemini 2.5 Flash는
  # reasoning_effort:"none"으로 thinking 비활성 가능(2.5 Pro·3는 불가). gemini flash
  # 계열에만 부착 — 다른 OpenAI-compat 서버(진짜 OpenAI/로컬)는 미지 파라미터를 400으로
  # 거부할 수 있어 게이팅 필수.
  def openai_reasoning_effort
    m = @config[:model].to_s.downcase
    return "none" if m.include?("gemini") && m.include?("flash")
    nil
  end

  # ── 로컬 CLI 실행 (Claude Code / Gemini / Codex) ──

  def call_claude_cli(system, user_content, &block)
    cli = cli_binary_for("claude_cli")
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
    run_cli(cmd, user_content, &block)
  end

  # Gemini CLI는 2026-06-18 종료 → Antigravity CLI(agy)로 대체.
  # agy v1.0.7 비대화형: `agy -p "<prompt>" --model "<표시명>" --dangerously-skip-permissions`
  #   - --model: `agy models` 표시명 그대로 전달 (예: "Gemini 3.5 Flash (Medium)").
  #     미지정/잘못된 값이면 agy 기본값으로 fallback(크래시 없음).
  #   - --dangerously-skip-permissions: 요약 작업은 비대화형이라 툴 권한 프롬프트로 멈추지 않게 함
  # GEMINI_CLI_PATH 도 하위호환으로 인정. provider 이름은 gemini_cli 유지.
  def call_gemini_cli(system, user_content, &block)
    cli = cli_binary_for("gemini_cli")
    ensure_cli!(cli, "Antigravity CLI", "curl -fsSL https://antigravity.google/cli/install.sh | bash")
    merged = "[시스템 지시]\n#{system}\n\n[사용자 입력]\n#{user_content}"
    cmd = [ cli, "-p", merged, "--dangerously-skip-permissions" ]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    run_cli(cmd, "", &block)
  end

  def call_codex_cli(system, user_content, &block)
    cli = cli_binary_for("codex_cli")
    ensure_cli!(cli, "Codex CLI", "npm install -g @openai/codex")
    # 프로덕션 .app은 cwd에 .git이 없어 codex exec가 "Not inside a trusted directory"로
    # 거부함 — git repo 검사 생략(exec 기본 sandbox는 read-only라 안전).
    cmd = [ cli, "exec", "--skip-git-repo-check", "-" ]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    merged = "[시스템 지시]\n#{system}\n\n[사용자 입력]\n#{user_content}"
    run_cli(cmd, merged, &block)
  end

  def ensure_cli!(cli, display_name, install_hint)
    return if cli_available?(cli)
    # 전체 경로(ENV 설정)는 로그에만 — 사용자 메시지에는 basename 만 노출.
    Rails.logger.error "[LlmService] CLI 미존재: '#{cli}' (#{display_name})"
    raise LlmError, "#{display_name}를 찾을 수 없습니다: '#{File.basename(cli.to_s)}'. #{install_hint}"
  end

  # CLI 바이너리가 이 머신에서 실행 가능한지. ensure_cli! 와 선제 폴백(maybe_fallback_from_missing_cli!)이
  # 동일 판정을 공유하도록 단일 출처로 추출(절대경로면 executable, 아니면 PATH 탐색).
  def cli_available?(cli)
    cli = cli.to_s
    return false if cli.empty?
    return true if cli.include?("/") && File.executable?(cli)
    system_which(cli)
  end

  # CLI provider 별 바이너리 경로 해석 — 각 call_*_cli 의 cli 결정 로직과 동일(단일 출처).
  # 선제 폴백 판정이 디스패치 전에 존재 여부를 보기 위해 분리. CLI 가 아니면 nil.
  def cli_binary_for(provider)
    case provider
    when "claude_cli" then ENV.fetch("CLAUDE_CLI_PATH", "claude")
    when "gemini_cli" then ENV["AGY_CLI_PATH"].presence || ENV.fetch("GEMINI_CLI_PATH", "agy")
    when "codex_cli"  then ENV.fetch("CODEX_CLI_PATH", "codex")
    end
  end

  # A안: CLI provider 로 추론하려는데 그 바이너리가 이 머신에 없으면, 부분 작업 후 예외 대신
  # 디스패치 전에 서버 기본 LLM(server_default_config)으로 @config·@client 를 선제 교체해 다시 추론한다.
  # 데스크톱(CLI 존재)=개인 CLI 유지 / 원격(CLI 없음)=서버 기본 폴백. SERVER_MODE 신호를 안 써 배포 무관.
  # 무한재귀 가드: 서버 기본마저 CLI 이고 그 바이너리도 없으면 교체하지 않고 원래 경로로 진행해
  # ensure_cli! 가 원래 미존재 메시지로 LlmError 를 raise 한다(폴백은 1회만).
  def maybe_fallback_from_missing_cli!
    provider = @config[:provider]
    return unless CLI_PROVIDERS.include?(provider)
    return if cli_available?(cli_binary_for(provider))

    fallback = server_default_config
    return if CLI_PROVIDERS.include?(fallback[:provider]) && !cli_available?(cli_binary_for(fallback[:provider]))

    Rails.logger.warn(
      "[LlmService] 개인 CLI '#{cli_binary_for(provider)}'(#{provider}) 미존재 → " \
      "서버 기본 LLM(#{fallback[:provider]}/#{fallback[:model]}) 폴백"
    )
    @config = fallback
    @client = build_client
  end

  def system_which(bin)
    ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).any? do |dir|
      path = File.join(dir, bin)
      File.executable?(path) && !File.directory?(path)
    end
  end

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
        # 스트리밍: stdout 을 청크로 읽어 방출. IO.select 로 전체 한도 감시.
        # readpartial 은 ASCII-8BIT(바이트) 청크를 주므로 멀티바이트(한글)가 청크 경계에서
        # 잘릴 수 있다. pending 에 모아 유효 UTF-8 접두부만 떼어 방출하고(미완 바이트는 보류),
        # 누적본(stdout_str)은 마지막에 UTF-8 로 재해석한다. 이렇게 하지 않으면 BINARY 문자열이
        # strip_think 의 UTF-8 정규식 gsub 에서 Encoding::CompatibilityError 를 낸다.
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + CLI_TIMEOUT
        pending = (+"").force_encoding(Encoding::BINARY)
        begin
          loop do
            remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
            if remaining <= 0 || IO.select([stdout], nil, nil, remaining).nil?
              Process.kill("KILL", wait_thr.pid) rescue nil
              wait_thr.join
              # basename 만 노출 — 절대 경로(ENV 설정)가 참가자에게 새지 않게 한다.
              raise LlmError, "CLI 응답 시간이 초과되었습니다 (#{CLI_TIMEOUT}초): #{File.basename(cmd.first.to_s)}"
            end
            chunk = stdout.readpartial(4096)
            stdout_str << chunk
            pending << chunk
            emit = take_utf8_prefix!(pending)
            block.call(emit) unless emit.empty?
          end
        rescue EOFError
          # 정상 종료
        end
        # 정상 종료 시 pending 은 비어 있어야 하나, 잔여 바이트가 있으면 UTF-8 로 방출(불완전분 제거).
        unless pending.empty?
          tail = pending.dup.force_encoding(Encoding::UTF_8)
          tail = tail.scrub("") unless tail.valid_encoding?
          block.call(tail) unless tail.empty?
        end
        stdout_str.force_encoding(Encoding::UTF_8)
        stderr_str = stderr.read.to_s
        status = wait_thr.value
      else
        unless wait_thr.join(CLI_TIMEOUT)
          Process.kill("KILL", wait_thr.pid) rescue nil
          wait_thr.join
          # basename 만 노출 — 절대 경로(ENV 설정)가 참가자에게 새지 않게 한다.
          raise LlmError, "CLI 응답 시간이 초과되었습니다 (#{CLI_TIMEOUT}초): #{File.basename(cmd.first.to_s)}"
        end
        stdout_str = stdout.read.to_s
        stderr_str = stderr.read.to_s
        status = wait_thr.value
      end
    end

    unless status&.success?
      err = stderr_str.to_s.strip
      # stderr 원문은 내부 경로·계정 정보가 섞일 수 있어 로그에만 남긴다 —
      # LlmError 메시지는 allowlist 로 사용자에게 그대로 노출되므로 코드만 포함.
      Rails.logger.error "[LlmService] CLI 실패 (코드 #{status&.exitstatus}): #{err.presence || '원인 불명'}"
      raise LlmError, "CLI 실행이 실패했습니다 (코드 #{status&.exitstatus})"
    end
    # 스트리밍 경로는 위에서 UTF-8 로 재해석했으나, 강제로 한 번 더 보정(킬/절단 대비).
    stdout_str.dup.force_encoding(Encoding::UTF_8).scrub("").strip
  end

  # 바이트 버퍼(ASCII-8BIT)에서 유효 UTF-8 접두부만 떼어 UTF-8 문자열로 반환한다.
  # 끝의 불완전한 멀티바이트 바이트(최대 3바이트)는 buf 에 남겨 다음 청크와 합쳐 처리한다.
  # 유효 접두부가 없으면("" 미완 바이트만) 빈 UTF-8 문자열을 반환한다. buf 는 제자리 변경된다.
  def take_utf8_prefix!(buf)
    whole = buf.dup.force_encoding(Encoding::UTF_8)
    return buf.slice!(0, buf.bytesize).force_encoding(Encoding::UTF_8) if whole.valid_encoding?

    1.upto(3) do |n|
      break if n >= buf.bytesize
      cand = buf.byteslice(0, buf.bytesize - n)
      next unless cand&.dup&.force_encoding(Encoding::UTF_8)&.valid_encoding?

      return buf.slice!(0, buf.bytesize - n).force_encoding(Encoding::UTF_8)
    end
    (+"").force_encoding(Encoding::UTF_8)
  end

  def call_llm_json(system, user_content)
    text = call_llm_raw(system, user_content)
    JSON.parse(TextFormatter.extract_json(text))
  rescue JSON::ParserError
    nil
  end

  # 추론 모델별 thinking 비활성 지시 (없으면 nil)
  def thinking_off_directive
    return nil if ENV["LLM_DISABLE_THINKING"] == "0"
    m = @config[:model].to_s
    return "detailed thinking off" if m.match?(/nemotron/i)
    return "/no_think"             if m.match?(/qwen3|qwen-3|qwq/i)
    ENV["LLM_DISABLE_THINKING"] == "1" ? "/no_think" : nil
  end

  # refine(전체 재작성) 출력이 기존 노트를 대량 유실했는지 판정 — solo(Rust 코어, 2026-07
  # commit 6209fad)에서 이식한 **원본 Rails엔 없는 의도적 divergence**(회의38 방어). thinking
  # 계열 모델(예: gemini)이 최종 마크다운 대신 자기 추론(<think> 태그로도 안 감싸져
  # strip_think가 못 거르는 맨 추론)을 뱉으면, refine_notes가 누적 노트를 그 추론쓰레기로
  # 통째 덮어써 원 요약이 소실된다(실측: 8k자 노트 → 727자). REFINE 규칙4("기존 내용
  # 삭제·생략 절대 금지, 원래 분량 유지")상 정상 refine 출력은 항상 기존분량 이상이므로,
  # 절반 미만으로 붕괴하면 오염으로 간주하고 거부한다. 원본 노트가 짧을 때(<플로어)는
  # 절반 스윙이 노이즈라 발동 안 함(초기 누적/사용자 축약 편집 보호).
  def catastrophic_note_loss?(current, next_notes)
    floor_chars = 400
    retention_min = 0.5
    cur = current.to_s.length
    return false if cur < floor_chars

    next_notes.to_s.length < cur * retention_min
  end

  # 출력에 새는 추론 블록 제거 (<think>, ◁think▷, <thinking>)
  def strip_think(text)
    return text if text.nil?
    text.gsub(/◁think▷.*?◁\/think▷/m, "")
        .gsub(/<think>.*?<\/think>/m, "")
        .gsub(/<thinking>.*?<\/thinking>/m, "")
        .strip
  end

  def empty_summary
    { "key_points" => [], "decisions" => [], "discussion_details" => [], "action_items" => [] }
  end
end
