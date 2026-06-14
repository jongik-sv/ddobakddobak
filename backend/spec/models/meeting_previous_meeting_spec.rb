require "rails_helper"

# 이전 회의 참고(시드+이어쓰기): Meeting#seed_summary_from_previous! + 자기참조 검증
RSpec.describe Meeting, type: :model do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }

  describe "#seed_summary_from_previous!" do
    let(:previous) { create(:meeting, team: team, creator: user, status: "completed") }
    let(:meeting)  { create(:meeting, team: team, creator: user, status: "recording", previous_meeting: previous) }

    before do
      create(:summary, meeting: previous, summary_type: "final",
             notes_markdown: "## 지난 회의\n- 결정: A안 채택", generated_at: 1.day.ago)
    end

    it "재구조화(기본): 이전 회의록 base만 시드(절취선 없음 — LLM이 논의에 삽입)" do
      meeting.seed_summary_from_previous!(summary_type: "realtime")

      seeded = meeting.summaries.order(:id).last
      expect(seeded).to be_present
      expect(seeded.summary_type).to eq("realtime")
      expect(seeded.notes_markdown).to include("## 지난 회의")
      expect(seeded.notes_markdown).to include("결정: A안 채택")
      expect(seeded.notes_markdown).not_to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
      expect(seeded.notes_markdown.rstrip).to end_with("결정: A안 채택")
    end

    it "증분도 동일하게 base만 시드(절취선은 시드에 안 넣음)" do
      meeting.update!(summary_restructure: false)
      meeting.seed_summary_from_previous!(summary_type: "realtime")

      seeded = meeting.summaries.order(:id).last
      expect(seeded.notes_markdown).to include("## 지난 회의")
      expect(seeded.notes_markdown).not_to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
      expect(seeded.notes_markdown.rstrip).to end_with("결정: A안 채택")
    end

    it "honors the summary_type argument (final)" do
      meeting.seed_summary_from_previous!(summary_type: "final")
      expect(meeting.summaries.last.summary_type).to eq("final")
    end

    it "is idempotent — no-op when a summary already exists" do
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 진행 중", generated_at: Time.current)
      expect { meeting.seed_summary_from_previous! }.not_to change { meeting.summaries.count }
    end

    it "no-ops when previous_meeting is nil" do
      solo = create(:meeting, team: team, creator: user, status: "recording")
      expect { solo.seed_summary_from_previous! }.not_to change { solo.summaries.count }
    end

    it "no-ops when the previous meeting has no notes" do
      blank_prev = create(:meeting, team: team, creator: user, status: "completed")
      m = create(:meeting, team: team, creator: user, status: "recording", previous_meeting: blank_prev)
      expect { m.seed_summary_from_previous! }.not_to change { m.summaries.count }
    end
  end

  describe "previous_meeting self-reference validation" do
    it "rejects referencing itself" do
      m = create(:meeting, team: team, creator: user)
      m.previous_meeting_id = m.id
      expect(m).not_to be_valid
      expect(m.errors[:previous_meeting_id]).to be_present
    end

    it "allows referencing another meeting" do
      prev = create(:meeting, team: team, creator: user)
      m = create(:meeting, team: team, creator: user)
      m.previous_meeting_id = prev.id
      expect(m).to be_valid
    end
  end
end
