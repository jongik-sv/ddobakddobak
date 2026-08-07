class Meeting < ApplicationRecord
  include Trashable
  include Meeting::RecurringSchedule
  include Meeting::AudioDuration
  include Meeting::AccessControl
  include Meeting::Dflow
  include Meeting::TranscriptionQueue
  include Meeting::RecordingHealing
  include Meeting::SummaryManagement

  belongs_to :project, optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"
  belongs_to :folder, optional: true
  # 이전 회의 참고: 지정 시 그 회의록을 현재 회의록의 시작점(시드)으로 깔고 이어쓴다.
  belongs_to :previous_meeting, class_name: "Meeting", optional: true
  has_many :taggings, as: :taggable, dependent: :destroy
  has_many :tags, through: :taggings
  has_many :glossary_entries, as: :owner, dependent: :destroy
  has_many :transcripts, dependent: :destroy
  has_many :summaries, dependent: :destroy
  has_many :blocks, dependent: :destroy
  has_many :meeting_attachments, dependent: :destroy
  has_many :meeting_contacts, dependent: :destroy
  has_many :meeting_bookmarks, dependent: :destroy
  has_many :meeting_collaborators, dependent: :destroy
  has_many :chat_messages, dependent: :destroy
  has_many :domain_file_links, as: :owner, dependent: :destroy
  # "선택된" 파일만(제외 마커 행은 별도) — UX 증분 B: 회의별 상속 제외.
  has_many :domain_files, -> { merge(DomainFileLink.not_excluded) }, through: :domain_file_links
  has_many :excluded_domain_file_links, -> { merge(DomainFileLink.excluded) }, as: :owner, class_name: "DomainFileLink"
  has_many :excluded_domain_files, through: :excluded_domain_file_links, source: :domain_file

  # 회의록 압축율 5단계 (회의 화면·미리보기에서 회의별 지정)
  SUMMARY_VERBOSITY_LEVELS = %w[very_concise concise standard detailed very_detailed].freeze

  # 예약 회의 자동시작 트리거 유예. 프론트 스케줄러는 scheduled_start_time + 이 시간까지 트리거를
  # 시도하므로, 그 안에는 아직 "놓침"이 아니다 — missed 판정은 이 유예가 지난 뒤에야 true.
  # ⚠️ 프론트 computeScheduleActions 의 GRACE(60s)와 반드시 일치해야 한다(문서화된 결합).
  SCHEDULE_TRIGGER_GRACE = 60.seconds

  # 이전 회의 시드 절취선. 증분(append) 모드에서만 이전 회의록 뒤에 붙어 이전/현재를 구분한다.
  # (재구조화 모드는 이전+현재를 한 회의로 병합하므로 절취선을 넣지 않는다.)
  PREVIOUS_MEETING_CUT_LINE = "**✂ ─ ─ ─ ─ ─ 이전 회의 / 현재 회의 ─ ─ ─ ─ ─**".freeze

  validates :title, presence: true
  validates :status, inclusion: { in: %w[pending recording transcribing completed] }
  validates :summary_verbosity, inclusion: { in: SUMMARY_VERBOSITY_LEVELS }
  validates :summary_restructure, inclusion: { in: [ true, false ] } # NOT NULL 컬럼 — nil 이 500 대신 422 가 되게
  validates :summary_custom_prompt, length: { maximum: 2000 }, allow_nil: true
  validates :summary_interval_sec, numericality: { only_integer: true, greater_than_or_equal_to: 0 } # 0 = 자동 요약 안 함
  validates :source, inclusion: { in: %w[live upload] }
  validates :expected_participants, numericality: { only_integer: true, greater_than_or_equal_to: 1, less_than_or_equal_to: 100 }, allow_nil: true
  # 예약 회의 시작 방식. 예약(scheduled_start_time) 회의에만 의미. nil = 예약 미지정(기존 즉시 회의).
  validates :auto_start_mode, inclusion: { in: %w[auto manual] }, allow_nil: true
  validate :previous_meeting_not_self

  enum :status, { pending: "pending", recording: "recording", transcribing: "transcribing", completed: "completed" }

  # 회의 잠금: locked_at 가 채워져 있으면 잠긴(읽기전용) 회의. 가드는 별도 task.
  def locked?
    locked_at.present?
  end

  # 중요 플래그 상속: 회의 생성 시 important 를 명시 지정하지 않았으면 소속 폴더값을 상속한다.
  # 명시 지정(컨트롤러가 important_explicitly_set=true 세팅) 케이스는 상속을 건너뛰고 지정값 보존.
  attr_accessor :important_explicitly_set
  before_create :seed_importance_from_folder

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

  # ── 예약 회의(scheduled meeting) 스코프 ──
  # 예약 시각이 지정된 회의(즉시 회의 제외).
  scope :scheduled, -> { where.not(scheduled_start_time: nil) }
  # 클라이언트 스케줄러 폴링용: 곧 시작할(within 창 안) + 아직 안 닫은 pending 예약.
  # 지난(놓친) 예약도 포함한다 — 놓침/임박 판정은 클라이언트/뷰가 한다.
  scope :upcoming_scheduled, ->(within: 1.hour) {
    scheduled.pending.where(schedule_dismissed_at: nil).where(scheduled_start_time: ..(Time.current + within))
  }
  # 놓친 예약: 예약 시각이 트리거 유예(SCHEDULE_TRIGGER_GRACE)까지 지난 pending·미dismiss 예약.
  # 유예 안(예: 30초 전)은 아직 자동시작 트리거 대상이라 missed 가 아니다.
  scope :missed_scheduled, -> {
    scheduled.pending.where(schedule_dismissed_at: nil).where(scheduled_start_time: ...SCHEDULE_TRIGGER_GRACE.ago)
  }

  scope :in_project, ->(pid) { pid.present? ? where(project_id: pid) : all }

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

  # 회의 실효 도메인 파일 세트 = 회의 자체 링크 + 폴더 조상체인 링크 + 프로젝트 링크(합집합, 파일 id 중복제거).
  # 우선순위(중복 시 구체 레벨 승, 배열 순서에도 반영): meeting > 가까운 folder > 먼 folder > project.
  # DomainReferenceBuilder는 이 순서를 그대로 소비해 캡 초과 시 project → 먼 folder → 가까운 folder →
  # meeting 순으로 잘라내(구체 레벨이 끝까지 살아남게) 처리한다.
  # @return [Array<Hash>] [{ file:, source: "meeting"|"folder"|"project", owner: (Folder|Project, source가 meeting이면 nil) }]
  #
  # UX 증분 B(회의별 상속 제외): 이 회의가 exclude=true 로 마크한 파일 id는 폴더/프로젝트
  # 상속분에서 제거한다. 회의 자체 selected(domain_files, exclude=false 스코프)에는 영향 없음.
  def effective_domain_files
    seen = {}
    result = []
    excluded_ids = domain_file_links.excluded.pluck(:domain_file_id).to_set

    domain_files.order("domain_file_links.id").each do |file|
      next if seen[file.id]
      seen[file.id] = true
      result << { file: file, source: "meeting", owner: nil }
    end

    if folder
      ([ folder ] + folder.ancestor_records).each do |fld|
        fld.domain_files.order("domain_file_links.id").each do |file|
          next if seen[file.id]
          if excluded_ids.include?(file.id)
            seen[file.id] = true
            next
          end
          seen[file.id] = true
          result << { file: file, source: "folder", owner: fld }
        end
      end
    end

    if project
      project.domain_files.order("domain_file_links.id").each do |file|
        next if seen[file.id]
        if excluded_ids.include?(file.id)
          seen[file.id] = true
          next
        end
        seen[file.id] = true
        result << { file: file, source: "project", owner: project }
      end
    end

    result
  end

  private

  # 응축 캐시 버전 — 압축 프롬프트(CONDENSE_PREVIOUS_NOTES_SYSTEM_PROMPT)를 개정하면 이 값을
  # 올려 기존 캐시를 전부 무효화한다(digest 에 섞여 들어가 자동으로 miss 처리됨).
  #
  # ⚠️ Meeting::SummaryManagement concern으로 옮기지 않는다: spec/models/meeting_condense_cache_spec.rb
  # 가 `stub_const("Meeting::CONDENSE_CACHE_VERSION", "v2")` 로 스텁하는데, RSpec 상수 스텁은
  # `mod.const_defined?(name, false)`(inherit: false)만 확인해 include된 모듈의 상수를 "미정의"로
  # 보고 Meeting 위에 새 상수를 얹는다 — 그러면 코드가 실제로 참조하는(렉시컬 스코프) 상수는
  # 그대로 남아 캐시 무효화 테스트가 깨진다. condense_previous_meeting_body/previous_condense_digest
  # 도 같은 이유로 이 자리에 함께 남긴다.
  CONDENSE_CACHE_VERSION = "v1".freeze

  # 이전 회의 본문(body)을 LLM 으로 1회 압축한다. 압축 실패·LLM 미설정(NotConfiguredError 포함,
  # LlmService.new 생성자 시점에 raise 될 수 있어 여기서 함께 잡는다) 등은 nil 반환 —
  # 호출부(seed_summary_from_previous!)가 압축 없이 각인된 body 원문을 블록으로 폴백한다
  # (시드 자체는 실패시키지 않는다).
  #
  # 캐시: "요약 재생성"(regenerate_notes/reset_content)은 summaries 를 지우고 seed 를 다시
  # 태우므로, previous_meeting 이 그대로면 이 LLM 호출이 매번 반복돼 순수 낭비다. 이 회의
  # (self) 에 이전 압축 결과를 digest 와 함께 저장해두고, 다음 호출에서 digest 가 일치하면
  # LLM 호출 없이 캐시를 반환한다. previous 가 재요약돼 body 가 바뀌거나, previous 회의명이
  # 바뀌거나(title 이 프롬프트에 실려 출력에 스며듦), LLM 모델/프로필을 바꾸거나,
  # CONDENSE_CACHE_VERSION 이 오르면 digest 불일치로 자연 무효화된다.
  def condense_previous_meeting_body(body, title)
    llm_config = creator&.effective_llm_config
    digest = previous_condense_digest(body, title, llm_config)

    if digest.present? && digest == prev_condensed_digest && prev_condensed_notes.present?
      Rails.logger.info "[MeetingSummarizationJob] condense cache hit meeting=#{id}"
      return prev_condensed_notes
    end

    condensed = LlmService.new(llm_config: llm_config).condense_previous_notes(body, meeting_title: title)

    if condensed.present? && digest.present?
      begin
        update_columns(prev_condensed_notes: condensed, prev_condensed_digest: digest)
      rescue => e
        # 캐시 저장 실패는 이번 응축 결과 반환을 막지 않는다(캐시는 최적화일 뿐, 다음 호출에서
        # 다시 시도됨) — 오염 없이 그냥 miss 로 남는다.
        Rails.logger.error "[Meeting] condense cache 저장 실패 meeting=#{id}: #{e.message}"
      end
    end

    condensed
  rescue => e
    Rails.logger.error "[Meeting] condense_previous_notes 실패 meeting=#{id}: #{e.message}"
    nil
  end

  # previous_meeting_id 가 없으면 캐시 불가(nil) — 시드 자체가 previous_meeting_id 필수라
  # 실질적으로 항상 present 이지만 방어적으로 처리.
  #
  # digest 입력에 title 을 포함: condense_previous_notes 프롬프트가 "회의 제목: <title>"을
  # 실어 응축 출력에 제목이 스며들 수 있어, previous 회의명이 바뀌면(body 불변이어도) 재응축이
  # 필요하다. LLM provider/model 도 포함: 사용자가 모델/프로필을 바꾼 뒤 "요약 재생성"을
  # 눌렀는데 옛 모델로 만든 캐시가 그대로 반환되면 기대와 어긋난다. auth_token/base_url 은
  # 제외한다 — 같은 provider/model 이면 실질적으로 동일한 응축을 낸다고 간주해 토큰 로테이션
  # 만으로 불필요한 무효화가 일어나지 않게 한다.
  def previous_condense_digest(body, title, llm_config)
    return nil if previous_meeting_id.blank?
    fingerprint = llm_config.is_a?(Hash) ? "#{llm_config[:provider]}/#{llm_config[:model]}" : ""
    Digest::SHA256.hexdigest("#{CONDENSE_CACHE_VERSION}|#{previous_meeting_id}|#{title}|#{fingerprint}|#{body}")
  end

  # 회의 생성 시 important 를 폴더값으로 상속. important_explicitly_set 면 상속 생략(지정값 보존).
  # 폴더가 없으면 false. (목록은 important=true 만 표시 — 신규 회의는 폴더 정책을 따른다.)
  def seed_importance_from_folder
    return if important_explicitly_set
    self.important = folder&.important || false
  end

  # 이전 회의로 자기 자신을 지정하면 무한 시드 루프가 되므로 거부.
  def previous_meeting_not_self
    return if previous_meeting_id.blank? || id.blank?
    errors.add(:previous_meeting_id, "는 자기 자신일 수 없습니다") if previous_meeting_id == id
  end
end
