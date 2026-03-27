require "rails_helper"

RSpec.describe MeetingFinalizerService do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user, status: "completed") }
  let(:client_double) { instance_double(SidecarClient) }

  let(:action_items_result) do
    { "action_items" => [{ "content" => "item1" }, { "content" => "item2" }] }
  end

  before do
    allow(SidecarClient).to receive(:new).and_return(client_double)
    allow(client_double).to receive(:summarize_action_items).and_return(action_items_result)
    create(:transcript, meeting: meeting)
  end

  describe "#call" do
    it "calls SidecarClient#summarize_action_items with transcript payload" do
      expect(client_double).to receive(:summarize_action_items).with(
        array_including(hash_including(speaker: anything, text: anything, started_at_ms: anything))
      )
      described_class.new(meeting).call
    end

    it "creates action items with ai_generated: true" do
      expect {
        described_class.new(meeting).call
      }.to change { meeting.action_items.where(ai_generated: true).count }.by(2)
    end

    it "creates action items with correct content" do
      described_class.new(meeting).call
      contents = meeting.action_items.pluck(:content)
      expect(contents).to include("item1", "item2")
    end

    it "creates action items with status 'todo'" do
      described_class.new(meeting).call
      meeting.action_items.each do |item|
        expect(item.status).to eq("todo")
      end
    end

    context "when meeting has no transcripts" do
      let(:meeting_no_transcripts) { create(:meeting, team: team, creator: user, status: "completed") }

      it "does not call summarize_action_items" do
        expect(client_double).not_to receive(:summarize_action_items)
        described_class.new(meeting_no_transcripts).call
      end
    end

    context "when SidecarClient raises SidecarError" do
      before do
        allow(client_double).to receive(:summarize_action_items).and_raise(SidecarClient::SidecarError, "Connection error")
        allow(Rails.logger).to receive(:error)
      end

      it "does not raise" do
        expect { described_class.new(meeting).call }.not_to raise_error
      end

      it "logs the error" do
        expect(Rails.logger).to receive(:error).with(/MeetingFinalizerService/)
        described_class.new(meeting).call
      end

      it "does not create any action items" do
        expect {
          described_class.new(meeting).call
        }.not_to change(ActionItem, :count)
      end
    end

    context "when action_items result is empty" do
      before do
        allow(client_double).to receive(:summarize_action_items).and_return({ "action_items" => [] })
      end

      it "creates no action items" do
        expect {
          described_class.new(meeting).call
        }.not_to change(ActionItem, :count)
      end
    end
  end
end
