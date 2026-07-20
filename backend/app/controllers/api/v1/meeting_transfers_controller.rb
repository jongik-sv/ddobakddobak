module Api
  module V1
    # 회의 1건을 .ddobak-meeting.tgz 로 내보내고/가져온다.
    # export: 대상 회의의 소유자/admin 전용(editable_by?).
    # import: 대상 프로젝트 멤버(create 권한) 전용(require_project!).
    class MeetingTransfersController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_meeting, only: %i[export]

      # 업로드 상한. 오디오 동봉 시 3GB.
      MAX_IMPORT_BYTES = 3 * 1024 * 1024 * 1024

      # POST /api/v1/meetings/:id/export  body { include_audio: bool }
      # → tar.gz 를 Tempfile 에 쓰고 send_file 스트리밍.
      def export
        return head :forbidden unless @meeting.editable_by?(current_user)

        include_audio = boolean_param(:include_audio)
        exporter      = MeetingExporter.new(@meeting, include_audio: include_audio)

        tempfile = Tempfile.new(["meeting-export", ".tgz"])
        tempfile.binmode
        exporter.write_to(tempfile)
        tempfile.flush

        send_file tempfile.path,
          type:        "application/gzip",
          disposition: "attachment",
          filename:    exporter.filename
      end

      # POST /api/v1/projects/:project_id/meetings/import  multipart file=<tar.gz>, body { folder_id? }
      # → 새 Meeting 복원 후 { meeting_id:, warnings: } 반환.
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
          return render json: { error: "gzip 아카이브가 아닙니다(.ddobak-meeting.tgz 형식 필요)" }, status: :unprocessable_entity
        end

        folder = nil
        if params[:folder_id].present?
          folder = project.folders.find_by(id: params[:folder_id])
          return render json: { error: "폴더를 찾을 수 없습니다" }, status: :not_found unless folder
        end

        result = MeetingImporter.new(
          uploaded.tempfile,
          user:    current_user,
          project: project,
          folder:  folder
        ).run!
        render json: { meeting_id: result[:meeting_id], warnings: result[:warnings] }, status: :created
      rescue Transfer::Archive::UnsafeEntryError,
             Transfer::Archive::InvalidArchiveError,
             Zlib::GzipFile::Error,
             ActiveRecord::RecordInvalid => e
        render json: { error: "가져오기 실패: #{e.message}" }, status: :unprocessable_entity
      end

      private

      # accessible_by 스코프로 읽기 인가까지 포함. 비접근(비멤버·비공유) 시 404.
      def set_meeting
        @meeting = Meeting.accessible_by(current_user).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      # "false" 문자열만 false, 미전달 시 true.
      def boolean_param(key)
        params.fetch(key, "true").to_s != "false"
      end
    end
  end
end
