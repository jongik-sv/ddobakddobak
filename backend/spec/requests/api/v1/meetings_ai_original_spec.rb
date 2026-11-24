require "rails_helper"

RSpec.describe "GET /api/v1/meetings/:id/ai_original", type: :request do
  let(:owner) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let(:meeting) { create(:meeting, project: project, creator: owner, shared: true) }

  def json = response.parsed_body

  def final_summary(ai:, human:)
    create(:summary, meeting: meeting, summary_type: "final", ai_notes_markdown: ai, notes_markdown: human,
           ai_generated_at: 2.hours.ago, human_edited_at: 1.hour.ago)
  end

  describe "권한" do
    before { final_summary(ai: "제목\n우판 공정 ⟦t:1234/s:abc⟧", human: "제목\n후판 공정") }

    def expect_diff
      expect(response).to have_http_status(:ok)
      expect(json.keys).to contain_exactly("available", "ai_generated_at", "human_edited_at", "diff")
      expect(json["available"]).to eq(true)
      expect(json["ai_generated_at"]).to be_present
      expect(json["human_edited_at"]).to be_present
      expect(json["diff"]).to eq([ { "op" => "equal", "text" => "제목" }, { "op" => "delete", "text" => "우판 공정" },
                                   { "op" => "insert", "text" => "후판 공정" } ])
    end

    it "소유자는 diff 열람" do
      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/ai_original"
      expect_diff
    end

    it "협업자는 diff 열람" do
      collaborator = create(:user)
      create(:project_membership, user: collaborator, project: project, role: "member")
      MeetingCollaborator.create!(meeting: meeting, user: collaborator)
      login_as(collaborator)
      get "/api/v1/meetings/#{meeting.id}/ai_original"
      expect_diff
    end

    it "admin 은 diff 열람" do
      login_as(create(:user, :admin))
      get "/api/v1/meetings/#{meeting.id}/ai_original"
      expect_diff
    end

    it "열람만 가능한 프로젝트 멤버는 403" do
      viewer = create(:user)
      create(:project_membership, user: viewer, project: project, role: "member")
      login_as(viewer)
      get "/api/v1/meetings/#{meeting.id}/ai_original"
      expect(response).to have_http_status(:forbidden)
    end
  end

  it "AI 원본 없는 회의는 available false" do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "사람만", ai_notes_markdown: nil)
    login_as(owner)
    get "/api/v1/meetings/#{meeting.id}/ai_original"
    expect(response).to have_http_status(:ok)
    expect(json).to eq("available" => false, "ai_generated_at" => nil, "human_edited_at" => nil, "diff" => [])
  end

  it "요약이 없는 회의도 available false" do
    login_as(owner)
    get "/api/v1/meetings/#{meeting.id}/ai_original"
    expect(json).to eq("available" => false, "ai_generated_at" => nil, "human_edited_at" => nil, "diff" => [])
  end
end
