# 폴더/프로젝트 챗 컨텍스트: 스코프 회의 ∩ 사용자 접근권 → 하이브리드(FTS+벡터 RRF) 발췌 + 목차 + history.
# ⚠️ SearchService#accessible_meeting_ids는 Meeting.kept만 쓰므로 재사용 금지 — 여기선 accessible_by(user)로 인가한다.
# ⚠️ FTS·벡터 두 경로 모두 동일 meeting_ids로 필터 — privilege escalation 방지.
class FolderChatContext
  MAX_CHARS   = 120_000
  TOP_K       = 60       # 융합 후 발췌 행 상한
  SNIPPET_LEN = 32
  EXCERPT_LEN = 160      # 벡터 전용 히트(FTS snippet 없음) 본문 절단 길이
  RRF_K       = 60       # Reciprocal Rank Fusion 상수

  def self.build(scope_type:, scope_id:, user:, keywords:, expansions: [], query_text: nil)
    new(scope_type, scope_id, user, keywords, expansions, query_text).build
  end

  def initialize(scope_type, scope_id, user, keywords, expansions = [], query_text = nil)
    @scope_type = scope_type
    @scope_id   = scope_id
    @user       = user
    @keywords   = Array(keywords).map(&:to_s).reject(&:blank?)
    @expansions = Array(expansions).map(&:to_s).reject(&:blank?)
    @query_text = query_text.to_s
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

  # FTS 검색어: 키워드 ∪ 확장어(토큰 분해). 다중어 확장은 토큰별 prefix OR(phrase-prefix 모호성 회피).
  def fts_terms
    @fts_terms ||= (@keywords + @expansions.flat_map { |e| e.split(/\s+/) })
                     .map(&:strip).reject(&:blank?).uniq
  end

  def fts_query
    fts_terms.map { |w| "\"#{w.gsub('"', '')}\"*" }.join(" OR ")
  end

  # FTS 랭크: [transcript_id, ...] 순위. snippet은 @fts_snippets[id]에 저장.
  def fts_ranked_ids
    return [] if meeting_ids.empty? || fts_terms.empty?

    placeholders = meeting_ids.map { "?" }.join(",")
    sql = <<~SQL
      SELECT transcripts_fts.source_id AS tid,
             snippet(transcripts_fts, 0, '', '', '…', #{SNIPPET_LEN}) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      WHERE transcripts_fts MATCH ? AND t.meeting_id IN (#{placeholders})
      ORDER BY rank
      LIMIT #{TOP_K}
    SQL
    binds = [ fts_query ] + meeting_ids
    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([ sql ] + binds)
    )
    @fts_snippets = {}
    rows.map { |r| id = r["tid"].to_i; @fts_snippets[id] = r["snippet"]; id }
  end

  # 벡터 검색 쿼리: 확장어 우선, 없으면 원문(query_text)으로 폴백(하위호환).
  def vector_queries
    (@expansions.presence || [ @query_text ]).map(&:to_s).reject(&:blank?)
  end

  # 벡터 랭크 리스트들: 쿼리(확장어)별 [transcript_id,...]. sidecar 실패 시 [] (FTS-only fallback).
  def vector_ranked_lists
    return [] if meeting_ids.empty? || vector_queries.empty?

    TranscriptVectorSearch.search_multi(queries: vector_queries, meeting_ids: meeting_ids, limit: TOP_K)
                          .map { |list| list.map { |h| h[:transcript_id] } }
  rescue => e
    Rails.logger.warn("[FolderChatContext] 벡터검색 실패 → FTS-only: #{e.message}")
    []
  end

  # RRF: score(t) = Σ_lists 1/(RRF_K + rank). 내림차순 transcript_id 배열.
  def rrf_merge(*lists)
    scores = Hash.new(0.0)
    lists.each do |list|
      list.each_with_index { |tid, rank| scores[tid] += 1.0 / (RRF_K + rank + 1) }
    end
    scores.sort_by { |_tid, s| -s }.map(&:first)
  end

  def excerpts_block
    return @excerpts_block if defined?(@excerpts_block)
    return @excerpts_block = "" if meeting_ids.empty?

    @fts_snippets = {}
    fts_ids   = fts_ranked_ids
    vec_lists = vector_ranked_lists
    return @excerpts_block = "" if fts_ids.empty? && vec_lists.all?(&:empty?)

    ranked = rrf_merge(fts_ids, *vec_lists).first(TOP_K)
    @excerpts_block = build_excerpt_lines(ranked)
  end

  # 융합 순서대로 발췌 라인 구성. text = FTS snippet 있으면 그것, 없으면 content 절단.
  def build_excerpt_lines(ranked_ids)
    by_id = Transcript.where(id: ranked_ids).includes(:meeting).index_by(&:id)
    ranked_ids.filter_map { |tid|
      t = by_id[tid]
      next unless t
      ms = t.started_at_ms.to_i
      clock = format("%02d:%02d", ms / 60000, (ms / 1000) % 60)
      spk = t.speaker_label.presence || "화자"
      text = @fts_snippets[tid].presence || t.content.to_s[0, EXCERPT_LEN]
      "[회의:#{t.meeting_id} #{t.meeting&.title}][#{clock}|#{ms}ms #{spk}] #{text}"
    }.join("\n")
  end

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
