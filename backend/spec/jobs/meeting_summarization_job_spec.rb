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

  # 증분(append-only) 모드: summary_restructure=false → 앞 내용 불변, 시간대별 블록만 추가
  describe "incremental mode (summary_restructure: false)" do
    let(:meeting) do
      create(:meeting, team: team, creator: user, status: "recording", summary_restructure: false)
    end

    it "appends a time-block to existing notes without rewriting them" do
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 기존 회의록\n\n- 앞선 결정", generated_at: 5.minutes.ago)
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 새 논의 내용", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      notes = meeting.summaries.find_by(summary_type: "realtime").reload.notes_markdown
      expect(notes).to start_with("## 기존 회의록\n\n- 앞선 결정")
      expect(notes).to include("### ⏱ ")
      expect(notes).to end_with("- 새 논의 내용")
      expect(meeting.transcripts.where(applied_to_minutes: true).count).to eq(2)
    end

    it "does NOT consume transcripts when append_notes returns ok:false" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "", "ok" => false })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(2)
      expect(meeting.summaries.find_by(summary_type: "realtime")).to be_nil
    end

    it "final promotes current notes append-only (no full rewrite)" do
      meeting.update_column(:status, "completed")
      meeting.transcripts.update_all(applied_to_minutes: true)
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 시간대별 기록\n\n- 그대로 보존", generated_at: 1.minute.ago)

      expect_any_instance_of(LlmService).not_to receive(:refine_notes)
      expect_any_instance_of(LlmService).not_to receive(:append_notes) # 남은 자막 없음

      described_class.perform_now(meeting.id, type: "final")

      final = meeting.summaries.find_by(summary_type: "final")
      expect(final.notes_markdown).to eq("## 시간대별 기록\n\n- 그대로 보존")
    end

    it "consumes transcripts when block is empty and no notes exist yet (재요약 루프 방지)" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(0)
      expect(meeting.summaries.find_by(summary_type: "realtime")).to be_nil
    end

    it "final rebuilds from scratch (whole-pass fallback) when notes were wiped (회의록 재생성)" do
      meeting.update_column(:status, "completed")
      meeting.transcripts.update_all(applied_to_minutes: true) # 전부 소비됨 + 요약 0건 (regenerate_notes 직후)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 재생성된 회의록", "ok" => true })
      expect_any_instance_of(LlmService).not_to receive(:append_notes)

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to eq("## 재생성된 회의록")
    end

    it "final uses the latest summary as base, not the stale final (reopen 후 stop)" do
      meeting.update_column(:status, "completed")
      meeting.transcripts.update_all(applied_to_minutes: true)
      create(:summary, meeting: meeting, summary_type: "final",
             notes_markdown: "## 옛 최종", generated_at: 30.minutes.ago)
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 옛 최종\n\n### ⏱ 10:00–11:00\n\n- 재개 세션 블록",
             generated_at: 1.minute.ago)

      described_class.perform_now(meeting.id, type: "final")

      final = meeting.summaries.find_by(summary_type: "final")
      expect(final.notes_markdown).to include("재개 세션 블록")
    end

    it "final appends remaining unapplied transcripts as a last block" do
      meeting.update_column(:status, "completed")
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 기존", generated_at: 1.minute.ago)
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 마지막 발화 정리", "ok" => true })

      described_class.perform_now(meeting.id, type: "final")

      final = meeting.summaries.find_by(summary_type: "final")
      expect(final.notes_markdown).to start_with("## 기존")
      expect(final.notes_markdown).to end_with("- 마지막 발화 정리")
      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(0)
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
