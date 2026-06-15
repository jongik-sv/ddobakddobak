# meeting 에 적용할 교정 목록을 결정론적 순서로 반환.
# 구체성: 회의 > 현재 폴더 > 가까운 조상 > 먼 조상.
# 같은 [from_text, match_type] 은 더 구체적인 레벨이 override.
# 적용 순서: literal(길이 내림차순) 먼저, regex(id 순) 나중.
class GlossaryResolver
  def self.for(meeting)
    new(meeting).resolve
  end

  def initialize(meeting)
    @meeting = meeting
  end

  def resolve
    by_key = {}
    levels.each do |owner|
      owner.glossary_entries.active.order(:id).each do |e|
        key = [e.from_text, e.match_type]
        next if by_key.key?(key) # 더 구체적 레벨이 이미 점유
        next if e.match_type == "literal" && e.from_text == e.to_text
        by_key[key] = { from: e.from_text, to: e.to_text, match_type: e.match_type }
      end
    end

    entries  = by_key.values
    literals = entries.select { |e| e[:match_type] == "literal" }.sort_by { |e| -e[:from].length }
    regexes  = entries.select { |e| e[:match_type] == "regex" }
    literals + regexes
  end

  private

  def levels
    result = [@meeting]
    if @meeting.folder
      result << @meeting.folder
      result.concat(@meeting.folder.ancestor_records)
    end
    result
  end
end
