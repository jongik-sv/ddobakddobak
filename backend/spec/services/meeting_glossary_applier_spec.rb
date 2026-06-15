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

    it "action_items / decisions(연관) / blocks / summary 전 컬럼을 교정한다" do
      create(:action_item, meeting: meeting, content: "회진 액션")
      create(:decision, meeting: meeting, content: "회진 결정")
      create(:block, meeting: meeting, content: "회진 블록")
      summary = meeting.summaries.first
      summary.update!(key_points: "회진 포인트", discussion_details: "회진 상세")

      MeetingGlossaryApplier.new(meeting, entries).apply_all!

      expect(meeting.action_items.first.reload.content).to eq("회의 액션")
      expect(meeting.decisions.first.reload.content).to eq("회의 결정")
      expect(meeting.blocks.first.reload.content).to eq("회의 블록")
      expect(summary.reload.key_points).to eq("회의 포인트")
      expect(summary.reload.discussion_details).to eq("회의 상세")
    end

    it "변경된 summary 는 generated_at 을 갱신한다" do
      summary = meeting.summaries.first
      old = 1.day.ago
      summary.update!(generated_at: old)
      MeetingGlossaryApplier.new(meeting, entries).apply_all!
      expect(summary.reload.generated_at).to be > old
    end
  end
end
