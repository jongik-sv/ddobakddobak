require "net/http"

class SidecarClient
  class SidecarError < StandardError; end
  class TimeoutError < SidecarError; end
  class ConnectionError < SidecarError; end

  TIMEOUT = 30

  def initialize
    @host = ENV.fetch("SIDECAR_HOST", "localhost")
    @port = ENV.fetch("SIDECAR_PORT", "8000").to_i
  end

  def health
    get("/health")
  end

  def stt_engine_info
    get("/settings/stt-engine")
  end

  def update_stt_engine(engine)
    put("/settings/stt-engine", { engine: engine })
  end

  def transcribe(audio_base64, meeting_id: nil, diarization_config: nil, languages: nil)
    body = { audio: audio_base64 }
    body[:meeting_id] = meeting_id if meeting_id
    body[:diarization_config] = diarization_config if diarization_config
    body[:languages] = languages if languages
    post("/transcribe", body)
  end

  def transcribe_file(file_path, meeting_id: nil, diarization_config: nil)
    body = { file_path: file_path }
    body[:meeting_id] = meeting_id if meeting_id
    body[:diarization_config] = diarization_config if diarization_config
    post("/transcribe-file", body, timeout: 1800)
  end

  def summarize(transcripts, type: "realtime", context: nil)
    body = { transcripts: transcripts, type: type }
    body[:context] = context if context
    post("/summarize", body)
  end

  def summarize_action_items(transcripts)
    post("/summarize/action-items", { transcripts: transcripts })
  end

  def refine_notes(current_notes, transcripts, meeting_title: "", meeting_type: "general")
    post("/refine-notes", {
      current_notes: current_notes,
      transcripts: transcripts,
      meeting_title: meeting_title,
      meeting_type: meeting_type
    })
  end

  def feedback_notes(current_notes, feedback, meeting_title: "")
    post("/feedback-notes", {
      current_notes: current_notes,
      feedback: feedback,
      meeting_title: meeting_title
    })
  end

  def get_llm_settings
    get("/settings/llm")
  end

  def update_llm_settings(params)
    put("/settings/llm", params)
  end

  def get_hf_settings
    get("/settings/hf")
  end

  def update_hf_settings(hf_token)
    put("/settings/hf", { hf_token: hf_token })
  end

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
      raise SidecarError, detail.to_s
    end
  end
end
