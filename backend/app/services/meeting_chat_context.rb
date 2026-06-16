# backend/app/services/meeting_chat_context.rb
class MeetingChatContext
  MAX_CHARS = 120_000      # 대략적 입력 예산 (200k 토큰 컨텍스트 대비 여유)
  SUMMARY_MAX_CHARS = 40_000 # 요약이 예산을 통째로 잡아먹지 않도록 상한
  HISTORY_TURNS = 6        # 직전 대화 메시지 수

  def self.build(meeting:, user:, question:)
    new(meeting, user, question).build
  end

  def initialize(meeting, user, question)
    @meeting = meeting
    @user = user
    @question = question.to_s
  end

  TRANSCRIPT_HEADER = "회의 전사:\n".freeze
  TRANSCRIPT_OMISSION = "\n…(전사 일부 생략 — 길어서 잘림)…".freeze
  SEPARATOR = "\n\n".freeze

  def build
    fixed = []
    fixed << "회의 제목: #{@meeting.title} (#{@meeting.created_at.to_date})"
    fixed << "회의록 요약:\n#{summary_text}" if summary_text.present?
    fixed << history_block if history_block.present?
    fixed << "질문: #{@question}"

    # transcript body 예산: MAX_CHARS에서 고정 블록·블록 간 구분자·전사 헤더/생략 마커를
    # 모두 제외한 나머지. 이렇게 빼두면 최종 user_content 길이가 MAX_CHARS를 넘지 않는다.
    overhead = TRANSCRIPT_HEADER.length + TRANSCRIPT_OMISSION.length +
               SEPARATOR.length * fixed.length
    budget = [MAX_CHARS - fixed.sum(&:length) - overhead, 0].max
    transcript = transcript_block(budget)

    parts = []
    parts << fixed[0]
    parts << "회의록 요약:\n#{summary_text}" if summary_text.present?
    parts << transcript if transcript.present?
    parts << history_block if history_block.present?
    parts << "질문: #{@question}"
    { system_prompt: LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT, user_content: parts.join(SEPARATOR) }
  end

  private

  def summary_text
    return @summary_text if defined?(@summary_text)
    s = @meeting.summaries.where(summary_type: "final").order(:created_at).last ||
        @meeting.summaries.order(:created_at).last
    text = s&.notes_markdown.to_s
    cap = self.class::SUMMARY_MAX_CHARS
    if text.length > cap
      text = text[0, cap] + "\n…(요약 일부 생략 — 길어서 잘림)…"
    end
    @summary_text = text
  end

  def transcript_block(budget)
    lines = @meeting.transcripts.order(:sequence_number).map do |t|
      "[#{ms_to_clock(t.started_at_ms)}] #{t.speaker_name.presence || t.speaker_label}: #{t.content}"
    end
    body = lines.join("\n")
    return "" if body.blank?
    return "" unless budget.positive?
    if body.length > budget
      body = body[0, budget] + TRANSCRIPT_OMISSION
    end
    "#{TRANSCRIPT_HEADER}#{body}"
  end

  def history_block
    return @history_block if defined?(@history_block)
    msgs = @meeting.chat_messages.for_user(@user)
                   .where(status: "complete").order(:created_at).last(HISTORY_TURNS)
    @history_block =
      if msgs.any?
        "이전 대화:\n" + msgs.map { |m| "#{m.role == 'user' ? '사용자' : '어시스턴트'}: #{m.content}" }.join("\n")
      else
        ""
      end
  end

  def ms_to_clock(ms)
    s = (ms.to_i / 1000)
    format("%02d:%02d", s / 60, s % 60)
  end
end
