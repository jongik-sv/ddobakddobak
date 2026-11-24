module SttTermLearning
  # 관리자 트리 응답(Task 12 계약 `tree`).
  class TreeBuilder
    NEW_WINDOW = 7.days

    def initialize(user, project_id: nil)
      @user = user
      @project_id = project_id
    end

    def call
      snap = AdminScope.snapshot(@user, project_id: @project_id)
      new_by_file = new_counts_by_file(snap)
      cand = promote_candidates(snap)
      stat = lambda do |n|
        {
          "term_count" => snap.term_map(n).size,
          "new_count" => n.files.sum { |f| new_by_file[f.id].to_i }
        }
      end

      global = snap.nodes.first
      projects = snap.nodes.select { |n| n.level.type == "Project" }.map do |p|
        folders = snap.descendants_of(p).map do |f|
          { "id" => f.folder_id, "name" => f.name, "parent_id" => parent_folder_id(snap, f) }
            .merge(stat.call(f)).merge("promote_candidates" => cand[f.key] || [])
        end
        { "id" => p.project_id, "name" => p.name }
          .merge(stat.call(p)).merge("promote_candidates" => cand[p.key] || [], "folders" => folders)
      end
      { "global" => stat.call(global), "projects" => projects }
    end

    private

    def parent_folder_id(snap, node)
      snap.node_by_key(node.parent_key)&.folder_id
    end

    # 최근 NEW_WINDOW 안에 끝난(reverted 제외) run 에서 registered/merged_existing 된 items (TermIndex 의 is_new 와 같은 기준) 수 — 파일 단위.
    # 보이지 않는 프로젝트 회의의 item 은 뺀다(TermIndex 와 같은 숨김 집합).
    def new_counts_by_file(snap)
      scope = ::SttTermLearningItem.applied_live.where(verdict: %w[registered merged_existing])
        .where(stt_term_learning_runs: { finished_at: (Time.current - NEW_WINDOW)..})
      hidden = snap.hidden_meeting_ids(scope.select("stt_term_learning_runs.meeting_id"))
      scope = scope.where.not(stt_term_learning_runs: { meeting_id: hidden.to_a }) if hidden.any?
      scope.group(:domain_file_id).count
    end

    # 상위로 올릴 후보 = 중복 그룹 중 merge_target 이 있고 그 레벨에 멤버가 없는 것 (TermIndex 와 같은 정의).
    def promote_candidates(snap)
      out = Hash.new { |h, k| h[k] = [] }
      snap.groups.each_value do |g|
        next unless g[:promote]
        out[g[:target].key] << { "term" => g[:term], "folder_ids" => g[:members].map(&:folder_id).compact.uniq }
      end
      out
    end
  end
end
