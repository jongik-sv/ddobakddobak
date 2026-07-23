require "rails_helper"
require "stringio"

# 요약 zip 내보내기 HTTP 경계.
# - POST /api/v1/folders/:id/export_summaries   → 멤버십 스코프(set_folder, 비멤버 404)
# - POST /api/v1/projects/:id/export_summaries  → member? 게이트(비멤버 403, admin 전용 아님)
RSpec.describe "Summary zip export", type: :request do
  before(:all) { Transcript.ensure_fts_tables! }

  let!(:member)   { create(:user) }
  let!(:outsider) { create(:user) }
  let!(:project)  { create(:project, creator: member, name: "기획팀") }
  let!(:folder)   { create(:folder, project: project, name: "주간 회의") }

  # meeting factory after_create 가 creator(member)를 프로젝트 멤버로 자동 등록
  let!(:meeting) do
    create(:meeting, project: project, creator: member, folder: folder,
                     title: "킥오프", status: "completed")
  end
  let!(:summary) do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "## 회의록\n내용")
  end

  def zip_entry_names(body)
    names = []
    Zip::File.open_buffer(body) do |zip|
      zip.each { |e| names << e.name.dup.force_encoding("UTF-8") }
    end
    names
  end

  describe "POST /api/v1/folders/:id/export_summaries" do
    it "멤버는 200 + application/zip + .zip 파일명" do
      login_as(member)
      post "/api/v1/folders/#{folder.id}/export_summaries"

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/zip")
      expect(response.headers["Content-Disposition"]).to include("attachment")
      expect(response.headers["Content-Disposition"]).to include(".zip")
      expect(zip_entry_names(response.body).join).to include("킥오프")
    end

    it "비멤버는 404 (set_folder 멤버십 스코프)" do
      login_as(outsider)
      post "/api/v1/folders/#{folder.id}/export_summaries"
      expect(response).to have_http_status(:not_found)
    end

    it "요약 있는 회의가 없으면 422" do
      summary.destroy!
      login_as(member)
      post "/api/v1/folders/#{folder.id}/export_summaries"
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("내보낼 요약이 없습니다")
    end
  end

  describe "POST /api/v1/projects/:id/export_summaries" do
    it "일반 멤버(비admin)는 200 — admin 전용이 아니다" do
      login_as(member)
      post "/api/v1/projects/#{project.id}/export_summaries"

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/zip")
      expect(zip_entry_names(response.body).join).to include("킥오프")
    end

    it "비멤버는 403 (admin 이어도 멤버가 아니면 403)" do
      admin_outsider = create(:user, :admin)
      login_as(admin_outsider)
      post "/api/v1/projects/#{project.id}/export_summaries"
      expect(response).to have_http_status(:forbidden)
    end

    it "요약 있는 회의가 없으면 422" do
      summary.destroy!
      login_as(member)
      post "/api/v1/projects/#{project.id}/export_summaries"
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
