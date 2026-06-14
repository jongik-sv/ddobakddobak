require "rails_helper"

# 이전 회의 참고(시드+병합)가 요약 잡에 배선됐는지 검증.
RSpec.describe MeetingSummarizationJob, "이전 회의 참고 시드" do
  let(:user)     { create(:user) }
  let(:team)     { create(:team, creator: user) }
  let(:previous) { create(:meeting, team: team, creator: user, status: "completed") }

  before do
    create(:summary, meeting: previous, summary_type: "final",
           notes_markdown: "## 지난 회의\n- 결정: A안", generated_at: 1.day.ago)
  end

  context "연결 + 증분: refine 병합 + 논의 절취선(seeded_merge:true)" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording",
             summary_restructure: false, previous_meeting: previous)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "오늘 발화", applied_to_minutes: false)
    end

    it "calls refine_notes with seeded_merge: true and previous notes as base" do
      received = {}
      allow_any_instance_of(LlmService).to receive(:refine_notes) do |_obj, current_notes, *_args, **kwargs|
        received[:notes] = current_notes
        received[:kwargs] = kwargs
        { "notes_markdown" => "## 통합 회의록", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:kwargs][:seeded_merge]).to be(true)
      expect(received[:notes]).to include("## 지난 회의")
      expect(received[:notes]).not_to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
    end

    it "does not use append_notes (증분이지만 연결이면 refine 병합)" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 통합", "ok" => true })
      expect_any_instance_of(LlmService).not_to receive(:append_notes)

      described_class.perform_now(meeting.id, type: "realtime")
    end
  end

  context "연결 + 재구조화: 완전 병합(seeded_merge:false, 절취선 없음)" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording",
             summary_restructure: true, previous_meeting: previous)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "오늘 발화", applied_to_minutes: false)
    end

    it "calls refine_notes with seeded_merge falsy and base merged" do
      received = {}
      allow_any_instance_of(LlmService).to receive(:refine_notes) do |_obj, current_notes, *_args, **kwargs|
        received[:notes] = current_notes
        received[:kwargs] = kwargs
        { "notes_markdown" => "## 통합 회의록", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:kwargs][:seeded_merge]).to be_falsy
      expect(received[:notes]).to include("## 지난 회의")
    end
  end

  context "비연결 + 증분: append-only 유지" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording", summary_restructure: false)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "uses append_notes (refine 안 씀)" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 새 논의", "ok" => true })
      expect_any_instance_of(LlmService).not_to receive(:refine_notes)

      described_class.perform_now(meeting.id, type: "realtime")
    end
  end
end
