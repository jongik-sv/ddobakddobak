# Whisper가 조용한 구간에 생성하는 대표적 환각 문구
WHISPER_HALLUCINATIONS = %w[
  감사합니다 고맙습니다 감사합니다. 고맙습니다. 수고하셨습니다 수고하셨습니다.
  구독과\ 좋아요 시청해\ 주셔서\ 감사합니다 MBC 뉴스 KBS 뉴스
].freeze

class TranscriptionJob < ApplicationJob
  queue_as :real_time

  def perform(meeting_id:, audio_data:, sequence: 0, offset_ms: 0, diarization_config: nil, languages: nil, audio_source: "mic")
    meeting = Meeting.find(meeting_id)
    client = SidecarClient.new

    # offset_ms = 프론트엔드에서 계산한 청크 시작 시점 (녹음 시작 기준)
    # segment.started_at_ms / ended_at_ms = 청크 내 상대 위치
    # → 합산하면 녹음 시작 기준 절대 시간

    # 시스템 오디오는 모두 원격 참가자 → diarization 스킵
    effective_diarization = audio_source == "system" ? nil : diarization_config

    result = client.transcribe(audio_data, meeting_id: meeting_id, diarization_config: effective_diarization, languages: languages)
    segments = result["segments"] || []

    segments.each do |segment|
      text = segment["text"].to_s.strip
      next if text.empty?
      next if WHISPER_HALLUCINATIONS.any? { |h| text.gsub(/\s+/, " ") == h }

      global_started = offset_ms + segment.fetch("started_at_ms", 0)
      global_ended   = offset_ms + segment.fetch("ended_at_ms", 0)

      # 시스템 오디오 소스의 화자 라벨에 REMOTE 접두사
      speaker = segment.fetch("speaker_label", nil) || segment.fetch("speaker", "SPEAKER_00")
      speaker = "REMOTE_#{speaker}" if audio_source == "system" && !speaker.start_with?("REMOTE_")

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
        "meeting_#{meeting.id}_transcription",
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
