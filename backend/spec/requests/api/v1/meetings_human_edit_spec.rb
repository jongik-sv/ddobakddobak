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
end
