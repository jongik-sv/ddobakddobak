require "rails_helper"

RSpec.describe "Api::V1::Meetings importance", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before { login_as(user) }

  # ============================================================
  # GET /api/v1/meetings — important 필터
  # ============================================================
  describe "GET /api/v1/meetings (importance filter)" do
    it "기본 목록은 완료 회의 중 important=true 만 반환한다" do
      important = create(:meeting, project: project, creator: user, status: "completed", important: true)
      # 완료 회의에만 important 필터가 적용되므로, 제외 검증은 completed 로 만들어야 한다
      # (pending/recording 은 important=false 라도 항상 노출됨).
      create(:meeting, project: project, creator: user, status: "completed", important: false)

      get "/api/v1/meetings"

      json = response.parsed_body
      ids = json["meetings"].map { |m| m["id"] }
      expect(ids).to eq([ important.id ])
    end

    it "show_all=1 이면 important=false 회의도 포함해 전부 반환한다" do
      important = create(:meeting, project: project, creator: user, important: true)
      unimportant = create(:meeting, project: project, creator: user, important: false)

      get "/api/v1/meetings", params: { show_all: 1 }

      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to contain_exactly(important.id, unimportant.id)
    end

    it "show_all=true(문자열)도 동일하게 전부 반환한다" do
      create(:meeting, project: project, creator: user, important: true)
      create(:meeting, project: project, creator: user, important: false)

      get "/api/v1/meetings", params: { show_all: "true" }

      expect(response.parsed_body["meetings"].length).to eq(2)
    end

    it "검색(q)에도 important 필터가 AND 로 적용된다 (완료 회의는 show_all 없으면 important=false 제외)" do
      hit_important = create(:meeting, project: project, creator: user, title: "발사대 점검", status: "completed", important: true)
      # 완료 회의에만 important 필터가 적용되므로 제외 대상도 completed 로 만든다.
      create(:meeting, project: project, creator: user, title: "발사대 정비", status: "completed", important: false)

      get "/api/v1/meetings", params: { q: "발사대" }

      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to eq([ hit_important.id ])
    end
  end

  # ============================================================
  # PATCH /api/v1/meetings/:id — important 토글
  # ============================================================
  describe "PATCH /api/v1/meetings/:id (toggle important)" do
    it "important false→true 토글 후 기본 목록에 나타난다" do
      # 완료 회의여야 important=false 일 때 기본 목록에서 숨겨진다(미완료는 항상 노출).
      meeting = create(:meeting, project: project, creator: user, status: "completed", important: false)

      get "/api/v1/meetings"
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).not_to include(meeting.id)

      patch "/api/v1/meetings/#{meeting.id}", params: { important: true }
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.important).to be true

      get "/api/v1/meetings"
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).to include(meeting.id)
    end

    it "important true→false 토글 후 기본 목록에서 사라진다" do
      # 완료 회의여야 important=false 토글 시 기본 목록에서 사라진다(미완료는 항상 노출).
      meeting = create(:meeting, project: project, creator: user, status: "completed", important: true)

      patch "/api/v1/meetings/#{meeting.id}", params: { important: false }
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.important).to be false

      get "/api/v1/meetings"
      expect(response.parsed_body["meetings"].map { |m| m["id"] }).not_to include(meeting.id)
    end
  end

  # ============================================================
  # POST /api/v1/meetings — 폴더 상속 vs 명시 지정
  # ============================================================
  describe "POST /api/v1/meetings (importance inheritance)" do
    it "important=true 폴더에서 만든 회의는 important=true 를 상속한다 (요청에 important 미포함)" do
      folder = create(:folder, project: project, important: true)

      post "/api/v1/meetings", params: { title: "회의", project_id: project.id, folder_id: folder.id }

      expect(response).to have_http_status(:created)
      meeting = Meeting.find(response.parsed_body["meeting"]["id"])
      expect(meeting.important).to be true
    end

    it "important=false 폴더에서 만든 회의는 important=false 를 상속한다" do
      folder = create(:folder, project: project, important: false)

      post "/api/v1/meetings", params: { title: "회의", project_id: project.id, folder_id: folder.id }

      meeting = Meeting.find(response.parsed_body["meeting"]["id"])
      expect(meeting.important).to be false
    end

    it "요청에 important=false 를 명시하면 important=true 폴더라도 false 로 저장한다 (상속 안 함)" do
      folder = create(:folder, project: project, important: true)

      post "/api/v1/meetings", params: { title: "회의", project_id: project.id, folder_id: folder.id, important: false }

      meeting = Meeting.find(response.parsed_body["meeting"]["id"])
      expect(meeting.important).to be false
    end

    it "요청에 important=true 를 명시하면 important=false 폴더라도 true 로 저장한다" do
      folder = create(:folder, project: project, important: false)

      post "/api/v1/meetings", params: { title: "회의", project_id: project.id, folder_id: folder.id, important: true }

      meeting = Meeting.find(response.parsed_body["meeting"]["id"])
      expect(meeting.important).to be true
    end
  end

  # ============================================================
  # PATCH /api/v1/folders/:id — important 토글
  # ============================================================
  describe "PATCH /api/v1/folders/:id (toggle important)" do
    it "폴더 important 를 토글하면 직렬화에 반영된다" do
      folder = create(:folder, project: project, important: false)
      # Folder#editable_by? 는 admin 또는 직속 회의 creator 만 허용 — 직속 회의를 만들어 권한 확보
      create(:meeting, project: project, creator: user, folder_id: folder.id)

      patch "/api/v1/folders/#{folder.id}", params: { important: true }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["folder"]["important"]).to be true
      expect(folder.reload.important).to be true
    end
  end
end
