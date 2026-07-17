require "base64"

class TranscriptionJob < ApplicationJob
  queue_as :real_time

  # 회의가 이미 삭제된 뒤 실행되면 재시도할 이유가 없다 — 즉시 폐기.
  # (오디오 파일이 남아 있어도 SttChunkStorage.sweep! 이 흡수한다.)
  discard_on ActiveRecord::RecordNotFound

  # Sidecar 타임아웃/연결 실패는 일시적일 가능성이 높으므로 재시도한다.
  # 재시도 소진 시(청크 유실 확정)에도 파일은 여기서 지우지 않는다 — sweeper 몫.
  retry_on SidecarClient::TimeoutError, SidecarClient::ConnectionError,
           wait: 5.seconds, attempts: 3 do |job, error|
    # audio_data(구형 인라인 base64, 최대 ~427KB)는 로그에서 제외 — 통째로 찍히면
    # 디스크 풀 등 폴백 활성 상황에서 에러 로그가 디스크 압박을 더 악화시킨다.
    safe_args = job.arguments.map { |arg| arg.is_a?(Hash) ? arg.except(:audio_data, "audio_data") : arg }
    Rails.logger.error(
      "[TranscriptionJob] 재시도 소진 — 청크 유실 (job_id=#{job.job_id}, args=#{safe_args.inspect}): #{error.message}"
    )
  end

  WHISPER_HALLUCINATIONS = %w[
    감사합니다 고맙습니다 감사합니다. 고맙습니다. 수고하셨습니다 수고하셨습니다.
    구독과\ 좋아요 시청해\ 주셔서\ 감사합니다 MBC 뉴스 KBS 뉴스
  ].freeze

  # audio_data(구형, 인라인 base64) / audio_path(신형, 디스크 경로) 겸용 시그니처.
  # 배포 순간 큐에 남아 있던 구형 잡(audio_data)이 그대로 소화되어야 하므로 둘 다 옵션.
  def perform(meeting_id:, audio_data: nil, audio_path: nil, sequence: 0, offset_ms: 0, diarization_config: nil, languages: nil, mode: "single", audio_source: "mic")
    meeting = Meeting.find(meeting_id)

    audio_base64 =
      if audio_path.present?
        Base64.strict_encode64(File.binread(audio_path))
      elsif audio_data.present?
        audio_data.to_s
      end

    if audio_base64.nil?
      Rails.logger.warn "[TranscriptionJob] audio_data/audio_path 모두 없음 (meeting=#{meeting_id}) — 스킵"
      return
    end

    client = SidecarClient.new

    # offset_ms = 프론트엔드에서 계산한 청크 시작 시점 (녹음 시작 기준)
    # segment.started_at_ms / ended_at_ms = 청크 내 상대 위치
    # → 합산하면 녹음 시작 기준 절대 시간

    result = client.transcribe(audio_base64, meeting_id: meeting_id, diarization_config: diarization_config, languages: languages, mode: mode, offset_ms: offset_ms)
    segments = result["segments"] || []

    segments.each do |segment|
      text = segment["text"].to_s.strip
      next if text.empty?
      next if WHISPER_HALLUCINATIONS.any? { |h| text.gsub(/\s+/, " ") == h }

      global_started = offset_ms + segment.fetch("started_at_ms", 0)
      global_ended   = offset_ms + segment.fetch("ended_at_ms", 0)

      speaker = segment.fetch("speaker_label", nil) || segment.fetch("speaker", nil) || "화자 1"

      transcript = Transcript.create!(
        meeting: meeting,
        content: text,
        speaker_label: speaker,
        audio_source: audio_source,
        started_at_ms: global_started,
        ended_at_ms: global_ended,
        sequence_number: sequence
      )

      ActionCable.server.broadcast(
        meeting.transcription_stream,
        {
          id: transcript.id,
          type: segment.fetch("type", "final"),
          text: transcript.content,
          speaker: transcript.speaker_label,
          audio_source: transcript.audio_source,
          started_at_ms: transcript.started_at_ms,
          ended_at_ms: transcript.ended_at_ms,
          seq: transcript.sequence_number,
          created_at: transcript.created_at.iso8601
        }
      )
    end

    delete_chunk_file(audio_path)
  rescue Errno::ENOENT => e
    # audio_path 파일이 이미 사라짐(스위퍼가 선점 등) — 재시도해도 의미 없으므로 그냥 종료.
    Rails.logger.warn "[TranscriptionJob] 청크 파일 유실 meeting=#{meeting_id} path=#{audio_path}: #{e.message}"
  rescue SidecarClient::TimeoutError, SidecarClient::ConnectionError
    # 여기서 삼키면 retry_on(위)이 절대 발동하지 않는다 — 반드시 재전파.
    # 파일은 재시도를 위해 보존한다(삭제하지 않음).
    raise
  rescue SidecarClient::SidecarError => e
    # 재시도 무의미한 4xx/5xx 등 — 로그 후 드랍 확정, 파일 삭제.
    Rails.logger.error "[TranscriptionJob] Sidecar error for meeting #{meeting_id}: #{e.message}"
    delete_chunk_file(audio_path)
  end

  private

  # 성공 완료 시 + 비재시도 SidecarError로 드랍 확정 시에만 호출된다.
  # ensure 에서 호출하지 않는다 — 재시도 시 파일이 살아있어야 하므로.
  def delete_chunk_file(audio_path)
    return unless audio_path.present?

    File.delete(audio_path)
  rescue Errno::ENOENT
    # 이미 삭제됨(스위퍼 등과의 경합) — 무해.
  end
end
