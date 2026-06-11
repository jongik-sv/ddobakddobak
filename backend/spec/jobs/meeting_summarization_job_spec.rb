require "rails_helper"

RSpec.describe MeetingSummarizationJob do
  let(:user)    { create(:user) }
  let(:team)    { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user, status: "recording") }

  before do
    create(:transcript, meeting: meeting, sequence_number: 1, content: "첫 발화", applied_to_minutes: false)
    create(:transcript, meeting: meeting, sequence_number: 2, content: "둘째 발화", applied_to_minutes: false)
  end

  describe "realtime path" do
    it "saves the realtime summary and consumes transcripts" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 통짜 회의록\n- 내용", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.summaries.find_by(summary_type: "realtime").notes_markdown).to include("통짜")
      expect(meeting.transcripts.where(applied_to_minutes: true).count).to eq(2)
    end

    it "does NOT consume transcripts when refine_notes returns ok:false (D8 anchor-C1)" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(2)
    end
  end

  describe "final path — ok:false 가드" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "completed") }

    # R3 final ok 가드: transient LLM 실패(ok:false) 시 final summary 미생성·transcripts 미소비
    # 상위 before 블록이 이 meeting 에도 transcript 2건을 추가하므로 별도 생성 불필요.
    it "does NOT save final summary or consume transcripts when refine_notes returns ok:false" do
      total_unapplied = meeting.transcripts.where(applied_to_minutes: false).count

      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false })

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.summaries.find_by(summary_type: "final")).to be_nil
      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(total_unapplied)
    end
  end

  # 실전 재현 버그: stop 직후 realtime 틱이 락 점유 → final try_lock 실패 → 무음 드랍.
  # 수정: final은 재enqueue (realtime은 cron이 다시 오므로 드랍 유지).
  describe "final lock contention (dev :async)" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "completed") }

    it "re-enqueues final instead of dropping when the in-process lock is busy" do
      mutex = described_class::MEETING_LOCKS.compute_if_absent(meeting.id) { Mutex.new }
      mutex.lock
      begin
        expect {
          described_class.perform_now(meeting.id, type: "final")
        }.to have_enqueued_job(described_class).with(meeting.id, type: "final")
      ensure
        mutex.unlock
        described_class::MEETING_LOCKS.delete(meeting.id)
      end
    end

    it "still drops realtime quietly on lock contention (cron retries next minute)" do
      mutex = described_class::MEETING_LOCKS.compute_if_absent(meeting.id) { Mutex.new }
      mutex.lock
      begin
        expect {
          described_class.perform_now(meeting.id, type: "realtime")
        }.not_to have_enqueued_job(described_class)
      ensure
        mutex.unlock
        described_class::MEETING_LOCKS.delete(meeting.id)
      end
    end
  end
end
