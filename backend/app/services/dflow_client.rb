require "net/http"

# D'Flow(회의록 아카이브) 서버 간 API 클라이언트.
# 계약 문서: tasks/dflow-minutes-upload/artifacts/dflow-minutes-upload-api-spec.md §3~§7.
# SidecarClient 패턴(sidecar_client.rb) 복제 — 전용 에러 계층 + with_connection + 공통 응답 파싱.
class DflowClient
  class Error < StandardError; end
  class ConnectionError < Error; end          # ECONNREFUSED/EHOSTUNREACH/SocketError
  class TimeoutError < Error; end             # Net::OpenTimeout/ReadTimeout
  class AuthError < Error; end                # 401(시크릿 불일치) / 404(미개통 — env 미설정, 계약 §3.2)
  class UnknownUserError < Error; end         # 403 code=unknown_user (계약 §3.4)
  class LinkConflictError < Error; end        # 409 code=link_conflict (계약 §4b)

  # 그 외 4xx/5xx — code·status 보존(원 code 그대로 컨트롤러까지 전파).
  class ApiError < Error
    attr_reader :code, :status

    def initialize(message, code: nil, status: nil)
      super(message)
      @code = code
      @status = status
    end
  end

  OPEN_TIMEOUT = 5   # Vercel cold start 감안
  READ_TIMEOUT = 20

  # base_url(뒤에 /api/v1 은 여기서 붙인다)·api_secret 은 settings.yaml dflow 섹션에서 읽는다
  # (T2 확정 인터페이스: AppSettings.load → cfg["dflow"]).
  attr_reader :base_url

  def initialize
    cfg = AppSettings.load
    dflow_cfg = cfg["dflow"] || {}
    @base_url = dflow_cfg["base_url"].to_s.chomp("/")
    @api_secret = dflow_cfg["api_secret"].to_s
  end

  # POST /api/v1/minutes → Hash(계약 §4.3)
  def upload_minute(payload)
    post("/minutes", payload)
  end

  # GET /api/v1/minutes → Hash(계약 §5.1)
  def list_minutes(params = {})
    get("/minutes", params)
  end

  # GET /api/v1/minutes/meta → Hash(계약 §5.2)
  def meta(project_id: nil)
    params = project_id.present? ? { project_id: project_id } : {}
    get("/minutes/meta", params)
  end

  # POST /api/v1/minutes/link → Hash(계약 §4b)
  def link_minute(minute_id:, external_id:, user_email:)
    post("/minutes/link", { minute_id: minute_id, external_id: external_id, user_email: user_email })
  end

  private

  def get(path, params = {})
    uri = build_uri(path, params)
    with_connection(uri) do |http|
      req = Net::HTTP::Get.new(uri)
      apply_headers(req)
      parse_response(http.request(req))
    end
  end

  def post(path, body)
    uri = build_uri(path)
    with_connection(uri) do |http|
      req = Net::HTTP::Post.new(uri)
      apply_headers(req)
      req.body = body.to_json
      parse_response(http.request(req))
    end
  end

  def apply_headers(req)
    req["Authorization"] = "Bearer #{@api_secret}"
    req["Content-Type"] = "application/json"
  end

  def build_uri(path, params = {})
    uri = URI.parse("#{@base_url}/api/v1#{path}")
    uri.query = URI.encode_www_form(params) if params.present?
    uri
  end

  def with_connection(uri)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    http.start { |conn| yield conn }
  rescue Net::OpenTimeout, Net::ReadTimeout
    raise TimeoutError, "D'Flow 요청이 시간 초과되었습니다"
  rescue Errno::ECONNREFUSED, Errno::EHOSTUNREACH, SocketError
    raise ConnectionError, "D'Flow 서버에 연결할 수 없습니다"
  end

  def parse_response(response)
    code = response.code.to_i
    return {} if code.between?(200, 299) && response.body.blank?
    return JSON.parse(response.body) if code.between?(200, 299)

    raise_for_error(code, safe_parse(response.body))
  end

  def safe_parse(raw)
    JSON.parse(raw.to_s)
  rescue JSON::ParserError
    {}
  end

  # 에러 메시지는 항상 우리가 직접 구성한 고정 문구 또는 D'Flow 응답의 error 필드만 사용한다.
  # api_secret 은 요청에만 쓰이고 응답 파싱 경로에는 전혀 등장하지 않으므로 노출될 수 없다.
  def raise_for_error(code, body)
    api_code = body["code"]
    message = body["error"].presence || "D'Flow 요청 실패 (#{code})"

    case code
    when 401
      raise AuthError, "D'Flow 인증 실패 — 시크릿이 일치하지 않습니다"
    when 404
      # ⚠️ D'Flow 404 는 두 가지 의미를 겸한다(계약 §3.2, §4b#1):
      #   ① env 미개통(존재 은닉) — Next 기본 404, JSON 바디·code 없음 → AuthError.
      #   ② link 의 minute_id 불존재 — JSON 바디 { code: "not_found" } 있음 → ApiError(code 보존).
      if api_code.present?
        raise ApiError.new(message, code: api_code, status: code)
      else
        raise AuthError, "D'Flow 미개통 또는 URL 오류입니다 — 설정을 확인하세요"
      end
    when 403
      raise UnknownUserError, message if api_code == "unknown_user"
      raise ApiError.new(message, code: api_code, status: code)
    when 409
      raise LinkConflictError, message if api_code == "link_conflict"
      raise ApiError.new(message, code: api_code, status: code)
    else
      raise ApiError.new(message, code: api_code, status: code)
    end
  end
end
