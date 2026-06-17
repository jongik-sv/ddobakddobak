module Api
  module V1
    # 프로젝트 1개를 .tar.gz(ddobak 전용 포맷)로 내보내고/가져온다.
    # 둘 다 시스템 admin 전용(User#admin?). 내보낸 아카이브는 다른 기기에서
    # 새 Project 로 복원된다(머지·멱등 없음, 항상 새 프로젝트).
    class ProjectTransfersController < ApplicationController
      before_action :authenticate_user!
      before_action :require_system_admin!
      before_action :set_project, only: %i[export]

      # 업로드 상한(설계문서 §보안). 오디오 동봉 시 회의가 많아도 여유 있게 3GB.
      MAX_IMPORT_BYTES = 3 * 1024 * 1024 * 1024

      # POST /api/v1/projects/:id/export  body { include_audio: bool }
      # → tar.gz 를 Tempfile 에 쓰고 디스크에서 스트리밍 전송(send_file). 대용량을
      #   Ruby String 으로 통째 RAM 에 올리지 않는다.
      def export
        include_audio = boolean_param(:include_audio)

        tempfile = Tempfile.new([ "project-export", ".tgz" ])
        tempfile.binmode
        ProjectExporter.new(@project, include_audio: include_audio).write_to(tempfile)
        tempfile.flush

        # send_file 은 지연(스트리밍) 전송이라 ensure 에서 즉시 unlink 하면 안 된다.
        # Tempfile finalizer(GC) 가 응답 전송 후 정리하도록 둔다.
        send_file tempfile.path,
          type:        "application/gzip",
          disposition: "attachment",
          filename:    export_filename(@project)
      end

      # POST /api/v1/projects/import  multipart file=<tar.gz>
      # → ProjectImporter 로 새 Project 복원 후 { project_id: } 반환.
      def import
        uploaded = params[:file]
        if uploaded.blank? || !uploaded.respond_to?(:tempfile)
          return render json: { error: "업로드 파일(file)이 필요합니다" }, status: :unprocessable_entity
        end

        if uploaded.size.to_i > MAX_IMPORT_BYTES
          return render json: { error: "업로드 파일이 너무 큽니다(최대 3GB)" }, status: :unprocessable_entity
        end

        unless gzip_magic?(uploaded.tempfile)
          return render json: { error: "gzip 아카이브가 아닙니다(.ddobak.tgz 형식 필요)" }, status: :unprocessable_entity
        end

        project = ProjectImporter.new(uploaded.tempfile, current_user).run!
        render json: { project_id: project.id }, status: :created
      rescue ProjectImporter::UnsafeEntryError,
             ProjectImporter::InvalidArchiveError,
             Zlib::GzipFile::Error,
             ActiveRecord::RecordInvalid => e
        render json: { error: "가져오기 실패: #{e.message}" }, status: :unprocessable_entity
      end

      private

      # export·import 둘 다 시스템 admin 게이트(설계문서 §보안).
      def require_system_admin!
        render json: { error: "Forbidden" }, status: :forbidden unless current_user&.admin?
      end

      def set_project
        @project = Project.find(params[:id])
      end

      # "false" 문자열만 false 로 해석하고, 미전달 시 true.
      def boolean_param(key)
        params.fetch(key, "true").to_s != "false"
      end

      # gzip 매직바이트(0x1f 0x8b) 사전 검증. 비-gzip 업로드를 임포터 실행 전에 422 로 끊는다.
      def gzip_magic?(tempfile)
        return false unless tempfile.respond_to?(:read)
        tempfile.rewind if tempfile.respond_to?(:rewind)
        head = tempfile.read(2)
        tempfile.rewind if tempfile.respond_to?(:rewind)
        head.is_a?(String) && head.bytesize == 2 &&
          head.getbyte(0) == 0x1f && head.getbyte(1) == 0x8b
      end

      # <slug>-export-YYYYMMDD.ddobak.tgz
      def export_filename(project)
        slug = project.name.to_s.parameterize
        slug = "project" if slug.blank?
        "#{slug}-export-#{Date.current.strftime('%Y%m%d')}.ddobak.tgz"
      end
    end
  end
end
