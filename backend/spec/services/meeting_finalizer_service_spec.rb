require "rails_helper"

RSpec.describe MeetingFinalizerService do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user, status: "completed") }
  let(:llm_double) { instance_double(LlmService) }

  let(:action_items_result) do
    { "action_items" => [{ "content" => "item1" }, { "content" => "item2" }] }
  end

  let(:summarize_result) do
    { "decisions" => ["결정사항 1", "결정사항 2"], "key_points" => [], "discussion_details" => [], "action_items" => [] }
  end

  before do
    allow(LlmService).to receive(:new).and_return(llm_double)
    allow(llm_double).to receive(:summarize_action_items).and_return(action_items_result)
    allow(llm_double).to receive(:summarize).and_return(summarize_result)
    create(:transcript, meeting: meeting)
  end

  describe "#call" do
    it "calls LlmService#summarize_action_items with transcript payload" do
      expect(llm_double).to receive(:summarize_action_items).with(
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
        expect(llm_double).not_to receive(:summarize_action_items)
        described_class.new(meeting_no_transcripts).call
      end
    end

    context "when LlmService raises an error" do
      before do
        allow(llm_double).to receive(:summarize_action_items).and_raise(StandardError, "Connection error")
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
        allow(llm_double).to receive(:summarize_action_items).and_return({ "action_items" => [] })
      end

      it "creates no action items" do
        expect {
          described_class.new(meeting).call
        }.not_to change(ActionItem, :count)
      end
    end

    # Decision 추출 테스트
    it "calls LlmService#summarize to extract decisions" do
      expect(llm_double).to receive(:summarize).with(
        array_including(hash_including(speaker: anything, text: anything, started_at_ms: anything)),
        type: "final"
      )
      described_class.new(meeting).call
    end

    it "creates decisions with ai_generated: true" do
      expect {
        described_class.new(meeting).call
      }.to change { meeting.decisions.where(ai_generated: true).count }.by(2)
    end

    it "creates decisions with correct content" do
      described_class.new(meeting).call
      contents = meeting.decisions.pluck(:content)
      expect(contents).to include("결정사항 1", "결정사항 2")
    end

    it "creates decisions with status 'active'" do
      described_class.new(meeting).call
      meeting.decisions.each do |d|
        expect(d.status).to eq("active")
      end
    end

    context "when decisions result is empty" do
      before do
        allow(llm_double).to receive(:summarize).and_return({ "decisions" => [] })
      end

      it "creates no decisions" do
        expect {
          described_class.new(meeting).call
        }.not_to change(Decision, :count)
      end
    end
  end
end
