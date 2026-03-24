require "rails_helper"

RSpec.describe SummarizationJob, type: :job do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user, status: "recording") }

  describe "#perform" do
    context "when there are recording meetings" do
      before { meeting }

      it "enqueues MeetingSummarizationJob for each recording meeting" do
        expect {
          described_class.new.perform
        }.to have_enqueued_job(MeetingSummarizationJob).with(meeting.id, type: "realtime")
      end

      it "only processes recording meetings" do
        completed_meeting = create(:meeting, team: team, creator: user, status: "completed")
        expect {
          described_class.new.perform
        }.to have_enqueued_job(MeetingSummarizationJob).with(meeting.id, type: "realtime")
        expect {
          described_class.new.perform
        }.not_to have_enqueued_job(MeetingSummarizationJob).with(completed_meeting.id, type: "realtime")
      end
    end

    context "when there are multiple recording meetings" do
      let(:meeting2) { create(:meeting, team: team, creator: user, status: "recording") }

      before do
        meeting
        meeting2
      end

      it "enqueues MeetingSummarizationJob for each meeting" do
        expect {
          described_class.new.perform
        }.to have_enqueued_job(MeetingSummarizationJob).exactly(2).times
      end
    end

    context "when there are no recording meetings" do
      it "does not enqueue any jobs" do
        expect {
          described_class.new.perform
        }.not_to have_enqueued_job(MeetingSummarizationJob)
      end
    end
  end
end
