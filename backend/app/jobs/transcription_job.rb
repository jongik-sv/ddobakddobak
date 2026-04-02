class TranscriptionJob < ApplicationJob
  queue_as :real_time

  WHISPER_HALLUCINATIONS = %w[
    감사합니다 고맙습니다 감사합니다. 고맙습니다. 수고하셨습니다 수고하셨습니다.
    구독과\ 좋아요 시청해\ 주셔서\ 감사합니다 MBC 뉴스 KBS 뉴스
  ].freeze

  def perform(meeting_id:, audio_data:, sequence: 0, offset_ms: 0, diarization_config: nil, languages: nil, audio_source: "mic")
    meeting = Meeting.find(meeting_id)
    client = SidecarClient.new

    # offset_ms = 프론트엔드에서 계산한 청크 시작 시점 (녹음 시작 기준)
    # segment.started_at_ms / ended_at_ms = 청크 내 상대 위치
    # → 합산하면 녹음 시작 기준 절대 시간

    result = client.transcribe(audio_data, meeting_id: meeting_id, diarization_config: diarization_config, languages: languages, offset_ms: offset_ms)
    segments = result["segments"] || []

    segments.each do |segment|
      text = segment["text"].to_s.strip
      next if text.empty?
      next if WHISPER_HALLUCINATIONS.any? { |h| text.gsub(/\s+/, " ") == h }

      global_started = offset_ms + segment.fetch("started_at_ms", 0)
      global_ended   = offset_ms + segment.fetch("ended_at_ms", 0)

      speaker = segment.fetch("speaker_label", nil) || segment.fetch("speaker", "SPEAKER_00")

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
  rescue SidecarClient::SidecarError => e
    Rails.logger.error "[TranscriptionJob] Sidecar error for meeting #{meeting_id}: #{e.message}"
  end
end
