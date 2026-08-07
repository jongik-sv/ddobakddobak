class MeetingFinalizerService
  def initialize(meeting)
    @meeting = meeting
  end

  def call
    transcripts = @meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    # ⭐ 절단 표식 워터마크 (감사 CRITICAL, MeetingSummarizationJob#redacted_since? 와 동일 근거).
    # 이 서비스는 정확히 redact 가 파기 대상으로 삼는 테이블(action_items 의 ai_generated: true
    # 행)에 쓴다. LLM 호출(수십 초) 중 기밀 절단이 커밋되면, 절단 전 전사로 만든 결과를 쓰기
    # 직전에 버려야 한다 — 안 그러면 파기했다고 믿은 파생 텍스트가 부활한다.
    redacted_watermark = @meeting.transcripts_redacted_at

    llm = LlmService.new(llm_config: @meeting.creator&.effective_llm_config)
    payload = Transcript.to_sidecar_payload(transcripts)

    # Action Items 추출 (structured JSON)
    items_result = llm.summarize_action_items(payload)

    # ⭐ LLM 호출이 끝난 뒤, 쓰기 직전에 재확인한다. 값 비교라 nil → 시각 전이·재절단으로
    # 인한 시각 변경을 모두 잡는다. 재큐잉하지 않는다 — 사용자가 필요하면 다시 회의록 재생성을 누른다.
    if redacted_since?(redacted_watermark)
      Rails.logger.info "[MeetingFinalizerService] skipped (redacted during LLM) meeting=#{@meeting.id}"
      return
    end

    save_action_items(items_result["action_items"] || [])
  rescue => e
    Rails.logger.error "[MeetingFinalizerService] meeting=#{@meeting.id} error=#{e.message}"
  end

  private

  # DB 에서 다시 읽는다 — @meeting 인스턴스는 redact 를 커밋한 다른 프로세스·다른 Meeting
  # 인스턴스의 변경을 영원히 못 본다(AudioRedactor#source_unchanged? 와 같은 이유).
  def redacted_since?(watermark)
    Meeting.where(id: @meeting.id).pick(:transcripts_redacted_at) != watermark
  end

  def save_action_items(items)
    items.each do |item|
      @meeting.action_items.create!(
        content:      item["content"],
        status:       "todo",
        ai_generated: true
      )
    end
  end

end
