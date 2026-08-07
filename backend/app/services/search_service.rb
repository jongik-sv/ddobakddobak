class SearchService
  PER_PAGE_DEFAULT = 20
  PER_PAGE_MAX     = 100

  Result = Struct.new(:results, :total, :page, :per_page, keyword_init: true)

  def initialize(user:, query:, filters: {}, page: 1, per_page: PER_PAGE_DEFAULT)
    @user     = user
    @query    = query.to_s.strip
    @filters  = filters.symbolize_keys
    @page     = [ (page.presence || 1).to_i, 1 ].max
    @per_page = [ [ (per_page.presence || PER_PAGE_DEFAULT).to_i, 1 ].max, PER_PAGE_MAX ].min
  end

  def call
    return empty_result if @query.blank?

    transcript_rows = search_transcripts
    summary_rows    = search_summaries

    combined = (transcript_rows + summary_rows).sort_by { |r| r[:created_at] }.reverse
    total    = combined.size
    paged    = combined.drop((@page - 1) * @per_page).first(@per_page)

    Result.new(results: paged, total: total, page: @page, per_page: @per_page)
  end

  private

  # 필터(폴더/상태/기간)만 반영한 접근가능 회의 스코프. 실제 id를 Ruby 배열로 뽑아 거대 IN(?,?,…)에
  # 박아넣지 않고, FTS 쿼리 안에 그대로 서브쿼리로 내려보낸다(select(:id).to_sql로 아래 재사용) —
  # 무필터(전건) 검색 시 SQLite 바인드 변수 상한을 넘길 위험과 id 전건을 Ruby 힙에 올리는 비용을
  # 없앤다. Meeting.kept와 각 where 절은 기존과 동일한 필터 조합을 그대로 유지한다.
  def accessible_meeting_scope
    @accessible_meeting_scope ||= begin
      scope = Meeting.kept
      scope = scope.where(folder_id: @filters[:folder_id])         if @filters[:folder_id].present?
      scope = scope.where(status: @filters[:status])               if @filters[:status].present?
      scope = scope.where("meetings.created_at >= ?", @filters[:date_from]) if @filters[:date_from].present?
      scope = scope.where("meetings.created_at <= ?", Date.parse(@filters[:date_to]).end_of_day) if @filters[:date_to].present?
      scope
    end
  end

  # id를 전건 로드하지 않고 존재 여부만 확인 — 접근가능 회의가 하나도 없으면 FTS 쿼리 자체를
  # 생략한다(기존 accessible_meeting_ids.empty? 가드와 동일한 조기 반환 동작).
  def accessible_meetings_present?
    return @accessible_meetings_present if defined?(@accessible_meetings_present)
    @accessible_meetings_present = accessible_meeting_scope.exists?
  end

  # 위 스코프를 그대로 서브쿼리 SQL로 내린다. AR가 값들을 안전하게 리터럴 quote 하므로
  # (바인드 파라미터가 아니라 to_sql이 직접 임베드) 별도 bind 배열이 필요 없다.
  #
  # ⚠️ 이 문자열을 raw SQL에 바로 문자열 보간해서 sanitize_sql_array에 넘기면 안 된다 —
  # sanitize_sql_array→replace_bind_variables는 statement.gsub(/\?/)로 SQL 전체에서 물음표를
  # "전부" 순서대로 찾아 바인드값과 매칭한다(따옴표 안 리터럴인지 구분 안 함). folder_id/status
  # 같은 필터는 사용자 입력이므로 값 안에 리터럴 "?"가 있으면(예: status=abc?) to_sql이 quote한
  # 이 서브쿼리 문자열에도 "?"가 섞여 들어가 바인드 순서가 밀리거나 개수 불일치 에러가 난다.
  # 그래서 아래 search_transcripts/search_summaries에서는 sanitize_sql_array가 실제 "?"
  # placeholder(MATCH ?, speaker 조건)만 먼저 바인딩하도록 이 서브쿼리 자리엔 SENTINEL을 넣어두고,
  # 바인딩이 끝난 뒤 순수 문자열 치환(블록 형태 sub — 역참조 해석 방지)으로 마지막에 끼워 넣는다.
  def accessible_meeting_subquery_sql
    @accessible_meeting_subquery_sql ||= accessible_meeting_scope.select(:id).to_sql
  end

  ACCESSIBLE_SUBQUERY_SENTINEL = "__accessible_meeting_ids_subquery__".freeze

  def bind_and_inline_subquery(sql, binds)
    bound = ActiveRecord::Base.sanitize_sql_array([ sql ] + binds)
    bound.sub(ACCESSIBLE_SUBQUERY_SENTINEL) { accessible_meeting_subquery_sql }
  end

  def fts_query
    @query.split(/\s+/).map { |w| "\"#{w}\"*" }.join(" ")
  end

  def search_transcripts
    return [] unless accessible_meetings_present?

    fts_q = fts_query

    speaker_condition = if @filters[:speaker].present?
      "AND (t.speaker_label = ? OR t.speaker_name = ?)"
    else
      ""
    end

    sql = <<~SQL
      SELECT t.id, t.meeting_id, t.speaker_label, t.speaker_name, t.created_at,
             m.title AS meeting_title,
             snippet(transcripts_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      JOIN meetings m ON m.id = t.meeting_id
      WHERE transcripts_fts MATCH ?
        AND t.meeting_id IN (#{ACCESSIBLE_SUBQUERY_SENTINEL})
        #{speaker_condition}
      ORDER BY rank
    SQL

    binds = [ fts_q ]
    binds += [ @filters[:speaker], @filters[:speaker] ] if @filters[:speaker].present?

    rows = ActiveRecord::Base.connection.select_all(bind_and_inline_subquery(sql, binds))

    rows.map do |row|
      {
        meeting_id: row["meeting_id"],
        meeting_title: row["meeting_title"],
        type: "transcript",
        snippet: row["snippet"],
        speaker: row["speaker_name"].presence || row["speaker_label"],
        created_at: row["created_at"]
      }
    end
  end

  def search_summaries
    return [] unless accessible_meetings_present?

    fts_q = fts_query

    sql = <<~SQL
      SELECT s.id, s.meeting_id, s.created_at,
             m.title AS meeting_title,
             snippet(summaries_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
      FROM summaries_fts
      JOIN summaries s ON s.id = summaries_fts.source_id
      JOIN meetings m ON m.id = s.meeting_id
      WHERE summaries_fts MATCH ?
        AND s.meeting_id IN (#{ACCESSIBLE_SUBQUERY_SENTINEL})
      ORDER BY rank
    SQL

    binds = [ fts_q ]

    rows = ActiveRecord::Base.connection.select_all(bind_and_inline_subquery(sql, binds))

    rows.map do |row|
      {
        meeting_id: row["meeting_id"],
        meeting_title: row["meeting_title"],
        type: "summary",
        snippet: row["snippet"],
        speaker: nil,
        created_at: row["created_at"]
      }
    end
  end

  def empty_result
    Result.new(results: [], total: 0, page: @page, per_page: @per_page)
  end
end
