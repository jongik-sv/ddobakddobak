module Api
  module V1
    # 폴더 서브트리를 .ddobak-folder.tgz 로 내보내고/가져온다.
    # export: 대상 폴더의 접근·편집 권한(project 멤버십 + editable_by?).
    # import: 대상 프로젝트 멤버(create 권한) 전용(require_project!).
    class FolderTransfersController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_folder, only: %i[export export_summaries]

      # 업로드 상한. 오디오 동봉 시 3GB.
      MAX_IMPORT_BYTES = 3 * 1024 * 1024 * 1024

      # POST /api/v1/folders/:id/export  body { include_audio: bool }
      # → tar.gz 를 Tempfile 에 쓰고 send_file 스트리밍.
      def export
        return head :forbidden unless @folder.editable_by?(current_user)

        include_audio = boolean_param(:include_audio)
        exporter      = FolderExporter.new(@folder, include_audio: include_audio)

        tempfile = Tempfile.new(["folder-export", ".tgz"])
        tempfile.binmode
        exporter.write_to(tempfile)
        tempfile.flush

        send_file tempfile.path,
          type:        "application/gzip",
          disposition: "attachment",
          filename:    exporter.filename
      end

      # POST /api/v1/folders/:id/export_summaries
      # 서브트리 회의들의 AI 요약 md 를 폴더 구조 그대로 zip 으로 다운로드.
      # 권한: set_folder 의 멤버십 스코프(비멤버 404)만 — 읽기 행위라
      # export(tgz)와 달리 editable_by? 를 요구하지 않는다(멤버 누구나).
      def export_summaries
        exporter = SummaryZipExporter.new(folder: @folder)
        return render json: { error: "내보낼 요약이 없습니다" }, status: :unprocessable_entity if exporter.empty?

        send_zip(exporter)
      end

      # POST /api/v1/projects/:project_id/folders/import  multipart file=<tar.gz>, body { parent_folder_id? }
      # → 새 폴더 서브트리 복원 후 { folder_id:, meeting_ids:, warnings: } 반환.
      def import
        project = require_project!(params[:project_id])
        return unless project

        uploaded = params[:file]
        if uploaded.blank? || !uploaded.respond_to?(:tempfile)
          return render json: { error: "업로드 파일(file)이 필요합니다" }, status: :unprocessable_entity
        end

        if uploaded.size.to_i > MAX_IMPORT_BYTES
          return render json: { error: "업로드 파일이 너무 큽니다(최대 3GB)" }, status: :unprocessable_entity
        end

        unless Transfer::Archive.gzip_magic?(uploaded.tempfile)
          return render json: { error: "gzip 아카이브가 아닙니다(.ddobak-folder.tgz 형식 필요)" }, status: :unprocessable_entity
        end

        parent_folder = nil
        if params[:parent_folder_id].present?
          parent_folder = project.folders.find_by(id: params[:parent_folder_id])
          return render json: { error: "부모 폴더를 찾을 수 없습니다" }, status: :not_found unless parent_folder
        end

        result = FolderImporter.new(
          uploaded.tempfile,
          user:          current_user,
          project:       project,
          parent_folder: parent_folder
        ).run!
        render json: { folder_id: result[:folder_id], meeting_ids: result[:meeting_ids],
                       warnings: result[:warnings] }, status: :created
      rescue Transfer::Archive::UnsafeEntryError,
             Transfer::Archive::InvalidArchiveError,
             Zlib::GzipFile::Error,
             ActiveRecord::RecordInvalid => e
        render json: { error: "가져오기 실패: #{e.message}" }, status: :unprocessable_entity
      end

      private

      # Folder には accessible_by スコープがないため、プロジェクト멤버십 기반으로 로드.
      # 비멤버에게 폴더 존재를 漏洩しないように 404 を返す。
      def set_folder
        accessible_project_ids = if current_user.admin?
          # 남의 개인 프로젝트(personal=true, 소유자 ≠ current_user)는 override 제외.
          Project.where(personal: false).or(Project.where(id: current_user.project_ids)).select(:id)
        else
          ProjectMembership.where(user_id: current_user.id).select(:project_id)
        end
        @folder = Folder.where(project_id: accessible_project_ids).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Folder not found" }, status: :not_found
      end

      # "false" 문자열만 false, 미전달 시 true.
      def boolean_param(key)
        params.fetch(key, "true").to_s != "false"
      end

      def send_zip(exporter)
        tempfile = Tempfile.new([ "summaries-export", ".zip" ])
        tempfile.binmode
        exporter.write_to(tempfile)
        tempfile.flush

        send_file tempfile.path,
          type:        "application/zip",
          disposition: "attachment",
          filename:    exporter.filename
      end
    end
  end
end
