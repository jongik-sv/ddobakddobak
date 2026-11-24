# STT 용어 학습 관리자 API(Task 12)의 공용 직렬화. 프론트 frontend/src/api/sttTermLearning.ts 계약과 같은 모양이다.
module SttTermLearningJson
  extend ActiveSupport::Concern

  LEARNING_DISABLED_MESSAGE = "학습 꺼짐: 설정에서 켜 주세요".freeze

  private

  def learning_enabled?
    AppSettings.stt_term_learning["enabled"] == true
  end

  def render_learning_disabled
    render json: { error: LEARNING_DISABLED_MESSAGE }, status: :unprocessable_entity
  end

  # 관리자 화면에 보이는 프로젝트 id(남의 personal·휴지통 제외). project 없는 회의는 보인다(TermIndex 와 같은 기준).
  def visible_project_ids
    @visible_project_ids ||= ::SttTermLearning::AdminScope.projects(current_user).pluck(:id)
  end

  def visible_project?(project_id)
    project_id.nil? || visible_project_ids.include?(project_id)
  end

  def visible_meetings_scope(scope = ::Meeting.all)
    scope.where(project_id: nil).or(scope.where(project_id: visible_project_ids))
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
