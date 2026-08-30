# 외부 공개 API(/api/ext) rate limit. 다른 경로는 건드리지 않는다(discriminator가 nil을
# 반환하면 rack-attack이 그 요청을 이 throttle에서 아예 카운트하지 않는다).
#
# 식별자: Authorization 헤더의 평문 토큰을 SHA256으로 hash해 캐시 키로 쓴다(평문 자체를
# 캐시에 남기지 않기 위함 — ApiToken#token_digest와 같은 해시 방식). 토큰이 없으면 IP.
# ⚠️ 미들웨어 레이어에서 DB 조회(토큰 유효성 검증 등)는 하지 않는다 — digest 계산만.
class Rack::Attack
  EXT_API_PREFIX = "/api/ext/".freeze

  def self.ext_api_request?(req)
    req.path.start_with?(EXT_API_PREFIX)
  end

  def self.ext_api_read_method?(req)
    req.get? || req.head?
  end

  def self.ext_api_discriminator(req)
    plaintext = req.get_header("HTTP_AUTHORIZATION").to_s[/\ABearer\s+(.+)\z/, 1]
    plaintext.present? ? Digest::SHA256.hexdigest(plaintext) : req.ip
  end

  # 토큰별(또는 토큰 없으면 IP별) 버킷. 공격자가 매 요청마다 무작위 Bearer 값을 바꾸면
  # digest가 매번 달라져 이 버킷이 무한히 분산되고 한도에 영영 도달하지 않는다 — 그 우회를
  # 막는 게 아래 ext-api/ip(IP 고정 버킷)의 역할이다.
  throttle("ext-api/read", limit: 120, period: 1.minute) do |req|
    ext_api_discriminator(req) if ext_api_request?(req) && ext_api_read_method?(req)
  end

  throttle("ext-api/write", limit: 20, period: 1.minute) do |req|
    ext_api_discriminator(req) if ext_api_request?(req) && !ext_api_read_method?(req)
  end

  # IP 고정 버킷(토큰과 무관) — 토큰을 매 요청 바꿔 위 두 throttle을 우회하는 무자격 폭주를
  # 잡는다. 정상 사용(같은 토큰 반복 호출)은 위 read/write 버킷이 더 먼저 걸리므로 실사용에
  # 영향 없고, "공정 사용"은 read/write가, "무자격 폭주"는 이 버킷이 담당한다.
  throttle("ext-api/ip", limit: 300, period: 1.minute) do |req|
    req.ip if ext_api_request?(req)
  end

  self.throttled_responder = lambda do |_req|
    [
      429,
      { "Content-Type" => "application/json" },
      [ { error: { code: "rate_limited", message: "요청 한도를 초과했습니다. 잠시 후 다시 시도하세요." } }.to_json ]
    ]
  end
end
