require "rails_helper"

# 최종 리뷰 I1 회귀: 관리자가 되돌린 등록이 같은 회의의 다음 편집(무관한 추가 수정)으로 다시 등록되면 안 된다.
# 되돌린 run 과 입력 digest 가 달라 Snapshot 중복 방지는 통과하므로 CandidateFilter 가 reverted_pair 로 막는다.
RSpec.describe "STT 용어 학습 되돌린 뒤 재편집", type: :request do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:folder) { create(:folder, project: project) }
  let(:meeting) { create(:meeting, project: project, folder: folder, creator: user, status: "completed") }
  let!(:transcript) { create(:transcript, meeting: meeting, sequence_number: 1, content: "우판 압연 계획을 논의") }
  let!(:final) do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "- 우판 압연 계획",
           ai_notes_markdown: "- 우판 압연 계획", ai_generated_at: 1.hour.ago, generated_at: 1.hour.ago)
  end
  let(:llm) do
    instance_double(LlmService, model_name: "m",
      extract_stt_misrecognitions: [ { "wrong" => "우판", "correct" => "후판", "category" => "설비",
                                       "definition" => "두꺼운 강판", "confidence" => 0.9 } ])
  end

  before do
    allow(AppSettings).to receive(:refresh_env_if_changed!)
    allow(LlmService).to receive(:new).and_return(llm)
    login_as(user)
  end

  it "되돌린 뒤 무관한 추가 편집 → 새 run 은 그 쌍을 다시 넣지 않는다(reverted_pair)" do
    patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "- 후판 압연 계획" }, as: :json
    expect(response).to have_http_status(:ok)
    perform_enqueued_jobs
    run = SttTermLearningRun.order(:id).last
    expect(run.items.pluck(:verdict)).to eq([ "registered" ])
    file = DomainFile.stt_auto.last
    expect(file.content).to include("**후판**")

    SttTermLearning::Reverter.new(run).call
    expect(file.reload.content).not_to include("**후판**")

    patch "/api/v1/meetings/#{meeting.id}/update_notes",
          params: { notes_markdown: "- 후판 압연 계획\n- 추가 메모" }, as: :json
    perform_enqueued_jobs
    run2 = SttTermLearningRun.order(:id).last
    expect(run2.id).not_to eq(run.id)
    expect(run2.status).to eq("done")
    expect(run2.items.map { |i| [ i.verdict, i.reason ] }).to eq([ [ "skipped_excluded", "reverted_pair" ] ])
    expect(file.reload.content).not_to include("**후판**")
    expect(DomainReferenceBuilder.build(create(:meeting, project: project, folder: folder)).to_s).not_to include("우판→후판")

    # 관리자 수동 등록은 여전히 override
    SttTermLearning::ManualRegistration.call(run2.items.first)
    expect(DomainFile.stt_auto.where(id: file.id).first.content).to include("**후판**")
  end
end
