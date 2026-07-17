class DomainFile < ApplicationRecord
  MAX_CONTENT_CHARS = 50_000

  # 용어 라인 규약: "- **용어** [분류] (오인식: 변형1, 변형2): 설명"
  # ([분류]와 (오인식: ...)은 각각 optional, 이 순서 고정. 분류·오인식 모두 없으면 "- **용어**: 설명").
  # "오인식"/"발음" 키워드 둘 다 허용, 변형은 쉼표 구분. 비매치 라인은 자유 텍스트로 보존한다(파싱·병합 대상 아님).
  TERM_LINE_REGEX = /^-\s*\*\*(.+?)\*\*(?:\s*\[([^\]]*)\])?(?:\s*\((?:오인식|발음)\s*:\s*([^)]*)\))?\s*:\s*(.*)$/

  belongs_to :project, optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"

  has_many :domain_file_links, dependent: :destroy

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

  # 프로젝트/폴더/회의 도메인 파일 링크 API 공용 요약 포맷(DomainFileSummary 계약).
  def summary_json(user = nil)
    {
      id: id,
      name: name,
      project_id: project_id,
      updated_at: updated_at,
      editable: editable_by?(user)
    }
  end

  # 신규/변경 용어를 마크다운 content에 반영한다.
  # 기존에 같은 key(normalize_key)의 용어 라인이 있으면 그 라인을 교체(replaced),
  # 없으면 파일 끝에 새 라인을 append(added)한다. 자유 텍스트 라인은 건드리지 않는다.
  # terms: [{"term"=>, "category"=>, "definition"=>, "mispronunciations"=>[...]}, ...] (term blank 항목은 skip,
  # mispronunciations는 optional — 없으면 오인식 표기 없는 라인이 된다)
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
      mispronunciations = raw["mispronunciations"] || raw[:mispronunciations]
      key = self.class.normalize_key(term)

      if existing_index.key?(key)
        idx = existing_index[key]
        existing_match = TERM_LINE_REGEX.match(lines[idx])
        existing_mispronunciations = existing_match ? self.class.split_mispronunciations(existing_match[3]) : []
        merged_mispronunciations = self.class.merge_mispronunciations(existing_mispronunciations, mispronunciations)
        lines[idx] = self.class.format_term_line(term, category, definition, merged_mispronunciations)
        replaced += 1
      else
        new_line = self.class.format_term_line(term, category, definition, mispronunciations)
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
        {
          term: m[1].to_s.strip,
          category: m[2].to_s.strip,
          mispronunciations: split_mispronunciations(m[3]),
          definition: m[4].to_s.strip,
          line_no: idx
        }
      end
    end

    def format_term_line(term, category, definition, mispronunciations = [])
      line = "- **#{term}**"
      line += " [#{category}]" if category.to_s.strip.present?
      mis = normalize_mispronunciations(mispronunciations)
      line += " (오인식: #{mis.join(', ')})" if mis.any?
      "#{line}: #{definition}"
    end

    # "변형1, 변형2" 형태의 원문 캡처(nil 가능)를 배열로 분해한다.
    def split_mispronunciations(raw)
      return [] if raw.blank?
      raw.split(",").map(&:strip).reject(&:blank?)
    end

    # merge_terms!/format_term_line에서 받는 임의 배열(문자열/심볼 혼재 가능)을 정규화한다.
    def normalize_mispronunciations(mispronunciations)
      Array(mispronunciations).map { |v| v.to_s.strip }.reject(&:blank?)
    end

    # 라인 교체 시 기존 오인식을 유실하지 않도록 기존(먼저) + 신규 순으로 합치고
    # normalize_key 기준(strip+downcase)으로 중복을 제거한다.
    def merge_mispronunciations(existing, new_values)
      seen = {}
      (normalize_mispronunciations(existing) + normalize_mispronunciations(new_values)).select do |v|
        key = normalize_key(v)
        next false if seen[key]
        seen[key] = true
        true
      end
    end

    # dedup key: trim + downcase (한글은 downcase 무영향, 영문 대소문자 무시)
    def normalize_key(term)
      term.to_s.strip.downcase
    end
  end
end
