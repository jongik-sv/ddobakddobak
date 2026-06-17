class Folder < ApplicationRecord
  belongs_to :project, optional: true
  belongs_to :parent, class_name: "Folder", optional: true
  has_many :children, class_name: "Folder", foreign_key: :parent_id, dependent: :nullify
  has_many :meetings, dependent: :nullify
  has_many :glossary_entries, as: :owner, dependent: :destroy
  has_many :taggings, as: :taggable, dependent: :destroy
  has_many :tags, through: :taggings

  validates :name, presence: true, length: { maximum: 100 }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :roots, -> { where(parent_id: nil) }
  scope :ordered, -> { order(:position, :name) }

  def ancestors
    path = []
    current = parent
    seen = {}
    while current && !seen[current.id]
      seen[current.id] = true
      path.unshift({ id: current.id, name: current.name })
      current = current.parent
    end
    path
  end

  # admin 또는 이 폴더에 직속한 회의의 creator 면 편집 가능(폴더엔 소유 컬럼이 없음).
  def editable_by?(user)
    user.admin? || meetings.exists?(created_by_id: user.id)
  end

  # 가까운 → 먼 순서의 조상 Folder 레코드 (사이클 가드).
  def ancestor_records
    records = []
    current = parent
    seen = {}
    while current && !seen[current.id]
      seen[current.id] = true
      records << current
      current = current.parent
    end
    records
  end

  # 자신 + 모든 자손 폴더 id (루트 포함). BFS, seen 사이클 가드.
  def subtree_ids
    result = []
    seen = {}
    queue = [self]
    while (node = queue.shift)
      next if seen[node.id]
      seen[node.id] = true
      result << node.id
      queue.concat(node.children.to_a)
    end
    result
  end

  # 타인 열람 가능 폴더 = 자신과 모든 조상이 shared일 때만(상속·폴더 우선).
  # 조상 중 하나라도 비공개면 false → 이 폴더와 모든 하위가 가려진다.
  # parent_id 순환(사이클)이 있어도 visited 가드로 무한루프 없이 종료.
  def effectively_shared?
    seen = {}
    node = self
    while node && !seen[node.id]
      return false unless node.shared
      seen[node.id] = true
      node = node.parent
    end
    true
  end

  # 타인에게 보이는(자신+모든 조상 공유) 폴더 id 배열. accessible_by/tree 공용.
  # 전 폴더를 1번만 로드해 in-memory로 조상 체인 평가(폴더당 쿼리 N+1 회피).
  def self.visible_folder_ids
    folders = all.to_a
    by_id = folders.index_by(&:id)
    cache = {}
    visiting = {}
    resolve = lambda do |f|
      return cache[f.id] if cache.key?(f.id)
      return true if visiting[f.id] # 사이클 — 낙관적 true로 끊어 크래시 방지
      visiting[f.id] = true
      parent = f.parent_id && by_id[f.parent_id]
      result = f.shared && (f.parent_id.nil? || parent.nil? || resolve.call(parent))
      visiting.delete(f.id)
      cache[f.id] = result
    end
    folders.each { |f| resolve.call(f) }
    cache.select { |_, v| v }.keys
  end

  # user를 주면 그 사용자가 접근 가능한 회의만 카운트 (admin/loopback은 전체).
  # user가 nil이면 전체 카운트(하위 호환).
  def self.tree(user = nil, project_id = nil)
    base = ordered.includes(:tags)
    base = base.where(project_id: project_id) if project_id.present?
    all_folders = base.to_a
    # non-admin: 비공개 폴더(및 비공개 조상 하위) 서브트리 통째로 숨긴다(상속).
    # admin/loopback은 자물쇠 표시와 함께 전부 본다.
    if user && !user.admin?
      visible = visible_folder_ids.to_set
      all_folders = all_folders.select { |f| visible.include?(f.id) }
    end
    scope = user ? Meeting.accessible_by(user) : Meeting.all
    scope = scope.where(project_id: project_id) if project_id.present?
    meeting_counts = scope.where(folder_id: all_folders.map(&:id))
                          .group(:folder_id).count
    children_by_parent = all_folders.group_by(&:parent_id)
    roots = children_by_parent[nil] || []
    build_tree(roots, children_by_parent, meeting_counts)
  end

  def self.build_tree(nodes, children_by_parent, meeting_counts)
    nodes.map do |node|
      children = children_by_parent[node.id] || []
      child_nodes = build_tree(children, children_by_parent, meeting_counts)
      total_meeting_count = (meeting_counts[node.id] || 0) +
                            child_nodes.sum { |c| c[:meeting_count] }
      {
        id: node.id,
        name: node.name,
        parent_id: node.parent_id,
        position: node.position,
        shared: node.shared,
        important: node.important,
        meeting_count: total_meeting_count,
        tags: node.tags.map { |t| { id: t.id, name: t.name, color: t.color } },
        children: child_nodes
      }
    end
  end
  private_class_method :build_tree
end
