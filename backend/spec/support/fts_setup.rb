RSpec.configure do |config|
  config.before(:suite) do
    conn = ActiveRecord::Base.connection
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(content, speaker_label, source_id UNINDEXED, tokenize='unicode61')")
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(notes_markdown, key_points, decisions, discussion_details, source_id UNINDEXED, tokenize='unicode61')")
    conn.execute("DELETE FROM transcripts_fts")
    conn.execute("DELETE FROM summaries_fts")
  end

  # FTS5 가상 테이블은 트랜잭션 롤백에 참여하지 않을 수 있으므로 테스트 전 정리
  config.before(:each) do
    conn = ActiveRecord::Base.connection
    conn.execute("DELETE FROM transcripts_fts") rescue nil
    conn.execute("DELETE FROM summaries_fts") rescue nil
  end
end
