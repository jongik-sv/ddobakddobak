# STT 용어 학습 관리자 API(Task 12)의 공용 직렬화. 프론트 frontend/src/api/sttTermLearning.ts 계약과 같은 모양이다.
module SttTermLearningJson
  extend ActiveSupport::Concern

  LEARNING_DISABLED_MESSAGE = "학습 꺼짐: 설정에서 켜 주세요".freeze
  GLOBAL_WRITE_MESSAGE = "전역 레벨은 시스템 관리자만 변경할 수 있습니다".freeze

  # 프로젝트 관리자(비 시스템 admin)가 전역 레벨을 바꾸려 할 때 — 403 으로 렌더한다.
  class GlobalWriteForbidden < StandardError; end

  FILE_WRITE_MESSAGE = "이 도메인 파일은 변경할 권한이 없습니다".freeze

  # 프로젝트 관리자가 관리 범위 밖·편집 권한 없는 도메인 파일을 바꾸려 할 때 — 403.
  class FileWriteForbidden < StandardError
    def initialize(message = FILE_WRITE_MESSAGE)
      super
    end
  end

  EXISTING_TERM_MESSAGE = "이 용어는 수정 권한이 없는 도메인 파일에 이미 있습니다".freeze

  included do
    rescue_from GlobalWriteForbidden do
      render json: { error: GLOBAL_WRITE_MESSAGE }, status: :forbidden
    end
    rescue_from FileWriteForbidden do |e|
      render json: { error: e.message }, status: :forbidden
    end
  end

  private

  # 시스템 admin 또는 관리 프로젝트가 1개 이상인 사용자만(로컬 모드는 통과).
  def require_stt_learning_manager!
    return true unless server_mode?
    return true if ::SttTermLearning::AdminScope.manager?(current_user)
    render json: { error: "Forbidden" }, status: :forbidden
  end

  def global_writer?
    ::SttTermLearning::AdminScope.global_writer?(current_user)
  end

  def forbid_global_write!
    raise GlobalWriteForbidden unless global_writer?
  end

  def managed_project_ids
    @managed_project_ids ||= ::SttTermLearning::AdminScope.projects(current_user).pluck(:id)
  end

  def writable_file?(file)
    ::SttTermLearning::AdminScope.writable_file?(current_user, file, managed_ids: managed_project_ids)
  end

  # 쓰기 전에(또는 같은 트랜잭션 안에서) 호출. 전역 자동 파일이면 전역 메시지, 아니면 파일 메시지로 403.
  def forbid_file_write!(file_or_id, existing_term: false)
    return true if global_writer?
    file = file_or_id.is_a?(::DomainFile) ? file_or_id : ::DomainFile.find_by(id: file_or_id)
    return true if file.nil? # 이미 없는 파일은 쓸 것이 없다(후속 단계가 not found 처리)
    return true if writable_file?(file)
    raise GlobalWriteForbidden if file.stt_auto? && file.auto_owner_type.nil?
    raise FileWriteForbidden, (existing_term ? EXISTING_TERM_MESSAGE : FILE_WRITE_MESSAGE)
  end

  def global_file_ids
    @global_file_ids ||= ::SttTermLearning::AdminScope.snapshot(current_user).global_file_ids
  end

  def learning_enabled?
    AppSettings.stt_term_learning["enabled"] == true
  end

  def render_learning_disabled
    render json: { error: LEARNING_DISABLED_MESSAGE }, status: :unprocessable_entity
  end

  # 관리자 화면에 보이는 프로젝트 id(서버 모드: 내가 프로젝트 admin 인 프로젝트. 로컬: 남의 personal·휴지통 제외).
  def visible_project_ids
    @visible_project_ids ||= ::SttTermLearning::AdminScope.projects(current_user).pluck(:id)
  end

  # 선택적 ?project_id= 필터. 없으면 nil(전체). 보이는 프로젝트가 아니면(남의 personal·휴지통·없는 id) 404.
  def scoped_project_id
    return @scoped_project_id if defined?(@scoped_project_id)
    raw = params[:project_id]
    @scoped_project_id =
      if raw.blank?
        nil
      else
        id = Integer(raw.to_s, 10, exception: false)
        raise ActiveRecord::RecordNotFound, "프로젝트가 없습니다" unless id && visible_project_ids.include?(id)
        id
      end
  end

  def visible_project?(project_id)
    (project_id.nil? && !server_mode?) || visible_project_ids.include?(project_id)
  end

  # 서버 모드: 관리 프로젝트의 회의만. 로컬 모드: project 없는 회의도 보인다(TermIndex 와 같은 기준).
  def visible_meetings_scope(scope = ::Meeting.all)
    in_projects = scope.where(project_id: visible_project_ids)
    server_mode? ? in_projects : scope.where(project_id: nil).or(in_projects)
  end

  # 관리자 화면에 보이는 도메인 파일 id(AdminScope 스냅샷 노드의 링크 파일 — TermIndex 가 보여 주는 집합).
  def visible_file_ids
    @visible_file_ids ||= ::SttTermLearning::AdminScope.snapshot(current_user).nodes.flat_map { |n| n.files.map(&:id) }.to_set
  end

  # 남의 personal 프로젝트(또는 휴지통 프로젝트)에 속한 레벨인지.
  def hidden_level?(level)
    pid = level.project_id
    !pid.nil? && !visible_project_ids.include?(pid)
  end

  # LevelInfo = { type, id, name, path } — path 는 AdminScope 와 같은 규칙(전역 [], 프로젝트 [p], 폴더 [p, 조상…, f]).
  def level_info(level)
    return nil unless level
    @level_info_cache ||= {}
    @level_info_cache[level.key] ||= begin
      path =
        case level.type
        when "global" then []
        when "Project" then [ level.owner.name ]
        when "Folder"
          folder = level.owner
          [ folder.project&.name, *folder.ancestor_records.reverse.map(&:name), folder.name ].compact
        end
      { type: level.type, id: level.owner&.id, name: level.name, path: path }
    end
  end

  # (owner_type, owner_id) → Level | nil. 지워진 폴더·프로젝트면 nil.
  def level_from_owner(type, id)
    case type
    when "global" then ::SttTermLearning::Level.global
    when "Folder"
      folder = ::Folder.find_by(id: id)
      folder && ::SttTermLearning::Level.for(folder)
    when "Project"
      project = ::Project.find_by(id: id)
      project && ::SttTermLearning::Level.for(project)
    end
  end

  # params 의 LevelRef({type, id}) → Level. 없는 레코드는 RecordNotFound.
  def level_from_ref(raw)
    ref = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw.to_h
    ref = ref.symbolize_keys.slice(:type, :id)
    raise ActiveRecord::RecordNotFound, "레벨이 없습니다" if ref[:type].blank?
    ::SttTermLearning::Level.from_ref(type: ref[:type], id: ref[:id])
  end

  def meeting_level(meeting)
    if meeting.folder
      ::SttTermLearning::Level.for(meeting.folder)
    elsif meeting.project
      ::SttTermLearning::Level.for(meeting.project)
    end
  end

  def meeting_ref(meeting)
    return nil unless meeting
    { id: meeting.id, title: meeting.title, level: level_info(meeting_level(meeting)) }
  end

  # { run_id => { registered:, skipped:, total: } } — 한 번의 group 쿼리.
  def item_stats(run_ids)
    stats = Hash.new { |h, k| h[k] = { registered: 0, skipped: 0, total: 0 } }
    ::SttTermLearningItem.where(run_id: run_ids).group(:run_id, :verdict).count.each do |(run_id, verdict), n|
      s = stats[run_id]
      s[:total] += n
      s[:registered] += n if %w[registered merged_existing].include?(verdict)
      s[:skipped] += n if verdict.start_with?("skipped_")
    end
    stats
  end

  def run_summary_json(run, stats = nil)
    stats ||= item_stats([ run.id ])
    s = stats[run.id]
    {
      id: run.id,
      meeting: meeting_ref(run.meeting),
      trigger: run.trigger,
      status: run.status,
      registered_count: s[:registered],
      skipped_count: s[:skipped],
      no_change: run.status == "done" && s[:total].zero?,
      error: run.error,
      llm_skipped_reason: run.llm_skipped_reason,
      created_at: run.created_at,
      finished_at: run.finished_at
    }
  end

  def run_item_json(item)
    file = item.domain_file
    {
      id: item.id,
      wrong: item.wrong,
      correct: item.correct,
      source: item.source,
      verdict: item.verdict,
      reason: item.reason,
      domain_file: file && { id: file.id, name: file.name },
      level: level_info(level_from_owner(item.level_owner_type, item.level_owner_id)),
      revert_result: item.revert_result
    }
  end
end
