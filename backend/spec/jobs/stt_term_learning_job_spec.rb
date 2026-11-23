require "rails_helper"

RSpec.describe SttTermLearningJob, type: :job do
  include ActiveJob::TestHelper

  let(:meeting) { create(:meeting) }
  let!(:summary) do
    create(:summary, meeting: meeting, summary_type: "final",
           ai_notes_markdown: "- 우판 압연", notes_markdown: "- 후판 압연")
  end
  let(:llm) { instance_double(LlmService, model_name: "test-model", extract_stt_misrecognitions: []) }

  before do
    allow(AppSettings).to receive(:refresh_env_if_changed!)
    allow(LlmService).to receive(:new).and_return(llm)
  end

  it "테스트 어댑터로 돈다(왕복 검증의 전제)" do
    expect(ActiveJob::Base.queue_adapter).to be_a(ActiveJob::QueueAdapters::TestAdapter)
  end

  it "queue 는 default, 전역 직렬화 키" do
    job = described_class.new(summary_id: 1, edited_at: "x")
    expect(job.queue_name).to eq("default")
    expect(job.concurrency_key).to eq("SttTermLearningJob/stt_term_learning")
    expect(described_class.concurrency_limit).to eq(1)
    expect(described_class.concurrency_duration).to eq(15.minutes)
  end

  describe "디바운스 (enqueue→perform 왕복)" do
    it "편집 후 스케줄된 잡이 그대로 돌면 run 을 만든다" do
      iso = summary.mark_human_edited!
      SttTermLearning::Scheduler.schedule_idle!(summary, iso)
      expect { perform_enqueued_jobs }.to change(SttTermLearningRun, :count).by(1)
      run = SttTermLearningRun.last
      expect(run).to have_attributes(trigger: "idle", status: "done", summary_id: summary.id)
    end

    it "그 사이 다시 편집했으면 이전 잡은 스킵(새 잡만 run 생성)" do
      iso1 = summary.mark_human_edited!(1.minute.ago); SttTermLearning::Scheduler.schedule_idle!(summary, iso1)
      iso2 = summary.mark_human_edited!;               SttTermLearning::Scheduler.schedule_idle!(summary, iso2)
      # digest dedup 이 두 번째를 막아 +1 이 되는 착시를 배제: 스냅샷 시도 자체가 새 잡 하나뿐이어야 한다.
      expect(SttTermLearning::Snapshot).to receive(:capture!).once.and_call_original
      expect { perform_enqueued_jobs }.to change(SttTermLearningRun, :count).by(1)
    end

    it "이전 편집 시각의 잡만 돌면 스냅샷을 시도하지 않는다" do
      iso1 = summary.mark_human_edited!(1.minute.ago); SttTermLearning::Scheduler.schedule_idle!(summary, iso1)
      summary.mark_human_edited!
      expect(SttTermLearning::Snapshot).not_to receive(:capture!)
      expect { perform_enqueued_jobs }.not_to change(SttTermLearningRun, :count)
    end

    it "마이크로초 단위 시각도 왕복 후 일치한다" do
      iso = summary.mark_human_edited!(Time.zone.parse("2026-11-23 10:00:00.123456"))
      expect(iso).to end_with(".123456+09:00").or end_with(".123456Z")
      SttTermLearning::Scheduler.schedule_idle!(summary, iso)
      expect { perform_enqueued_jobs }.to change(SttTermLearningRun, :count).by(1)
    end

    it "30분 대기로 enqueue 된다" do
      iso = summary.mark_human_edited!
      freeze_time do
        expect { SttTermLearning::Scheduler.schedule_idle!(summary, iso) }
          .to have_enqueued_job(SttTermLearningJob).with(summary_id: summary.id, edited_at: iso).at(30.minutes.from_now)
      end
    end

    it "대기 분은 설정값을 따른다" do
      allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => true, "idle_minutes" => 7, "min_confidence" => 0.6)
      iso = summary.mark_human_edited!
      freeze_time do
        expect { SttTermLearning::Scheduler.schedule_idle!(summary, iso) }
          .to have_enqueued_job(SttTermLearningJob).at(7.minutes.from_now)
      end
    end

    it "학습 대상이 아니거나 설정 off 면 스케줄하지 않는다" do
      iso = summary.mark_human_edited!
      summary.update!(ai_notes_markdown: nil)
      expect { SttTermLearning::Scheduler.schedule_idle!(summary, iso) }.not_to have_enqueued_job(SttTermLearningJob)

      summary.update!(ai_notes_markdown: "- 우판 압연")
      allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => false, "idle_minutes" => 30, "min_confidence" => 0.6)
      expect { SttTermLearning::Scheduler.schedule_idle!(summary, iso) }.not_to have_enqueued_job(SttTermLearningJob)
    end

    it "schedule_idle! 는 내부 예외가 나도 raise 하지 않고 로그 후 nil" do
      iso = summary.mark_human_edited!
      allow(SttTermLearningJob).to receive(:set).and_raise(StandardError, "queue down")
      allow(Rails.logger).to receive(:error)
      expect(SttTermLearning::Scheduler.schedule_idle!(summary, iso)).to be_nil
      expect(Rails.logger).to have_received(:error).with(include("queue down"))
    end

    it "AI 가 다시 써서 human_edited_at 이 nil 이 됐으면 스킵" do
      iso = summary.mark_human_edited!
      SttTermLearning::Scheduler.schedule_idle!(summary, iso)
      summary.write_ai_final!("- 새 AI 본문")
      expect { perform_enqueued_jobs }.not_to change(SttTermLearningRun, :count)
    end
  end

  it "summary 가 지워졌거나 run 이 지워졌으면 no-op(예외 없음)" do
    iso = summary.mark_human_edited!
    SttTermLearning::Scheduler.schedule_idle!(summary, iso)
    run = create(:stt_term_learning_run, meeting: meeting)
    described_class.perform_later(run_id: run.id)
    summary.destroy!
    run.destroy!
    expect { perform_enqueued_jobs }.not_to raise_error
    expect(SttTermLearningRun.count).to eq(0)
  end

  it "run_id 로 enqueue 된 run 을 처리한다" do
    run = SttTermLearning::Snapshot.capture!(summary, trigger: "pre_overwrite")
    described_class.perform_later(run_id: run.id)
    perform_enqueued_jobs
    expect(run.reload.status).to eq("done")
  end

  it "설정 off 면 run_id 경로는 처리하지 않고 run 을 failed(learning_disabled) 로 닫는다 → 다시 켜면 같은 텍스트로 capture! 가능" do
    run = SttTermLearning::Snapshot.capture!(summary, trigger: "pre_overwrite")
    described_class.perform_later(run_id: run.id)
    allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => false, "idle_minutes" => 30, "min_confidence" => 0.6)
    expect(SttTermLearning::Processor).not_to receive(:new)
    perform_enqueued_jobs
    expect(run.reload).to have_attributes(status: "failed", error: "learning_disabled")

    allow(AppSettings).to receive(:stt_term_learning).and_return(AppSettings::STT_TERM_LEARNING_DEFAULTS.dup)
    expect(SttTermLearning::Snapshot.capture!(summary, trigger: "pre_overwrite")).to be_persisted
  end

  it "설정 off 여도 queued 가 아닌 run 은 건드리지 않는다" do
    run = create(:stt_term_learning_run, meeting: meeting, status: "done")
    allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => false, "idle_minutes" => 30, "min_confidence" => 0.6)
    described_class.perform_now(run_id: run.id)
    expect(run.reload.status).to eq("done")
  end
end
