class SearchService
  PER_PAGE_DEFAULT = 20
  PER_PAGE_MAX     = 100

  Result = Struct.new(:results, :total, :page, :per_page, keyword_init: true)

  def initialize(user:, query:, filters: {}, page: 1, per_page: PER_PAGE_DEFAULT)
    @user     = user
    @query    = query.to_s.strip
    @filters  = filters.symbolize_keys
    @page     = [(page.presence || 1).to_i, 1].max
    @per_page = [[(per_page.presence || PER_PAGE_DEFAULT).to_i, 1].max, PER_PAGE_MAX].min
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

  def accessible_meeting_ids
    @accessible_meeting_ids ||= begin
      scope = Meeting.all
      scope = scope.where(folder_id: @filters[:folder_id])         if @filters[:folder_id].present?
      scope = scope.where(status: @filters[:status])               if @filters[:status].present?
      scope = scope.where("meetings.created_at >= ?", @filters[:date_from]) if @filters[:date_from].present?
      scope = scope.where("meetings.created_at <= ?", Date.parse(@filters[:date_to]).end_of_day) if @filters[:date_to].present?
      scope.pluck(:id)
    end
  end

  def fts_query
    @query.split(/\s+/).map { |w| "\"#{w}\"*" }.join(" ")
  end

  def search_transcripts
    return [] if accessible_meeting_ids.empty?

    fts_q = fts_query
    placeholders = accessible_meeting_ids.map { "?" }.join(",")

    speaker_condition = if @filters[:speaker].present?
      "AND t.speaker_label = ?"
    else
      ""
    end

    sql = <<~SQL
      SELECT t.id, t.meeting_id, t.speaker_label, t.created_at,
             m.title AS meeting_title,
             snippet(transcripts_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      JOIN meetings m ON m.id = t.meeting_id
      WHERE transcripts_fts MATCH ?
        AND t.meeting_id IN (#{placeholders})
        #{speaker_condition}
      ORDER BY rank
    SQL

    binds = [fts_q] + accessible_meeting_ids
    binds << @filters[:speaker] if @filters[:speaker].present?

    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([sql] + binds)
    )

    rows.map do |row|
      {
        meeting_id: row["meeting_id"],
        meeting_title: row["meeting_title"],
        type: "transcript",
        snippet: row["snippet"],
        speaker: row["speaker_label"],
        created_at: row["created_at"]
      }
    end
  end

  def search_summaries
    return [] if accessible_meeting_ids.empty?

    fts_q = fts_query
    placeholders = accessible_meeting_ids.map { "?" }.join(",")

    sql = <<~SQL
      SELECT s.id, s.meeting_id, s.created_at,
             m.title AS meeting_title,
             snippet(summaries_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
      FROM summaries_fts
      JOIN summaries s ON s.id = summaries_fts.source_id
      JOIN meetings m ON m.id = s.meeting_id
      WHERE summaries_fts MATCH ?
        AND s.meeting_id IN (#{placeholders})
      ORDER BY rank
    SQL

    binds = [fts_q] + accessible_meeting_ids

    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([sql] + binds)
    )

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
