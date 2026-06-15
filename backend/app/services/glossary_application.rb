# 교정 엔트리 배열을 텍스트에 순차 적용한다.
# entry = { from:, to:, match_type: "literal"|"regex" }
# regex 는 사용자 입력 → 백그라운드 잡에서 무인 실행되므로 ReDoS 가드 필수:
#   per-pattern Regexp.timeout + 적용 중 타임아웃/컴파일 오류 시 해당 엔트리만 스킵.
class GlossaryApplication
  REGEX_TIMEOUT = 0.5 # seconds

  def self.apply(text, entries)
    return text if text.blank? || entries.blank?
    entries.reduce(text) { |acc, e| apply_one(acc, e) }
  end

  def self.apply_one(text, entry)
    if entry[:match_type] == "regex"
      re = Regexp.new(entry[:from].to_s, timeout: REGEX_TIMEOUT)
      text.gsub(re, entry[:to].to_s)
    else
      text.gsub(entry[:from].to_s, entry[:to].to_s)
    end
  rescue Regexp::TimeoutError, RegexpError => err
    Rails.logger.warn("[glossary] regex skip from=#{entry[:from].inspect} err=#{err.class}")
    text
  end
end
