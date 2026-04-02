class Folder < ApplicationRecord
  belongs_to :team, optional: true
  belongs_to :parent, class_name: "Folder", optional: true
  has_many :children, class_name: "Folder", foreign_key: :parent_id, dependent: :nullify
  has_many :meetings, dependent: :nullify
  has_many :taggings, as: :taggable, dependent: :destroy
  has_many :tags, through: :taggings

  validates :name, presence: true, length: { maximum: 100 }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :roots, -> { where(parent_id: nil) }
  scope :ordered, -> { order(:position, :name) }

  def ancestors
    path = []
    current = parent
    while current
      path.unshift({ id: current.id, name: current.name })
      current = current.parent
    end
    path
  end

  def self.tree
    all_folders = ordered.includes(:tags).to_a
    meeting_counts = Meeting.where(folder_id: all_folders.map(&:id))
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
        meeting_count: total_meeting_count,
        tags: node.tags.map { |t| { id: t.id, name: t.name, color: t.color } },
        children: child_nodes
      }
    end
  end
  private_class_method :build_tree
end
