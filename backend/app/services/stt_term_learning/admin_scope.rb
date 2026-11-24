module SttTermLearning
  # 관리자 화면(트리·용어 인덱스)이 보는 범위와 그 인메모리 스냅샷.
  module AdminScope
    module_function

    # 남의 personal 프로젝트는 뺀다. Project#blocks_admin_override?(user) 의 SQL 등가물이다
    # (personal && created_by_id != user.id 를 제외) — 한쪽을 바꾸면 spec 이 어긋나게 해 둔다.
    def projects(user)
      ::Project.kept.where(personal: false).or(::Project.kept.where(created_by_id: user&.id))
    end

    def snapshot(user)
      Snapshot.new(user)
    end

    Node = Struct.new(:level, :key, :name, :path, :parent_key, :project_id, :folder_id, :files, :children_keys, keyword_init: true) do
      def global? = level.global?

      def info
        { "type" => level.type, "id" => level.owner&.id, "name" => name, "path" => path }
      end
    end

    # 전역 + 보이는 프로젝트 + 그 폴더를 한 번에 읽어 두고 조회한다(링크·파일 preload).
    class Snapshot
      attr_reader :nodes

      def initialize(user)
        @terms = {}
        projects = AdminScope.projects(user).order(:id).to_a
        pids = projects.map(&:id)
        folders = ::Folder.kept.where(project_id: pids).order(:id).to_a
        base = ::DomainFileLink.not_excluded.includes(:domain_file).order(:id)
        links = (base.where(owner_type: "Project", owner_id: pids).to_a +
                 base.where(owner_type: "Folder", owner_id: folders.map(&:id)).to_a)
                  .group_by { |l| [l.owner_type, l.owner_id] }
        files_for = ->(type, id) { (links[[type, id]] || []).map(&:domain_file).compact }

        @nodes = []
        @by_key = {}
        global_file = ::DomainFile.stt_auto.find_by(auto_owner_type: nil, project_id: nil)
        add(Node.new(level: Level.global, key: "global", name: "전역", path: [], parent_key: nil, project_id: nil,
                     folder_id: nil, files: [global_file].compact, children_keys: []))

        by_project = folders.group_by(&:project_id)
        projects.each do |project|
          pnode = add(Node.new(level: Level.for(project), key: "Project:#{project.id}", name: project.name,
                               path: [project.name], parent_key: "global", project_id: project.id, folder_id: nil,
                               files: files_for.call("Project", project.id), children_keys: []))
          fmap = (by_project[project.id] || []).index_by(&:id)
          kids = fmap.values.group_by { |f| fmap.key?(f.parent_id) ? f.parent_id : nil }
          walk = lambda do |parent_folder_id, parent_node, trail|
            (kids[parent_folder_id] || []).each do |folder|
              next if trail.include?(folder.id) # 순환 가드
              node = add(Node.new(level: Level.for(folder), key: "Folder:#{folder.id}", name: folder.name,
                                  path: parent_node.path + [folder.name], parent_key: parent_node.key,
                                  project_id: project.id, folder_id: folder.id,
                                  files: files_for.call("Folder", folder.id), children_keys: []))
              parent_node.children_keys << node.key
              walk.call(folder.id, node, trail + [folder.id])
            end
          end
          walk.call(nil, pnode, [])
        end
        @nodes.first.children_keys.concat(@nodes.select { |n| n.parent_key == "global" }.map(&:key))
      end

      # 보이는 프로젝트 id(전역 노드 제외).
      def visible_project_ids
        @visible_project_ids ||= @nodes.filter_map(&:project_id).uniq
      end

      # meeting_ids(배열·relation) 중 보이지 않는 프로젝트(남의 personal 등)에 속한 회의 id 집합.
      # TermIndex(meeting_ids·source)와 TreeBuilder(new_count)가 같은 숨김 기준을 쓴다.
      def hidden_meeting_ids(meeting_ids)
        ::Meeting.where(id: meeting_ids).where.not(project_id: nil).where.not(project_id: visible_project_ids)
                 .pluck(:id).to_set
      end

      def node_for(level)
        @by_key[level.key]
      end

      def node_by_key(key)
        @by_key[key]
      end

      def descendants_of(node)
        node.children_keys.flat_map { |k| [@by_key[k]] + descendants_of(@by_key[k]) }
      end

      # 파일의 용어 줄(key 중복은 첫 줄만).
      def terms_in(file)
        @terms[file.id] ||= ::DomainFile.parse_terms(file.content).each_with_object({}) do |t, h|
          h[::DomainFile.normalize_key(t[:term])] ||= t
        end
      end

      # { key => 대표 용어 hash } — 그 레벨 링크 파일들의 합.
      def term_map(node)
        node.files.each_with_object({}) { |f, h| terms_in(f).each { |k, t| h[k] ||= t } }
      end

      # 중복 그룹: { "pid:key" => { term:, members: [Node], target: Node|nil, promote: bool } }
      # 같은 프로젝트 안에서 같은 key 가 2개 이상 레벨에 있을 때(전역 제외).
      def groups
        @groups ||= begin
          acc = Hash.new { |h, k| h[k] = { term: nil, members: [], file_ids: [] } }
          nodes.each do |n|
            next if n.global?
            n.files.each do |file|
              terms_in(file).each do |key, t|
                g = acc["#{n.project_id}:#{key}"]
                g[:term] ||= t[:term]
                g[:members] << n unless g[:members].include?(n)
                g[:file_ids] << file.id
              end
            end
          end
          acc.select { |_, g| g[:members].size >= 2 && g[:file_ids].uniq.size >= 2 }.each_value do |g|
            g[:target] = common_ancestor(g[:members])
            g[:promote] = !g[:target].nil? && g[:members].none? { |m| m.key == g[:target].key }
          end
        end
      end

      def common_ancestor(members)
        chains = members.map { |m| chain(m) }
        chains.first.find { |n| chains.all? { |c| c.any? { |x| x.key == n.key } } && !n.global? }
      end

      private

      def chain(node)
        out = []
        cur = node
        seen = {}
        while cur && !seen[cur.key]
          seen[cur.key] = true
          out << cur
          cur = @by_key[cur.parent_key]
        end
        out
      end

      def add(node)
        @nodes << node
        @by_key[node.key] = node
        node
      end
    end
  end
end
