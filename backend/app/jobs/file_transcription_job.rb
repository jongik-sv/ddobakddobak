class FileTranscriptionJob < ApplicationJob
  include PcmConvertible
  queue_as :file_transcription

  POLL_INTERVAL_SEC = 2
  STT_PROGRESS_MIN = 5
  STT_PROGRESS_MAX = 90
  STT_ETA_MIN_PERCENT = 10  # 진행률이 이 % 이상일 때만 완료 추정(잔여) 표기 — 초반 과대추정 회피

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.transcribing?

    channel = meeting.transcription_stream

    # 1. ffmpeg로 원본 → raw PCM 16kHz mono 변환
    pcm_path = convert_to_pcm(meeting)
    broadcast_progress(channel, 5, "음성 파일 변환 완료")

    # 2. Sidecar /transcribe-file 호출 (회의 생성자의 개인 언어 설정 + 청크 분할 시간 전달)
    lang = meeting.creator&.effective_language_config || ::User.server_default_language_config
    languages = lang[:languages]
    mode = lang[:mode]
    file_chunk_sec = ENV.fetch("AUDIO_FILE_CHUNK_SEC", "30").to_i
    diarization_config = AppSettings.diarization_config
    if meeting.expected_participants.present?
      diarization_config["expected_speakers"] = meeting.expected_participants
    end
    result = with_stt_progress_poller(meeting, channel) do
      SidecarClient.new.transcribe_file(
        pcm_path,
        meeting_id: meeting.id,
        languages: languages,
        mode: mode,
        file_chunk_sec: file_chunk_sec,
        diarization_config: diarization_config
      )
    end
    broadcast_progress(channel, 90, "음성 인식 완료")

    # 3. Transcript 레코드 일괄 생성
    store_transcripts(meeting, result["segments"])
    apply_speaker_names(meeting)
    broadcast_progress(channel, 93, "트랜스크립트 저장 완료")

    if diarization_config["enable"]
      # 화자분리 ON: 회의록 자동생성 스킵 — 사용자가 화자 이름 지정 후 수동 생성(regenerate_notes)
      broadcast_progress(channel, 99, "화자 분리 완료 — 화자 이름 지정 후 회의록을 생성하세요")
    else
      # 4. AI 회의록 생성 (final 모드)
      generate_summary(meeting)
      broadcast_progress(channel, 99, "AI 회의록 생성 완료")

      # 5. Action Items 추출
      MeetingFinalizerService.new(meeting).call
    end

    # 6. 완료 — 실제 사용된 배치 STT 엔진을 회의 정보에 기록(sidecar resolve 결과)
    meeting.update!(
      status: :completed,
      transcription_progress: 100,
      ended_at: Time.current,
      stt_engine: result["engine"]
    )
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
      ActionCable.server.broadcast(meeting.transcription_stream, {
        type: "file_transcription_error",
        error: e.message
      })
    end
  end

  private

  # 블로킹 transcribe_file 동안 sidecar 진행 레지스트리를 폴링해 5~90% 를 broadcast 한다.
  # 폴러 스레드는 HTTP 폴링 + ActionCable broadcast 만 수행(ActiveRecord 미접근 → 스레드 안전).
  def with_stt_progress_poller(meeting, channel)
    stop = false
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    poller = Thread.new do
      client = SidecarClient.new
      until stop
        prog = client.get_transcribe_progress(meeting.id)
        if prog
          total = prog["total_ms"].to_i
          if prog["phase"] == "post"
            # STT 끝, 화자분리·후처리 중 — 90% 고정 + 안내(진행바 정지 방지)
            broadcast_progress(channel, STT_PROGRESS_MAX, "화자 분리·후처리 중…")
          elsif total.positive?
            processed = prog["processed_ms"].to_i
            pct = stt_poll_percent(processed, total)
            elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
            broadcast_progress(channel, pct, stt_poll_message(pct, elapsed, processed, total))
          end
        end
        break if stop
        sleep POLL_INTERVAL_SEC
      end
    rescue => e
      Rails.logger.debug { "[FileTranscriptionJob] STT poller 종료: #{e.class}: #{e.message}" }
    end

    yield
  ensure
    stop = true
    if poller
      poller.kill
      poller.join
    end
  end

  def stt_poll_percent(processed_ms, total_ms)
    return STT_PROGRESS_MIN if total_ms.to_i <= 0

    span = STT_PROGRESS_MAX - STT_PROGRESS_MIN
    (STT_PROGRESS_MIN + processed_ms.to_f / total_ms * span).round.clamp(STT_PROGRESS_MIN, STT_PROGRESS_MAX)
  end

  # 경과(벽시계) + 완료 추정(잔여). 잔여는 진행률이 STT_ETA_MIN_PERCENT 이상일 때만(초반 과대추정 회피).
  def stt_poll_message(percent, elapsed_s, processed_ms, total_ms)
    msg = "음성 인식 중… 경과 #{format_hms(elapsed_s)}"
    if percent >= STT_ETA_MIN_PERCENT && processed_ms.to_i.positive? && total_ms.to_i.positive?
      frac = processed_ms.to_f / total_ms
      remaining = elapsed_s * (1 - frac) / frac
      msg += " · 잔여 ~#{format_hms(remaining)}"
    end
    msg
  end

  # 초 → "M:SS" (1시간 이상이면 "H:MM:SS"). 음수는 0:00.
  def format_hms(seconds)
    s = seconds.to_f.round
    s = 0 if s.negative?
    h = s / 3600
    m = (s % 3600) / 60
    sec = s % 60
    h.positive? ? format("%d:%02d:%02d", h, m, sec) : format("%d:%02d", m, sec)
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

  # SpeakerDB names 맵을 비정규화 사본(speaker_name)으로 재적용한다.
  # name == id 는 "이름 미설정" — 복사하지 않는다. 실패해도 잡은 계속 진행.
  def apply_speaker_names(meeting)
    speakers = SidecarClient.new.get_speakers(meeting.id)["speakers"]
    return if speakers.blank?

    speakers.each do |sp|
      next if sp["name"].blank? || sp["name"] == sp["id"]
      meeting.transcripts.where(speaker_label: sp["id"]).update_all(speaker_name: sp["name"])
    end
  rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
    Rails.logger.warn "[FileTranscriptionJob] meeting=#{meeting.id} speaker_name 재적용 실패: #{e.message}"
  end

  def generate_summary(meeting)
    transcripts = meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    payload = Transcript.to_sidecar_payload(transcripts)

    llm = LlmService.new(llm_config: meeting.creator&.effective_llm_config)
    result = llm.refine_notes(
      "", payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: PromptTemplate.sections_prompt_for(meeting.meeting_type),
      attendees: meeting.attendees,
      verbosity: meeting.summary_verbosity,
      chronological: !meeting.summary_restructure # 증분 선택 업로드 = 시간 흐름 요약
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
