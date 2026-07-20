require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"

# 회의 Export/Import HTTP 경계 테스트.
# - POST /api/v1/meetings/:id/export    → editable_by? 게이트 · tar.gz 다운로드
# - POST /api/v1/projects/:project_id/meetings/import  → 멤버십 게이트 · multipart 업로드 · 새 Meeting 생성
RSpec.describe "Api::V1::MeetingTransfers", type: :request do
  before(:all) { Transcript.ensure_fts_tables! }

  let!(:editor)   { create(:user) }        # 회의 소유자 = editable_by? 통과
  let!(:member)   { create(:user) }        # 프로젝트 멤버, 비소유자 = editable_by? 실패
  let!(:outsider) { create(:user) }        # 비멤버 = accessible_by 실패

  let!(:project) { create(:project, creator: editor) }

  # editor 소유 + shared=true → member도 읽기 가능, 편집 불가
  let!(:meeting) do
    create(:meeting, creator: editor, project: project, shared: true, title: "내보내기 테스트")
  end

  before do
    # member를 프로젝트 멤버로 추가 (meeting factory after_create가 editor는 이미 추가)
    ProjectMembership.find_or_create_by!(project_id: project.id, user_id: member.id) do |pm|
      pm.role = "member"
    end
  end

  # ── 헬퍼 ──────────────────────────────────────────────────────────────

  def meeting_archive(include_audio: false)
    io = StringIO.new
    MeetingExporter.new(meeting, include_audio: include_audio).write_to(io)
    io.string
  end

  # 폴더 아카이브 = scope:"folder" — meeting import에 올리면 422
  def folder_archive_wrong_scope
    folder = create(:folder, project: project)
    io = StringIO.new
    FolderExporter.new(folder, include_audio: false).write_to(io)
    io.string
  end

  def upload_file(bytes, filename: "export.tgz")
    tmp = Tempfile.new(["meeting-import-test", ".tgz"])
    tmp.binmode
    tmp.write(bytes)
    tmp.rewind
    Rack::Test::UploadedFile.new(tmp.path, "application/gzip", true, original_filename: filename)
  end

  # ── EXPORT ─────────────────────────────────────────────────────────────

  describe "POST /api/v1/meetings/:id/export" do
    context "editor (소유자)" do
      before { login_as(editor) }

      it "200 + gzip Content-Type + .ddobak-meeting.tgz 파일명" do
        post "/api/v1/meetings/#{meeting.id}/export",
             params: { include_audio: false }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.media_type).to eq("application/gzip")
        expect(response.headers["Content-Disposition"]).to include("attachment")
        expect(response.headers["Content-Disposition"]).to include(".ddobak-meeting.tgz")
      end

      it "응답 본문은 scope=meeting 매니페스트가 든 유효한 gzip+tar 스트림이다" do
        post "/api/v1/meetings/#{meeting.id}/export",
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
        expect(manifest["scope"]).to eq("meeting")
        expect(manifest["meeting"]["id"]).to eq(meeting.id)
      end
    end

    context "비-editor (프로젝트 멤버, 비소유자)" do
      before { login_as(member) }

      it "403 Forbidden" do
        post "/api/v1/meetings/#{meeting.id}/export",
             params: { include_audio: false }, as: :json
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "비접근 (비멤버 — accessible_by 스코프 밖)" do
      before { login_as(outsider) }

      it "404 Not Found" do
        post "/api/v1/meetings/#{meeting.id}/export",
             params: { include_audio: false }, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ── IMPORT ─────────────────────────────────────────────────────────────

  describe "POST /api/v1/projects/:project_id/meetings/import" do
    context "프로젝트 멤버(editor)" do
      before { login_as(editor) }

      it "201 + meeting_id 반환 + 회의 레코드 생성" do
        archive = meeting_archive

        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file(archive) }
        }.to change(Meeting, :count).by(1)

        expect(response).to have_http_status(:created)
        new_id = response.parsed_body["meeting_id"]
        expect(new_id).to be_present
        new_meeting = Meeting.find(new_id)
        expect(new_meeting.project_id).to eq(project.id)
        expect(new_meeting.id).not_to eq(meeting.id)
      end
    end

    context "비멤버(outsider)" do
      before { login_as(outsider) }

      it "403 Forbidden + 회의 생성 없음" do
        archive = meeting_archive

        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file(archive) }
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "scope 불일치 — 폴더 아카이브를 회의 import에 업로드" do
      before { login_as(editor) }

      it "422 Unprocessable + error 메시지" do
        bad_archive = folder_archive_wrong_scope

        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file(bad_archive) }
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to be_present
      end
    end

    context "비-gzip 파일" do
      before { login_as(editor) }

      it "422 Unprocessable + error 메시지" do
        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file("이건 그냥 평문입니다 gzip 아님") }
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to be_present
      end
    end

    # ── 보안: cross-tenant folder enumeration 제거 ──────────────────────────

    context "folder_id 가 존재하지 않는 ID" do
      before { login_as(editor) }

      it "404 Not Found + 회의 생성 없음" do
        archive = meeting_archive

        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file(archive), folder_id: 999_999_999 }
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "folder_id 가 다른 프로젝트의 실재 폴더 (cross-tenant oracle 제거 확인)" do
      before { login_as(editor) }

      it "404 Not Found (422 아님) + 회의 생성 없음" do
        other_project = create(:project, creator: create(:user))
        other_folder  = create(:folder, project: other_project)
        archive = meeting_archive

        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file(archive), folder_id: other_folder.id }
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "folder_id 가 대상 프로젝트의 유효 폴더 (happy path)" do
      before { login_as(editor) }

      it "201 + 새 회의가 해당 폴더에 생성" do
        target_folder = create(:folder, project: project)
        archive = meeting_archive

        expect {
          post "/api/v1/projects/#{project.id}/meetings/import",
               params: { file: upload_file(archive), folder_id: target_folder.id }
        }.to change(Meeting, :count).by(1)

        expect(response).to have_http_status(:created)
        new_meeting = Meeting.find(response.parsed_body["meeting_id"])
        expect(new_meeting.folder_id).to eq(target_folder.id)
      end
    end

    # ── T7: public_uid 충돌 warnings 노출 ──────────────────────────────────

    context "public_uid 충돌 아카이브 import (T7)" do
      before { login_as(editor) }

      it "201 + warnings 1건을 응답에 포함한다" do
        meeting.update_columns(
          public_uid:      "0199abc0-0000-7000-8000-000000000077",
          dflow_synced_at: Time.zone.parse("2026-07-01 10:00:00"),
          dflow_url:       "https://dflow.example.com/meetings/abc"
        )
        archive = meeting_archive

        post "/api/v1/projects/#{project.id}/meetings/import",
             params: { file: upload_file(archive) }

        expect(response).to have_http_status(:created)
        body = response.parsed_body
        expect(body["warnings"]).to contain_exactly(
          "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"
        )
      end

      it "충돌이 없으면 warnings 는 빈 배열이다" do
        archive = meeting_archive

        post "/api/v1/projects/#{project.id}/meetings/import",
             params: { file: upload_file(archive) }

        expect(response).to have_http_status(:created)
        expect(response.parsed_body["warnings"]).to eq([])
      end
    end
  end
end
