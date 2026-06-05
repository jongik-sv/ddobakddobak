class Meeting < ApplicationRecord
  belongs_to :team, optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"
  belongs_to :folder, optional: true
  has_many :taggings, as: :taggable, dependent: :destroy
  has_many :tags, through: :taggings
  has_many :transcripts, dependent: :destroy
  has_many :summaries, dependent: :destroy
  has_many :action_items, dependent: :destroy
  has_many :decisions, dependent: :destroy
  has_many :blocks, dependent: :destroy
  has_many :meeting_attachments, dependent: :destroy
  has_many :meeting_contacts, dependent: :destroy
  has_many :meeting_bookmarks, dependent: :destroy
  has_many :meeting_participants, dependent: :destroy
  has_many :active_participants, -> { where(left_at: nil) }, class_name: "MeetingParticipant"

  validates :title, presence: true
  validates :share_code, uniqueness: true, allow_nil: true
  validates :status, inclusion: { in: %w[pending recording transcribing completed] }
  validates :source, inclusion: { in: %w[live upload] }

  enum :status, { pending: "pending", recording: "recording", transcribing: "transcribing", completed: "completed" }

  scope :search, ->(q) { where("title LIKE ?", "%#{sanitize_sql_like(q)}%") if q.present? }
  scope :search_with_summary, ->(q) {
    if q.present?
      pattern = "%#{sanitize_sql_like(q)}%"
      where("title LIKE :q OR brief_summary LIKE :q", q: pattern)
    end
  }
  scope :created_after, ->(date) { where("created_at >= ?", date) if date.present? }
  scope :created_before, ->(date) { where("created_at <= ?", Date.parse(date).end_of_day) if date.present? }
  scope :by_status, ->(status) { where(status: status) if status.present? }

  # 열람 가능한 회의 목록 범위: admin은 전체, 그 외는 본인 소유분 + "공유로 보이는" 회의.
  # 유효 공유 가시성 = meetings.shared AND (폴더 없음 OR 폴더도 shared). 즉 폴더를 비공개로
  # 두면 그 폴더의 회의는 개별 shared 여부와 무관하게 전부 숨는다(폴더 설정 우선).
  # (개별 회의 접근은 MeetingLookup이 참여자까지 허용하므로 더 넓다 — 이 스코프는 목록 쿼리용)
  # .or 양변은 join 없는 plain where(폴더는 서브쿼리로 IN 처리)라 index의 .includes/필터 체인과 호환된다.
  scope :accessible_by, ->(user) {
    if user.admin?
      all
    else
      visible_shared = where(shared: true).where(
        "meetings.folder_id IS NULL OR meetings.folder_id IN (?)",
        Folder.where(shared: true).select(:id)
      )
      where(created_by_id: user.id).or(visible_shared)
    end
  }

  # 수정·삭제 가능한 회의 목록 범위: admin은 전체, 그 외는 본인 소유분만.
  scope :editable_by, ->(user) { user.admin? ? all : where(created_by_id: user.id) }

  def sharing?
    share_code.present?
  end

  def owner?(user)
    created_by_id == user.id
  end

  # 유효 공유 가시성(타인 열람 허용 여부): 회의가 공유이고, 폴더가 없거나 폴더도 공유일 때만.
  # 폴더를 비공개로 두면 안의 회의는 개별 shared 여부와 무관하게 타인에게 안 보인다(폴더 우선).
  # accessible_by 스코프(목록 쿼리)와 동일 규칙을 단건(show 인가)에서 표현한다.
  def shared_visible?
    shared? && (folder_id.nil? || folder&.shared?)
  end

  # 수정·삭제 권한: admin(god-mode) 또는 본인 소유만.
  def editable_by?(user)
    return false unless user
    (user.respond_to?(:admin?) && user.admin?) || created_by_id == user.id
  end

  def transcription_stream
    "meeting_#{id}_transcription"
  end

  def host_participant
    active_participants.find_by(role: MeetingParticipant::ROLE_HOST)
  end

  # 명함에서 인식한 참석자 이름을 attendees 자유텍스트에 비파괴 append.
  # 기존 사용자 입력은 지우지 않고, 같은 이름이 이미 있으면 skip(중복 방지).
  def append_attendee!(name, company = nil)
    name = name.to_s.strip
    return if name.blank?

    existing = attendees.to_s
    # 쉼표로 구분된 항목 단위로 정확히 비교 — "이름" 또는 "이름 (회사)" 형태만 중복으로 본다.
    # (단순 substring 비교는 "박영수"에 "영수" 추가 시 오탐으로 skip되는 버그가 있었다.)
    return if existing.split(/,\s*/).any? { |e| e == name || e.start_with?("#{name} (") }

    label   = company.to_s.strip.present? ? "#{name} (#{company.to_s.strip})" : name
    updated = existing.strip.empty? ? label : "#{existing}, #{label}"
    update_column(:attendees, updated)
  end

  def active_summary
    summaries.find_by(summary_type: "final") ||
      summaries.order(generated_at: :desc).first
  end

  def current_notes_markdown
    active_summary&.notes_markdown.to_s
  end

  # 트랜스크립트·요약·액션아이템·결정·블록(선택적으로 첨부)을 모두 삭제한다.
  def purge_transcription_content!(include_attachments: false)
    transcripts.destroy_all
    summaries.destroy_all
    action_items.destroy_all
    decisions.destroy_all
    blocks.destroy_all
    meeting_attachments.destroy_all if include_attachments
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
