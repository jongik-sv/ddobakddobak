require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"

# 프로젝트 Export/Import HTTP 경계 테스트.
# - POST /api/v1/projects/:id/export  → admin 게이트 · tar.gz 다운로드
# - POST /api/v1/projects/import      → admin 게이트 · multipart 업로드 · 새 Project 생성(라운드트립)
RSpec.describe "Api::V1::ProjectTransfers", type: :request do
  before(:all) { Transcript.ensure_fts_tables! }

  let!(:admin) { create(:user, :admin) }
  let!(:non_admin) { create(:user) }

  # 시드 프로젝트 + 자식 일부 (라운드트립 검증용)
  let!(:project) { create(:project, creator: admin, name: "기획팀") }
  let!(:folder)  { create(:folder, project: project, name: "루트", parent: nil) }
  let!(:meeting) do
    create(:meeting, project: project, creator: admin, folder: folder,
                     title: "주간 회의")
  end
  let!(:transcript) { create(:transcript, meeting: meeting, content: "안녕하세요 회의 시작합니다") }
  let!(:tag)     { create(:tag, project: project, name: "긴급") }
  let!(:tagging) { Tagging.create!(tag: tag, taggable: meeting) }

  describe "POST /api/v1/projects/:id/export" do
    context "admin 으로 인증" do
      before { login_as(admin) }

      it "tar.gz 파일을 다운로드로 응답한다" do
        post "/api/v1/projects/#{project.id}/export",
             params: { include_audio: false }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.media_type).to eq("application/gzip")
        expect(response.headers["Content-Disposition"]).to include("attachment")
        expect(response.headers["Content-Disposition"]).to include(".ddobak.tgz")
      end

      it "응답 본문은 매니페스트가 든 유효한 gzip+tar 스트림이다" do
        post "/api/v1/projects/#{project.id}/export",
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
        expect(manifest["format_version"]).to eq(ProjectExporter::FORMAT_VERSION)
        expect(manifest["project"]["name"]).to eq("기획팀")
        expect(manifest["meetings"].size).to eq(1)
      end

      it "존재하지 않는 프로젝트는 404" do
        post "/api/v1/projects/999999/export",
             params: { include_audio: false }, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    context "비-admin 으로 인증" do
      before { login_as(non_admin) }

      it "403 을 반환한다" do
        post "/api/v1/projects/#{project.id}/export",
             params: { include_audio: false }, as: :json
        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  describe "POST /api/v1/projects/import" do
    # 시드 프로젝트를 tar.gz 로 내보내 업로드 파일로 사용한다.
    def export_archive(include_audio: false)
      io = StringIO.new
      ProjectExporter.new(project, include_audio: include_audio).write_to(io)
      io.string
    end

    def upload_file(bytes, filename: "export.ddobak.tgz")
      tmp = Tempfile.new([ "import", ".tgz" ])
      tmp.binmode
      tmp.write(bytes)
      tmp.rewind
      Rack::Test::UploadedFile.new(tmp.path, "application/gzip", true, original_filename: filename)
    end

    context "admin 으로 인증" do
      before { login_as(admin) }

      it "업로드된 아카이브로 새 프로젝트를 생성하고 project_id 를 반환한다" do
        archive = export_archive

        expect {
          post "/api/v1/projects/import",
               params: { file: upload_file(archive) }
        }.to change(Project, :count).by(1)

        expect(response).to have_http_status(:created)
        project_id = response.parsed_body["project_id"]
        expect(project_id).to be_present

        new_project = Project.find(project_id)
        expect(new_project.id).not_to eq(project.id)
        expect(new_project.name).to include("기획팀")
        expect(new_project.name).to include("(가져옴")
        expect(new_project.created_by_id).to eq(admin.id)
        # 라운드트립: 회의·트랜스크립트가 복원됨
        m = new_project.meetings.first
        expect(m).to be_present
        expect(m.transcripts.first.content).to eq("안녕하세요 회의 시작합니다")
      end

      it "file 파라미터가 없으면 422" do
        post "/api/v1/projects/import", params: {}
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "잘못된 아카이브(매니페스트 누락)는 422 와 에러 메시지" do
        bad = StringIO.new
        Zlib::GzipWriter.wrap(bad) do |gz|
          Gem::Package::TarWriter.new(gz) do |tar|
            tar.add_file_simple("not_manifest.txt", 0o644, 3) { |e| e.write("hi\n") }
          end
        end

        expect {
          post "/api/v1/projects/import",
               params: { file: upload_file(bad.string) }
        }.not_to change(Project, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to be_present
      end

      # F6: gzip 매직바이트(0x1f 0x8b) 사전 검증.
      it "비-gzip 업로드는 422 를 반환한다" do
        expect {
          post "/api/v1/projects/import",
               params: { file: upload_file("이건 그냥 평문입니다 gzip 아님") }
        }.not_to change(Project, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to be_present
      end
    end

    context "비-admin 으로 인증" do
      before { login_as(non_admin) }

      it "403 을 반환한다" do
        archive = export_archive
        expect {
          post "/api/v1/projects/import",
               params: { file: upload_file(archive) }
        }.not_to change(Project, :count)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
