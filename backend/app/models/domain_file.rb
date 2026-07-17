class DomainFile < ApplicationRecord
  MAX_CONTENT_CHARS = 50_000

  # 용어 라인 규약: "- **용어** [분류]: 설명" (분류 없으면 "- **용어**: 설명").
  # 비매치 라인은 자유 텍스트로 보존한다(파싱·병합 대상 아님).
  TERM_LINE_REGEX = /^-\s*\*\*(.+?)\*\*(?:\s*\[([^\]]*)\])?\s*:\s*(.*)$/

  belongs_to :project, optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"

  has_many :meeting_domain_files, dependent: :destroy
  has_many :meetings, through: :meeting_domain_files

  validates :name, presence: true, length: { maximum: 100 },
            uniqueness: { scope: :project_id }
  validates :content, length: { maximum: MAX_CONTENT_CHARS }

  # 열람 스코프: admin은 전체, 그 외는 전역(공용) 파일 + 본인 소속 프로젝트 파일.
  # 멤버십 소스는 meeting.rb:178 accessible_by와 동일(ProjectMembership).
  scope :accessible_by, ->(user) {
    next all if user.admin?

    pids = ProjectMembership.where(user_id: user.id).select(:project_id)
    where(project_id: nil).or(where(project_id: pids))
  }

  def editable_by?(user)
    return false unless user
    user.admin? || created_by_id == user.id
  end

  # 신규/변경 용어를 마크다운 content에 반영한다.
  # 기존에 같은 key(normalize_key)의 용어 라인이 있으면 그 라인을 교체(replaced),
  # 없으면 파일 끝에 새 라인을 append(added)한다. 자유 텍스트 라인은 건드리지 않는다.
  # terms: [{"term"=>, "category"=>, "definition"=>}, ...] (term blank 항목은 skip)
  # 반환: { added: n, replaced: n }
  def merge_terms!(terms)
    added = 0
    replaced = 0

    lines = content.to_s.split("\n", -1)
    # 기존 용어 라인의 key => line index
    existing_index = {}
    lines.each_with_index do |line, idx|
      m = TERM_LINE_REGEX.match(line)
      next unless m
      existing_index[self.class.normalize_key(m[1])] = idx
    end

    Array(terms).each do |raw|
      term = raw["term"] || raw[:term]
      term = term.to_s.strip
      next if term.blank?

      category = (raw["category"] || raw[:category]).to_s.strip
      definition = (raw["definition"] || raw[:definition]).to_s.strip
      new_line = self.class.format_term_line(term, category, definition)
      key = self.class.normalize_key(term)

      if existing_index.key?(key)
        lines[existing_index[key]] = new_line
        replaced += 1
      else
        lines << new_line
        existing_index[key] = lines.length - 1
        added += 1
      end
    end

    update!(content: lines.join("\n"))
    { added: added, replaced: replaced }
  end

  class << self
    # content(마크다운)에서 용어 라인만 파싱한다. 비매치 라인은 결과에 포함하지 않는다.
    def parse_terms(content)
      content.to_s.split("\n").each_with_index.filter_map do |line, idx|
        m = TERM_LINE_REGEX.match(line)
        next unless m
        { term: m[1].to_s.strip, category: m[2].to_s.strip, definition: m[3].to_s.strip, line_no: idx }
      end
    end

    def format_term_line(term, category, definition)
      if category.to_s.strip.present?
        "- **#{term}** [#{category}]: #{definition}"
      else
        "- **#{term}**: #{definition}"
      end
    end

    # dedup key: trim + downcase (한글은 downcase 무영향, 영문 대소문자 무시)
    def normalize_key(term)
      term.to_s.strip.downcase
    end
  end
end
