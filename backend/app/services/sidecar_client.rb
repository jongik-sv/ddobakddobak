require "net/http"

# STT 서버(Sidecar)와의 통신 클라이언트.
# STT(음성인식), 화자분리, 스피커 관리, HF 설정 전용.
# LLM 요약 기능은 LlmService로 이전됨.
class SidecarClient
  class SidecarError < StandardError; end
  class TimeoutError < SidecarError; end
  class ConnectionError < SidecarError; end

  TIMEOUT = 30

  def initialize
    @host = ENV.fetch("SIDECAR_HOST", "localhost")
    @port = ENV.fetch("SIDECAR_PORT", "13324").to_i
  end

  def health
    get("/health")
  end

  # ── STT ──

  def stt_engine_info
    get("/settings/stt-engine")
  end

  def update_stt_engine(engine)
    put("/settings/stt-engine", { engine: engine })
  end

  def transcribe(audio_base64, meeting_id: nil, diarization_config: nil, languages: nil, offset_ms: 0)
    body = { audio: audio_base64, offset_ms: offset_ms }
    body[:meeting_id] = meeting_id if meeting_id
    body[:diarization_config] = diarization_config if diarization_config
    body[:languages] = languages if languages
    post("/transcribe", body)
  end

  def transcribe_file(file_path, meeting_id: nil, diarization_config: nil, languages: nil, file_chunk_sec: nil)
    body = { file_path: file_path }
    body[:meeting_id] = meeting_id if meeting_id
    body[:diarization_config] = diarization_config if diarization_config
    body[:languages] = languages if languages
    body[:file_chunk_sec] = file_chunk_sec if file_chunk_sec
    post("/transcribe-file", body, timeout: 1800)
  end

  # ── Speakers ──

  def get_speakers(meeting_id)
    get("/speakers?meeting_id=#{meeting_id}")
  end

  def rename_speaker(speaker_id, name, meeting_id)
    encoded_id = URI.encode_uri_component(speaker_id)
    put("/speakers/#{encoded_id}?meeting_id=#{meeting_id}", { name: name })
  end

  def reset_speakers(meeting_id)
    delete("/speakers?meeting_id=#{meeting_id}")
  end

  # ── HuggingFace ──

  def get_hf_settings
    get("/settings/hf")
  end

  def update_hf_settings(hf_token)
    put("/settings/hf", { hf_token: hf_token })
  end

  private

  def get(path)
    with_connection do |http|
      req = Net::HTTP::Get.new(path)
      parse_response(http.request(req))
    end
  end

  def put(path, body)
    with_connection do |http|
      req = Net::HTTP::Put.new(path, "Content-Type" => "application/json")
      req.body = body.to_json
      parse_response(http.request(req))
    end
  end

  def delete(path)
    with_connection do |http|
      req = Net::HTTP::Delete.new(path)
      parse_response(http.request(req))
    end
  end

  def post(path, body, timeout: TIMEOUT)
    with_connection(timeout: timeout) do |http|
      req = Net::HTTP::Post.new(path, "Content-Type" => "application/json")
      req.body = body.to_json
      parse_response(http.request(req))
    end
  end

  def with_connection(timeout: TIMEOUT)
    http = Net::HTTP.new(@host, @port)
    http.open_timeout = timeout
    http.read_timeout = timeout
    http.keep_alive_timeout = 30
    http.start { |conn| yield conn }
  rescue Net::OpenTimeout, Net::ReadTimeout => e
    raise TimeoutError, "Sidecar request timed out: #{e.message}"
  rescue Errno::ECONNREFUSED, Errno::EHOSTUNREACH, SocketError => e
    raise ConnectionError, "Cannot connect to Sidecar: #{e.message}"
  end

  def parse_response(response)
    case response.code.to_i
    when 200..299
      JSON.parse(response.body)
    else
      body = JSON.parse(response.body) rescue {}
      detail = body["detail"] || body["error"] || response.body
      raise SidecarError, "#{response.code} #{detail}"
    end
  end
end
