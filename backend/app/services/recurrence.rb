# 반복 예약 규칙으로 다음 occurrence(미래)를 계산하는 순수 모듈.
# 규칙 포맷: { "freq" => "weekly"|"daily", "days" => [0..6], "time" => "HH:MM", "tz" => "<IANA>" }
#   - days: 0=일~6=토 (JS Date.getDay 와 동일). weekly 에서만 사용, daily 는 무시.
#   - time: 벽시계 "HH:MM".
#   - tz: IANA 타임존. wall-clock 해석에만 사용한다(반환값은 항상 UTC).
# DST 함정: 시각에 일/초를 더하는 산술은 DST 경계에서 벽시계가 어긋난다 →
# 후보 날짜마다 tz.local(...) 로 in-zone 구성해 벽시계 시각을 보존한다.
module Recurrence
  module_function

  # 규칙 기준 `after` 보다 엄격히 미래인 다음 occurrence 의 UTC Time. 비반복/불완전 규칙은 nil.
  def next_occurrence(rule, after:)
    return nil if rule.blank?

    rule = rule.symbolize_keys
    time = rule[:time].to_s
    return nil if time.blank?

    hour, min = time.split(":").map(&:to_i)
    tz = ActiveSupport::TimeZone[rule[:tz].to_s] || Time.zone
    start = after.in_time_zone(tz)

    case rule[:freq].to_s
    when "weekly"
      days = Array(rule[:days]).map(&:to_i)
      return nil if days.empty?

      # 오늘(offset 0)부터 7일 뒤(offset 7)까지 스캔 — offset 7 은 "오늘 요일의 시각이 이미
      # 지나 다음 주 같은 요일로 wrap" 케이스를 잡는다(0..6 만 보면 nil 이 새어나간다).
      (0..7).each do |offset|
        date = (start + offset.days).to_date
        next unless days.include?(date.wday)

        candidate = tz.local(date.year, date.month, date.day, hour, min)
        return candidate.utc if candidate > after
      end
      nil
    when "daily"
      # 오늘 시각이 아직 미래면 오늘, 지났으면 내일.
      (0..1).each do |offset|
        date = (start + offset.days).to_date
        candidate = tz.local(date.year, date.month, date.day, hour, min)
        return candidate.utc if candidate > after
      end
      nil
    end
  end
end
