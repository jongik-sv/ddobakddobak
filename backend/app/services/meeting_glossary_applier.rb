# 교정 엔트리를 회의의 텍스트 표면에 적용한다.
# - apply_transcripts! : 트랜스크립트만 (전사 직후 훅용 — 이후 요약은 교정본에서 생성)
# - apply_all!         : 요약 4컬럼 + action_items + decisions + blocks + transcripts (수동 재적용/feedback)
# 둘 다 트랜스크립트 변경 건수를 반환한다.
class MeetingGlossaryApplier
  SUMMARY_COLS = %i[notes_markdown key_points decisions discussion_details].freeze

  def initialize(meeting, entries)
    @meeting = meeting
    @entries = entries
  end

  def apply_transcripts!
    correct_records!(@meeting.transcripts, :content)
  end

  def apply_all!
    return 0 if @entries.blank?

    @meeting.summaries.find_each do |summary|
      attrs = {}
      SUMMARY_COLS.each do |col|
        original = summary[col]
        next if original.blank?
        corrected = GlossaryApplication.apply(original, @entries)
        attrs[col] = corrected if corrected != original
      end
      if attrs.any?
        attrs[:generated_at] = Time.current
        summary.update!(attrs)
      end
    end

    correct_records!(@meeting.action_items, :content)
    correct_records!(@meeting.decisions, :content)
    correct_records!(@meeting.blocks, :content)
    correct_records!(@meeting.transcripts, :content)
  end

  private

  def correct_records!(relation, column)
    return 0 if @entries.blank?
    changed = 0
    relation.find_each do |record|
      original = record[column]
      next if original.blank?
      corrected = GlossaryApplication.apply(original, @entries)
      if corrected != original
        record.update!(column => corrected)
        changed += 1
      end
    end
    changed
  end
end
