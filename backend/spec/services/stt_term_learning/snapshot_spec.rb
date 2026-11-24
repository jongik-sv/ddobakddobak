require "rails_helper"

RSpec.describe SttTermLearning::Snapshot do
  include ActiveJob::TestHelper

  let(:meeting) { create(:meeting) }
  let(:ai) { "# 회의록\n- 우판 압연" }
  let(:human) { "# 회의록\n- 후판 압연" }
  let!(:summary) do
    create(:summary, meeting: meeting, summary_type: "final", ai_notes_markdown: ai, notes_markdown: human)
  end

  before { allow(AppSettings).to receive(:refresh_env_if_changed!) }

  def digest(a = ai, h = human)
    Digest::SHA256.hexdigest("#{a}\u0000#{h}")
  end

  describe ".capture!" do
    it "AI 원본과 같으면 pre_overwrite 스냅샷 안 만듦" do
      summary.update!(notes_markdown: ai)
      expect(described_class.capture!(summary, trigger: "pre_overwrite")).to be_nil
      expect(SttTermLearningRun.count).to eq(0)
    end

    it "다르면 ai/human/전사 텍스트와 digest 를 담은 queued run 생성" do
      # Transcript default_scope(sequence_number) 가 먼저 걸리므로 순번·시각을 같은 순서로 둔다.
      create(:transcript, meeting: meeting, content: "둘째 우판", started_at_ms: 5000, sequence_number: 2)
      create(:transcript, meeting: meeting, content: "첫째", started_at_ms: 1000, sequence_number: 1)

      run = described_class.capture!(summary, trigger: "pre_overwrite")

      expect(run).to be_persisted
      expect(run).to have_attributes(
        meeting_id: meeting.id, summary_id: summary.id, trigger: "pre_overwrite", status: "queued",
        ai_text: ai, human_text: human, transcript_text: "첫째\n둘째 우판", input_digest: digest
      )
    end

    it "같은 digest 의 done run 이 있으면 idle·pre_overwrite 는 nil, manual(force) 은 생성" do
      create(:stt_term_learning_run, meeting: meeting, status: "done", input_digest: digest)

      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
      expect(described_class.capture!(summary, trigger: "pre_overwrite")).to be_nil
      expect(described_class.capture!(summary, trigger: "manual", force: true)).to be_persisted
    end

    it "1시간 안의 queued·running run 과 같은 digest 면 nil" do
      create(:stt_term_learning_run, meeting: meeting, status: "queued", input_digest: digest, created_at: 50.minutes.ago)
      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
      SttTermLearningRun.update_all(status: "running")
      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
    end

    it "오래된(2시간) running·queued run 은 막지 않는다" do
      stale = create(:stt_term_learning_run, meeting: meeting, status: "running", input_digest: digest, created_at: 2.hours.ago)
      expect(described_class.capture!(summary, trigger: "idle")).to be_persisted

      SttTermLearningRun.where.not(id: stale.id).delete_all
      stale.update_columns(status: "queued")
      expect(described_class.capture!(summary, trigger: "idle")).to be_persisted
    end

    it "llm_failed 로 끝난 done run 은 막지 않고, 다른 사유·사유 없음 done 은 막는다" do
      done = create(:stt_term_learning_run, meeting: meeting, status: "done", input_digest: digest, llm_skipped_reason: "llm_failed")
      expect(described_class.capture!(summary, trigger: "idle")).to be_persisted

      SttTermLearningRun.where.not(id: done.id).delete_all
      done.update_columns(llm_skipped_reason: "llm_not_configured")
      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
      done.update_columns(llm_skipped_reason: nil)
      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
    end

    it "reverted run 과 같은 digest 면 pre_overwrite 는 nil, failed run 과 같으면 생성" do
      reverted = create(:stt_term_learning_run, meeting: meeting, status: "reverted", input_digest: digest)
      expect(described_class.capture!(summary, trigger: "pre_overwrite")).to be_nil

      reverted.update!(status: "failed")
      expect(described_class.capture!(summary, trigger: "pre_overwrite")).to be_persisted
    end

    it "다른 회의의 같은 digest run 은 막지 않는다" do
      create(:stt_term_learning_run, status: "done", input_digest: digest)
      expect(described_class.capture!(summary, trigger: "idle")).to be_persisted
    end

    it "설정 off 면 nil" do
      allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => false, "idle_minutes" => 30, "min_confidence" => 0.6)
      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
    end

    it "realtime 행·ai_notes 없는 행은 nil" do
      realtime = create(:summary, meeting: meeting, summary_type: "realtime", ai_notes_markdown: ai, notes_markdown: human)
      expect(described_class.capture!(realtime, trigger: "idle")).to be_nil

      summary.update!(ai_notes_markdown: nil)
      expect(described_class.capture!(summary, trigger: "idle")).to be_nil
      expect(SttTermLearningRun.count).to eq(0)
    end
  end

  describe ".before_overwrite!" do
    it "활성 final 을 pre_overwrite 로 스냅샷하고 잡을 enqueue 한다" do
      run = nil
      expect { run = described_class.before_overwrite!(meeting) }
        .to change(SttTermLearningRun, :count).by(1)
      expect(run.trigger).to eq("pre_overwrite")
      expect(SttTermLearningJob).to have_been_enqueued.with(run_id: run.id)
    end

    it "final 이 없거나 스냅샷 조건이 안 되면 nil 이고 enqueue 안 함" do
      summary.update!(notes_markdown: ai)
      expect(described_class.before_overwrite!(meeting)).to be_nil
      summary.destroy!
      expect(described_class.before_overwrite!(meeting)).to be_nil
      expect(SttTermLearningJob).not_to have_been_enqueued
    end

    it "before_overwrite! 는 내부 예외가 나도 raise 하지 않고 nil" do
      allow(described_class).to receive(:capture!).and_raise(StandardError, "boom")
      allow(Rails.logger).to receive(:error)
      expect(described_class.before_overwrite!(meeting)).to be_nil
      expect(Rails.logger).to have_received(:error).with(include("boom"))
    end
  end

  describe ".manual!" do
    it "같은 digest 가 done 이어도 manual 로 생성하고 enqueue" do
      create(:stt_term_learning_run, meeting: meeting, status: "done", input_digest: digest)
      run = described_class.manual!(meeting)
      expect(run).to have_attributes(trigger: "manual", status: "queued")
      expect(SttTermLearningJob).to have_been_enqueued.with(run_id: run.id)
    end

    it "final 이 없으면 nil" do
      summary.destroy!
      expect(described_class.manual!(meeting)).to be_nil
    end
  end
end
