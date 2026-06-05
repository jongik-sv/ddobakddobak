# 명함 이미지 → Vision OCR → 구조화 연락처 배열.
# 요약 LLM과 동일하게 Claude CLI(`claude -p`)로 처리한다(LlmService#call_claude_cli와 같은 CLI).
# CLI가 이미지 파일을 Read 툴로 시각 인식하므로 ANTHROPIC API 키가 필요 없다.
class CardExtractionService
  class VisionUnavailable < StandardError; end

  DEFAULT_MODEL = "sonnet" # claude CLI 모델 별칭(vision 지원). VISION_LLM_MODEL/LLM_MODEL로 override.
  CLI_TIMEOUT = 120

  FIXED_KEYS = %w[name company department title mobile phone fax email website address raw_text].freeze

  SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 명함 OCR 추출기다. 주어진 경로의 명함 이미지 파일을 Read 도구로 열어 정보를 빠짐없이 추출한다.
    반드시 JSON만 출력한다(설명/마크다운/코드펜스 금지). 명함이 여러 장이면 JSON 배열로.
    각 명함 객체 키:
      name, company, department, title, mobile, phone, fax, email, website, address, raw_text
    그 외에 명함에 있는 추가 정보(SNS, 메신저ID, 추가 번호 등)는 해당 키 그대로 같은 객체에 넣는다.
    raw_text 에는 명함에서 읽은 모든 텍스트 원문을 넣는다.
    못 읽은 필드는 생략하거나 null. 값이 한국어/영어 혼용이면 보이는 그대로.
  PROMPT

  def initialize(attachment)
    @attachment = attachment
  end

  def call
    path = @attachment.file_path

    text = call_vision(path)
    parse_contacts(text) || begin
      retry_text = call_vision(path)
      parse_contacts(retry_text) || [ normalize({ "raw_text" => retry_text.to_s.strip }) ]
    end
  end

  private

  # 분리된 raw 호출 — 스펙에서 stub 한다.
  # 요약과 동일한 Claude CLI를 -p(print) 모드로 호출하고, 이미지 파일경로를 Read 툴로 인식시킨다.
  def call_vision(image_path)
    cli = ENV.fetch("CLAUDE_CLI_PATH", "claude")
    ensure_cli!(cli)

    prompt = "다음 경로의 명함 이미지 파일을 Read 도구로 열어 정보를 추출해 JSON으로만 답하라: #{image_path}"
    cmd = [
      cli, "-p", prompt,
      "--output-format", "text",
      "--system-prompt", SYSTEM_PROMPT,
      "--model", vision_model,
      "--allowedTools", "Read",
      "--permission-mode", "bypassPermissions"
    ]
    run_cli(cmd)
  end

  def vision_model
    ENV["VISION_LLM_MODEL"].presence || ENV["LLM_MODEL"].presence || DEFAULT_MODEL
  end

  def ensure_cli!(cli)
    return if cli.include?("/") && File.executable?(cli)

    found = ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).any? do |dir|
      path = File.join(dir, cli)
      File.executable?(path) && !File.directory?(path)
    end
    raise VisionUnavailable, "Claude CLI를 찾을 수 없습니다: '#{cli}' — 명함 인식 불가" unless found
  end

  def run_cli(cmd)
    require "open3"

    stdout_str = nil
    stderr_str = nil
    status = nil

    Open3.popen3(*cmd) do |stdin, stdout, stderr, wait_thr|
      stdin.close

      unless wait_thr.join(CLI_TIMEOUT)
        Process.kill("KILL", wait_thr.pid) rescue nil
        wait_thr.join
        raise VisionUnavailable, "명함 인식 CLI 응답 시간 초과 (#{CLI_TIMEOUT}초)"
      end

      stdout_str = stdout.read.to_s
      stderr_str = stderr.read.to_s
      status = wait_thr.value
    end

    unless status&.success?
      raise VisionUnavailable,
            "명함 인식 CLI 오류 (코드 #{status&.exitstatus}): #{stderr_str.to_s.strip.presence || '원인 불명'}"
    end
    stdout_str.strip
  end

  # 성공 시 Array<Hash(symbol keys)>, 실패(파싱불가) 시 nil
  def parse_contacts(text)
    json = extract_json(text)
    data = JSON.parse(json)
    list = data.is_a?(Array) ? data : [ data ]
    list.map { |h| normalize(h) }
  rescue JSON::ParserError, TypeError
    nil
  end

  def normalize(hash)
    return { raw_text: nil } unless hash.is_a?(Hash)
    contact = {}
    FIXED_KEYS.each { |k| contact[k.to_sym] = hash[k].presence }
    extra = hash.reject { |k, _| FIXED_KEYS.include?(k.to_s) }
    contact[:extra] = extra.presence || {}
    contact
  end

  def extract_json(text)
    s = text.to_s.strip
    if (m = s.match(/```(?:json)?\s*([\s\S]*?)```/))
      m[1].strip
    else
      s
    end
  end
end
