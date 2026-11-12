# 보드 JSON 추출·검증 — frontend/src/lib/whiteboard/schema.ts 의 Ruby 사본(design.md §5).
module Whiteboard
  class ValidationError < StandardError; end

  module Board
    TAGS = %w[확정 검토 미결].freeze
    ZONE_KINDS = %w[topic decision issue todo schedule].freeze
    LIMITS = { title: 120, headline: 200, text: 300, person: 60, zones: 12, items: 20 }.freeze

    module_function

    # 앞뒤 공백·```json 펜스 제거 후 첫 `{`~마지막 `}` 를 JSON 파싱.
    def extract_json(text)
      s = text.to_s.strip
      s = s.sub(/\A```[a-zA-Z]*\s*\n?/, "").sub(/\n?```\s*\z/, "").strip
      start = s.index("{")
      stop = s.rindex("}")
      fail!("JSON 객체를 찾을 수 없음") if start.nil? || stop.nil? || stop <= start
      begin
        JSON.parse(s[start..stop])
      rescue JSON::ParserError => e
        fail!("JSON 파싱 실패: #{e.message}")
      end
    end

    def parse_response(text)
      validate(extract_json(text))
    end

    def validate(raw)
      fail!("최상위 값이 객체가 아님") unless raw.is_a?(Hash)
      title = req_string(raw, "title", "board", LIMITS[:title])
      date = req_string(raw, "date", "board", 40)
      headline = req_string(raw, "headline", "board", LIMITS[:headline])
      fail!("zones가 비었거나 배열이 아님") if !raw["zones"].is_a?(Array) || raw["zones"].empty?

      # 빈 구역 제거 → 12개 절단 → 검증(비객체 구역은 남겨 검증에서 걸리게 한다)
      candidates = raw["zones"]
                   .reject { |z| z.is_a?(Hash) && z["items"].is_a?(Array) && z["items"].empty? }
                   .first(LIMITS[:zones])
      fail!("항목이 있는 구역이 없음") if candidates.empty?

      zones = []
      candidates.each_with_index do |z, zi|
        where = "zones[#{zi}]"
        fail!("#{where}가 객체가 아님") unless z.is_a?(Hash)
        z_title = req_string(z, "title", where, LIMITS[:title])
        fail!("#{where}.kind가 허용 값이 아님") unless z["kind"].is_a?(String) && ZONE_KINDS.include?(z["kind"])
        fail!("#{where}.items가 배열이 아님") unless z["items"].is_a?(Array)
        items = z["items"].first(LIMITS[:items]).each_with_index.map do |it, ii|
          iw = "#{where}.items[#{ii}]"
          fail!("#{iw}가 객체가 아님") unless it.is_a?(Hash)
          text = req_string(it, "text", iw, LIMITS[:text])
          fail!("#{iw}.text가 빈 문자열") if text.empty?
          tag = it["tag"]
          unless tag.nil?
            fail!("#{iw}.tag가 허용 값이 아님") unless tag.is_a?(String) && TAGS.include?(tag)
          end
          { "text" => text, "tag" => tag, "who" => opt_string(it["who"], LIMITS[:person]),
            "due" => opt_string(it["due"], LIMITS[:person]) }
        end
        zones << { "title" => z_title, "kind" => z["kind"], "items" => items } unless items.empty?
      end
      fail!("항목이 있는 구역이 없음") if zones.empty?
      { "title" => title, "date" => date, "headline" => headline, "zones" => zones }
    end

    def req_string(obj, key, where, max)
      v = obj[key]
      fail!("#{where}.#{key}가 문자열이 아님") unless v.is_a?(String)
      strip_u(v)[0, max]
    end

    def opt_string(v, max)
      return nil unless v.is_a?(String)
      t = strip_u(v)[0, max]
      t.empty? ? nil : t
    end

    # JS String.prototype.trim 과 맞추기 위해 유니코드 공백(NBSP, 전각 공백 등)까지 제거한다.
    def strip_u(v)
      v.gsub(/\A[[:space:]\uFEFF]+|[[:space:]\uFEFF]+\z/, "")
    end

    def fail!(msg)
      raise ValidationError, msg
    end
  end
end
