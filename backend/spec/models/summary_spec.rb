require "rails_helper"

RSpec.describe Summary, type: :model do
  let(:user)    { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user) }

  describe "FTS indexing" do
    it "FTS 인덱싱 값에서 마커를 제거한다" do
      Summary.ensure_fts_tables!
      s = meeting.summaries.create!(
        summary_type: "final",
        generated_at: Time.current,
        notes_markdown: "결정 보류 ⟦t:125000|s:화자 1⟧"
      )
      row = ActiveRecord::Base.connection.execute(
        "SELECT notes_markdown FROM summaries_fts WHERE source_id = #{s.id}"
      ).first
      expect(row["notes_markdown"]).not_to include("⟦t:")
    end

    it "마커가 없는 일반 텍스트는 그대로 인덱싱된다" do
      Summary.ensure_fts_tables!
      s = meeting.summaries.create!(
        summary_type: "final",
        generated_at: Time.current,
        notes_markdown: "일반 결정 사항 내용"
      )
      row = ActiveRecord::Base.connection.execute(
        "SELECT notes_markdown FROM summaries_fts WHERE source_id = #{s.id}"
      ).first
      expect(row["notes_markdown"]).to eq("일반 결정 사항 내용")
    end

    it "마커가 여러 개 있을 때 모두 제거된다" do
      Summary.ensure_fts_tables!
      s = meeting.summaries.create!(
        summary_type: "final",
        generated_at: Time.current,
        notes_markdown: "첫 항목 ⟦t:100|s:화자 1⟧ 두 번째 ⟦t:200|s:화자 2⟧ 완료"
      )
      row = ActiveRecord::Base.connection.execute(
        "SELECT notes_markdown FROM summaries_fts WHERE source_id = #{s.id}"
      ).first
      expect(row["notes_markdown"]).not_to include("⟦t:")
      expect(row["notes_markdown"]).to include("첫 항목")
      expect(row["notes_markdown"]).to include("두 번째")
    end
  end
end
