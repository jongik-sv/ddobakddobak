require "rails_helper"

RSpec.describe "GET /api/ext/v1/projects", type: :request do
  let(:user) { create(:user) }

  def issue_token(user:, scopes: %w[meetings:read], **attrs)
    ApiToken.issue!(user: user, name: "테스트", scopes: scopes, expires_at: 1.day.from_now, **attrs)
  end

  def auth_header(plaintext)
    { "Authorization" => "Bearer #{plaintext}" }
  end

  it "사용자가 멤버인 프로젝트만 반환한다" do
    member_project = create(:project)
    other_project = create(:project)
    create(:project_membership, user: user, project: member_project, role: "member")

    _t, plaintext = issue_token(user: user)
    get "/api/ext/v1/projects", headers: auth_header(plaintext)

    expect(response).to have_http_status(:ok)
    body = response.parsed_body["projects"]
    expect(body.map { |p| p["id"] }).to include(member_project.id)
    expect(body.map { |p| p["id"] }).not_to include(other_project.id)
    row = body.find { |p| p["id"] == member_project.id }
    expect(row).to include("name" => member_project.name, "personal" => false)
    expect(row["created_at"]).to be_present
  end

  it "토큰 project_ids 제한과 교집합만 반환한다" do
    p1 = create(:project)
    p2 = create(:project)
    create(:project_membership, user: user, project: p1, role: "member")
    create(:project_membership, user: user, project: p2, role: "member")

    _t, plaintext = issue_token(user: user, project_ids: [ p1.id ])
    get "/api/ext/v1/projects", headers: auth_header(plaintext)

    expect(response.parsed_body["projects"].map { |p| p["id"] }).to eq([ p1.id ])
  end

  it "meetings:read 스코프가 없으면 403" do
    _t, plaintext = issue_token(user: user, scopes: %w[transcripts:read])
    get "/api/ext/v1/projects", headers: auth_header(plaintext)

    expect(response).to have_http_status(:forbidden)
    expect(response.parsed_body["error"]["code"]).to eq("insufficient_scope")
  end

  it "인증 헤더가 없으면 401" do
    get "/api/ext/v1/projects"
    expect(response).to have_http_status(:unauthorized)
  end
end
