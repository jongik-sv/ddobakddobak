module SttTermLearning
  # 관리자 용어 인덱스(Task 12 계약 `TermRow`).
  class TermIndex
    MAX_MEETING_IDS = 20

    def initialize(user)
      @user = user
    end

    # level: Level|nil (nil = 전 레벨). 보이지 않는 레벨(남의 personal 등)이면 [].
    def rows(level: nil, include_descendants: false)
      snap = AdminScope.snapshot(@user)
      selected =
        if level.nil?
          snap.nodes
        else
          node = snap.node_for(level)
          next_nodes = node ? [node] : []
          next_nodes += snap.descendants_of(node) if node && include_descendants
          next_nodes
        end
      files = selected.flat_map(&:files).uniq
      applied = applied_items(files, hidden_meeting_ids(snap, files))
      cutoff = Time.current - TreeBuilder::NEW_WINDOW

      selected.flat_map do |node|
        node.files.flat_map do |file|
          count = nil
          snap.terms_in(file).map do |key, t|
            items = applied[[file.id, key]] || []
            count ||= ImpactCounter.count(node.level, domain_file_id: file.id)
            group = snap.groups["#{node.project_id}:#{key}"] unless node.global?
            build_row(node, file, key, t, items, count, group, cutoff)
          end
        end
      end
    end

    private

    # { [file_id, correct_key] => [item(최신 id 순)] }
    def applied_items(files, hidden)
      return {} if files.empty?
      items = ::SttTermLearningItem.applied_live.where(domain_file_id: files.map(&:id))
        .includes(:run).order(id: :desc).to_a
      items.reject! { |i| hidden.include?(i.run.meeting_id) } if hidden.any?
      items.group_by { |i| [i.domain_file_id, i.correct_key] }
    end

    # 보이지 않는 프로젝트(남의 personal 등)에 속한 회의 id — meeting_ids·source 에서 뺀다.
    def hidden_meeting_ids(snap, files)
      return Set.new if files.empty?
      run_ids = ::SttTermLearningItem.where(domain_file_id: files.map(&:id)).select(:run_id)
      mids = ::SttTermLearningRun.where(id: run_ids).select(:meeting_id)
      visible = snap.nodes.filter_map(&:project_id).uniq
      ::Meeting.where(id: mids).where.not(project_id: nil).where.not(project_id: visible).pluck(:id).to_set
    end

    def build_row(node, file, key, t, items, count, group, cutoff)
      source =
        if file.stt_auto?
          items.first&.source == "feedback" ? "feedback" : "auto"
        else
          items.any? ? "human_merged" : "human"
        end
      {
        "row_id" => "#{file.id}:#{key}@#{node.level.key}",
        "term" => t[:term],
        "key" => key,
        "category" => t[:category].presence,
        "definition" => t[:definition].presence,
        "mispronunciations" => t[:mispronunciations],
        "domain_file" => { "id" => file.id, "name" => file.name, "auto" => file.stt_auto? },
        "level" => node.info,
        "source" => source,
        "meeting_ids" => items.map { |i| i.run.meeting_id }.uniq.first(MAX_MEETING_IDS),
        "is_new" => items.any? { |i| new_item?(i, cutoff) },
        "applied_meeting_count" => count,
        "duplicate_group" => group ? "#{node.project_id}:#{key}" : nil,
        "merge_target" => group&.dig(:target)&.info
      }
    end

    def new_item?(item, cutoff)
      %w[registered merged_existing].include?(item.verdict) && item.run.finished_at.present? && item.run.finished_at >= cutoff
    end
  end
end
