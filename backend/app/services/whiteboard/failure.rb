# 실패 분류 — frontend/src/lib/whiteboard/failure.ts 의 Ruby 사본(design.md §7, §11.4).
module Whiteboard
  # exit 0 출력이 로그인/한도 안내라 재요청 없이 즉시 실패시킬 때 쓰는 내부 예외.
  class OutputFailure < StandardError
    attr_reader :result

    def initialize(result)
      @result = result
      super(result.message)
    end
  end

  module Failure
    MESSAGES = {
      "auth" => "서버 PC의 Claude Code 로그인이 필요합니다. 관리자에게 알려 주세요.",
      "rate_limit" => "Claude 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
      "format" => "Claude 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.",
      "timeout" => "3분 안에 응답이 없어 중단했습니다. 다시 시도해 주세요.",
      "not_found" => "서버에서 Claude Code를 찾을 수 없습니다."
    }.freeze

    AUTH_RE = %r{login|not logged in|authenticat|/login|\b401\b|oauth}i
    RATE_RE = /rate limit|usage limit|limit reached|\b429\b|quota/i

    Result = Struct.new(:kind, :message)

    module_function

    def classify(error)
      case error
      when Whiteboard::ValidationError
        return Result.new("format", MESSAGES["format"])
      when LlmService::CliTimeoutError
        return Result.new("timeout", MESSAGES["timeout"])
      when Errno::ENOENT
        return Result.new("not_found", MESSAGES["not_found"])
      end
      haystack = [ error.message, (error.respond_to?(:stderr) ? error.stderr : nil),
                   (error.respond_to?(:stdout_tail) ? error.stdout_tail : nil) ].compact.join("\n")
      return Result.new("auth", MESSAGES["auth"]) if AUTH_RE.match?(haystack)
      return Result.new("rate_limit", MESSAGES["rate_limit"]) if RATE_RE.match?(haystack)

      # LlmError 메시지는 우리가 작성한 안내문이라 노출 가능. 그 밖 예외는 내부 정보 보호를 위해 일반 문구.
      detail = error.is_a?(LlmService::LlmError) ? error.message.gsub(/\s+/, " ").strip[0, 120] : "알 수 없는 오류"
      Result.new("unknown", "화이트보드를 만들지 못했습니다: #{detail.presence || '알 수 없는 오류'}")
    end

    # exit 0 인데 JSON 이 아닌 짧은 출력이 로그인/한도 안내일 때만 분류한다(재요청 낭비 방지).
    def classify_output(text)
      t = text.to_s
      return nil if t.length > 1000
      return Result.new("auth", MESSAGES["auth"]) if AUTH_RE.match?(t)
      return Result.new("rate_limit", MESSAGES["rate_limit"]) if RATE_RE.match?(t)
      nil
    end
  end
end
