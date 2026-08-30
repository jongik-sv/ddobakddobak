require "rails_helper"

RSpec.describe "Ext::V1::Meetings", type: :request do
  let(:owner) { create(:user) }
  let(:collaborator) { create(:user) }
  let(:folder_collaborator) { create(:user) }
  let(:project_member) { create(:user) }
  let(:outsider) { create(:user) }
  let(:project) { create(:project) }

  def issue_token(user:, scopes: %w[meetings:read transcripts:read summaries:read], **attrs)
    ApiToken.issue!(user: user, name: "테스트", scopes: scopes, expires_at: 1.day.from_now, **attrs)
  end

  def auth_header(plaintext)
    { "Authorization" => "Bearer #{plaintext}" }
  end

  before do
    create(:project_membership, user: project_member, project: project, role: "member")
  end

  describe "인가 매트릭스 — 목록/단건" do
    let!(:root_folder)   { create(:folder, project: project) }
    let!(:leaf_folder)   { create(:folder, project: project, parent: root_folder) }
    let!(:private_meeting) { create(:meeting, project: project, creator: owner, shared: false) }
    let!(:collab_meeting)  { create(:meeting, project: project, creator: owner, shared: false) }
    let!(:folder_meeting)  { create(:meeting, project: project, creator: owner, folder: leaf_folder, shared: false) }
    let!(:shared_meeting)  { create(:meeting, project: project, creator: owner, shared: true) }

    before do
      MeetingCollaborator.create!(meeting: collab_meeting, user: collaborator)
      FolderCollaborator.create!(folder: root_folder, user: folder_collaborator)
    end

    it "소유자는 자기 회의를 목록·단건 모두 본다" do
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).to include(private_meeting.id)

      get "/api/ext/v1/meetings/#{private_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["meeting"]["id"]).to eq(private_meeting.id)
    end

    it "직접 협업자는 비공유 회의를 목록·단건 모두 본다" do
      _t, plaintext = issue_token(user: collaborator)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).to include(collab_meeting.id)

      get "/api/ext/v1/meetings/#{collab_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:ok)
    end

    it "폴더 상속 협업자는 하위 폴더 회의를 목록·단건 모두 본다" do
      _t, plaintext = issue_token(user: folder_collaborator)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).to include(folder_meeting.id)

      get "/api/ext/v1/meetings/#{folder_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:ok)
    end

    it "프로젝트 멤버는 공유 회의를 목록·단건 모두 본다" do
      _t, plaintext = issue_token(user: project_member)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).to include(shared_meeting.id)

      get "/api/ext/v1/meetings/#{shared_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:ok)
    end

    it "프로젝트 멤버라도 비공유(비협업) 회의는 목록에 없고 단건은 404" do
      _t, plaintext = issue_token(user: project_member)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).not_to include(private_meeting.id)

      get "/api/ext/v1/meetings/#{private_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]["code"]).to eq("not_found")
    end

    it "무관한 사용자는 어떤 회의도 목록·단건에서 못 본다(404)" do
      _t, plaintext = issue_token(user: outsider)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).not_to include(private_meeting.id, shared_meeting.id, collab_meeting.id, folder_meeting.id)

      get "/api/ext/v1/meetings/#{private_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "스코프 검사" do
    let!(:meeting) { create(:meeting, project: project, creator: owner) }

    before do
      create(:transcript, meeting: meeting)
      create(:summary, meeting: meeting, summary_type: "final")
    end

    it "meetings:read 없는 토큰이면 index/show 403" do
      _t, plaintext = issue_token(user: owner, scopes: %w[transcripts:read])

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]["code"]).to eq("insufficient_scope")

      get "/api/ext/v1/meetings/#{meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:forbidden)
    end

    it "transcripts:read 없는 토큰이면 403" do
      _t, plaintext = issue_token(user: owner, scopes: %w[meetings:read])
      get "/api/ext/v1/meetings/#{meeting.id}/transcripts", headers: auth_header(plaintext)
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]["code"]).to eq("insufficient_scope")
    end

    it "summaries:read 없는 토큰이면 403" do
      _t, plaintext = issue_token(user: owner, scopes: %w[meetings:read])
      get "/api/ext/v1/meetings/#{meeting.id}/summary", headers: auth_header(plaintext)
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]["code"]).to eq("insufficient_scope")
    end
  end

  describe "토큰 project_ids 제한" do
    it "제한 밖 회의는 목록에서 빠지고 단건은 404" do
      other_project = create(:project)
      allowed_meeting = create(:meeting, project: project, creator: owner)
      out_of_scope_meeting = create(:meeting, project: other_project, creator: owner)

      _t, plaintext = issue_token(user: owner, project_ids: [ project.id ])

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to include(allowed_meeting.id)
      expect(ids).not_to include(out_of_scope_meeting.id)

      get "/api/ext/v1/meetings/#{out_of_scope_meeting.id}", headers: auth_header(plaintext)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "페이지네이션·필터" do
    it "기본 20건, page/per_page 파라미터를 반영한다" do
      create_list(:meeting, 25, project: project, creator: owner)
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings", headers: auth_header(plaintext)
      body = response.parsed_body
      expect(body["meetings"].size).to eq(20)
      expect(body["meta"]).to eq({ "page" => 1, "per_page" => 20, "total" => 25, "total_pages" => 2 })

      get "/api/ext/v1/meetings", params: { page: 2, per_page: 10 }, headers: auth_header(plaintext)
      body2 = response.parsed_body
      expect(body2["meetings"].size).to eq(10)
      expect(body2["meta"]["page"]).to eq(2)
      expect(body2["meta"]["total_pages"]).to eq(3)
    end

    it "per_page가 최대치(100)를 넘으면 잘린다" do
      _t, plaintext = issue_token(user: owner)
      get "/api/ext/v1/meetings", params: { per_page: 500 }, headers: auth_header(plaintext)
      expect(response.parsed_body["meta"]["per_page"]).to eq(100)
    end

    it "status 필터가 동작한다" do
      pending_meeting = create(:meeting, project: project, creator: owner, status: "pending")
      completed_meeting = create(:meeting, project: project, creator: owner, status: "completed")
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings", params: { status: "completed" }, headers: auth_header(plaintext)
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to include(completed_meeting.id)
      expect(ids).not_to include(pending_meeting.id)
    end

    it "project_id 필터가 동작한다" do
      other_project = create(:project)
      in_project = create(:meeting, project: project, creator: owner)
      in_other = create(:meeting, project: other_project, creator: owner)
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings", params: { project_id: project.id }, headers: auth_header(plaintext)
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to include(in_project.id)
      expect(ids).not_to include(in_other.id)
    end

    it "folder_id 필터가 하위 폴더 회의까지 포함한다" do
      root = create(:folder, project: project)
      leaf = create(:folder, project: project, parent: root)
      in_root = create(:meeting, project: project, creator: owner, folder: root)
      in_leaf = create(:meeting, project: project, creator: owner, folder: leaf)
      outside = create(:meeting, project: project, creator: owner)
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings", params: { folder_id: root.id }, headers: auth_header(plaintext)
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to include(in_root.id, in_leaf.id)
      expect(ids).not_to include(outside.id)
    end

    it "from/to 필터가 생성일 범위를 제한한다" do
      old_meeting = create(:meeting, project: project, creator: owner, created_at: 10.days.ago)
      recent_meeting = create(:meeting, project: project, creator: owner, created_at: 1.day.ago)
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings", params: { from: 5.days.ago.iso8601 }, headers: auth_header(plaintext)
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to include(recent_meeting.id)
      expect(ids).not_to include(old_meeting.id)
    end
  end

  describe "GET /meetings/:id" do
    it "목록 필드 + owner 표시명 + 전사 개수 + 최종요약 존재 여부 + duration을 포함한다" do
      meeting = create(:meeting, project: project, creator: owner, audio_duration_ms: 12_345)
      create(:transcript, meeting: meeting)
      create(:transcript, meeting: meeting)
      create(:summary, meeting: meeting, summary_type: "final")
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings/#{meeting.id}", headers: auth_header(plaintext)
      body = response.parsed_body["meeting"]
      expect(body["owner_name"]).to eq(owner.name)
      expect(body["transcript_count"]).to eq(2)
      expect(body["has_final_summary"]).to eq(true)
      expect(body["duration_ms"]).to eq(12_345)
    end
  end

  describe "GET /meetings/:id/transcripts" do
    it "sequence_number 순으로 반환한다" do
      meeting = create(:meeting, project: project, creator: owner)
      t2 = create(:transcript, meeting: meeting, sequence_number: 2, content: "두번째")
      t1 = create(:transcript, meeting: meeting, sequence_number: 1, content: "첫번째")
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings/#{meeting.id}/transcripts", headers: auth_header(plaintext)
      body = response.parsed_body["transcripts"]
      expect(body.map { |t| t["id"] }).to eq([ t1.id, t2.id ])
      expect(body.first["content"]).to eq("첫번째")
    end
  end

  describe "GET /meetings/:id/summary" do
    it "summary_type final 중 최신 1건을 파싱해 반환한다" do
      meeting = create(:meeting, project: project, creator: owner)
      create(:summary, meeting: meeting, summary_type: "realtime", notes_markdown: "중간본")
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "최종본", key_points: [ "a", "b" ].to_json)
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings/#{meeting.id}/summary", headers: auth_header(plaintext)
      expect(response).to have_http_status(:ok)
      body = response.parsed_body["summary"]
      expect(body["notes_markdown"]).to eq("최종본")
      expect(body["key_points"]).to eq(%w[a b])
    end

    it "final 요약이 없으면 404 summary_not_found" do
      meeting = create(:meeting, project: project, creator: owner)
      _t, plaintext = issue_token(user: owner)

      get "/api/ext/v1/meetings/#{meeting.id}/summary", headers: auth_header(plaintext)
      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]["code"]).to eq("summary_not_found")
    end
  end

  describe "감사 로그" do
    it "각 액션 호출마다 audit 로그가 남는다" do
      meeting = create(:meeting, project: project, creator: owner)
      create(:summary, meeting: meeting, summary_type: "final")
      _t, plaintext = issue_token(user: owner)

      expect {
        get "/api/ext/v1/meetings", headers: auth_header(plaintext)
        get "/api/ext/v1/meetings/#{meeting.id}", headers: auth_header(plaintext)
        get "/api/ext/v1/meetings/#{meeting.id}/transcripts", headers: auth_header(plaintext)
        get "/api/ext/v1/meetings/#{meeting.id}/summary", headers: auth_header(plaintext)
      }.to change(ApiTokenAuditLog, :count).by(4)
    end
  end
end
