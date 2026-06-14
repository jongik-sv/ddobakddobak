require "rails_helper"

# 이전 회의 참고(시드+이어쓰기)가 요약 잡에 배선됐는지 검증.
RSpec.describe MeetingSummarizationJob, "이전 회의 참고 시드" do
  let(:user)     { create(:user) }
  let(:team)     { create(:team, creator: user) }
  let(:previous) { create(:meeting, team: team, creator: user, status: "completed") }

  before do
    create(:summary, meeting: previous, summary_type: "final",
           notes_markdown: "## 지난 회의\n- 결정: A안", generated_at: 1.day.ago)
  end

  context "증분 모드(append): 이전 시드 위에 현재 블록을 덧붙인다" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording",
             summary_restructure: false, previous_meeting: previous)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "오늘 발화", applied_to_minutes: false)
    end

    it "seeds previous notes (frozen above marker) and appends today's block below" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 오늘 새 논의", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      notes = meeting.summaries.find_by(summary_type: "realtime").notes_markdown
      expect(notes).to include("## 지난 회의") # 이전 회의록 보존
      expect(notes).to include(Meeting::PREVIOUS_MEETING_MARKER)
      expect(notes).to include("오늘 새 논의")
      expect(notes.index(Meeting::PREVIOUS_MEETING_MARKER)).to be < notes.index("오늘 새 논의")
    end
  end

  context "재구조화 모드(refine): seeded_from_previous 플래그 전달" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording",
             summary_restructure: true, previous_meeting: previous)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "오늘 발화", applied_to_minutes: false)
    end

    it "passes seeded_from_previous: true to refine_notes" do
      received = nil
      allow_any_instance_of(LlmService).to receive(:refine_notes) do |_obj, *_args, **kwargs|
        received = kwargs
        { "notes_markdown" => "## 통합 회의록", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:seeded_from_previous]).to be(true)
    end
  end

  context "이전 회의 미지정 회의" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording", summary_restructure: true)
    end

    before do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    end

    it "passes seeded_from_previous: false (시드 없음)" do
      received = nil
      allow_any_instance_of(LlmService).to receive(:refine_notes) do |_obj, *_args, **kwargs|
        received = kwargs
        { "notes_markdown" => "## 회의록", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(received[:seeded_from_previous]).to be(false)
    end
  end
end
