# 세컨드 브레인 외부 API(/api/ext/v1/search)용 하이브리드(FTS+벡터 RRF) 회의 검색.
# ⚠️ 인가 경계는 호출부(Ext::V1::SearchController)가 넘기는 `meetings` relation 하나뿐이다 —
# 이 서비스는 그 relation을 pluck(:id)로 확정한 뒤에는 절대 다른 경로로 회의를 넓히지 않는다.
# FolderChatContext(app/services/folder_chat_context.rb)의 FTS prefix 쿼리·RRF 융합 방식을 그대로
# 따르되, 스코프 소스가 폴더/프로젝트 재계산이 아니라 컨트롤러가 넘긴 relation이라는 점이 다르다.
class ExtMeetingSearch
  RRF_K              = 60   # Reciprocal Rank Fusion 상수
  CANDIDATE_POOL      = 60   # 융합 전 각 경로(FTS/벡터)에서 확보하는 후보 수
  TRANSCRIPT_SNIPPET_LEN = 32
  TRANSCRIPT_EXCERPT_LEN = 160 # FTS snippet이 없을 때(벡터 전용 히트) 본문 절단 길이
  SUMMARY_SNIPPET_LEN    = 32
  SUMMARY_LIMIT           = 10

  Result = Struct.new(:transcript_results, :summary_results, :vector_used, keyword_init: true)

  def self.call(user:, meetings:, q:, limit: 20)
    new(user: user, meetings: meetings, q: q, limit: limit).call
  end

  def initialize(user:, meetings:, q:, limit:)
    @user        = user
    @meeting_ids = meetings.pluck(:id)
    @q           = q.to_s.strip
    @limit       = limit
  end

  def call
    Result.new(
      transcript_results: transcript_results,
      summary_results: summary_results,
      vector_used: @vector_used.nil? ? true : @vector_used
    )
  end

  private

  def fts_terms
    @fts_terms ||= @q.split(/\s+/).map(&:strip).reject(&:blank?)
  end

  # 토큰별 prefix OR(FolderChatContext#fts_query와 동일 방식) — 큰따옴표 제거로 인젝션 안전.
  def fts_query
    fts_terms.map { |w| "\"#{w.gsub('"', '')}\"*" }.join(" OR ")
  end

  def transcript_results
    return [] if @meeting_ids.empty? || fts_terms.empty?

    fts_ids, snippets = fts_transcript_ranked
    ranked = rrf_merge(fts_ids, vector_ranked_ids).first(@limit)
    return [] if ranked.empty?

    # meeting_id: @meeting_ids를 다시 건다 — 벡터 경로(TranscriptVectorSearch)가 잘못된 id를
    # 반환하더라도(버그·향후 변경) 스코프 밖 transcript가 렌더되지 않도록 하는 방어선.
    by_id = Transcript.where(id: ranked, meeting_id: @meeting_ids).includes(:meeting).index_by(&:id)
    ranked.filter_map do |tid|
      t = by_id[tid]
      next unless t
      {
        meeting_id: t.meeting_id,
        meeting_title: t.meeting&.title,
        transcript_id: t.id,
        snippet: snippets[tid].presence || t.content.to_s[0, TRANSCRIPT_EXCERPT_LEN],
        speaker_label: t.speaker_label,
        started_at_ms: t.started_at_ms
      }
    end
  end

  def fts_transcript_ranked
    placeholders = @meeting_ids.map { "?" }.join(",")
    sql = <<~SQL
      SELECT transcripts_fts.source_id AS tid,
             snippet(transcripts_fts, 0, '', '', '…', #{TRANSCRIPT_SNIPPET_LEN}) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      WHERE transcripts_fts MATCH ? AND t.meeting_id IN (#{placeholders})
      ORDER BY rank
      LIMIT #{CANDIDATE_POOL}
    SQL
    binds = [ fts_query ] + @meeting_ids
    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([ sql ] + binds)
    )
    snippets = {}
    ids = rows.map { |r| id = r["tid"].to_i; snippets[id] = r["snippet"]; id }
    [ ids, snippets ]
  end

  # 벡터 랭크: 예외(sidecar 다운 등) 시 빈 배열 폴백 + vector_used=false. 정상 완료(매칭 0건 포함)면 true.
  def vector_ranked_ids
    @vector_used = true
    return [] if @meeting_ids.empty? || @q.blank?

    TranscriptVectorSearch.search_multi(queries: [ @q ], meeting_ids: @meeting_ids, limit: CANDIDATE_POOL)
                          .first.to_a.map { |h| h[:transcript_id] }
  rescue => e
    Rails.logger.warn("[ExtMeetingSearch] 벡터검색 실패 → FTS-only: #{e.message}")
    @vector_used = false
    []
  end

  # score(t) = Σ_lists 1/(RRF_K + rank + 1). 내림차순 id 배열.
  def rrf_merge(*lists)
    scores = Hash.new(0.0)
    lists.each do |list|
      list.each_with_index { |id, rank| scores[id] += 1.0 / (RRF_K + rank + 1) }
    end
    scores.sort_by { |_id, s| -s }.map(&:first)
  end

  # 요약 경로: 임베딩이 없으므로 FTS 전용, 상위 SUMMARY_LIMIT건.
  def summary_results
    return [] if @meeting_ids.empty? || fts_terms.empty?

    placeholders = @meeting_ids.map { "?" }.join(",")
    sql = <<~SQL
      SELECT summaries_fts.source_id AS sid,
             snippet(summaries_fts, 0, '', '', '…', #{SUMMARY_SNIPPET_LEN}) AS snippet
      FROM summaries_fts
      JOIN summaries s ON s.id = summaries_fts.source_id
      WHERE summaries_fts MATCH ? AND s.meeting_id IN (#{placeholders})
      ORDER BY rank
      LIMIT #{SUMMARY_LIMIT}
    SQL
    binds = [ fts_query ] + @meeting_ids
    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([ sql ] + binds)
    )
    return [] if rows.empty?

    ids = rows.map { |r| r["sid"].to_i }
    snippet_by_id = rows.index_by { |r| r["sid"].to_i }
    by_id = Summary.where(id: ids).includes(:meeting).index_by(&:id)
    ids.filter_map do |sid|
      s = by_id[sid]
      next unless s
      {
        meeting_id: s.meeting_id,
        meeting_title: s.meeting&.title,
        summary_id: s.id,
        snippet: snippet_by_id[sid]["snippet"]
      }
    end
  end
end
