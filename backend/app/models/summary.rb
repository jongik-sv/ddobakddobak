class Summary < ApplicationRecord
  include FtsIndexable
  fts_table :summaries_fts, columns: %i[notes_markdown key_points decisions discussion_details]

  belongs_to :meeting

  validates :summary_type, presence: true, inclusion: { in: %w[realtime final] }
  validates :generated_at, presence: true

  # AI 가 final 행을 쓰는 단일 경로. notes 와 ai 원본을 같은 값으로 두고,
  # human_edited_at 을 비워 대기 중인 디바운스 학습 잡이 불일치로 스킵되게 한다.
  def write_ai_final!(notes_markdown)
    now = Time.current
    update!(notes_markdown: notes_markdown, ai_notes_markdown: notes_markdown,
            ai_generated_at: now, generated_at: now, human_edited_at: nil)
  end

  # 회의록 본문 사람 편집 시각. 디바운스 잡 인자용 iso8601(6) 문자열을 반환한다.
  def mark_human_edited!(at = Time.current)
    update_column(:human_edited_at, at)
    reload.human_edited_at.iso8601(6)
  end

  def learnable?
    summary_type == "final" && ai_notes_markdown.present?
  end

  private

  def fts_value_for(col)
    v = super
    col.to_s == "notes_markdown" ? v.to_s.gsub(/⟦(?:m:\d+\/)?t:\d+(?::\d+)*[|\/]s:[^⟧]+⟧/, "") : v
  end
end
