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
  # (개별 회의 접근 인가는 MeetingLookup#authorize_meeting_read! — 이 스코프는 목록 쿼리용)
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

  # 파일 전사 대기열 위치. file_transcription 큐는 스레드 1개 직렬이라, 앞선 회의가 오래 걸리면
  # (예: 70분 파일) 뒤에 업로드된 회의는 진행률이 계속 0%로 보여 "고장"으로 오인된다(실사고).
  # transcribing인데 자기 잡이 아직 대기(미claim) 상태면 앞선 미완료 잡 수(N)를 반환 —
  # 프론트는 이걸로 "앞에 N건 대기 중"을 보여주다가, 잡이 claim(실행 시작)되면 nil로 전환해
  # 기존 진행률 표시(ActionCable broadcast)로 자연스럽게 넘어간다.
  # SolidQueue::Job은 :queue DB 별도 커넥션(config/environments/production.rb connects_to)이라
  # primary DB 커넥션풀에 영향 없음. dev/test(:async 어댑터)는 큐 테이블 자체가 없어
  # StatementInvalid가 나므로 nil로 폴백(기존 "잡 못 찾으면 null" 동작과 동일 취급).
  TRANSCRIPTION_QUEUE_NAME = "file_transcription".freeze
  TRANSCRIPTION_QUEUE_JOB_CLASSES = %w[FileTranscriptionJob ReDiarizeJob].freeze

  # jobs: 미리 조회해둔 스냅샷(옵션) — meeting_serializable#transcription_queue_jobs_snapshot 가
  # 요청(컨트롤러 인스턴스) 단위로 1회 조회한 배열을 넘겨 목록 직렬화의 회의별 재조회(N+1)를
  # 피한다. 생략하면(단건 조회 등) 기존처럼 그 자리에서 조회한다.
  def transcription_queue_position(jobs = nil)
    return nil unless transcribing?

    jobs ||= self.class.unfinished_transcription_queue_jobs
    own_index = jobs.find_index do |job|
      TRANSCRIPTION_QUEUE_JOB_CLASSES.include?(job.class_name) &&
        self.class.transcription_queue_job_meeting_id(job) == id
    end
    return nil unless own_index

    return nil if jobs[own_index].claimed? # 실행 중 — 진행률 표시로 전환

    own_index
  rescue ActiveRecord::StatementInvalid
    nil
  end

  # queue_name=file_transcription, 미완료(finished_at nil) 잡을 id 순(=enqueue 순)으로 스냅샷.
  # ReDiarizeJob도 같은 큐를 공유하므로 자연히 포함된다(다른 회의의 재분리도 대기열을 밀어야 정확).
  # failed_execution 이 붙은 잡은 제외 — SolidQueue는 실패해도 finished_at을 채우지 않으므로
  # (gem 소스 SolidQueue::Job::Executable#finished! 은 성공 경로에서만 호출) 워커 강제종료(배포
  # 재시작·OOM 시 프로세스 prune 의 fail_all_claimed_executions_with)로 죽은 잡이 제외 없이는
  # 영구 대기 카운트에 잡혀 뒤 회의들의 대기 수를 과대표시하고, 자기 잡이 failed면 영원히
  # "대기 중"으로 멈춘다.
  def self.unfinished_transcription_queue_jobs
    # claimed_execution 을 함께 preload — meeting_serializable#transcription_queue_jobs_snapshot 가
    # 요청당 1회 이 스냅샷을 재사용하는 목록 직렬화 경로에서, 회의마다 호출되는 jobs[i].claimed?
    # (has_one 존재 체크)가 추가 쿼리 없이 미리 로드된 값을 쓰게 한다.
    SolidQueue::Job.where(queue_name: TRANSCRIPTION_QUEUE_NAME, finished_at: nil)
                   .where.missing(:failed_execution)
                   .includes(:claimed_execution)
                   .order(:id).to_a
  end

  # SolidQueue::Job#arguments = ActiveJob 직렬화 해시(예: {"job_class"=>"FileTranscriptionJob",
  # "arguments"=>[meeting_id], ...}). meeting_id(Integer)는 ActiveJob 허용 원시타입이라 그대로 보존.
  def self.transcription_queue_job_meeting_id(job)
    args = job.arguments
    return nil unless args.is_a?(Hash)
    Array(args["arguments"]).first
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

  # 활성 점유 녹음 여부: recording 이고 점유 기기 하트비트가 신선(stale 아님)할 때만 true.
  # 단일 녹음 기기 락의 충돌 판정과 serializer(recorder_active) 노출이 공유하는 판정.
  def recorder_active?
    recording? && !stale_recording?
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
    if changed.zero?
      # 다른 healer 가 먼저 completed 로 전이한 경우 — in-memory @meeting 이 recording 으로
      # 잔존하면 가드(reject_if_recorder_conflict!) 통과 후 downstream 액션(stop/pause)이
      # stale recording?=true 로 오작동한다. 성공 분기와 동일하게 reload 로 상태를 맞춘다.
      reload
      return
    end

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

  # D'Flow 전송 team 자동 판정 재료: 폴더 체인의 최상위 폴더명. 폴더 없으면 nil.
  def dflow_root_folder_name
    dflow_folder_chain.last&.name
  end

  # D'Flow 전송 제목 자동 조립 재료: 최상위 바로 아래 폴더명. 3단계 이상이면 그 아래는 무시.
  def dflow_sub_folder_name
    chain = dflow_folder_chain
    chain.length >= 2 ? chain[-2].name : nil
  end

  # D'Flow 전송 제목: "<하위폴더명>-<원제목>" (하위 폴더 없으면 원제목). 200자 초과 시 원제목 쪽을 잘라 맞춘다.
  def dflow_auto_title
    stripped = title.to_s.strip
    sub = dflow_sub_folder_name
    return stripped[0, 200] if sub.nil?

    prefix = "#{sub}-"
    full = "#{prefix}#{stripped}"
    return full unless full.length > 200

    prefix + stripped[0, 200 - prefix.length]
  end

  # 최초 전송 이후 재전송이 필요한지(로컬 편집/요약 갱신이 마지막 전송보다 최신인지).
  def dflow_needs_resync?
    return false if public_uid.blank? || dflow_synced_at.blank?
    edited = [ last_user_edit_at, active_summary&.updated_at ].compact.max
    edited.present? && edited > dflow_synced_at
  end

  # 발급 순서 불변 규칙(§1.2, 계약 §4.6): uuid 생성 → update! 로 DB 커밋. D'Flow 전송(업로드/link)은
  # 이 메서드가 반환한 뒤 호출부가 별도로 수행하며, 전송이 실패해도 여기서 커밋된 public_uid 는
  # 유지된다(재발급 절대 금지 — 재시도 시 같은 external_id 를 재사용해야 D'Flow 쪽 upsert 가 멱등하다).
  # DflowUploadService#call 과 MeetingDflowController#claim 양쪽이 이 메서드 하나만 호출해
  # 불변식이 두 곳에 흩어지지 않도록 한다(이미 발급된 경우 재사용 — 아무 것도 하지 않음).
  def ensure_dflow_public_uid!
    return if public_uid.present?
    update!(public_uid: SecureRandom.uuid_v7)
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
    # 콘텐츠 초기화(reset_content·재전사) 시 이전 요약 실패 기록도 함께 클리어 —
    # 잔존하면 초기화된 회의에 오탐 실패 배지가 영구 노출된다.
    clear_summary_error!
  end

  # ── 요약 실패 레포트 (summary_error) ──
  # 영속 기록의 메시지 상한 — broadcast·meeting_json 노출 공통(과대 메시지 방어).
  SUMMARY_ERROR_MESSAGE_MAX = 500

  # 요약(LLM) final 실패 영속 기록 — meeting_json 으로 노출돼 새로고침 후에도 사용자가
  # 실패를 알 수 있다. MeetingSummarizationJob 과 FileTranscriptionJob(파일 전사 경유
  # final)이 공유하는 단일 진입점. update_columns: 콜백·updated_at 오염 방지.
  def record_summary_error!(message)
    update_columns(
      summary_error_message: message.to_s.truncate(SUMMARY_ERROR_MESSAGE_MAX),
      summary_error_at: Time.current
    )
  end

  # 성공 저장 시 이전 실패 기록 클리어 — 기록이 없으면 쓰기 생략(매 틱 불필요한 UPDATE 방지).
  def clear_summary_error!
    return if summary_error_message.nil? && summary_error_at.nil?
    update_columns(summary_error_message: nil, summary_error_at: nil)
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
    # 인용 마커(⟦t:…⟧, ⟦m:…⟧) 제거 — 절단 전에 지워야 반토막 마커가 남지 않는다
    notes_markdown = notes_markdown.gsub(/⟦[^⟧]*⟧/, "").gsub(/[ \t]{2,}/, " ")
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

  # 폴더 체인(가까운→먼): 자기 폴더 + 조상들. ancestor_records가 자기 자신을 제외하므로 앞에 붙인다
  # (effective_domain_files 등 기존 선례와 동일 패턴, meeting.rb / meetings_controller.rb).
  def dflow_folder_chain
    return [] unless folder
    [ folder ] + folder.ancestor_records
  end
end
