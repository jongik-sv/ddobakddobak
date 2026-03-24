class AddNotesMarkdownToSummaries < ActiveRecord::Migration[8.1]
  def change
    add_column :summaries, :notes_markdown, :text
  end
end
