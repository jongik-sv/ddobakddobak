# 녹음/화자분리 잔류 상태 자가복구 + 임베딩 일관화.
module Meeting::RecordingHealing
  extend ActiveSupport::Concern

  # 화자분리만 재실행(ReDiarizeJob)이 :async 잡 드롭(서버 리로드 등)으로 멈추면 회의가
  # transcribing 에 영구정지된다 — 재실행 버튼은 completed 에서만 보여 UI 로는 회복 불가.
  # re_diarize_started_at 가 임계시간보다 오래되면 stale 로 보고 completed 로 자가복구한다.
  # 실 STT(FileTranscriptionJob)는 이 컬럼을 쓰지 않으므로 절대 건드리지 않는다(클로버 방지).
  RE_DIARIZE_STALE_AFTER = 5.minutes

  def heal_stale_re_diarize!
    return unless transcribing? && re_diarize_started_at.present?
    return if re_diarize_started_at > RE_DIARIZE_STALE_AFTER.ago

    update_columns(status: "completed", transcription_progress: 100, re_diarize_started_at: nil)
  end

  # 이 회의의 전사 content가 확정된 시점에 임베딩을 일관되게 맞춘다(배치, 라이브 밖).
  # 라이브/파일STT/import 핫패스에서 인라인 임베딩을 제거했으므로, 확정 경계에서 이 메서드로 흡수한다.
  # diff 기반(EmbedBackfillJob)이라 신규 전사 + 무효화로 삭제된 행을 모두 재생성한다. 멱등.
  def reconcile_embeddings!
    EmbedBackfillJob.perform_later(meeting_id: id)
  end

  # 강제종료/크래시로 recording 에 고정된 회의 자가복구. recorder presence(하트비트)
  # 부재로만 판정 — 침묵과 무관(침묵은 클라측 silenceAutoComplete 가 stop 호출).
  # RecordingLock 미사용 이유: acquire 가 audio_chunk(발화)에서만 호출돼 시작직후 침묵에
  # holder 가 nil → 활성 녹음 오종결. 하트비트는 VAD/일시정지 무관하게 전송돼 정확.
  RECORDER_HEARTBEAT_STALE_AFTER = 90.seconds

  def stale_recording?
    return false unless recording?

    recorder_heartbeat_at.nil? || recorder_heartbeat_at < RECORDER_HEARTBEAT_STALE_AFTER.ago
  end

  # 활성 점유 녹음 여부: recording 이고 점유 기기 하트비트가 신선(stale 아님)할 때만 true.
  # 단일 녹음 기기 락의 충돌 판정과 serializer(recorder_active) 노출이 공유하는 판정.
  def recorder_active?
    recording? && !stale_recording?
  end

  def heal_stale_recording!
    return unless stale_recording?

    # 종료시각 = 마지막 presence(하트비트). 부재(레거시/#207)면 치유 호출 시각.
    ended = recorder_heartbeat_at || Time.current

    # 원자적 종결: recording 인 행만 completed 로 전이. 변경행수 0이면(다른 요청·인스턴스가
    # 먼저 종결) early return — stop 과 동일 시맨틱(브로드캐스트·lock·job)을 중복 실행하지 않는다.
    # update_all 은 콜백/검증 우회(status 전이엔 콜백 불필요). reload 로 in-memory 갱신.
    changed = Meeting.where(id: id, status: "recording")
                     .update_all(status: "completed", ended_at: ended, paused_at: nil, updated_at: Time.current)
    if changed.zero?
      # 다른 healer 가 먼저 completed 로 전이한 경우 — in-memory @meeting 이 recording 으로
      # 잔존하면 가드(reject_if_recorder_conflict!) 통과 후 downstream 액션(stop/pause)이
      # stale recording?=true 로 오작동한다. 성공 분기와 동일하게 reload 로 상태를 맞춘다.
      reload
      return
    end

    RecordingLock.clear(id)

    # stop 액션과 동일하게 녹음 종료 브로드캐스트(읽기전용 뷰어 라우팅 등 프론트 신호).
    ActionCable.server.broadcast(
      transcription_stream,
      { type: "recording_stopped", meeting_id: id }
    )

    # in-memory status 갱신 — show/index serializer 가 종결 후 상태를 일관되게 읽도록.
    reload

    if transcripts.exists?
      MeetingSummarizationJob.perform_later(id, type: "final")
      reconcile_embeddings!
    end
  end
end
