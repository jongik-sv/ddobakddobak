require "rails_helper"

# STT 용어 자동 학습 트리거 배선(스펙 §5.1·5.2). 사람 편집은 idle 디바운스 잡을 걸고,
# 요약 행 삭제·덮어쓰기 직전에는 pre_overwrite 스냅샷을 만든다. 학습 쪽 실패는 원래 동작을 막지 않는다.
RSpec.describe "Api::V1::Meetings STT 용어 학습 트리거", type: :request do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }
  let!(:transcript) { create(:transcript, meeting: meeting, sequence_number: 1, content: "우판 압연 발화") }
  let!(:final) do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "사람",
           ai_notes_markdown: "AI", ai_generated_at: 1.hour.ago, generated_at: 1.hour.ago)
  end

  before { login_as(user) }

  def pre_overwrite_runs
    SttTermLearningRun.where(trigger: "pre_overwrite")
  end

  describe "update_notes" do
    it "idle 학습 잡을 30분 뒤로 건다(edited_at 은 저장된 human_edited_at 의 iso8601(6))" do
      freeze_time do
        expect {
          patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "사람2" }, as: :json
        }.to have_enqueued_job(SttTermLearningJob)
          .with(summary_id: final.id, edited_at: kind_of(String)).at(30.minutes.from_now)
      end
      expect(response).to have_http_status(:ok)
      job = enqueued_jobs.find { |j| j["job_class"] == "SttTermLearningJob" }
      edited_at = job["arguments"].first["edited_at"]
      expect(edited_at).to eq(final.reload.human_edited_at.iso8601(6))
    end

    it "스케줄러가 예외를 던져도 200 이고 노트는 저장된다" do
      allow(::SttTermLearning::Scheduler).to receive(:schedule_idle!).and_raise("boom")
      patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "사람2" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(final.reload.notes_markdown).to eq("사람2")
    end
  end

  describe "feedback" do
    it "idle 학습 잡을 건다" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/feedback",
             params: { corrections: [ { from: "사람", to: "인간" } ] }, as: :json
      }.to have_enqueued_job(SttTermLearningJob).with(summary_id: final.id, edited_at: kind_of(String))
      expect(response).to have_http_status(:ok)
    end

    it "요약 없는 회의 feedback 도 200, 학습 잡 없음" do
      final.destroy!
      expect {
        post "/api/v1/meetings/#{meeting.id}/feedback",
             params: { corrections: [ { from: "우판", to: "후판" } ] }, as: :json
      }.not_to have_enqueued_job(SttTermLearningJob)
      expect(response).to have_http_status(:ok)
    end

    it "스케줄러가 예외를 던져도 200" do
      allow(::SttTermLearning::Scheduler).to receive(:schedule_idle!).and_raise("boom")
      post "/api/v1/meetings/#{meeting.id}/feedback",
           params: { corrections: [ { from: "사람", to: "인간" } ] }, as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  describe "regenerate_notes" do
    it "summaries 삭제 전에 pre_overwrite run 을 만들고 run_id 잡을 건다" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/regenerate_notes"
      }.to change { pre_overwrite_runs.count }.by(1)
      expect(response).to have_http_status(:ok)

      run = pre_overwrite_runs.last
      expect(run).to have_attributes(ai_text: "AI", human_text: "사람", transcript_text: "우판 압연 발화",
                                     meeting_id: meeting.id, summary_id: nil)
      expect(Summary.where(id: final.id)).not_to exist
      expect(SttTermLearningJob).to have_been_enqueued.with(run_id: run.id)
    end

    it "AI 원본과 같으면 스냅샷 없음" do
      final.update_columns(notes_markdown: "AI")
      expect { post "/api/v1/meetings/#{meeting.id}/regenerate_notes" }.not_to change { SttTermLearningRun.count }
      expect(response).to have_http_status(:ok)
    end

    it "스냅샷(capture!)이 실패해도 200 이고 요약은 삭제·재요약 잡은 걸린다" do
      allow(::SttTermLearning::Snapshot).to receive(:capture!).and_raise("boom")
      expect { post "/api/v1/meetings/#{meeting.id}/regenerate_notes" }
        .to have_enqueued_job(MeetingSummarizationJob)
      expect(response).to have_http_status(:ok)
      expect(Summary.where(id: final.id)).not_to exist
    end

    it "before_overwrite! 자체가 예외를 던져도 200 (호출부 가드)" do
      allow(::SttTermLearning::Snapshot).to receive(:before_overwrite!).and_raise("boom")
      post "/api/v1/meetings/#{meeting.id}/regenerate_notes"
      expect(response).to have_http_status(:ok)
      expect(Summary.where(id: final.id)).not_to exist
    end
  end

  describe "reset_content" do
    it "전사가 지워지기 전 transcript_text 를 담아 스냅샷" do
      expect { post "/api/v1/meetings/#{meeting.id}/reset_content" }.to change { pre_overwrite_runs.count }.by(1)
      expect(response).to have_http_status(:ok)
      expect(pre_overwrite_runs.last).to have_attributes(ai_text: "AI", human_text: "사람",
                                                         transcript_text: "우판 압연 발화")
      expect(meeting.transcripts.count).to eq(0)
    end

    it "before_overwrite! 가 예외를 던져도 200 이고 초기화는 진행" do
      allow(::SttTermLearning::Snapshot).to receive(:before_overwrite!).and_raise("boom")
      post "/api/v1/meetings/#{meeting.id}/reset_content"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.status).to eq("pending")
      expect(meeting.summaries.count).to eq(0)
    end
  end

  describe "regenerate_stt" do
    let(:audio_path) do
      path = Rails.root.join("tmp", "stt_learn_regen_#{SecureRandom.hex(4)}.mp3").to_s
      File.write(path, "x")
      path
    end

    before do
      meeting.update_columns(audio_file_path: audio_path)
      allow(FileTranscriptionJob).to receive(:perform_later)
    end

    after { FileUtils.rm_f(audio_path) }

    it "전사·요약이 지워지기 전 스냅샷" do
      expect { post "/api/v1/meetings/#{meeting.id}/regenerate_stt" }.to change { pre_overwrite_runs.count }.by(1)
      expect(response).to have_http_status(:ok)
      expect(pre_overwrite_runs.last).to have_attributes(ai_text: "AI", human_text: "사람",
                                                         transcript_text: "우판 압연 발화")
      expect(meeting.summaries.count).to eq(0)
    end

    it "before_overwrite! 가 예외를 던져도 200 이고 재전사 잡은 걸린다" do
      allow(::SttTermLearning::Snapshot).to receive(:before_overwrite!).and_raise("boom")
      post "/api/v1/meetings/#{meeting.id}/regenerate_stt"
      expect(response).to have_http_status(:ok)
      expect(FileTranscriptionJob).to have_received(:perform_later).with(meeting.id)
      expect(meeting.reload.status).to eq("transcribing")
    end
  end
end
