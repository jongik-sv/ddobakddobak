require "rails_helper"

# Meeting#active_summary — R4 상태 인지 (구현리뷰 useredit-M5)
# completed 회의는 final 하드 우선, 그 외(recording 등)는 최신 generated_at 우선
# (reopen 후 stale final 이 실시간 요약을 가리는 버그 방지)
RSpec.describe Meeting, type: :model do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }

  describe "#active_summary" do
    context "completed 회의: final 우선" do
      let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

      it "returns the final summary even when a newer realtime exists" do
        _realtime = create(:summary, meeting: meeting, summary_type: "realtime",
                           notes_markdown: "## 실시간 요약\n진행 중 내용",
                           generated_at: 5.minutes.ago)
        final_sum = create(:summary, meeting: meeting, summary_type: "final",
                           notes_markdown: "## 최종 요약\n최종 내용",
                           generated_at: 10.minutes.ago)  # generated_at 은 오래됐지만 final

        expect(meeting.active_summary).to eq(final_sum)
      end

      it "falls back to realtime when no final summary exists" do
        realtime = create(:summary, meeting: meeting, summary_type: "realtime",
                          notes_markdown: "## 실시간", generated_at: Time.current)
        expect(meeting.active_summary).to eq(realtime)
      end
    end

    context "recording 회의(reopen 시나리오): 최신 우선 (stale final 무시)" do
      let(:meeting) { create(:meeting, project: project, creator: user, status: "recording") }

      it "returns the realtime summary (newer generated_at) over a stale final" do
        # reopen 후 시나리오: final 은 오래됐고, realtime 이 더 최신
        _stale_final = create(:summary, meeting: meeting, summary_type: "final",
                              notes_markdown: "## 이전 최종",
                              generated_at: 30.minutes.ago)
        fresh_realtime = create(:summary, meeting: meeting, summary_type: "realtime",
                                notes_markdown: "## 재개 후 실시간",
                                generated_at: 1.minute.ago)

        expect(meeting.active_summary).to eq(fresh_realtime)
      end
    end
  end
end
