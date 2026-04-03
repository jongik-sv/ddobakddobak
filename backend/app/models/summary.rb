class Summary < ApplicationRecord
  include FtsIndexable
  fts_table :summaries_fts, columns: %i[notes_markdown key_points decisions discussion_details]

  belongs_to :meeting

  validates :summary_type, presence: true, inclusion: { in: %w[realtime final] }
  validates :generated_at, presence: true
end
