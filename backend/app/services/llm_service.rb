# LLM 기반 회의 요약 서비스.
#
# Sidecar(Python)의 summarizer.py를 Rails로 이전한 것.
# Anthropic/OpenAI API를 직접 호출하거나, 로컬 CLI(claude/gemini/codex) 를 실행하여
# 회의록 요약, 정제, Action Item 추출을 수행한다.
class LlmService
  class LlmError < StandardError; end

  TIMEOUT = 300 # seconds
  CLI_TIMEOUT = 180 # seconds — Claude/Gemini/Codex CLI 실행 제한

  CLI_PROVIDERS = %w[claude_cli gemini_cli codex_cli].freeze

  SUMMARIZE_SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 회의 내용을 분석하여 구조화된 요약을 제공하는 전문가입니다.
    트랜스크립트를 분석하여 반드시 아래 JSON 형식으로만 응답하세요.

    응답 형식:
    {
      "key_points": ["핵심 포인트 1", "핵심 포인트 2"],
      "decisions": ["결정사항 1", "결정사항 2"],
      "discussion_details": ["논의 내용 1", "논의 내용 2"],
      "action_items": [
        {"content": "할 일 내용", "assignee_hint": "담당자 힌트 또는 null", "due_date_hint": "마감일 힌트 또는 null"}
      ]
    }

    JSON 외에 다른 텍스트를 포함하지 마세요.
  PROMPT

  ACTION_ITEMS_SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 회의 내용에서 Action Item을 추출하는 전문가입니다.
    트랜스크립트를 분석하여 반드시 아래 JSON 형식으로만 응답하세요.

    응답 형식:
    {
      "action_items": [
        {"content": "할 일 내용", "assignee_hint": "담당자 힌트 또는 null", "due_date_hint": "마감일 힌트 또는 null"}
      ]
    }

    JSON 외에 다른 텍스트를 포함하지 마세요.
  PROMPT

  DEFAULT_SECTION_STRUCTURE = <<~SECTION.freeze
    2. **구조화**: 회의록을 다음과 같이 체계적으로 구성하세요 (섹션 번호 부여 권장):
       - ## 1. 핵심 요약 (3~5개 항목. 각 항목을 별도의 Markdown 불릿(- )으로 작성하고 항목 사이에 빈 줄을 넣어 분리할 것. 각 항목은 "맥락 → **결론/핵심**" 구조. 서술형 문장 금지. 여러 항목을 한 줄에 이어붙이지 말 것)
       - ## 2. 논의 사항 (각 주제별로 소제목 사용)
       - ## 3. 결정사항 (결정된 내용을 표로 정리)
       - ## 4. Action Items (담당자, 기한이 있으면 표로 정리)
       - ## 5. 기타 논의 (기타 참고 사항 및 누락된 내용)
  SECTION

  REFINE_NOTES_SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 실시간 회의록 작성 전문가입니다.
    현재까지 작성된 회의록(Markdown)과 새로운 음성 인식 자막(transcript)을 받아,
    통합된 회의록을 작성합니다.

    ## 핵심 규칙

    1. **오타 교정**: 음성 인식(STT) 자막에는 오타가 많습니다. 문맥을 파악하여 반드시 오타를 교정하세요.
       - 예: "개발 환영" → "개발 환경", "테스크" → "태스크", "디플로이" → "배포"
       - 한국어와 영어가 섞인 기술 용어에 특히 주의하세요.

    2. **구조화**: 회의록을 다음과 같이 체계적으로 구성하세요 (섹션 번호 부여 권장):
       - ## 1. 핵심 요약 (3~5개 항목. 각 항목을 별도의 Markdown 불릿(- )으로 작성하고 항목 사이에 빈 줄을 넣어 분리할 것. 각 항목은 "맥락 → **결론/핵심**" 구조. 서술형 문장 금지. 여러 항목을 한 줄에 이어붙이지 말 것)
       - ## 2. 논의 사항 (각 주제별로 소제목 사용)
       - ## 3. 결정사항 (결정된 내용을 표로 정리)
       - ## 4. Action Items (담당자, 기한이 있으면 표로 정리)
       - ## 5. 기타 논의 (기타 참고 사항 및 누락된 내용)

    3. **표 적극 활용**: 비교, 목록, 현황 등은 Markdown 표로 정리하세요.
       예시:
       | 항목 | 담당자 | 기한 | 상태 |
       |------|--------|------|------|
       | API 설계 | 김개발 | 3/28 | 진행중 |

    4. **[최우선] 기존 내용 보존**: 기존 회의록의 모든 내용은 반드시 빠짐없이 포함해야 합니다.
       - ⚠️ 기존 회의록에 있던 내용을 절대 삭제하거나 생략하지 마세요.
       - ⚠️ 기존 내용을 요약·축약하여 줄이지 마세요. 원래 분량 그대로 유지하세요.
       - 새로운 자막 내용만 기존 회의록에 추가/병합하세요.

    5. **점진적 업데이트**: 기존 회의록 구조를 유지하면서 새로운 내용을 자연스럽게 통합하세요.
       - 기존 섹션에 해당하는 내용이면 해당 섹션 끝에 추가
       - 새로운 주제면 새 소제목 생성
       - 이전 내용과 정확히 중복되는 경우에만 합치기 (유사한 내용은 모두 유지)

    6. **간결한 문체**: 어미를 최대한 간결하게 작성하세요.
       - "~했습니다", "~하였습니다" 대신 "~함", "~완료", "~예정" 등 명사형/체언 종결 사용
       - "~하기로 했습니다" → "~하기로 함", "~진행할 예정입니다" → "~진행 예정"
       - 불필요한 조사와 서술어를 줄이고 핵심만 남기세요

    7. **Markdown만 반환**: 전체 출력을 ```markdown 블록으로 감싸지 마세요. 단, 본문 내 ```mermaid 코드블록은 허용됩니다.

    8. **수식·단위 표기**: LaTeX 수식($...$)을 사용하지 마세요. 대신 유니코드 문자를 사용하세요.
       - 위첨자: ² ³ ⁴ ⁿ ⁻¹ (예: m², cm³, 10⁶)
       - 아래첨자: ₀ ₁ ₂ (예: CO₂, H₂O)
       - 기호: ± × ÷ ≤ ≥ ≠ ≈ ° ‰ μ Ω π α β γ → ← ∞
       - 분수: ½ ⅓ ¼ ⅔ ¾
       - 예시: g/m² (O) / $g/m^2$ (X), CO₂ (O) / $CO_2$ (X)

    9. **다이어그램 활용**: 시각적 표현이 효과적인 부분은 Mermaid 다이어그램을 사용하세요.
       - 적합한 경우: 프로세스/워크플로우, 타임라인, 의사결정 흐름, 시스템 구조, 의존관계, 비율/통계
       - 부적합한 경우: 단순 목록, 짧은 정보, 이미 표로 충분한 내용
       - 형식: ```mermaid ... ``` 코드블록 사용
       - 지원 유형: flowchart(프로세스), sequenceDiagram(상호작용), gantt(일정), pie(비율), mindmap(아이디어맵)
       - 회의록 당 최대 2개, 내용이 충분히 복잡할 때만 추가
       - 다이어그램 노드/라벨은 한국어로 작성
       - ⚠️ **[필수] 노드 라벨에 반드시 따옴표 사용**: 예외 없이 모든 노드 라벨을 큰따옴표로 감싸세요.
         - 따옴표 없는 노드는 파싱 에러를 유발하므로 절대 사용 금지입니다.
         - ✅ 올바른 예: A["개근중량 입력"] --> B{"공정 구분"} --> C["도금 부착량 (g/m²) × 길이"]
         - ❌ 잘못된 예: A[개근중량 입력] --> B{공정 구분} --> C[도금 부착량 × 길이]
         - 다이아몬드 노드도 마찬가지: B{"조건 분기"} (O) / B{조건 분기} (X)
       - ⚠️ **[필수] 노드 라벨 내 줄바꿈은 \\n 대신 <br/>을 사용하세요.**
         - Mermaid에서 \\n은 줄바꿈으로 인식되지 않아 렌더링 오류를 유발합니다.
         - ✅ 올바른 예: A["첫째 줄<br/>둘째 줄"]
         - ❌ 잘못된 예: A["첫째 줄\\n둘째 줄"] (실제 줄바꿈 또는 문자열 \\n 모두 금지)

    ## 출력 형식

    순수 Markdown 텍스트만 반환하세요. JSON이 아닙니다.
    ```markdown 블록으로 감싸지 마세요. ```mermaid 코드블록은 본문 내에서 사용 가능합니다.
  PROMPT

  FEEDBACK_NOTES_SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 회의록 편집 전문가입니다.
    현재 회의록(Markdown)과 사용자의 피드백(지시사항)을 받아 회의록을 수정합니다.

    ## 규칙
    1. 사용자의 피드백을 정확하게 반영하여 회의록을 수정하세요.
    2. 피드백에서 언급하지 않은 부분은 가능한 그대로 유지하세요.
    3. 전체 구조와 형식은 유지하면서 필요한 부분만 변경하세요.
    4. Markdown만 반환: 전체 출력을 ```markdown 블록으로 감싸지 마세요. 단, 본문 내 ```mermaid 코드블록은 허용됩니다.
    5. 다이어그램: 사용자가 다이어그램을 요청하면 ```mermaid 코드블록을 사용하세요.
       지원 유형: flowchart, sequenceDiagram, gantt, pie, mindmap. 라벨은 한국어로 작성.
    6. 수식·단위 표기: LaTeX 수식($...$)을 사용하지 마세요. 유니코드 문자를 사용하세요.
       - 위첨자: ² ³ ⁴, 아래첨자: ₀ ₁ ₂, 기호: ± × ÷ ≤ ≥ ≠ ≈ ° μ π → ∞
       - 예: g/m² (O) / $g/m^2$ (X), CO₂ (O) / $CO_2$ (X)
    7. [필수] Mermaid 노드 라벨에 반드시 큰따옴표 사용 — 예외 없음. A["라벨"] (O) / A[라벨] (X). 다이아몬드도 B{"조건"} (O) / B{조건} (X)
    8. [필수] Mermaid 노드 라벨 내 줄바꿈은 \\n 대신 <br/> 사용. A["첫째 줄<br/>둘째 줄"] (O) / A["첫째 줄\\n둘째 줄"] (X)

    ## 출력 형식
    순수 Markdown 텍스트만 반환하세요. JSON이 아닙니다.
    ```markdown 블록으로 감싸지 마세요. ```mermaid 코드블록은 본문 내에서 사용 가능합니다.
  PROMPT

  # @param llm_config [Hash, nil] 사용자별 LLM 설정 override
  #   { provider:, auth_token:, model:, base_url: }
  def initialize(llm_config: nil)
    @config = resolve_config(llm_config)
    @client = build_client
  end

  # 회의록 정제: 기존 노트 + 새 자막 → 통합 회의록
  def refine_notes(current_notes, transcripts, meeting_title: "", meeting_type: "general", sections_prompt: nil)
    transcript_text = format_transcripts(transcripts)
    return { "notes_markdown" => current_notes } if transcript_text.blank?

    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
    if current_notes.present?
      parts << "현재 회의록:\n#{current_notes}"
    else
      parts << "현재 회의록: (아직 없음 — 새로 작성해주세요)"
    end
    parts << "새로운 자막:\n#{transcript_text}"
    user_content = parts.join("\n\n")

    estimated_tokens = current_notes.length + transcript_text.length + 2048
    max_tokens = [4096, [estimated_tokens, max_output_tokens].min].max

    system_prompt = if sections_prompt.present?
      REFINE_NOTES_SYSTEM_PROMPT.sub(DEFAULT_SECTION_STRUCTURE, sections_prompt)
    else
      REFINE_NOTES_SYSTEM_PROMPT
    end

    result = call_llm_raw(system_prompt, user_content, max_tokens: max_tokens)
    notes = fix_mermaid_quotes(strip_markdown_fence(result))
    { "notes_markdown" => notes }
  rescue => e
    Rails.logger.error "[LlmService] refine_notes failed: #{e.message}"
    { "notes_markdown" => current_notes }
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
  def apply_feedback(current_notes, feedback, meeting_title: "")
    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
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

  # 외부 LLM용 프롬프트 조립 (LLM 호출 없음)
  def build_prompt(current_notes, transcripts, meeting_title: "", sections_prompt: nil)
    system_prompt = if sections_prompt.present?
      REFINE_NOTES_SYSTEM_PROMPT.sub(DEFAULT_SECTION_STRUCTURE, sections_prompt)
    else
      REFINE_NOTES_SYSTEM_PROMPT
    end

    transcript_text = format_transcripts(transcripts)
    parts = []
    parts << "회의 제목: #{meeting_title}" if meeting_title.present?
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
        uri_base: @config[:base_url].presence
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

    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0
    Rails.logger.info "[LlmService] #{@config[:provider]}/#{@config[:model]} #{elapsed.round(1)}s | input=#{system.length + user_content.length}자 output=#{result.length}자"
    result
  end

  def call_anthropic(system, user_content, max_tokens)
    response = @client.messages.create(
      model: @config[:model],
      max_tokens: max_tokens,
      system: system,
      messages: [{ role: "user", content: user_content }]
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
    cmd = [cli, "-p", "--output-format", "text", "--system-prompt", system]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    run_cli(cmd, user_content)
  end

  def call_gemini_cli(system, user_content)
    cli = ENV.fetch("GEMINI_CLI_PATH", "gemini")
    ensure_cli!(cli, "Gemini CLI", "npm install -g @google/gemini-cli")
    merged = "[시스템 지시]\n#{system}\n\n[사용자 입력]\n#{user_content}"
    cmd = [cli, "-p", merged, "--output-format", "text"]
    cmd.push("--model", @config[:model].to_s) if @config[:model].present?
    run_cli(cmd, "")
  end

  def call_codex_cli(system, user_content)
    cli = ENV.fetch("CODEX_CLI_PATH", "codex")
    ensure_cli!(cli, "Codex CLI", "npm install -g @openai/codex")
    cmd = [cli, "exec", "-"]
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
    clean = clean.gsub('\\n', '<br/>')
    clean = clean.gsub("\n", '<br/>').delete("\r")
    "#{open_b}\"#{clean}\"#{close_b}"
  end

  def empty_summary
    { "key_points" => [], "decisions" => [], "discussion_details" => [], "action_items" => [] }
  end
end
