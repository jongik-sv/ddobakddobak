# 외부 공개 API(/api/ext) rate limit. 다른 경로는 건드리지 않는다(discriminator가 nil을
# 반환하면 rack-attack이 그 요청을 이 throttle에서 아예 카운트하지 않는다).
#
# 식별자: Authorization 헤더의 평문 토큰을 SHA256으로 hash해 캐시 키로 쓴다(평문 자체를
# 캐시에 남기지 않기 위함 — ApiToken#token_digest와 같은 해시 방식). 토큰이 없으면 IP.
class Rack::Attack
  EXT_API_PREFIX = "/api/ext/".freeze

  def self.ext_api_request?(req)
    req.path.start_with?(EXT_API_PREFIX)
  end

  def self.ext_api_discriminator(req)
    plaintext = req.get_header("HTTP_AUTHORIZATION").to_s[/\ABearer\s+(.+)\z/, 1]
    plaintext.present? ? Digest::SHA256.hexdigest(plaintext) : req.ip
  end

  throttle("ext-api/read", limit: 120, period: 1.minute) do |req|
    ext_api_discriminator(req) if ext_api_request?(req) && req.get?
  end

  throttle("ext-api/write", limit: 20, period: 1.minute) do |req|
    ext_api_discriminator(req) if ext_api_request?(req) && !req.get?
  end

  self.throttled_responder = lambda do |_req|
    [
      429,
      { "Content-Type" => "application/json" },
      [ { error: { code: "rate_limited", message: "요청 한도를 초과했습니다. 잠시 후 다시 시도하세요." } }.to_json ]
    ]
  end
end
