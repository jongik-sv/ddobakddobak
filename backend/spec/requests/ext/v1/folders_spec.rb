require "rails_helper"

RSpec.describe "GET /api/ext/v1/projects/:project_id/folders", type: :request do
  let(:owner) { create(:user) }
  let(:outsider) { create(:user) }
  let(:project) { create(:project, creator: owner) }

  def issue_token(user:, scopes: %w[meetings:read], **attrs)
    ApiToken.issue!(user: user, name: "테스트", scopes: scopes, expires_at: 1.day.from_now, **attrs)
  end

  def auth_header(plaintext)
    { "Authorization" => "Bearer #{plaintext}" }
  end

  before do
    create(:project_membership, user: owner, project: project, role: "admin")
  end

  it "프로젝트 멤버는 전체 폴더 트리를 평면 배열로 받는다" do
    root = create(:folder, project: project)
    leaf = create(:folder, project: project, parent: root)

    _t, plaintext = issue_token(user: owner)
    get "/api/ext/v1/projects/#{project.id}/folders", headers: auth_header(plaintext)

    expect(response).to have_http_status(:ok)
    body = response.parsed_body["folders"]
    expect(body.map { |f| f["id"] }).to contain_exactly(root.id, leaf.id)
    leaf_row = body.find { |f| f["id"] == leaf.id }
    expect(leaf_row["parent_id"]).to eq(root.id)
  end

  it "해당 프로젝트 멤버가 아니면 404" do
    _t, plaintext = issue_token(user: outsider)
    get "/api/ext/v1/projects/#{project.id}/folders", headers: auth_header(plaintext)

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["error"]["code"]).to eq("not_found")
  end

  it "토큰 project_ids 제한 밖이면 404" do
    _t, plaintext = issue_token(user: owner, project_ids: [ create(:project).id ])
    get "/api/ext/v1/projects/#{project.id}/folders", headers: auth_header(plaintext)

    expect(response).to have_http_status(:not_found)
  end

  it "meetings:read 스코프가 없으면 403" do
    _t, plaintext = issue_token(user: owner, scopes: %w[transcripts:read])
    get "/api/ext/v1/projects/#{project.id}/folders", headers: auth_header(plaintext)

    expect(response).to have_http_status(:forbidden)
  end

  it "존재하지 않는 프로젝트면 404" do
    _t, plaintext = issue_token(user: owner)
    get "/api/ext/v1/projects/999999/folders", headers: auth_header(plaintext)

    expect(response).to have_http_status(:not_found)
  end
end
