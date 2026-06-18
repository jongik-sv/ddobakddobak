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
