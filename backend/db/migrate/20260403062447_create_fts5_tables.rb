class CreateFts5Tables < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts
      USING fts5(content, speaker_label, source_id UNINDEXED, tokenize='unicode61');
    SQL

    execute <<~SQL
      CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts
      USING fts5(notes_markdown, key_points, decisions, discussion_details, source_id UNINDEXED, tokenize='unicode61');
    SQL

    # 기존 데이터 FTS에 채우기
    execute <<~SQL
      INSERT INTO transcripts_fts(source_id, content, speaker_label)
      SELECT id, content, speaker_label FROM transcripts;
    SQL

    execute <<~SQL
      INSERT INTO summaries_fts(source_id, notes_markdown, key_points, decisions, discussion_details)
      SELECT id, notes_markdown, key_points, decisions, discussion_details FROM summaries;
    SQL
  end

  def down
    execute "DROP TABLE IF EXISTS transcripts_fts;"
    execute "DROP TABLE IF EXISTS summaries_fts;"
  end
end
