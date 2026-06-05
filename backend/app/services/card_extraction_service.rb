require "base64"

# 명함 이미지 → Vision OCR(Anthropic) → 구조화 연락처 배열.
# per-user 요약 LLM과 분리: 전용 Anthropic 클라이언트(ANTHROPIC_AUTH_TOKEN + vision 모델).
class CardExtractionService
  class VisionUnavailable < StandardError; end

  DEFAULT_MODEL = "claude-sonnet-4-20250514"
  MAX_TOKENS = 2000

  FIXED_KEYS = %w[name company department title mobile phone fax email website address raw_text].freeze

  MEDIA_TYPES = {
    "image/jpeg" => :"image/jpeg",
    "image/png"  => :"image/png",
    "image/gif"  => :"image/gif",
    "image/webp" => :"image/webp"
  }.freeze

  SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 명함 OCR 추출기다. 이미지의 명함에서 정보를 빠짐없이 추출한다.
    반드시 JSON만 출력한다(설명/마크다운 금지). 명함이 여러 장이면 JSON 배열로.
    각 명함 객체 키:
      name, company, department, title, mobile, phone, fax, email, website, address, raw_text
    그 외에 명함에 있는 추가 정보(SNS, 메신저ID, 추가 번호 등)는 해당 키 그대로 같은 객체에 넣는다.
    raw_text 에는 명함에서 읽은 모든 텍스트 원문을 넣는다.
    못 읽은 필드는 생략하거나 null. 값이 한국어/영어 혼용이면 보이는 그대로.
  PROMPT

  USER_TEXT = "이 명함 이미지에서 정보를 추출해 위 형식의 JSON으로만 답하라.".freeze

  def initialize(attachment)
    @attachment = attachment
  end

  def call
    base64     = Base64.strict_encode64(File.binread(@attachment.file_path))
    media_type = MEDIA_TYPES.fetch(@attachment.content_type, :"image/jpeg")

    text = call_vision(base64, media_type)
    parse_contacts(text) || begin
      retry_text = call_vision(base64, media_type)
      parse_contacts(retry_text) || [ normalize({ "raw_text" => retry_text.to_s.strip }) ]
    end
  end

  private

  # 분리된 raw 호출 — 스펙에서 stub 한다.
  def call_vision(base64, media_type)
    client = Anthropic::Client.new(api_key: vision_api_key!)
    resp = client.messages.create(
      model: ENV.fetch("VISION_LLM_MODEL", DEFAULT_MODEL),
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [ {
        role: "user",
        content: [
          { type: :text, text: USER_TEXT },
          { type: :image, source: { type: :base64, media_type: media_type, data: base64 } }
        ]
      } ]
    )
    block = resp.content&.first
    raise "Vision API가 빈 응답을 반환했습니다" unless block.respond_to?(:text)
    block.text
  end

  def vision_api_key!
    key = ENV["ANTHROPIC_AUTH_TOKEN"].to_s
    raise VisionUnavailable, "ANTHROPIC_AUTH_TOKEN 미설정 — 명함 인식 불가" if key.strip.empty?
    key
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
