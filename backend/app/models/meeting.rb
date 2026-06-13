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

  # 회의록 압축율 5단계 (회의 화면·미리보기에서 회의별 지정)
  SUMMARY_VERBOSITY_LEVELS = %w[very_concise concise standard detailed very_detailed].freeze

  validates :title, presence: true
  validates :share_code, uniqueness: true, allow_nil: true
  validates :status, inclusion: { in: %w[pending recording transcribing completed] }
  validates :summary_verbosity, inclusion: { in: SUMMARY_VERBOSITY_LEVELS }
  validates :summary_restructure, inclusion: { in: [ true, false ] } # NOT NULL 컬럼 — nil 이 500 대신 422 가 되게
  validates :source, inclusion: { in: %w[live upload] }
  validates :expected_participants, numericality: { only_integer: true, greater_than_or_equal_to: 1, less_than_or_equal_to: 100 }, allow_nil: true
  # 화자분리 AHC 거리 컷오프. UI 슬라이더 0.2~0.8, API엔 약간 여유. 0/음수 등 쓰레기값 차단(garbage .to_f → 0.0 → 422)
  validates :diarization_threshold, numericality: { greater_than_or_equal_to: 0.1, less_than_or_equal_to: 1.0 }, allow_nil: true

  enum :status, { pending: "pending", recording: "recording", transcribing: "transcribing", completed: "completed" }

  # SQLite LIKE는 기본 ESCAPE 문자가 없어 sanitize_sql_like의 백슬래시 이스케이프가
  # 리터럴로 매치된다(%·_ 포함 검색어 오동작) — ESCAPE '\' 명시 필수.
  scope :search, ->(q) { where("title LIKE ? ESCAPE '\\'", "%#{sanitize_sql_like(q)}%") if q.present? }
  # 목록 검색: 제목·요약 미리보기에 더해 전사 본문까지 부분문자열 매치.
  # FTS(transcripts_fts)는 prefix-word 의미론이라 제목 LIKE와 불일치 — 일관성 위해 LIKE 유지.
  scope :search_with_summary, ->(q) {
    if q.present?
      pattern = "%#{sanitize_sql_like(q)}%"
      where(<<~SQL.squish, q: pattern)
        title LIKE :q ESCAPE '\\' OR brief_summary LIKE :q ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM transcripts t
          WHERE t.meeting_id = meetings.id AND t.content LIKE :q ESCAPE '\\'
        )
      SQL
    end
  }
  scope :created_after, ->(date) { where("created_at >= ?", date) if date.present? }
  scope :created_before, ->(date) { where("created_at <= ?", Date.parse(date).end_of_day) if date.present? }
  scope :by_status, ->(status) { where(status: status) if status.present? }

  # 열람 가능한 회의 목록 범위: admin은 전체, 그 외는 본인 소유분 + "공유로 보이는" 회의.
  # 유효 공유 가시성 = meetings.shared AND (폴더 없음 OR 폴더와 모든 조상이 shared). 즉 상위
  # 폴더를 비공개로 두면 그 하위 폴더·회의가 개별 shared 여부와 무관하게 전부 숨는다(상속·폴더 우선).
  # (개별 회의 접근은 MeetingLookup이 참여자까지 허용하므로 더 넓다 — 이 스코프는 목록 쿼리용)
  # Folder.visible_folder_ids가 조상 체인을 in-memory로 평가해 보이는 폴더 id만 IN 으로 넘긴다.
  scope :accessible_by, ->(user) {
    if user.admin?
      all
    else
      visible_shared = where(shared: true).where(
        "meetings.folder_id IS NULL OR meetings.folder_id IN (?)",
        Folder.visible_folder_ids
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

  # 유효 공유 가시성(타인 열람 허용 여부): 회의가 공유이고, 폴더가 없거나 폴더와 모든 조상이 공유일 때만.
  # 상위 폴더를 비공개로 두면 하위 회의는 개별 shared 여부와 무관하게 타인에게 안 보인다(상속·폴더 우선).
  # accessible_by 스코프(목록 쿼리)와 동일 규칙을 단건(show 인가)에서 표현한다.
  def shared_visible?
    shared? && (folder_id.nil? || folder&.effectively_shared?)
  end

  # 수정·삭제 권한: admin(god-mode) 또는 본인 소유만.
  def editable_by?(user)
    return false unless user
    (user.respond_to?(:admin?) && user.admin?) || created_by_id == user.id
  end

  def transcription_stream
    "meeting_#{id}_transcription"
  end

  # 화자분리만 재실행(ReDiarizeJob)이 :async 잡 드롭(서버 리로드 등)으로 멈추면 회의가
  # transcribing 에 영구정지된다 — 재실행 버튼은 completed 에서만 보여 UI 로는 회복 불가.
  # re_diarize_started_at 가 임계시간보다 오래되면 stale 로 보고 completed 로 자가복구한다.
  # 실 STT(FileTranscriptionJob)는 이 컬럼을 쓰지 않으므로 절대 건드리지 않는다(클로버 방지).
  RE_DIARIZE_STALE_AFTER = 5.minutes

  def heal_stale_re_diarize!
    return unless transcribing? && re_diarize_started_at.present?
    return if re_diarize_started_at > RE_DIARIZE_STALE_AFTER.ago

    update_columns(status: "completed", transcription_progress: 100, re_diarize_started_at: nil)
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

  # completed 회의만 final 을 하드 우선. reopen(=recording 복귀) 후엔 최신 우선 —
  # stale final 이 reopen 후 쌓이는 realtime 진행분을 가리지 않게 (구현리뷰 useredit-M5).
  def active_summary
    if completed?
      summaries.find_by(summary_type: "final") ||
        summaries.order(generated_at: :desc, id: :desc).first
    else
      summaries.order(generated_at: :desc, id: :desc).first
    end
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
