require "rails_helper"

RSpec.describe MeetingGlossaryApplier do
  let(:meeting) { create(:meeting) }
  let(:entries) { [{ from: "회진", to: "회의", match_type: "literal" }] }

  before do
    create(:transcript, meeting: meeting, content: "회진 시작")
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회진 노트")
  end

  describe "#apply_transcripts!" do
    it "트랜스크립트만 교정하고 건수 반환" do
      count = MeetingGlossaryApplier.new(meeting, entries).apply_transcripts!
      expect(count).to eq(1)
      expect(meeting.transcripts.first.content).to eq("회의 시작")
      expect(meeting.summaries.first.notes_markdown).to eq("회진 노트") # 미변경
    end
  end

  describe "#apply_all!" do
    it "전 표면(요약+트랜스크립트) 교정" do
      MeetingGlossaryApplier.new(meeting, entries).apply_all!
      expect(meeting.transcripts.first.content).to eq("회의 시작")
      expect(meeting.summaries.first.reload.notes_markdown).to eq("회의 노트")
    end

    it "빈 엔트리면 아무것도 안 함" do
      expect { MeetingGlossaryApplier.new(meeting, []).apply_all! }.not_to(change { meeting.transcripts.first.content })
    end
  end
end
