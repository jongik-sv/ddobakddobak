# 이미 전사된 회의에 대해 STT(whisper) 없이 화자분리만 재실행한다.
# 트랜스크립트 원문은 유지하고, 회의의 diarization_threshold 에 맞춰 speaker_label 만 재할당,
# speaker_name 은 초기화한다. sidecar /diarize-file 가 내부적으로 speakrs 실행 + SpeakerDB 등록까지 처리한다.
class ReDiarizeJob < ApplicationJob
  include PcmConvertible
  queue_as :file_transcription

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.transcribing?
    channel = meeting.transcription_stream

    transcripts = meeting.transcripts.order(:sequence_number).to_a
    if transcripts.empty?
      meeting.update(status: :completed)
      return
    end

    pcm_path = convert_to_pcm(meeting)
    broadcast_progress(channel, 20, "음성 파일 변환 완료")

    diarization_config = AppSettings.diarization_config
    diarization_config["enable"] = true
    if meeting.expected_participants.present?
      diarization_config["expected_speakers"] = meeting.expected_participants
    end
    if meeting.diarization_threshold.present?
      diarization_config["ahc_threshold"] = meeting.diarization_threshold
    end

    segments = transcripts.map { |t| { started_at_ms: t.started_at_ms, ended_at_ms: t.ended_at_ms } }
    result = SidecarClient.new.diarize_file(
      pcm_path, meeting_id: meeting.id, segments: segments, diarization_config: diarization_config
    )
    broadcast_progress(channel, 80, "화자 분리 완료")

    returned = result["segments"] || []
    # 입력 순서 보존 → sequence_number 순 transcripts 와 zip. speaker_name 은 라벨 매핑 변경으로 초기화.
    transcripts.each_with_index do |t, i|
      seg = returned[i]
      next unless seg && seg["speaker_label"].present?
      t.update_columns(speaker_label: seg["speaker_label"], speaker_name: nil)
    end

    meeting.update!(status: :completed, transcription_progress: 100)
    ActionCable.server.broadcast(channel, { type: "file_transcription_complete", meeting_id: meeting.id })
    File.delete(pcm_path) if pcm_path && File.exist?(pcm_path)
    Rails.logger.info "[ReDiarizeJob] meeting=#{meeting.id} 완료"
  rescue => e
    Rails.logger.error "[ReDiarizeJob] meeting=#{meeting_id} error=#{e.class}: #{e.message}"
    meeting&.update(status: :completed)
    ActionCable.server.broadcast(meeting.transcription_stream, { type: "file_transcription_error", error: e.message }) if meeting
  end

  private

  def broadcast_progress(channel, percent, message = nil)
    ActionCable.server.broadcast(channel, { type: "transcription_progress", progress: percent, message: message })
  end
end
