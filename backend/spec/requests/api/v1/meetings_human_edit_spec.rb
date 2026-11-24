require "rails_helper"

RSpec.describe "Api::V1::Meetings 사람 편집 시각", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }
  let!(:final) do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "AI 원본 우판",
           ai_notes_markdown: "AI 원본 우판", ai_generated_at: 1.hour.ago, generated_at: 1.hour.ago)
  end

  before { login_as(user) }

  it "update_notes 는 human_edited_at 을 찍고 ai_notes_markdown 은 그대로" do
    patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "사람 수정" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(final.reload).to have_attributes(notes_markdown: "사람 수정", ai_notes_markdown: "AI 원본 우판")
    expect(final.human_edited_at).to be_within(5.seconds).of(Time.current)
  end

  it "feedback 은 human_edited_at 을 찍고 ai_notes_markdown 은 그대로(교정은 notes 에만)" do
    post "/api/v1/meetings/#{meeting.id}/feedback",
         params: { corrections: [ { from: "우판", to: "후판" } ] }, as: :json
    expect(response).to have_http_status(:ok)
    expect(final.reload.notes_markdown).to include("후판")
    expect(final.ai_notes_markdown).to eq("AI 원본 우판")
    expect(final.human_edited_at).to be_within(5.seconds).of(Time.current)
  end

  describe "편집 시각을 찍지 않는 경우(대기 목록에 영영 남지 않게)" do
    it "학습이 꺼져 있으면 update_notes·feedback 모두 human_edited_at 을 찍지 않는다" do
      allow(AppSettings).to receive(:stt_term_learning)
        .and_return(AppSettings::STT_TERM_LEARNING_DEFAULTS.merge("enabled" => false))
      patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "사람 수정 우판" }, as: :json
      expect(response).to have_http_status(:ok)
      post "/api/v1/meetings/#{meeting.id}/feedback", params: { corrections: [ { from: "우판", to: "후판" } ] }, as: :json
      expect(response).to have_http_status(:ok)
      expect(final.reload.notes_markdown).to include("후판")
      expect(final.human_edited_at).to be_nil
    end

    it "update_notes 가 같은 본문이면 찍지 않는다" do
      patch "/api/v1/meetings/#{meeting.id}/update_notes", params: { notes_markdown: "AI 원본 우판" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(final.reload.human_edited_at).to be_nil
    end

    it "feedback 이 아무것도 고치지 못하면 찍지 않는다" do
      post "/api/v1/meetings/#{meeting.id}/feedback", params: { corrections: [ { from: "없는말", to: "있는말" } ] }, as: :json
      expect(response).to have_http_status(:ok)
      expect(final.reload.human_edited_at).to be_nil
    end
  end
end
