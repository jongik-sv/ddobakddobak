class Meeting < ApplicationRecord
  include Trashable

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
  has_many :action_items, dependent: :destroy
  has_many :decisions, dependent: :destroy
  has_many :blocks, dependent: :destroy
  has_many :meeting_attachments, dependent: :destroy
  has_many :meeting_contacts, dependent: :destroy
  has_many :meeting_bookmarks, dependent: :destroy
  has_many :meeting_participants, dependent: :destroy
  has_many :active_participants, -> { where(left_at: nil) }, class_name: "MeetingParticipant"
  has_many :chat_messages, dependent: :destroy

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
  validates :share_code, uniqueness: true, allow_nil: true
  validates :status, inclusion: { in: %w[pending recording transcribing completed] }
  validates :summary_verbosity, inclusion: { in: SUMMARY_VERBOSITY_LEVELS }
  validates :summary_restructure, inclusion: { in: [ true, false ] } # NOT NULL 컬럼 — nil 이 500 대신 422 가 되게
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

  # 반복 예약 회의 여부. recurrence_rule(JSON)이 있으면 반복 시리즈.
  def recurring?
    recurrence_rule.present?
  end

  # recurrence_rule(JSON 텍스트)을 파싱한 해시. 비반복/파싱불가면 nil.
  def parsed_recurrence_rule
    return nil if recurrence_rule.blank?
    JSON.parse(recurrence_rule)
  rescue JSON::ParserError
    nil
  end

  # 반복 시리즈의 다음 occurrence(미래) pending 회의를 복제 생성한다.
  # - 비반복이면 no-op(nil).
  # - 멱등: 이미 이 회의를 시드로 한 예약(scheduled) successor 가 있으면 중복 생성하지 않는다.
  # - 다음 occurrence 가 없으면(규칙 불완전 등) no-op(nil).
  # title/유형/폴더/프로젝트/공유/중요/모드/규칙·요약옵션만 승계하고, started_at·ended_at·locked_at·
  # 오디오·dismiss 같은 상태 필드는 깨끗하게 둔다(새 pending 회의). previous_meeting_id 로 체이닝해
  # "이전 회의 참고" 시드가 시리즈를 따라 이어진다.
  # 중요(important)는 원본값을 명시 승계한다 — important_explicitly_set=true 로 표시해
  # before_create :seed_importance_from_folder 가 폴더값으로 덮어쓰지 않게 한다(컨트롤러
  # apply_explicit_importance! 와 동일 패턴). 그래야 중요한 반복 시리즈의 후속 occurrence 가
  # important=true 를 유지해 기본(important 필터) 회의 목록에서 사라지지 않는다.
  def materialize_next_occurrence!
    return unless recurring?
    # 이미 미래 형제(이 회의를 시드로 한 예약 successor)가 있으면 중복 방지(every-minute 롤오버 멱등).
    return if Meeting.where(previous_meeting_id: id).scheduled.exists?

    next_time = Recurrence.next_occurrence(parsed_recurrence_rule, after: Time.current)
    return if next_time.nil?

    successor = Meeting.new(
      title: title,
      meeting_type: meeting_type,
      folder_id: folder_id,
      project_id: project_id,
      shared: shared,
      important: important,
      created_by_id: created_by_id,
      summary_verbosity: summary_verbosity,
      summary_restructure: summary_restructure,
      auto_start_mode: auto_start_mode,
      recurrence_rule: recurrence_rule,
      previous_meeting_id: id,
      scheduled_start_time: next_time
    )
    successor.important_explicitly_set = true # 폴더값 override 방지(중요 플래그 명시 승계)
    successor.save!
    successor
  end

  # 중요 플래그 상속: 회의 생성 시 important 를 명시 지정하지 않았으면 소속 폴더값을 상속한다.
  # 명시 지정(컨트롤러가 important_explicitly_set=true 세팅) 케이스는 상속을 건너뛰고 지정값 보존.
  attr_accessor :important_explicitly_set
  before_create :seed_importance_from_folder

  # ── 오디오 길이 측정/캐시 ──
  # audio_file_path 파일의 길이(ms)를 ffprobe로 측정한다. 파일이 없으면 0.
  def measure_audio_duration_ms
    path = audio_file_path
    return 0 unless path.present? && File.exist?(path)

    output = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (output.to_f * 1000).to_i
  rescue StandardError
    0
  end

  # 측정값을 audio_duration_ms 컬럼에 저장(콜백·검증 우회). audio_file_path가 바뀌는
  # 쓰기 지점에서 호출해 컬럼이 항상 현재 파일 길이를 반영하게 한다(merge로 path가
  # 그대로여도 내용이 커지므로 무조건 재측정한다).
  def refresh_audio_duration!
    update_column(:audio_duration_ms, measure_audio_duration_ms)
  end

  # audio_file_path를 바꾸는 모든 쓰기 지점의 단일 진입점. 경로를 저장(검증 실행)하고
  # 곧바로 길이를 재측정·캐시해 path↔duration 결합을 모델에서 강제한다(콜백 부재 →
  # 새 쓰기 지점이 refresh를 빠뜨리는 일 방지). 파일을 '비우는' reset 경로는 별개.
  def set_audio_file!(path)
    update!(audio_file_path: path)
    refresh_audio_duration!
  end

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

  # 열람 가능한 회의 목록 범위: admin은 전체, 그 외는 본인 소유분 + "공유로 보이는" 회의.
  # 유효 공유 가시성 = meetings.shared AND (폴더 없음 OR 폴더와 모든 조상이 shared). 즉 상위
  # 폴더를 비공개로 두면 그 하위 폴더·회의가 개별 shared 여부와 무관하게 전부 숨는다(상속·폴더 우선).
  # (개별 회의 접근은 MeetingLookup이 참여자까지 허용하므로 더 넓다 — 이 스코프는 목록 쿼리용)
  # Folder.visible_folder_ids가 조상 체인을 in-memory로 평가해 보이는 폴더 id만 IN 으로 넘긴다.
  # Phase 5 컨트롤러 스코핑(index 등)에서 사용 예정.
  scope :in_project, ->(pid) { pid.present? ? where(project_id: pid) : all }

  scope :accessible_by, ->(user) {
    if user.admin?
      kept
    else
      member_pids = ProjectMembership.where(user_id: user.id).select(:project_id)
      base = kept.where(project_id: member_pids)
      visible_shared = base.where(shared: true).where(
        "meetings.folder_id IS NULL OR meetings.folder_id IN (?)",
        Folder.visible_folder_ids
      )
      base.where(created_by_id: user.id).or(visible_shared)
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

  # 이 회의의 전사 content가 확정된 시점에 임베딩을 일관되게 맞춘다(배치, 라이브 밖).
  # 라이브/파일STT/import 핫패스에서 인라인 임베딩을 제거했으므로, 확정 경계에서 이 메서드로 흡수한다.
  # diff 기반(EmbedBackfillJob)이라 신규 전사 + 무효화로 삭제된 행을 모두 재생성한다. 멱등.
  def reconcile_embeddings!
    EmbedBackfillJob.perform_later(meeting_id: id)
  end

  # 강제종료/크래시로 recording 에 고정된 회의 자가복구. recorder presence(하트비트)
  # 부재로만 판정 — 침묵과 무관(침묵은 클라측 silenceAutoComplete 가 stop 호출).
  # RecordingLock 미사용 이유: acquire 가 audio_chunk(발화)에서만 호출돼 시작직후 침묵에
  # holder 가 nil → 활성 녹음 오종결. 하트비트는 VAD/일시정지 무관하게 전송돼 정확.
  RECORDER_HEARTBEAT_STALE_AFTER = 90.seconds

  def stale_recording?
    return false unless recording?

    recorder_heartbeat_at.nil? || recorder_heartbeat_at < RECORDER_HEARTBEAT_STALE_AFTER.ago
  end

  def heal_stale_recording!
    return unless stale_recording?

    # 종료시각 = 마지막 presence(하트비트). 부재(레거시/#207)면 치유 호출 시각.
    ended = recorder_heartbeat_at || Time.current

    # 원자적 종결: recording 인 행만 completed 로 전이. 변경행수 0이면(다른 요청·인스턴스가
    # 먼저 종결) early return — stop 과 동일 시맨틱(브로드캐스트·lock·job)을 중복 실행하지 않는다.
    # update_all 은 콜백/검증 우회(status 전이엔 콜백 불필요). reload 로 in-memory 갱신.
    changed = Meeting.where(id: id, status: "recording")
                     .update_all(status: "completed", ended_at: ended, paused_at: nil, updated_at: Time.current)
    return if changed.zero?

    RecordingLock.clear(id)

    # stop 액션과 동일하게 녹음 종료 브로드캐스트(읽기전용 뷰어 라우팅 등 프론트 신호).
    ActionCable.server.broadcast(
      transcription_stream,
      { type: "recording_stopped", meeting_id: id }
    )

    # in-memory status 갱신 — show/index serializer 가 종결 후 상태를 일관되게 읽도록.
    reload

    if transcripts.exists?
      MeetingFinalizerJob.perform_later(id)
      MeetingSummarizationJob.perform_later(id, type: "final")
      reconcile_embeddings!
    end
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

  # 이전 회의 참고 시드: 이 회의에 요약이 아직 없고 previous_meeting 이 지정돼 있으면,
  # 이전 회의록(notes_markdown) 스냅샷을 시작점으로 깐 초기 Summary 1건을 만든다.
  # 이후 요약 잡(realtime/final)이 이 시드를 base 로 현재 자막을 이어쓴다.
  # 멱등: 요약이 하나라도 있으면 no-op (시드는 단 한 번). 스냅샷이므로 이후 이전 회의가 바뀌어도 고정.
  #
  # 시드는 모드 무관 이전 회의록 base 만 깐다(절취선 없음). 이후 요약 잡이 이전+현재를 한 회의로
  # 병합하며, 증분(연결) 모드에선 LLM 이 논의사항 안에 절취선(PREVIOUS_MEETING_CUT_LINE)을 한 번 삽입한다.
  def seed_summary_from_previous!(summary_type: "realtime")
    return if summaries.exists?
    return if previous_meeting_id.blank?

    base = previous_meeting&.current_notes_markdown.to_s
    return if base.blank?

    summaries.create!(summary_type: summary_type, notes_markdown: base.rstrip, generated_at: Time.current)
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

  private

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
