# 폴더/프로젝트 챗 컨텍스트: 스코프 회의 ∩ 사용자 접근권 → FTS top-K 발췌 + 회의 목차 + history.
# ⚠️ SearchService#accessible_meeting_ids는 Meeting.kept만 쓰므로 재사용 금지 — 여기선 accessible_by(user)로 인가한다.
class FolderChatContext
  MAX_CHARS   = 120_000
  TOP_K       = 40       # FTS 발췌 행 상한
  SNIPPET_LEN = 32

  def self.build(scope_type:, scope_id:, user:, keywords:)
    new(scope_type, scope_id, user, keywords).build
  end

  def initialize(scope_type, scope_id, user, keywords)
    @scope_type = scope_type
    @scope_id   = scope_id
    @user       = user
    @keywords   = Array(keywords).reject(&:blank?)
  end

  def build
    parts = []
    parts << "스코프: #{@scope_type} ##{@scope_id} (회의 #{meeting_ids.size}건)"
    parts << "회의 목차:\n#{toc_block}" if toc_block.present?
    parts << "관련 회의 발췌:\n#{excerpts_block}" if excerpts_block.present?
    parts << history_block if history_block.present?
    { system_prompt: LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT, user_content: truncate(parts.join("\n\n")) }
  end

  private

  # 스코프 후보 회의 ∩ accessible_by(user) → id 배열.
  # accessible_by 가 인가 경계 — 공유 안 된 타인 회의는 여기서 걸러져 발췌에 절대 노출되지 않는다.
  def meeting_ids
    @meeting_ids ||= begin
      scoped = case @scope_type
      when "folder"
        ids = Folder.find_by(id: @scope_id)&.subtree_ids || []
        Meeting.where(folder_id: ids)
      when "project"
        Meeting.where(project_id: @scope_id)
      else
        Meeting.none
      end
      scoped.merge(Meeting.accessible_by(@user)).pluck(:id)
    end
  end

  def fts_query
    @keywords.map { |w| "\"#{w.gsub('"', '')}\"*" }.join(" OR ")
  end

  # FTS top-K 발췌 — 회의ID·ms·화자·snippet. (transcripts_fts, content 가 0번 컬럼)
  def excerpts_block
    return @excerpts_block if defined?(@excerpts_block)

    if meeting_ids.empty? || @keywords.empty?
      return @excerpts_block = ""
    end

    placeholders = meeting_ids.map { "?" }.join(",")
    sql = <<~SQL
      SELECT t.meeting_id, t.started_at_ms, t.speaker_label, t.speaker_name, m.title AS meeting_title,
             snippet(transcripts_fts, 0, '', '', '…', #{SNIPPET_LEN}) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      JOIN meetings m ON m.id = t.meeting_id
      WHERE transcripts_fts MATCH ? AND t.meeting_id IN (#{placeholders})
      ORDER BY rank
      LIMIT #{TOP_K}
    SQL
    binds = [ fts_query ] + meeting_ids
    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([ sql ] + binds)
    )
    @excerpts_block = rows.map { |r|
      ms = r["started_at_ms"].to_i
      clock = format("%02d:%02d", ms / 60000, (ms / 1000) % 60)
      spk = r["speaker_label"].presence || "화자"
      "[회의:#{r['meeting_id']} #{r['meeting_title']}][#{clock}|#{ms}ms #{spk}] #{r['snippet']}"
    }.join("\n")
  end

  # 회의 목차: 후보 회의 제목·날짜·brief_summary 한 줄(폭넓은 질문 대비).
  def toc_block
    return @toc_block if defined?(@toc_block)
    @toc_block = Meeting.where(id: meeting_ids).order(created_at: :desc).limit(100).map { |m|
      brief = m.brief_summary.to_s.strip.tr("\n", " ")
      "- [회의:#{m.id}] #{m.title} (#{m.created_at.to_date})#{brief.present? ? " — #{brief}" : ''}"
    }.join("\n")
  end

  def history_block
    return @history_block if defined?(@history_block)
    msgs = ChatMessage.for_scope(@scope_type, @scope_id).for_user(@user)
                      .where(status: "complete").order(:created_at).last(6)
    @history_block = msgs.any? ? "이전 대화:\n" + msgs.map { |m| "#{m.role == 'user' ? '사용자' : '어시스턴트'}: #{m.content}" }.join("\n") : ""
  end

  def truncate(text)
    text.length > MAX_CHARS ? text[0, MAX_CHARS] + "\n…(생략)…" : text
  end
end
