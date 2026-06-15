# 비-텍스트 안건 첨부를 claude CLI(uv run --with <lib>)로 추출해 <file_path>.extracted/ 에 md 기록.
# 이미지는 Vision(Read)로 OCR. 명함 OCR(CardExtractionService)과 동일한 CLI shell-out 패턴.
class AgendaExtractionService
  class ExtractionUnavailable < StandardError; end

  CLI_TIMEOUT = (ENV["AGENDA_EXTRACTION_TIMEOUT"] || "300").to_i
  IMAGE_TYPES = %w[image/png image/jpeg image/gif image/webp].freeze

  def initialize(attachment)
    @attachment = attachment
  end

  # 추출 실행 → 기록된 md 경로 배열(정렬) 반환. 원본 없으면 [].
  def call
    return [] unless @attachment.file? && @attachment.file_path.present? && File.exist?(@attachment.file_path)

    dir = @attachment.extraction_dir
    FileUtils.mkdir_p(dir)
    run_cli(build_command(dir))
    Dir.glob(File.join(dir, "*.md")).sort
  end

  # content_type별 추출 지시문. (스펙 대상 — 분기 검증)
  def extraction_prompt(dir)
    base = File.basename(@attachment.original_filename.to_s)
    path = @attachment.file_path
    common = "추출 결과 markdown을 '#{dir}/' 폴더에 Write 하라. 임베디드 이미지는 무시(텍스트만). "

    if IMAGE_TYPES.include?(@attachment.content_type)
      "'#{path}' 이미지를 Read 도구로 열어 보이는 텍스트를 OCR 추출해 '#{dir}/#{base}.md' 로 Write 하라. " \
      "차트/도표는 텍스트·수치만 옮기고 그림 복원은 하지 마라."
    elsif xlsx?
      common +
        "'#{path}' 를 `uv run --with openpyxl python` 으로 열어 각 시트를 markdown 표로 추출하고 " \
        "시트별로 '#{base}.sheet1.md', '#{base}.sheet2.md' … 처럼 Write 하라. 네이티브 차트는 데이터표로."
    elsif pptx?
      common +
        "'#{path}' 를 `uv run --with python-pptx python` 으로 열어 슬라이드 텍스트·표를 markdown 으로 추출해 " \
        "'#{base}.md' 로 Write 하라. 네이티브 차트 객체는 카테고리+값을 표로 추출하라(그림 복원 금지)."
    elsif docx?
      common +
        "'#{path}' 를 `uv run --with python-docx python` 으로 열어 본문·표를 markdown 으로 추출해 '#{base}.md' 로 Write 하라."
    else # pdf 등
      common +
        "'#{path}' 를 `uv run --with pdfplumber python` 으로 열어 텍스트·표를 markdown 으로 추출해 '#{base}.md' 로 Write 하라. " \
        "Read 도구로 직접 읽어도 된다."
    end
  end

  private

  def xlsx?
    @attachment.content_type.to_s.include?("spreadsheet") || @attachment.content_type == "application/vnd.ms-excel"
  end

  def pptx?
    @attachment.content_type.to_s.include?("presentation") || @attachment.content_type == "application/vnd.ms-powerpoint"
  end

  def docx?
    @attachment.content_type.to_s.include?("word") || @attachment.content_type == "application/msword"
  end

  def build_command(dir)
    cli = ENV.fetch("CLAUDE_CLI_PATH", "claude")
    ensure_cli!(cli)
    model = ENV["VISION_LLM_MODEL"].presence || ENV["LLM_MODEL"].presence || "sonnet"
    [
      cli, "-p", extraction_prompt(dir),
      "--output-format", "text",
      "--allowedTools", "Read Bash Write",
      "--permission-mode", "bypassPermissions",
      "--model", model
    ]
  end

  def ensure_cli!(cli)
    return if cli.include?("/") && File.executable?(cli)
    found = ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).any? do |d|
      p = File.join(d, cli)
      File.executable?(p) && !File.directory?(p)
    end
    raise ExtractionUnavailable, "Claude CLI를 찾을 수 없습니다: '#{cli}'" unless found
  end

  def run_cli(cmd)
    require "open3"
    Open3.popen3(*cmd) do |stdin, stdout, stderr, wait_thr|
      stdin.close
      unless wait_thr.join(CLI_TIMEOUT)
        Process.kill("KILL", wait_thr.pid) rescue nil
        wait_thr.join
        raise ExtractionUnavailable, "추출 CLI 응답 시간 초과 (#{CLI_TIMEOUT}초)"
      end
      status = wait_thr.value
      raise ExtractionUnavailable, "추출 CLI 오류 (#{status&.exitstatus}): #{stderr.read.to_s.strip}" unless status&.success?
    end
  end
end
