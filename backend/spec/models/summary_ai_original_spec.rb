require "rails_helper"

RSpec.describe Summary, "AI 원본 보관" do
  it "write_ai_final! 은 notes 와 ai_notes 를 같은 값으로, human_edited_at 은 nil 로" do
    s = create(:summary, summary_type: "final", human_edited_at: 1.hour.ago)
    expect(s.write_ai_final!("# AI")).to eq(true)
    expect(s.reload).to have_attributes(notes_markdown: "# AI", ai_notes_markdown: "# AI", human_edited_at: nil)
    expect(s.ai_generated_at).to be_present
  end

  it "새 레코드도 write_ai_final! 로 저장된다" do
    m = create(:meeting)
    s = m.summaries.find_or_initialize_by(summary_type: "final")
    s.write_ai_final!("# new")
    expect(s).to be_persisted
    expect(s.ai_notes_markdown).to eq("# new")
  end

  it "mark_human_edited! 는 iso8601(6) 문자열을 반환하고 DB 값과 일치한다" do
    s = create(:summary, summary_type: "final")
    str = s.mark_human_edited!
    expect(str).to eq(s.reload.human_edited_at.iso8601(6))
  end

  describe "#learnable?" do
    it "final + ai_notes 있음" do
      expect(build(:summary, summary_type: "final", ai_notes_markdown: "x")).to be_learnable
    end
    it "realtime 이면 아님" do
      expect(build(:summary, summary_type: "realtime", ai_notes_markdown: "x")).not_to be_learnable
    end
    it "ai_notes 없으면 아님" do
      expect(build(:summary, summary_type: "final", ai_notes_markdown: nil)).not_to be_learnable
    end
  end
end
