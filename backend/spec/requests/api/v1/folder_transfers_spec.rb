require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"

# 폴더 Export/Import HTTP 경계 테스트.
# - POST /api/v1/folders/:id/export             → editable_by? 게이트 · tar.gz 다운로드
# - POST /api/v1/projects/:project_id/folders/import → 멤버십 게이트 · multipart 업로드 · 새 Folder 서브트리 생성
RSpec.describe "Api::V1::FolderTransfers", type: :request do
  before(:all) { Transcript.ensure_fts_tables! }

  let!(:editor)   { create(:user) }        # 폴더에 회의를 가진 사용자 = editable_by? 통과
  let!(:member)   { create(:user) }        # 프로젝트 멤버, 폴더에 회의 없음 = editable_by? 실패
  let!(:outsider) { create(:user) }        # 비멤버 = project membership 밖

  let!(:project) { create(:project, creator: editor) }
  let!(:folder)  { create(:folder, project: project, name: "팀 회의") }

  # editor의 회의를 folder에 만들어 folder.editable_by?(editor) = true
  # meeting factory after_create 가 editor를 project 멤버로 자동 추가
  let!(:meeting_in_folder) do
    create(:meeting, creator: editor, project: project, folder: folder, title: "폴더 테스트 회의")
  end

  before do
    # member를 프로젝트 멤버로 추가
    ProjectMembership.find_or_create_by!(project_id: project.id, user_id: member.id) do |pm|
      pm.role = "member"
    end
  end

  # ── 헬퍼 ──────────────────────────────────────────────────────────────

  def folder_archive(include_audio: false)
    io = StringIO.new
    FolderExporter.new(folder, include_audio: include_audio).write_to(io)
    io.string
  end

  # 회의 아카이브 = scope:"meeting" — folder import에 올리면 422
  def meeting_archive_wrong_scope
    io = StringIO.new
    MeetingExporter.new(meeting_in_folder, include_audio: false).write_to(io)
    io.string
  end

  def upload_file(bytes, filename: "export.tgz")
    tmp = Tempfile.new(["folder-import-test", ".tgz"])
    tmp.binmode
    tmp.write(bytes)
    tmp.rewind
    Rack::Test::UploadedFile.new(tmp.path, "application/gzip", true, original_filename: filename)
  end

  # ── EXPORT ─────────────────────────────────────────────────────────────

  describe "POST /api/v1/folders/:id/export" do
    context "editor (폴더에 회의를 가진 사용자)" do
      before { login_as(editor) }

      it "200 + gzip Content-Type + .ddobak-folder.tgz 파일명" do
        post "/api/v1/folders/#{folder.id}/export",
             params: { include_audio: false }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.media_type).to eq("application/gzip")
        expect(response.headers["Content-Disposition"]).to include("attachment")
        expect(response.headers["Content-Disposition"]).to include(".ddobak-folder.tgz")
      end

      it "응답 본문은 scope=folder 매니페스트가 든 유효한 gzip+tar 스트림이다" do
        post "/api/v1/folders/#{folder.id}/export",
             params: { include_audio: false }, as: :json

        expect(response).to have_http_status(:ok)

        io = StringIO.new(response.body)
        manifest = nil
        Zlib::GzipReader.wrap(io) do |gz|
          Gem::Package::TarReader.new(gz) do |tar|
            tar.each do |entry|
              manifest = JSON.parse(entry.read) if entry.full_name == "manifest.json"
            end
          end
        end

        expect(manifest).not_to be_nil
        expect(manifest["scope"]).to eq("folder")
        expect(manifest["folders"].first["id"]).to eq(folder.id)
      end
    end

    context "비-editor (프로젝트 멤버, 폴더에 회의 없음)" do
      before { login_as(member) }

      it "403 Forbidden" do
        post "/api/v1/folders/#{folder.id}/export",
             params: { include_audio: false }, as: :json
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "비접근 (비멤버 — project membership 밖)" do
      before { login_as(outsider) }

      it "404 Not Found" do
        post "/api/v1/folders/#{folder.id}/export",
             params: { include_audio: false }, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ── IMPORT ─────────────────────────────────────────────────────────────

  describe "POST /api/v1/projects/:project_id/folders/import" do
    context "프로젝트 멤버(editor)" do
      before { login_as(editor) }

      it "201 + folder_id + meeting_ids 반환 + 폴더 레코드 생성" do
        archive = folder_archive

        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file(archive) }
        }.to change(Folder, :count).by(1)

        expect(response).to have_http_status(:created)
        body = response.parsed_body
        expect(body["folder_id"]).to be_present
        expect(body["meeting_ids"]).to be_an(Array)

        new_folder = Folder.find(body["folder_id"])
        expect(new_folder.project_id).to eq(project.id)
        expect(new_folder.id).not_to eq(folder.id)
      end
    end

    context "비멤버(outsider)" do
      before { login_as(outsider) }

      it "403 Forbidden + 폴더 생성 없음" do
        archive = folder_archive

        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file(archive) }
        }.not_to change(Folder, :count)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "scope 불일치 — 회의 아카이브를 폴더 import에 업로드" do
      before { login_as(editor) }

      it "422 Unprocessable + error 메시지" do
        bad_archive = meeting_archive_wrong_scope

        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file(bad_archive) }
        }.not_to change(Folder, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to be_present
      end
    end

    context "비-gzip 파일" do
      before { login_as(editor) }

      it "422 Unprocessable + error 메시지" do
        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file("이건 그냥 평문입니다 gzip 아님") }
        }.not_to change(Folder, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to be_present
      end
    end

    # ── 보안: cross-tenant parent_folder_id enumeration 제거 ──────────────

    context "parent_folder_id 가 존재하지 않는 ID" do
      before { login_as(editor) }

      it "404 Not Found + 폴더 생성 없음" do
        archive = folder_archive

        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file(archive), parent_folder_id: 999_999_999 }
        }.not_to change(Folder, :count)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "parent_folder_id 가 다른 프로젝트의 실재 폴더 (cross-tenant oracle 제거 확인)" do
      before { login_as(editor) }

      it "404 Not Found (422 아님) + 폴더 생성 없음" do
        other_project = create(:project, creator: create(:user))
        other_folder  = create(:folder, project: other_project)
        archive = folder_archive

        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file(archive), parent_folder_id: other_folder.id }
        }.not_to change(Folder, :count)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "parent_folder_id 가 대상 프로젝트의 유효 폴더 (happy path)" do
      before { login_as(editor) }

      it "201 + 새 폴더가 해당 부모 폴더 아래 생성" do
        parent = create(:folder, project: project, name: "부모 폴더")
        archive = folder_archive

        expect {
          post "/api/v1/projects/#{project.id}/folders/import",
               params: { file: upload_file(archive), parent_folder_id: parent.id }
        }.to change(Folder, :count).by(1)

        expect(response).to have_http_status(:created)
        new_folder = Folder.find(response.parsed_body["folder_id"])
        expect(new_folder.parent_id).to eq(parent.id)
      end
    end
  end
end
