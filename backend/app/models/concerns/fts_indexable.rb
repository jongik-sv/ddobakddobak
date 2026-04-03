module FtsIndexable
  extend ActiveSupport::Concern

  class_methods do
    def fts_table(table_name, columns:)
      after_save    :fts_upsert
      after_destroy :fts_delete

      define_method(:fts_table_name)  { table_name.to_s }
      define_method(:fts_columns)     { columns }
    end

    # FTS 테이블이 없으면 생성 (테스트 등에서 호출)
    def ensure_fts_tables!
      conn = ActiveRecord::Base.connection
      [
        ["transcripts_fts", "content, speaker_label"],
        ["summaries_fts", "notes_markdown, key_points, decisions, discussion_details"]
      ].each do |name, cols|
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS #{name} USING fts5(#{cols}, source_id UNINDEXED, tokenize='unicode61')")
      end
    end
  end

  private

  def fts_upsert
    conn = ActiveRecord::Base.connection
    conn.execute(ActiveRecord::Base.sanitize_sql_array(
      ["DELETE FROM #{fts_table_name} WHERE source_id = ?", id]
    ))
    cols = fts_columns.map(&:to_s)
    vals = cols.map { |c| send(c) }
    placeholders = (["?"] * (cols.size + 1)).join(", ")
    conn.execute(ActiveRecord::Base.sanitize_sql_array(
      ["INSERT INTO #{fts_table_name}(#{cols.join(', ')}, source_id) VALUES (#{placeholders})"] + vals + [id]
    ))
  rescue => e
    Rails.logger.warn("FtsIndexable: upsert failed for #{self.class.name}##{id}: #{e.message}")
  end

  def fts_delete
    conn = ActiveRecord::Base.connection
    conn.execute(ActiveRecord::Base.sanitize_sql_array(
      ["DELETE FROM #{fts_table_name} WHERE source_id = ?", id]
    ))
  rescue => e
    Rails.logger.warn("FtsIndexable: delete failed for #{self.class.name}##{id}: #{e.message}")
  end
end
