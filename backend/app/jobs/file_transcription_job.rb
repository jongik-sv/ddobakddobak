class FileTranscriptionJob < ApplicationJob
  queue_as :file_transcription

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.transcribing?

    channel = "meeting_#{meeting.id}_transcription"

    # 1. ffmpeg로 원본 → raw PCM 16kHz mono 변환
    pcm_path = convert_to_pcm(meeting)
    broadcast_progress(channel, 10, "음성 파일 변환 완료")

    # 2. Sidecar /transcribe-file 호출 (설정된 언어 목록 + 청크 분할 시간 전달)
    languages = ENV.fetch("SELECTED_LANGUAGES", "ko").split(",").map(&:strip).reject(&:empty?)
    file_chunk_sec = ENV.fetch("AUDIO_FILE_CHUNK_SEC", "30").to_i
    result = SidecarClient.new.transcribe_file(
      pcm_path,
      meeting_id: meeting.id,
      languages: languages,
      file_chunk_sec: file_chunk_sec
    )
    broadcast_progress(channel, 70, "음성 인식 완료")

    # 3. Transcript 레코드 일괄 생성
    store_transcripts(meeting, result["segments"])
    broadcast_progress(channel, 80, "트랜스크립트 저장 완료")

    # 4. AI 회의록 생성 (final 모드)
    generate_summary(meeting)
    broadcast_progress(channel, 95, "AI 회의록 생성 완료")

    # 5. Action Items 추출
    MeetingFinalizerService.new(meeting).call

    # 6. 완료
    meeting.update!(status: :completed, transcription_progress: 100, ended_at: Time.current)
    ActionCable.server.broadcast(channel, {
      type: "file_transcription_complete",
      meeting_id: meeting.id
    })

    # 임시 PCM 파일 정리
    File.delete(pcm_path) if pcm_path && File.exist?(pcm_path)

    Rails.logger.info "[FileTranscriptionJob] meeting=#{meeting.id} 완료"
  rescue => e
    Rails.logger.error "[FileTranscriptionJob] meeting=#{meeting_id} error=#{e.class}: #{e.message}"
    if meeting
      meeting.update(status: :pending, transcription_progress: 0)
      ActionCable.server.broadcast("meeting_#{meeting.id}_transcription", {
        type: "file_transcription_error",
        error: e.message
      })
    end
  end

  private

  def convert_to_pcm(meeting)
    input_path = meeting.audio_file_path
    raise "오디오 파일이 없습니다" unless input_path.present? && File.exist?(input_path)

    pcm_path = input_path.sub(/\.[^.]+$/, "_pcm.raw")

    success = system(
      "ffmpeg", "-y",
      "-i", input_path,
      "-ar", "16000",
      "-ac", "1",
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      pcm_path,
      out: File::NULL, err: File::NULL
    )
    raise "ffmpeg 변환 실패" unless success && File.exist?(pcm_path)

    pcm_path
  end

  def store_transcripts(meeting, segments)
    return if segments.blank?

    segments.each_with_index do |seg, idx|
      meeting.transcripts.create!(
        content: seg["text"],
        speaker_label: seg["speaker_label"] || "화자 1",
        started_at_ms: seg["started_at_ms"],
        ended_at_ms: seg["ended_at_ms"],
        sequence_number: idx + 1,
        applied_to_minutes: false
      )
    end
  end

  def generate_summary(meeting)
    transcripts = meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    payload = transcripts.map do |t|
      { speaker: t.speaker_label, text: t.content, started_at_ms: t.started_at_ms }
    end

    template = PromptTemplate.find_by(meeting_type: meeting.meeting_type)
    result = SidecarClient.new.refine_notes(
      "", payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: template&.sections_prompt
    )
    notes_markdown = result["notes_markdown"]

    if notes_markdown.present?
      summary = meeting.summaries.find_or_initialize_by(summary_type: "final")
      summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)
      meeting.transcripts.update_all(applied_to_minutes: true)
    end
  end

  def broadcast_progress(channel, percent, message = nil)
    ActionCable.server.broadcast(channel, {
      type: "transcription_progress",
      progress: percent,
      message: message
    })
  end
end
