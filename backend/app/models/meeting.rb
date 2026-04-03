class Meeting < ApplicationRecord
  belongs_to :team, optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"
  belongs_to :folder, optional: true
  has_many :taggings, as: :taggable, dependent: :destroy
  has_many :tags, through: :taggings
  has_many :transcripts, dependent: :destroy
  has_many :summaries, dependent: :destroy
  has_many :action_items, dependent: :destroy
  has_many :blocks, dependent: :destroy
  has_many :meeting_attachments, dependent: :destroy
  has_many :meeting_bookmarks, dependent: :destroy
  has_many :meeting_participants, dependent: :destroy
  has_many :active_participants, -> { where(left_at: nil) }, class_name: "MeetingParticipant"

  validates :title, presence: true
  validates :share_code, uniqueness: true, allow_nil: true
  validates :status, inclusion: { in: %w[pending recording transcribing completed] }
  validates :source, inclusion: { in: %w[live upload] }

  enum :status, { pending: "pending", recording: "recording", transcribing: "transcribing", completed: "completed" }

  scope :search, ->(q) { where("title LIKE ?", "%#{sanitize_sql_like(q)}%") if q.present? }
  scope :created_after, ->(date) { where("created_at >= ?", date) if date.present? }
  scope :created_before, ->(date) { where("created_at <= ?", Date.parse(date).end_of_day) if date.present? }
  scope :by_status, ->(status) { where(status: status) if status.present? }

  def sharing?
    share_code.present?
  end

  def owner?(user)
    created_by_id == user.id
  end

  def transcription_stream
    "meeting_#{id}_transcription"
  end

  def host_participant
    active_participants.find_by(role: MeetingParticipant::ROLE_HOST)
  end

  def active_summary
    summaries.find_by(summary_type: "final") ||
      summaries.order(generated_at: :desc).first
  end

  def current_notes_markdown
    active_summary&.notes_markdown.to_s
  end

  # notes_markdown에서 의미 있는 요약 텍스트를 추출하여 brief_summary 컬럼에 저장
  def refresh_brief_summary!(notes_markdown = nil)
    notes_markdown ||= (summaries.find_by(summary_type: "final") ||
                        summaries.order(generated_at: :desc).first)&.notes_markdown
    return if notes_markdown.blank?

    text = self.class.extract_brief_summary(notes_markdown)
    update_column(:brief_summary, text) if text.present?
  end

  def self.extract_brief_summary(notes_markdown, max_length: 150)
    lines = notes_markdown.lines.map(&:strip).reject(&:empty?)

    # 마크다운 헤더, 구분선, 빈 블릿 등 건너뛰고 실제 내용 추출
    content_lines = lines.reject { |l|
      l.match?(/\A\#{1,6}\s/) ||      # 헤더
      l.match?(/\A[-=*]{3,}\z/) ||     # 구분선
      l.match?(/\A```/) ||             # 코드블록
      l.match?(/\A\|/)                 # 테이블
    }.map { |l|
      l.gsub(/\A[-*+]\s+/, "")        # 불릿 마커 제거
       .gsub(/\*\*(.+?)\*\*/, '\1')   # 볼드 제거
       .gsub(/[*_~`>]/, "")           # 나머지 마크다운 기호 제거
       .strip
    }.reject(&:empty?)

    return nil if content_lines.empty?

    # 첫 2~3줄을 합쳐서 의미 있는 길이 확보
    result = ""
    content_lines.each do |line|
      candidate = result.empty? ? line : "#{result} #{line}"
      if candidate.length > max_length
        result = result.empty? ? "#{line[0...max_length]}..." : result
        break
      end
      result = candidate
    end

    result.presence
  end
end
