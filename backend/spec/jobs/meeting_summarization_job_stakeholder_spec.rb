require "rails_helper"

# 이해관계자 정보 1회 주입:
# - realtime/타이머 경로는 stakeholder_reference_applied_at 이 nil 일 때(업로드 후 첫 요약)만
#   주입하고, 성공하면 플래그를 채워 이후 틱에는 재주입하지 않는다.
# - final(종료·재생성) 경로는 플래그와 무관하게 항상 이해관계자 정보 전체를 주입한다.
# meeting_summarization_job_agenda_spec.rb 미러.
RSpec.describe MeetingSummarizationJob, "stakeholder reference injection" do
  let(:user)    { create(:user) }
  let(:project)    { create(:project, creator: user) }

  def stub_refine_capturing
    captured = []
    allow_any_instance_of(LlmService).to receive(:refine_notes) do |_svc, *_args, **kwargs|
      captured << kwargs[:stakeholder_reference]
      { "notes_markdown" => "## 회의록\n- 내용", "ok" => true }
    end
    captured
  end

  describe "realtime path" do
    let(:meeting) do
      create(:meeting, project: project, creator: user, status: "recording",
             stakeholder_reference: "김철수 / 기획팀 / 팀장")
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "injects the stakeholder reference on the first tick and marks it applied" do
      captured = stub_refine_capturing

      described_class.perform_now(meeting.id, type: "realtime")

      expect(captured).to eq([ "김철수 / 기획팀 / 팀장" ])
      expect(meeting.reload.stakeholder_reference_applied_at).to be_present
    end

    it "does NOT re-inject once the stakeholder reference was already applied" do
      meeting.update_column(:stakeholder_reference_applied_at, 1.minute.ago)
      captured = stub_refine_capturing

      described_class.perform_now(meeting.id, type: "realtime")

      expect(captured).to eq([ nil ])
    end
  end

  describe "final path" do
    let(:meeting) do
      create(:meeting, project: project, creator: user, status: "completed",
             stakeholder_reference: "김철수 / 기획팀 / 팀장",
             stakeholder_reference_applied_at: 1.minute.ago)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "always injects the full stakeholder reference regardless of the applied flag" do
      captured = stub_refine_capturing

      described_class.perform_now(meeting.id, type: "final")

      expect(captured).to eq([ "김철수 / 기획팀 / 팀장" ])
    end
  end
end
