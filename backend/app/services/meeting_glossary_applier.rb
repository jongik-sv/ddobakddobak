# 교정 엔트리를 회의의 텍스트 표면에 적용한다.
# - apply_transcripts! : 트랜스크립트만 (전사 직후 훅용 — 이후 요약은 교정본에서 생성)
# - apply_all!         : 요약 4컬럼 + blocks + transcripts (수동 재적용/feedback)
# 둘 다 트랜스크립트 변경 건수를 반환한다.
#
# 요약 4컬럼과 blocks.content 는 인용 마커(⟦t:.../s:...⟧)를 담을 수 있는 표면이라
# GlossaryApplication.apply_protecting_markers 로 마커를 보호하며 적용한다(실서버에서
# "250"→"임가공" 같은 사전 항목이 ⟦t:1056250/...⟧ 내부 숫자를 오염시킨 사고가 실증됨).
# 반대로 transcripts.content 는 전사 원문이라 마커가 애초에 존재하지 않고(마커는 요약
# 생성 시점에 LLM이 붙이는 것) 전사 텍스트 자체가 오타 교정의 대상이므로, 보호를 걸면
# 안 되고 기존 GlossaryApplication.apply(비보호)를 그대로 써야 한다.
class MeetingGlossaryApplier
  SUMMARY_COLS = %i[notes_markdown key_points decisions discussion_details].freeze

  def initialize(meeting, entries)
    @meeting = meeting
    @entries = entries
  end

  def apply_transcripts!
    correct_records!(@meeting.transcripts, :content, protect_markers: false)
  end

  def apply_all!
    return 0 if @entries.blank?

    @meeting.summaries.find_each do |summary|
      attrs = {}
      SUMMARY_COLS.each do |col|
        original = summary[col]
        next if original.blank?
        corrected = GlossaryApplication.apply_protecting_markers(original, @entries)
        attrs[col] = corrected if corrected != original
      end
      if attrs.any?
        attrs[:generated_at] = Time.current
        summary.update!(attrs)
      end
    end

    correct_records!(@meeting.blocks, :content, protect_markers: true)
    correct_records!(@meeting.transcripts, :content, protect_markers: false)
  end

  private

  def correct_records!(relation, column, protect_markers:)
    return 0 if @entries.blank?
    changed = 0
    relation.find_each do |record|
      original = record[column]
      next if original.blank?
      corrected =
        if protect_markers
          GlossaryApplication.apply_protecting_markers(original, @entries)
        else
          GlossaryApplication.apply(original, @entries)
        end
      if corrected != original
        record.update!(column => corrected)
        changed += 1
      end
    end
    changed
  end
end
