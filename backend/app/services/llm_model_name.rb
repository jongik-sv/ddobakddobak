# LLM 모델 id 를 사람이 읽기 좋은 표시명으로 변환한다(순수 함수, 절대 raise 안 함).
class LlmModelName
  CLAUDE = /\Aclaude-(?:(\d+)(?:-\d+)?-)?(opus|sonnet|haiku)-?(\d+)?/i
  GPT = /\Agpt-/i

  def self.humanize(model_id)
    s = model_id.to_s.strip
    return "AI" if s.blank?

    # 이미 공백/괄호가 있으면 친절한 표시명(CLI 등)으로 보고 그대로.
    return s if s.match?(/[ ()]/)

    if (m = s.match(CLAUDE))
      ver = m[1].presence || m[3] # claude-sonnet-4 → 4, claude-3-5-haiku → 3
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
