require "rails_helper"

# 안건 자료 1회 주입:
# - realtime/타이머 경로는 agenda_reference_applied_at 이 nil 일 때(업로드 후 첫 요약)만 주입하고,
#   성공하면 플래그를 채워 이후 틱에는 재주입하지 않는다.
# - final(종료·재생성) 경로는 플래그와 무관하게 항상 안건 전체를 주입한다.
RSpec.describe MeetingSummarizationJob, "agenda reference injection" do
  let(:user)    { create(:user) }
  let(:team)    { create(:team, creator: user) }

  def stub_refine_capturing
    captured = []
    allow_any_instance_of(LlmService).to receive(:refine_notes) do |_svc, *_args, **kwargs|
      captured << kwargs[:agenda_reference]
      { "notes_markdown" => "## 회의록\n- 내용", "ok" => true }
    end
    captured
  end

  describe "realtime path" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording",
             agenda_reference: "1. 예산안 검토")
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "injects the agenda reference on the first tick and marks it applied" do
      captured = stub_refine_capturing

      described_class.perform_now(meeting.id, type: "realtime")

      expect(captured).to eq([ "1. 예산안 검토" ])
      expect(meeting.reload.agenda_reference_applied_at).to be_present
    end

    it "does NOT re-inject once the agenda was already applied" do
      meeting.update_column(:agenda_reference_applied_at, 1.minute.ago)
      captured = stub_refine_capturing

      described_class.perform_now(meeting.id, type: "realtime")

      expect(captured).to eq([ nil ])
    end
  end

  describe "final path" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "completed",
             agenda_reference: "1. 예산안 검토",
             agenda_reference_applied_at: 1.minute.ago)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "always injects the full agenda reference regardless of the applied flag" do
      captured = stub_refine_capturing

      described_class.perform_now(meeting.id, type: "final")

      expect(captured).to eq([ "1. 예산안 검토" ])
    end
  end
end
