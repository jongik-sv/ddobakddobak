require "diff/lcs"

module SttTermLearning
  # AI 원본 ↔ 사람 최종본 줄 단위 diff.
  # 인용 마커(⟦t:.../s:...⟧)는 diff 전에 지워 마커만 다른 줄이 hunk 로 잡히지 않게 한다.
  module LineDiff
    module_function

    # -> [{op: "equal"|"delete"|"insert", text: String}]
    # sdiff 의 "!"(change)는 delete + insert 두 op 로 펼친다.
    def ops(a_text, b_text)
      a = lines(a_text)
      b = lines(b_text)
      Diff::LCS.sdiff(a, b).flat_map do |c|
        case c.action
        when "=" then [ { op: "equal", text: c.old_element } ]
        when "-" then [ { op: "delete", text: c.old_element } ]
        when "+" then [ { op: "insert", text: c.new_element } ]
        when "!" then [ { op: "delete", text: c.old_element }, { op: "insert", text: c.new_element } ]
        end
      end
    end

    # 연속된 비-equal op 묶음 -> [{removed: [String], added: [String]}]
    # 공백만 다른 줄 쌍(removed[i] ↔ added[i])과 빈 줄은 빼고, 남는 줄이 없는 hunk 는 버린다.
    def hunks(ops)
      ops.chunk_while { |x, y| x[:op] != "equal" && y[:op] != "equal" }
         .reject { |group| group.first[:op] == "equal" }
         .filter_map { |group| clean_hunk(group) }
    end

    def lines(text)
      LlmPrompts::CitationMarkers.strip_all(text).split("\n", -1).map(&:rstrip)
    end

    def clean_hunk(group)
      removed = group.select { _1[:op] == "delete" }.map { _1[:text] }
      added = group.select { _1[:op] == "insert" }.map { _1[:text] }

      # 같은 위치의 줄 쌍이 공백만 다르면 둘 다 뺀다.
      keep = Array.new([ removed.size, added.size ].max, true)
      [ removed.size, added.size ].min.times do |i|
        keep[i] = false if squash(removed[i]) == squash(added[i])
      end
      removed = removed.each_with_index.select { |l, i| keep[i] && l.strip.present? }.map(&:first)
      added = added.each_with_index.select { |l, i| keep[i] && l.strip.present? }.map(&:first)

      return nil if removed.empty? && added.empty?
      { removed: removed, added: added }
    end

    def squash(line)
      line.to_s.gsub(/\s+/, "")
    end
  end
end
