class AddAiOriginalToSummaries < ActiveRecord::Migration[8.1]
  # 컬럼 추가만(SQLite 테이블 재생성 없음).
  def change
    add_column :summaries, :ai_notes_markdown, :text
    add_column :summaries, :ai_generated_at, :datetime
    add_column :summaries, :human_edited_at, :datetime
  end
end
