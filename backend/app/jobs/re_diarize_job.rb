# 이미 전사된 회의에 대해 STT(whisper) 없이 화자분리만 재실행한다.
# 트랜스크립트 원문은 유지하고, 회의의 diarization_threshold 에 맞춰 speaker_label 만 재할당하며,
# speaker_name(비정규화 사본)은 SpeakerDB 에 보존된 이름을 새 라벨에 재적용한다(유지).
# sidecar /diarize-file 가 내부적으로 speakrs 실행 + SpeakerDB 등록(기존 이름 보존)까지 처리한다.
class ReDiarizeJob < ApplicationJob
  include PcmConvertible
  queue_as :file_transcription

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.transcribing?
    channel = meeting.transcription_stream

    transcripts = meeting.transcripts.order(:sequence_number).to_a
    if transcripts.empty?
      meeting.update(status: :completed, re_diarize_started_at: nil)
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
    # 이름의 진실원천은 SpeakerDB(sidecar). 재실행해도 SpeakerDB 이름은 보존되므로,
    # 비정규화 사본 speaker_name 을 새 라벨 기준으로 SpeakerDB 에서 재적용한다(초기화 아님).
    name_by_label = fetch_speaker_names(meeting.id)
    # 입력 순서 보존 → sequence_number 순 transcripts 와 zip.
    transcripts.each_with_index do |t, i|
      seg = returned[i]
      next unless seg && seg["speaker_label"].present?
      label = seg["speaker_label"]
      t.update_columns(speaker_label: label, speaker_name: name_by_label[label])
    end

    meeting.update!(status: :completed, transcription_progress: 100, re_diarize_started_at: nil)
    ActionCable.server.broadcast(channel, { type: "file_transcription_complete", meeting_id: meeting.id })
    File.delete(pcm_path) if pcm_path && File.exist?(pcm_path)
    Rails.logger.info "[ReDiarizeJob] meeting=#{meeting.id} 완료"
  rescue => e
    Rails.logger.error "[ReDiarizeJob] meeting=#{meeting_id} error=#{e.class}: #{e.message}"
    meeting&.update(status: :completed, re_diarize_started_at: nil)
    ActionCable.server.broadcast(meeting.transcription_stream, { type: "file_transcription_error", error: e.message }) if meeting
  end

  private

  # SpeakerDB(sidecar) 에서 라벨→이름 매핑을 읽는다. sidecar 규약상 name == id 는 "이름 미설정"
  # 이므로 nil 로 정규화. sidecar 불통 시엔 빈 맵(→ speaker_name nil) 으로 폴백(잡은 계속 완료).
  def fetch_speaker_names(meeting_id)
    result = SidecarClient.new.get_speakers(meeting_id)
    speakers = result["speakers"] || result[:speakers] || []
    speakers.each_with_object({}) do |s, map|
      id   = s["id"] || s[:id]
      name = s["name"] || s[:name]
      next if id.blank?
      map[id] = (name.present? && name != id) ? name : nil
    end
  rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
    Rails.logger.warn "[ReDiarizeJob] get_speakers 실패(이름 재적용 생략) meeting=#{meeting_id}: #{e.message}"
    {}
  end

  def broadcast_progress(channel, percent, message = nil)
    ActionCable.server.broadcast(channel, { type: "transcription_progress", progress: percent, message: message })
  end
end
