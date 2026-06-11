class MeetingSummarizationJob < ApplicationJob
  queue_as :summarization

  # SolidQueue(production)에서 동일 meeting에 대한 동시 실행 방지.
  # dev의 :async 어댑터에서는 무시되므로 아래 in-process Mutex로 보강한다.
  if respond_to?(:limits_concurrency)
    limits_concurrency to: 1, key: ->(meeting_id, **) { "meeting_summarization:#{meeting_id}" }
  end

  # 같은 프로세스 안에서 동일 meeting의 LLM 호출이 동시에 일어나지 않도록 보장.
  # dev/:async 환경에서 SolidQueue 락이 작동하지 않을 때의 안전망.
  MEETING_LOCKS = Concurrent::Map.new

  def perform(meeting_id, type: "realtime")
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting

    mutex = MEETING_LOCKS.compute_if_absent(meeting_id) { Mutex.new }
    unless mutex.try_lock
      if type == "final"
        # final은 정본 확정 안전망 — 드랍하면 영영 안 생긴다(stop이 1회만 enqueue).
        # 실전 재현: stop 직후 realtime 틱(LLM 수십 초)이 락 점유 → final try_lock 실패 → 무음 드랍.
        # 락 해제 후 재시도하도록 재enqueue (realtime은 매분 cron이 다시 오므로 드랍 OK).
        Rails.logger.info "[MeetingSummarizationJob] final re-enqueued (lock busy) meeting=#{meeting_id}"
        self.class.set(wait: 30.seconds).perform_later(meeting_id, type: "final")
      else
        Rails.logger.info "[MeetingSummarizationJob] skipped (in-process lock busy) meeting=#{meeting_id} type=#{type}"
      end
      return
    end

    begin
      case type
      when "final"
        generate_minutes_final(meeting)
      else
        generate_minutes_realtime(meeting)
      end
    ensure
      mutex.unlock
    end
  end

  private

  def llm_service_for(meeting)
    llm_config = meeting.creator&.effective_llm_config
    LlmService.new(llm_config: llm_config)
  end

  # 사용자 편집/초기화가 이 잡의 enqueue 이후에 일어났으면 잡을 폐기한다.
  # - 사용자가 회의록을 직접 수정한 경우, 우리가 LLM으로 덮어쓰면 안 됨.
  # - 회의가 reset_content로 :pending이 되었으면 잔여 잡은 무시.
  def stale_relative_to_user_action?(meeting)
    enqueued = enqueued_at_time
    return false unless enqueued

    if meeting.last_user_edit_at && meeting.last_user_edit_at > enqueued
      Rails.logger.info "[MeetingSummarizationJob] skipped (user edited after enqueue) meeting=#{meeting.id}"
      return true
    end
    if meeting.last_reset_at && meeting.last_reset_at > enqueued
      Rails.logger.info "[MeetingSummarizationJob] skipped (meeting reset after enqueue) meeting=#{meeting.id}"
      return true
    end
    false
  end

  def enqueued_at_time
    value = enqueued_at
    case value
    when Time, ActiveSupport::TimeWithZone then value
    when String then Time.iso8601(value) rescue nil
    when Numeric then Time.at(value)
    end
  end

  def broadcast_started(meeting, summary_type)
    ActionCable.server.broadcast(meeting.transcription_stream, {
      type: "summarization_started",
      summary_type: summary_type
    })
  end

  def broadcast_finished(meeting, summary_type, ok:)
    ActionCable.server.broadcast(meeting.transcription_stream, {
      type: "summarization_finished",
      summary_type: summary_type,
      ok: ok
    })
  end

  def generate_minutes_realtime(meeting)
    meeting.reload
    return if meeting.completed?
    return if meeting.pending?
    return if stale_relative_to_user_action?(meeting)

    new_transcripts = meeting.transcripts
                             .where(applied_to_minutes: false)
                             .order(:sequence_number)
    return if new_transcripts.empty?

    applied_ids = new_transcripts.pluck(:id)
    channel = meeting.transcription_stream

    current_notes = meeting.current_notes_markdown
    payload = Transcript.to_sidecar_payload(new_transcripts)

    started = true
    ok = false
    broadcast_started(meeting, "realtime")
    result = llm_service_for(meeting).refine_notes(
      current_notes, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: PromptTemplate.sections_prompt_for(meeting.meeting_type),
      attendees: meeting.attendees
    )
    notes_markdown = result["notes_markdown"]

    # LLM 호출 중에 stop/reset/user-edit이 일어났을 수 있으므로 broadcast/저장 전에 재확인.
    meeting.reload
    if meeting.completed?
      Rails.logger.info "[MeetingSummarizationJob] realtime skipped (meeting completed during LLM) meeting=#{meeting.id}"
      return
    end
    if meeting.pending? || stale_relative_to_user_action?(meeting)
      Rails.logger.info "[MeetingSummarizationJob] realtime skipped (reset or user-edit during LLM) meeting=#{meeting.id}"
      return
    end

    if result["ok"] && notes_markdown.present?
      summary = meeting.summaries.find_or_initialize_by(summary_type: "realtime")
      summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

      meeting.refresh_brief_summary!(notes_markdown)
      meeting.transcripts.where(id: applied_ids).update_all(applied_to_minutes: true)

      ActionCable.server.broadcast(channel, {
        type: "meeting_notes_update",
        notes_markdown: notes_markdown
      })

      ActionCable.server.broadcast(channel, {
        type: "transcripts_applied",
        ids: applied_ids
      })
    elsif !result["ok"]
      # transient LLM 실패: 미저장·미소비. 다음 틱 재시도(무음 손실 차단).
      Rails.logger.warn "[MeetingSummarizationJob] realtime transient failure meeting=#{meeting.id} (미소비)"
    end
    ok = true
  rescue LlmService::LlmError, StandardError => e
    Rails.logger.error "[MeetingSummarizationJob] realtime meeting=#{meeting.id} error=#{e.message}"
  ensure
    broadcast_finished(meeting, "realtime", ok: ok) if started
  end

  def generate_minutes_final(meeting)
    meeting.reload
    return if meeting.pending?
    return if stale_relative_to_user_action?(meeting)

    transcripts = meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    current_notes = meeting.current_notes_markdown
    payload = Transcript.to_sidecar_payload(transcripts)

    started = true
    ok = false
    broadcast_started(meeting, "final")
    result = llm_service_for(meeting).refine_notes(
      current_notes, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: PromptTemplate.sections_prompt_for(meeting.meeting_type),
      attendees: meeting.attendees
    )
    notes_markdown = result["notes_markdown"]
    return if notes_markdown.blank?

    # transient LLM 실패(ok:false)면 저장·소비·강등해제 전부 건너뜀 — stale notes 로 전 자막을
    # 영구 소비(sticky)하는 무음 손실 차단 (D8 anchor-C1, realtime 경로와 동일 처리).
    unless result["ok"]
      Rails.logger.warn "[MeetingSummarizationJob] final transient failure meeting=#{meeting.id} (미소비)"
      return
    end

    meeting.reload
    if meeting.pending? || stale_relative_to_user_action?(meeting)
      Rails.logger.info "[MeetingSummarizationJob] final skipped (reset or user-edit during LLM) meeting=#{meeting.id}"
      return
    end

    summary = meeting.summaries.find_or_initialize_by(summary_type: "final")
    summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

    meeting.refresh_brief_summary!(notes_markdown)
    meeting.transcripts.update_all(applied_to_minutes: true)

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "meeting_notes_update", notes_markdown: notes_markdown, is_final: true }
    )
    ok = true
  rescue LlmService::LlmError, StandardError => e
    Rails.logger.error "[MeetingSummarizationJob] final meeting=#{meeting.id} error=#{e.message}"
  ensure
    broadcast_finished(meeting, "final", ok: ok) if started
  end
end
