class Meeting < ApplicationRecord
  belongs_to :team
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"
  has_many :transcripts, dependent: :destroy
  has_many :summaries, dependent: :destroy
  has_many :action_items, dependent: :destroy
  has_many :blocks, dependent: :destroy

  validates :title, presence: true
  validates :status, inclusion: { in: %w[pending recording transcribing completed] }
  validates :source, inclusion: { in: %w[live upload] }

  enum :status, { pending: "pending", recording: "recording", transcribing: "transcribing", completed: "completed" }

  scope :for_team, ->(team_ids) { where(team_id: team_ids) }
  scope :search, ->(q) { where("title LIKE ?", "%#{sanitize_sql_like(q)}%") if q.present? }
  scope :created_after, ->(date) { where("created_at >= ?", date) if date.present? }
  scope :created_before, ->(date) { where("created_at <= ?", Date.parse(date).end_of_day) if date.present? }

  def brief_summary(max_length = 80)
    summary = summaries.find_by(summary_type: "final") ||
              summaries.order(generated_at: :desc).first
    return nil unless summary&.notes_markdown.present?

    # 마크다운 헤더/기호 제거 후 첫 줄 추출
    text = summary.notes_markdown
                  .gsub(/^#+\s*/, "")
                  .gsub(/[*_~`>\-]/, "")
                  .strip
                  .lines
                  .map(&:strip)
                  .reject(&:empty?)
                  .first
    return nil unless text

    text.length > max_length ? "#{text[0...max_length]}..." : text
  end
end
