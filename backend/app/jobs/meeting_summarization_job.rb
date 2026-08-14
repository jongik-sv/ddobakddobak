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

  FINAL_REENQUEUE_CAP = 5
  FINAL_REENQUEUE_WAIT = 30.seconds
  # final 재시도 포기 시 사용자 레포트 문구 — 영속 기록·ok:false broadcast 가 같은 문구를 공유.
  FINAL_GIVE_UP_ERROR = "최종 요약 재시도 한도(#{FINAL_REENQUEUE_CAP}회)를 초과해 생성을 포기했습니다. 회의록 재생성으로 다시 시도해 주세요.".freeze

  def perform(meeting_id, type: "realtime", attempt: 0)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting

    mutex = MEETING_LOCKS.compute_if_absent(meeting_id) { Mutex.new }
    unless mutex.try_lock
      if type == "final"
        # final은 정본 확정 안전망 — 드랍하면 영영 안 생긴다(stop이 1회만 enqueue).
        # 실전 재현: stop 직후 realtime 틱(LLM 수십 초)이 락 점유 → final try_lock 실패 → 무음 드랍.
        # 락 해제 후 재시도하도록 재enqueue (realtime은 매분 cron이 다시 오므로 드랍 OK).
        Rails.logger.info "[MeetingSummarizationJob] final re-enqueued (lock busy) meeting=#{meeting_id}"
        self.class.set(wait: 30.seconds).perform_later(meeting_id, type: "final", attempt: attempt)
      else
        Rails.logger.info "[MeetingSummarizationJob] skipped (in-process lock busy) meeting=#{meeting_id} type=#{type}"
      end
      return
    end

    begin
      case type
      when "final"
        generate_minutes_final(meeting, attempt: attempt)
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

  # realtime 자동 틱 전용 가드: creator 개인 LLM 설정도 없고 서버 LLM도 "선택 안함"
  # (User.server_default_llm_config == nil, ENV LLM_PROVIDER=="none") 이면 LLM 호출 자체를
  # 시도하지 않고 조용히 건너뛴다. 매분 cron이 도는 realtime 경로에서 NotConfiguredError를
  # 그대로 broadcast하면 틱마다 ok:false 알림이 반복되므로 자동 경로만 무음 skip 처리한다.
  # final(명시적 사용자 액션: 종료/수동 재생성)은 이 가드를 타지 않고 기존 에러 broadcast 유지.
  def realtime_llm_unconfigured?(meeting)
    (meeting.creator&.effective_llm_config || User.server_default_llm_config).nil?
  end

  # realtime/타이머 경로의 안건 주입값: 업로드 후 아직 한 번도 주입 안 됐을 때만(applied_at nil)
  # 압축 안건을 반환한다. 이미 주입됐으면 nil(재주입 안 함). final 은 이 헬퍼를 쓰지 않고 항상 주입.
  def realtime_agenda_reference(meeting)
    return nil if meeting.agenda_reference_applied_at.present?
    meeting.agenda_reference.presence
  end

  # realtime/타이머 경로의 이해관계자 주입값: 업로드 후 아직 한 번도 주입 안 됐을 때만
  # (applied_at nil) 압축 이해관계자 정보를 반환한다. realtime_agenda_reference 미러.
  def realtime_stakeholder_reference(meeting)
    return nil if meeting.stakeholder_reference_applied_at.present?
    meeting.stakeholder_reference.presence
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

  # summary_interval_sec 게이트: 마지막 realtime 요약 생성 시각(없으면 녹음 시작 시각) 기준으로
  # 간격이 아직 안 지났으면 이번 cron 틱은 건너뛴다. cron(SummarizationJob)이 매분 도는 것과
  # 무관하게 회의별 요약 주기를 실제로 준수시켜 LLM 호출(비용)을 줄인다.
  # 0(안 함)은 SummarizationJob의 where.not(summary_interval_sec: 0)에서 이미 걸러지므로
  # 여기선 방어적으로만 취급 — 0 이하면 게이트를 걸지 않고 기존 동작(무제한 실행) 유지.
  # final 경로는 이 메서드를 호출하지 않는다(게이트 없음, 즉시 실행).
  def realtime_interval_pending?(meeting)
    interval = meeting.summary_interval_sec.to_i
    return false if interval <= 0

    last_at = meeting.summaries.where(summary_type: "realtime").maximum(:generated_at) || meeting.started_at
    return false if last_at.blank?

    Time.current < last_at + interval.seconds
  end

  # ⭐ 절단 표식 워터마크 재확인 (감사 CRITICAL). watermark 는 이 잡이 전사를 읽은 시점의
  # meeting.transcripts_redacted_at 값(nil 일 수 있다) — LLM 호출 뒤 **쓰기 직전** DB 를 다시
  # 읽어 그 값과 비교한다. 존재 여부(.present?)가 아니라 **값 자체**를 비교하는 이유: 재절단으로
  # 시각이 다른 시각으로 바뀌는 경우도 잡아야 하고, nil → 시각 전이는 값 비교만으로 자동으로 걸린다.
  # 이미 절단된 회의를 이 잡이 시작부터 알고 있었고(watermark 가 non-nil) 그 사이 변화가
  # 없으면 통과시킨다 — 그건 "절단 후 사용자가 회의록을 수동 재생성"하는 정상 경로다(설계 문서
  # "절단 후" 절 — 자동 재요약은 안 걸지만 수동 재생성은 허용).
  def redacted_since?(meeting, watermark)
    meeting.transcripts_redacted_at != watermark
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
    # 요약 시작을 회의에 영속화 — 회의목록·상세 배지가 페이지 이탈·새로고침 후에도 "요약중"을
    # 유지한다. broadcast_finished 에서 짝 맞춰 해제한다(limits_concurrency 로 중복 실행 없음).
    meeting.record_summary_start!
    ActionCable.server.broadcast(meeting.transcription_stream, {
      type: "summarization_started",
      summary_type: summary_type
    })
  end

  # error: 실패 사유(사용자 레포트용). ok:true 면 nil — 프론트가 ok:false + error 로 토스트/배지를 띄운다.
  def broadcast_finished(meeting, summary_type, ok:, error: nil)
    # 요약 종료 영속화 — 멱등(broadcast_started 없이 온 give-up 경로에도 false 유지로 무해).
    # record_summary_error! 가 먼저 불린 final 실패 경로에서도 안전 — 두 메서드는 독립 컬럼.
    meeting.record_summary_finished!
    ActionCable.server.broadcast(meeting.transcription_stream, {
      type: "summarization_finished",
      summary_type: summary_type,
      ok: ok,
      error: error
    })
  end

  def generate_minutes_realtime(meeting)
    meeting.reload
    return if meeting.completed?
    return if meeting.pending?
    return if meeting.paused_at? # 일시정지 중 자동 요약 금지 (cron이 enqueue 후 일시정지된 경우 방어)
    return if stale_relative_to_user_action?(meeting)
    return if realtime_interval_pending?(meeting) # summary_interval_sec 미경과 — 매분 cron 재요약(LLM 비용) 방지
    if realtime_llm_unconfigured?(meeting)
      Rails.logger.info "[MeetingSummarizationJob] realtime skipped (llm not configured) meeting=#{meeting.id}"
      return
    end

    new_transcripts = meeting.transcripts
                             .where(applied_to_minutes: false)
                             .order(:sequence_number)
    return if new_transcripts.empty?

    # ⭐ 절단 표식 워터마크 — 전사를 읽는 이 시점 값을 잡아둔다. LLM 호출(수 초~수십 초) 중
    # 기밀 구간 절단이 커밋되면 이 값이 바뀌므로, 쓰기 직전 재확인으로 절단 전 전사 기반
    # 결과를 버린다. 컨트롤러의 summarizing? 진입 가드는 summarizing 플래그를 이 잡 자신
    # (broadcast_started → record_summary_start!)이 세우므로 ffmpeg 도는 창에는 무력한
    # 순수 TOCTOU — 여기서 값 비교로 직접 막는다(감사 CRITICAL).
    redacted_watermark = meeting.transcripts_redacted_at

    # 이전 회의 참고: 첫 요약 직전, 이전 회의록을 시드로 깐다(요약 0건일 때만, 멱등).
    meeting.seed_summary_from_previous!(summary_type: "realtime")

    # 안건 자료 1회 주입: 업로드 후 첫 요약(applied_at nil)에만 주입한다. 성공 시 플래그를 채워
    # 이후 매분 cron 틱마다 재주입(비용 폭증)을 막는다.
    agenda_ref = realtime_agenda_reference(meeting)
    # 이해관계자 정보도 안건과 동일하게 1회만 주입(agenda_ref 미러).
    stakeholder_ref = realtime_stakeholder_reference(meeting)
    # 도메인 파일(용어집)은 안건과 달리 매 틱 주입 — 회의 중 선택이 바뀔 수 있어 1회주입 플래그 없음.
    domain_ref = DomainReferenceBuilder.build(meeting)

    applied_ids = new_transcripts.pluck(:id)
    channel = meeting.transcription_stream

    # 연결 회의 상단 고정 요약(pinned_top)은 요약 틱이 절대 재작성하지 않는다(코드 레벨 보호) —
    # LLM 에는 절취선 아래 본문(body_notes)만 current_notes 로 전달하고, pinned_top 은 문맥
    # 연속성을 위한 참고용 컨텍스트로만 별도 제공한다. 절취선이 없으면(비연결) pinned_top=nil,
    # body_notes=전체 문서 그대로 — 기존 동작과 동일(회귀 없음).
    pinned_top, body_notes = split_pinned_notes(meeting.current_notes_markdown, meeting)
    payload = Transcript.to_sidecar_payload(new_transcripts)

    started = true
    ok = false
    error = nil
    broadcast_started(meeting, "realtime")
    # 재구조화 모드는 refine 로 본문 통짜 재작성, 그 외(증분)는 append 로 새 블록만 추가.
    # previous_meeting_id 유무는 이 분기에 관여하지 않는다 — 이전 회의 내용은 이미 pinned_top 에
    # 코드 레벨로 분리돼 있으므로, 본문(body_notes)은 비연결 회의와 동일하게 처리하면 된다.
    if meeting.summary_restructure?
      result = call_refine_notes(meeting, body_notes, payload,
                                  agenda_reference: agenda_ref, stakeholder_reference: stakeholder_ref,
                                  domain_reference: domain_ref,
                                  pinned_top: pinned_top, verbosity_context: :realtime)
      body_result = result["notes_markdown"]
    else
      # 증분 모드: 새 자막만 시간대별 블록으로 요약해 본문(body_notes) 뒤에 덧붙인다(앞 내용 불변).
      result = call_append_notes(meeting, body_notes, payload,
                                  agenda_reference: agenda_ref, stakeholder_reference: stakeholder_ref,
                                  domain_reference: domain_ref,
                                  pinned_top: pinned_top)
      # 시간 라벨은 소비셋(applied_ids) 스냅샷으로 계산 — 릴레이션 재질의는 LLM 호출(수십 초) 중
      # 도착한 자막까지 집계해 시간대가 과대/중첩된다.
      body_result = compose_appended_notes(body_notes, result["block_markdown"],
                                           meeting.transcripts.where(id: applied_ids))
    end
    # 연결 회의는 문서 제목(H1)을 pinned_top 최상단에 한 번만 둔다(사용자 실사용 피드백 — 제목이
    # "이전 회의 요약"보다 먼저 나와야 함). refine_notes 는 REFINE_NOTES_SYSTEM_PROMPT 규칙 0에
    # 따라 매 틱 본문 첫 줄에 H1 을 다시 쓰므로, pinned_top 이 있으면 그 중복 H1 을 여기서 제거한다.
    # body 는 사용자 편집이 닿을 수 있는 영역이라 무조건 삭제(strip_leading_h1)가 아니라, 회의
    # 제목과 정확히 일치할 때만 지우는 strip_matching_h1 을 쓴다 — 사용자가 본문 첫 줄에 직접 쓴
    # 커스텀 H1(회의 제목과 다른 텍스트)은 보존한다. (append 모드 결과는 H1 로 시작하지 않아 no-op.)
    body_result = strip_pinned_h1(body_result, pinned_top, meeting)
    # 저장 직전 재조립: pinned_top + 절취선 + body_result. pinned_top 없으면(비연결) 절취선 없이
    # body_result 그대로(join 이 처리) — 기존 단일 notes_markdown 계약과 동일하게 유지.
    notes_markdown = PreviousMeetingNotes.join(pinned_top, body_result)

    # LLM 호출 중에 stop/reset/user-edit이 일어났을 수 있으므로 broadcast/저장 전에 재확인.
    meeting.reload
    if meeting.completed?
      ok = true # 의도된 스킵 — ok:false 는 프론트에 오류로 레포트되므로 실패로 취급하지 않는다
      Rails.logger.info "[MeetingSummarizationJob] realtime skipped (meeting completed during LLM) meeting=#{meeting.id}"
      return
    end
    # ⭐ 절단 표식 재확인이 stale 검사보다 먼저다 — 순서 자체에 의미는 없지만(redact 는 재시도
    # 대상이 아니므로 realtime 은 어느 쪽이든 드랍뿐이다), final 경로와 판단 위치를 맞춰둔다.
    if redacted_since?(meeting, redacted_watermark)
      ok = true # 의도된 스킵 — 절단은 재시도 대상이 아니다(사용자가 필요하면 다시 요약을 누른다)
      Rails.logger.info "[MeetingSummarizationJob] realtime skipped (redacted during LLM) meeting=#{meeting.id}"
      return
    end
    if meeting.pending? || stale_relative_to_user_action?(meeting)
      ok = true # 의도된 스킵 (위와 동일)
      Rails.logger.info "[MeetingSummarizationJob] realtime skipped (reset or user-edit during LLM) meeting=#{meeting.id}"
      return
    end

    # present? 판정은 body_result(본문) 기준 — pinned_top 이 있으면 notes_markdown(재조립본)은
    # 본문이 비어도 항상 present 라 저장 여부 판단에 쓸 수 없다(연결 직후 첫 틱이 빈 블록이면
    # 불필요한 재저장·브로드캐스트가 생긴다).
    if result["ok"] && body_result.present?
      summary = meeting.summaries.find_or_initialize_by(summary_type: "realtime")
      summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

      meeting.clear_summary_error!
      meeting.refresh_brief_summary!(body_result)
      meeting.transcripts.where(id: applied_ids).update_all(applied_to_minutes: true)

      ActionCable.server.broadcast(channel, {
        type: "meeting_notes_update",
        notes_markdown: notes_markdown
      })

      ActionCable.server.broadcast(channel, {
        type: "transcripts_applied",
        ids: applied_ids
      })
    elsif result["ok"] && !meeting.summary_restructure?
      # 증분 모드: 기록할 내용 없음(빈 블록, ok:true). 노트는 그대로 두고 자막만 소비 —
      # 미소비로 두면 같은 자막을 매 틱 재요약하는 루프가 된다.
      meeting.transcripts.where(id: applied_ids).update_all(applied_to_minutes: true)
      ActionCable.server.broadcast(channel, { type: "transcripts_applied", ids: applied_ids })
    elsif !result["ok"]
      # transient LLM 실패: 미저장·미소비. 다음 틱 재시도(무음 손실 차단).
      # 사유는 broadcast 로만 레포트 — 매분 재시도라 영속 기록하면 노이즈(final 만 영속 기록).
      error = result["error"].presence || "요약 생성에 실패했습니다"
      Rails.logger.warn "[MeetingSummarizationJob] realtime transient failure meeting=#{meeting.id} (미소비)"
    end
    # 안건을 실제로 주입했고 LLM 이 성공했으면 1회주입 플래그를 채운다(이후 틱 재주입 방지).
    # 실패(ok:false) 시엔 플래그를 두지 않아 다음 틱이 다시 주입한다.
    if agenda_ref.present? && result["ok"]
      meeting.update_column(:agenda_reference_applied_at, Time.current)
    end
    # 이해관계자 정보도 동일 규칙(agenda_ref 블록 미러).
    if stakeholder_ref.present? && result["ok"]
      meeting.update_column(:stakeholder_reference_applied_at, Time.current)
    end
    # 기존엔 무조건 ok=true 로 transient 실패도 성공으로 broadcast 됐다 — result["ok"] 를 그대로 반영.
    ok = result["ok"] ? true : false
  rescue LlmService::LlmError, StandardError => e
    # broadcast 는 참가자 전원 노출 — 예외 원문(호스트:포트·경로 등)은 로그에만, 사용자에겐 정규화 문구.
    error = LlmService.user_facing_error_message(e)
    Rails.logger.error "[MeetingSummarizationJob] realtime meeting=#{meeting.id} error=#{e.message}"
  ensure
    broadcast_finished(meeting, "realtime", ok: ok, error: ok ? nil : error) if started
  end

  # 전사 편집 등으로 stale라 이번 final 결과를 버려야 하지만, 정본(final summary)이 아직 없으면
  # 그냥 드랍하면 "영영 안 생김"(stop이 final을 1회만 enqueue). 최신 전사로 재생성하도록 재enqueue한다.
  # 이미 정본이 있으면(사용자 수동 편집 가능성) 덮어쓰지 않도록 기존대로 드랍.
  # 반환값으로 결과를 구분한다 — 호출부가 포기(:gave_up)를 성공처럼 broadcast 하지 않게:
  #   :minutes_exist — 정본이 이미 있어 드랍(의도된 스킵)
  #   :gave_up       — 재시도 한도 초과 포기(영속 기록됨) → 호출부는 ok:false 로 레포트
  #   :reenqueued    — 최신 전사로 재생성하도록 재enqueue(의도된 스킵)
  def reenqueue_final_if_minutes_missing(meeting, attempt)
    if meeting.summaries.exists?(summary_type: "final")
      Rails.logger.info "[MeetingSummarizationJob] final skipped (reset or user-edit during LLM; minutes exist) meeting=#{meeting.id}"
      return :minutes_exist
    end
    if attempt >= FINAL_REENQUEUE_CAP
      # 재시도 포기 = 정본이 영영 안 생김 — 사용자에게 레포트하도록 영속 기록.
      meeting.record_summary_error!(FINAL_GIVE_UP_ERROR)
      Rails.logger.warn "[MeetingSummarizationJob] final giving up (still stale after #{attempt} retries) meeting=#{meeting.id}"
      return :gave_up
    end
    Rails.logger.info "[MeetingSummarizationJob] final re-enqueued (stale during LLM, no minutes yet) meeting=#{meeting.id} attempt=#{attempt + 1}"
    self.class.set(wait: FINAL_REENQUEUE_WAIT).perform_later(meeting.id, type: "final", attempt: attempt + 1)
    :reenqueued
  end

  # LLM 호출 뒤 실패 기록·저장 판단 직전의 공통 재확인 — LLM 도중 reset(pending)/사용자
  # 편집(stale)이 있었으면 이번 결과(성공·실패 모두)를 버린다. 초기화된 회의에 실패 배지가
  # 남지 않게 실패 영속 기록보다 반드시 먼저 수행한다. 반환:
  #   :proceed — 그대로 진행 / :skipped — 의도된 스킵(ok:true 마감) / :gave_up — 재시도 포기(ok:false)
  #
  # ⭐ 절단 표식 재확인은 stale 검사보다 **먼저** 와야 한다(감사 CRITICAL). redact 트랜잭션은
  # transcripts_redacted_at 와 last_user_edit_at 을 함께 갱신하므로(D'Flow 재전송 신호), 순서를
  # 바꾸면 stale_relative_to_user_action? 이 먼저 걸려 reenqueue_final_if_minutes_missing 으로
  # 새어 나간다 — 절단은 재큐잉 대상이 아니다(사용자가 다시 누르면 된다. 재큐잉하면 절단 직후
  # LLM 이 또 도는 낭비고, 재시도 한도 소진 시 사용자가 원치도 않은 실패 배지까지 남는다).
  def final_post_llm_disposition(meeting, attempt, redacted_watermark)
    meeting.reload
    if meeting.pending?
      Rails.logger.info "[MeetingSummarizationJob] final skipped (reset during LLM) meeting=#{meeting.id}"
      return :skipped
    end
    if redacted_since?(meeting, redacted_watermark)
      Rails.logger.info "[MeetingSummarizationJob] final skipped (redacted during LLM) meeting=#{meeting.id}"
      return :skipped
    end
    if stale_relative_to_user_action?(meeting)
      Rails.logger.info "[MeetingSummarizationJob] final skipped (user-edit during LLM) meeting=#{meeting.id}"
      return reenqueue_final_if_minutes_missing(meeting, attempt) == :gave_up ? :gave_up : :skipped
    end
    :proceed
  end

  def generate_minutes_final(meeting, attempt: 0)
    meeting.reload
    return if meeting.pending?
    if stale_relative_to_user_action?(meeting)
      outcome = reenqueue_final_if_minutes_missing(meeting, attempt)
      # 이 경로는 시작 broadcast 없이 끝난다 — 포기만은 라이브로도 실패를 알린다(영속 기록은 헬퍼가 수행).
      broadcast_finished(meeting, "final", ok: false, error: FINAL_GIVE_UP_ERROR) if outcome == :gave_up
      return
    end

    transcripts = meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    # ⭐ 절단 표식 워터마크 — realtime 과 동일 근거(위 redacted_since? 주석). 이 잡이 전사를
    # 읽는 시점 값을 잡아, LLM 호출 뒤 쓰기 직전 재확인으로 절단 전 전사 기반 결과를 버린다.
    redacted_watermark = meeting.transcripts_redacted_at

    # 이전 회의 참고: 요약 0건(예: 회의록 재생성 직후)이고 previous_meeting 지정 시 이전 회의록을 시드로 깐다.
    meeting.seed_summary_from_previous!(summary_type: "final")

    # 증분 모드의 base 는 "가장 최근 요약"이어야 한다. current_notes_markdown 은 completed 상태에서
    # 옛 final 을 하드 우선하므로(reopen 직후 stop 시) 재개 세션에서 append 된 realtime 블록을 버리게 된다.
    latest_full = meeting.summaries.order(generated_at: :desc, id: :desc).first&.notes_markdown.to_s
    # final 은 안건과 마찬가지로 1회주입 플래그 없이 항상 도메인 파일을 주입한다.
    domain_ref = DomainReferenceBuilder.build(meeting)

    started = true
    ok = false
    error = nil
    pinned_top = nil
    broadcast_started(meeting, "final")
    # 재구조화 모드는 항상 refine 통짜 재생성, 그 외(증분)는 base(latest_full 본문)가 백지일 때만
    # refine 폴백, 그 외엔 append-only. previous_meeting_id 유무는 이 분기에 관여하지 않는다 —
    # 이전 회의 내용은 이미 pinned_top(상단 고정 블록)에 코드 레벨로 분리돼 있으므로, 본문은
    # 비연결 회의와 동일하게 처리한다. pinned_top 은 어느 분기든 절취선 아래만 LLM 에 전달하고
    # (코드 레벨 보호) 저장 직전 재조립한다.
    if meeting.summary_restructure?
      pinned_top, refine_body = split_pinned_notes(meeting.current_notes_markdown, meeting)
      payload = Transcript.to_sidecar_payload(transcripts)
      # final(종료·재생성)은 1회주입 플래그와 무관하게 항상 안건·이해관계자 전체를 주입한다.
      result = call_refine_notes(meeting, refine_body, payload,
                                  agenda_reference: meeting.agenda_reference.presence,
                                  stakeholder_reference: meeting.stakeholder_reference.presence,
                                  domain_reference: domain_ref, pinned_top: pinned_top,
                                  chronological: false)
      body_result = result["notes_markdown"]
    else
      pinned_top, latest_body = split_pinned_notes(latest_full, meeting)
      if latest_body.blank?
        # 증분인데 본문 base 가 백지(재생성 직후·연결 직후 첫 final 등) — refine 폴백(시간 흐름 지시).
        payload = Transcript.to_sidecar_payload(transcripts)
        result = call_refine_notes(meeting, "", payload,
                                    agenda_reference: meeting.agenda_reference.presence,
                                    stakeholder_reference: meeting.stakeholder_reference.presence,
                                    domain_reference: domain_ref, pinned_top: pinned_top,
                                    chronological: true)
        body_result = result["notes_markdown"]
      else
        # 전체 재작성 없이 남은 미적용 자막만 마지막 블록으로 덧붙여 확정(append-only).
        remaining_ids = transcripts.where(applied_to_minutes: false).pluck(:id)
        if remaining_ids.any?
          remaining = meeting.transcripts.where(id: remaining_ids).order(:sequence_number)
          payload = Transcript.to_sidecar_payload(remaining)
          result = call_append_notes(meeting, latest_body, payload,
                                      agenda_reference: meeting.agenda_reference.presence,
                                      stakeholder_reference: meeting.stakeholder_reference.presence,
                                      domain_reference: domain_ref, pinned_top: pinned_top)
          body_result = compose_appended_notes(latest_body, result["block_markdown"], remaining)
        else
          result = { "ok" => true }
          body_result = latest_body
        end
      end
    end
    # 연결 회의는 문서 제목(H1)을 pinned_top 최상단에 한 번만 둔다(사용자 실사용 피드백) —
    # refine_notes 가 매 틱 본문 첫 줄에 다시 쓰는, 회의 제목과 정확히 일치하는 H1 만 여기서
    # 제거해 중복을 막는다(strip_matching_h1 — 사용자가 본문에 직접 쓴 커스텀 H1은 보존).
    # (append 모드 결과·기존 latest_body 승계는 H1 로 시작하지 않아 no-op.)
    body_result = strip_pinned_h1(body_result, pinned_top, meeting)
    # LLM 도중 reset/사용자 편집 재확인을 실패 기록·저장 판단보다 먼저 수행한다 —
    # 의도된 스킵이면 성공·실패 결과 모두 버려, 초기화된 회의에 실패 배지가 남지 않는다.
    case final_post_llm_disposition(meeting, attempt, redacted_watermark)
    when :skipped
      ok = true # 의도된 스킵 — ok:false 는 프론트에 오류로 레포트되므로 실패로 취급하지 않는다
      return
    when :gave_up
      error = FINAL_GIVE_UP_ERROR # 재시도 포기는 성공처럼 보이면 안 됨 — ok:false + 사유로 레포트
      return
    end

    # transient LLM 실패(ok:false)면 저장·소비·강등해제 전부 건너뜀 — stale notes 로 전 자막을
    # 영구 소비(sticky)하는 무음 손실 차단 (D8 anchor-C1, realtime 경로와 동일 처리).
    # blank 체크보다 먼저 판정해 실패 사유 기록이 누락되지 않게 한다.
    # final 은 stop 이 1회만 enqueue 하므로 실패를 영속 기록해 사용자에게 레포트한다.
    unless result["ok"]
      error = result["error"].presence || "요약 생성에 실패했습니다"
      meeting.record_summary_error!(error)
      Rails.logger.warn "[MeetingSummarizationJob] final transient failure meeting=#{meeting.id} (미소비)"
      return
    end
    if body_result.blank?
      # ok:true 인데 결과가 빈 하드 실패 — final 은 재시도가 없으므로 broadcast 만으로는
      # 새로고침 시 소실된다. 영속 기록해 배지로 레포트한다. (pinned_top 유무와 무관 — 본문
      # 기준으로 판정해야 연결 회의도 정확히 걸린다.)
      error = "요약 결과가 비어 있습니다"
      meeting.record_summary_error!(error)
      return
    end

    # 저장 직전 재조립: pinned_top + 절취선 + body_result.
    notes_markdown = PreviousMeetingNotes.join(pinned_top, body_result)

    summary = meeting.summaries.find_or_initialize_by(summary_type: "final")
    summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

    meeting.clear_summary_error!
    meeting.refresh_brief_summary!(body_result)
    # update_all 전에 "이번에 새로 적용되는" 자막 id를 스냅샷한다(프론트 라이브기록 미적용 배지 해제용).
    newly_applied_ids = meeting.transcripts.where(applied_to_minutes: false).pluck(:id)
    meeting.transcripts.update_all(applied_to_minutes: true)

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "meeting_notes_update", notes_markdown: notes_markdown, is_final: true }
    )
    # final 잡도 realtime 경로처럼 소비한 자막을 클라이언트에 알린다.
    # 이 broadcast 누락이 "종료 요약 후 마지막 자막이 라이브기록에 미적용으로 남는" 버그의 원인
    # (DB는 applied_to_minutes:true인데 store의 applied 플래그는 그대로라 unapplied로 표시됨).
    if newly_applied_ids.any?
      ActionCable.server.broadcast(
        meeting.transcription_stream,
        { type: "transcripts_applied", ids: newly_applied_ids }
      )
    end
    ok = true
  rescue LlmService::LlmError, StandardError => e
    # broadcast·영속 기록은 참가자 전원 노출 — 예외 원문은 로그에만, 사용자에겐 정규화 문구.
    error = LlmService.user_facing_error_message(e)
    # final 은 재enqueue 되지 않는 하드 실패 — 사용자 레포트용 영속 기록.
    meeting.record_summary_error!(error)
    Rails.logger.error "[MeetingSummarizationJob] final meeting=#{meeting.id} error=#{e.message}"
  ensure
    broadcast_finished(meeting, "final", ok: ok, error: ok ? nil : error) if started
  end

  # pinned_top(연결 회의 상단 고정 요약)의 문서 제목(H1)을 이 회의의 현재 title 로 갱신한다.
  # seed 시점에 동결된 제목이 이후 회의명 변경을 반영하지 못하는 문제를 막기 위해, 저장 직전
  # 재조립마다(realtime·final 공통) 호출한다. pinned_top 은 코드 관리 영역(LLM·사용자 편집이
  # 닿지 않음)이라 무조건 strip 후 with_title 재적용해도 안전하다 — 레거시(제목 도입 전 시드)
  # 문서도 다음 틱에 자동으로 제목이 붙는 부수 효과(마이그레이션 불필요).
  def refresh_pinned_title(pinned_top, meeting)
    return pinned_top if pinned_top.blank?
    PreviousMeetingNotes.with_title(meeting.title, PreviousMeetingNotes.strip_leading_h1(pinned_top))
  end

  # realtime/final 공통: source_markdown 을 절취선 기준 pinned_top/body 로 나누고, pinned_top
  # 제목을 갱신한다(refresh_pinned_title). 호출부 3곳(realtime 1·final 2) 모두 결과를
  # `pinned_top, body = split_pinned_notes(...)` 형태로 받아 그대로 이어 쓴다.
  def split_pinned_notes(source_markdown, meeting)
    pinned_top, body = PreviousMeetingNotes.split(source_markdown)
    [ refresh_pinned_title(pinned_top, meeting), body ]
  end

  # realtime/final 공통: refine_notes 호출부 조립(회의 제목·타입·섹션 프롬프트·참석자·verbosity·
  # custom_prompt 등 meeting 파생 파라미터는 항상 동일). verbosity_context/chronological 은
  # LlmService#refine_notes 의 기존 기본값(:final / false)과 동일한 기본값을 여기서도 유지해
  # 명시적으로 넘기지 않는 호출부(realtime의 chronological, final restructure 분기의
  # verbosity_context)의 동작이 바뀌지 않게 한다. agenda_reference/domain_reference/pinned_top
  # 은 호출부마다 다르므로(1회주입 여부·현재 vs base 문서 등) 그대로 인자로 받는다.
  def call_refine_notes(meeting, body, payload, agenda_reference:, domain_reference:, pinned_top:,
                         stakeholder_reference: nil, verbosity_context: :final, chronological: false)
    llm_service_for(meeting).refine_notes(
      body, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: PromptTemplate.sections_prompt_for(meeting.meeting_type),
      attendees: meeting.attendees,
      verbosity: meeting.summary_verbosity,
      verbosity_context: verbosity_context,
      chronological: chronological,
      agenda_reference: agenda_reference,
      stakeholder_reference: stakeholder_reference,
      domain_reference: domain_reference,
      custom_prompt: meeting.summary_custom_prompt,
      pinned_context: pinned_top
    )
  end

  # realtime/final 공통: append_notes 호출부 조립. agenda_reference/stakeholder_reference/
  # domain_reference/pinned_top 은 호출부마다 다르므로 그대로 인자로 받는다(결과의 시간대 블록
  # 조립(compose_appended_notes)은 호출부 책임 — 소비 자막 스냅샷 시점이 realtime/final 서로 다르다).
  def call_append_notes(meeting, body, payload, agenda_reference:, domain_reference:, pinned_top:, stakeholder_reference: nil)
    llm_service_for(meeting).append_notes(
      body, payload,
      meeting_title: meeting.title,
      attendees: meeting.attendees,
      verbosity: meeting.summary_verbosity,
      agenda_reference: agenda_reference,
      stakeholder_reference: stakeholder_reference,
      domain_reference: domain_reference,
      custom_prompt: meeting.summary_custom_prompt,
      pinned_context: pinned_top
    )
  end

  # realtime/final 공통: pinned_top 이 있을 때만(연결 회의) 본문 첫 줄의 회의 제목과 정확히
  # 일치하는 H1 을 제거한다(strip_matching_h1). pinned_top 없으면(비연결) 그대로 반환.
  def strip_pinned_h1(body_result, pinned_top, meeting)
    return body_result unless pinned_top.present?
    PreviousMeetingNotes.strip_matching_h1(body_result, meeting.title)
  end

  # 증분 블록을 시간대 헤딩과 함께 기존 회의록 뒤에 덧붙인 전체 노트 반환. 블록 없으면 기존 그대로.
  def compose_appended_notes(current_notes, block_markdown, new_transcripts)
    return current_notes if block_markdown.blank?

    heading = "### ⏱ #{time_range_label(new_transcripts)}"
    [ current_notes.presence, "#{heading}\n\n#{block_markdown}" ].compact.join("\n\n")
  end

  # 새 자막 구간의 시간대 라벨(회의 시작 기준 경과): "12:05–13:40", 1시간 넘으면 "1:02:11–…"
  def time_range_label(transcripts)
    from_ms = transcripts.minimum(:started_at_ms).to_i
    to_ms   = [ transcripts.maximum(:ended_at_ms).to_i, from_ms ].max
    "#{format_clock(from_ms)}–#{format_clock(to_ms)}"
  end

  def format_clock(ms)
    total = ms / 1000
    h, rem = total.divmod(3600)
    m, s = rem.divmod(60)
    h.positive? ? format("%d:%02d:%02d", h, m, s) : format("%02d:%02d", m, s)
  end
end
