class DomainFile < ApplicationRecord
  MAX_CONTENT_CHARS = 50_000
  AUTO_KIND_STT = "stt_auto".freeze

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

  scope :stt_auto, -> { where(auto_kind: AUTO_KIND_STT) }

  def stt_auto?
    auto_kind == AUTO_KIND_STT
  end

  # 전역 자동 파일. 프로젝트 삭제로 project_id 가 nullify 된 프로젝트 레벨 자동 파일은
  # auto_owner_type 이 남아 있으므로 전역으로 오인하지 않는다.
  def global_auto?
    stt_auto? && auto_owner_type.nil? && project_id.nil?
  end

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

  # key(normalize_key 된 용어)의 첫 용어 항목. parse_terms 항목 형식 그대로.
  def find_term(key)
    self.class.parse_terms(content).find { |t| self.class.normalize_key(t[:term]) == key }
  end

  # key 의 원문 줄(없으면 nil).
  def term_line(key)
    t = find_term(key)
    return nil unless t
    content.to_s.split("\n", -1)[t[:line_no]]
  end

  # 학습 결과 반영. 저장은 최대 한 번.
  # merges: { term_key => [variants] } — 기존 줄의 용어·분류·설명은 보존하고 오인식만 합집합.
  # new_terms: [{term:, category:, definition:, mispronunciations:}] — 끝에 append(같은 key 가 있으면 merges 규칙).
  # 반환: { term_key => 바뀐 뒤 줄 } (String 키). 바뀐 게 없으면 저장 없이 {}.
  def apply_learning!(merges: {}, new_terms: [])
    lines = content.to_s.split("\n", -1)
    index = {}
    lines.each_with_index do |line, idx|
      m = TERM_LINE_REGEX.match(line)
      index[self.class.normalize_key(m[1])] = idx if m
    end

    changed = {}
    merge_into = lambda do |key, variants|
      idx = index[key]
      next unless idx
      m = TERM_LINE_REGEX.match(lines[idx])
      existing = self.class.split_mispronunciations(m[3])
      merged = self.class.merge_mispronunciations(existing, variants)
      next if merged == existing

      lines[idx] = self.class.format_term_line(m[1].to_s.strip, m[2].to_s.strip, m[4].to_s.strip, merged)
      changed[key] = lines[idx]
    end

    (merges || {}).each { |key, variants| merge_into.call(self.class.normalize_key(key), variants) }

    Array(new_terms).each do |raw|
      term = (raw[:term] || raw["term"]).to_s.strip
      next if term.blank?
      key = self.class.normalize_key(term)
      variants = raw[:mispronunciations] || raw["mispronunciations"]
      if index.key?(key)
        merge_into.call(key, variants)
      else
        lines << self.class.format_term_line(term, (raw[:category] || raw["category"]).to_s.strip,
                                             (raw[:definition] || raw["definition"]).to_s.strip, variants)
        index[key] = lines.length - 1
        changed[key] = lines.last
      end
    end

    return {} if changed.empty?
    update!(content: lines.join("\n"))
    changed
  end

  # 용어 줄 하나를 지운다. 지운 원래 줄을 반환(없으면 nil).
  def remove_term_line!(key)
    t = find_term(key)
    return nil unless t
    lines = content.to_s.split("\n", -1)
    removed = lines.delete_at(t[:line_no])
    update!(content: lines.join("\n"))
    removed
  end

  # 변형 하나만 제거(남는 게 없으면 (오인식: …) 괄호 자체가 사라진다). 제거했으면 true.
  def remove_mispronunciation!(key, variant)
    t = find_term(key)
    return false unless t
    vkey = self.class.normalize_key(variant)
    remaining = t[:mispronunciations].reject { |v| self.class.normalize_key(v) == vkey }
    return false if remaining.size == t[:mispronunciations].size
    lines = content.to_s.split("\n", -1)
    lines[t[:line_no]] = self.class.format_term_line(t[:term], t[:category], t[:definition], remaining)
    update!(content: lines.join("\n"))
    true
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
