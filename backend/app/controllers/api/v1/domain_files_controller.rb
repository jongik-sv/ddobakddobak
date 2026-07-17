module Api
  module V1
    # 도메인 파일(용어집) CRUD. 기존 glossary(오타교정 from→to)와 완전 별개 기능.
    # ActiveStorage 미사용 — content 는 domain_files.content(text)에 직저장(agenda_reference 선례).
    class DomainFilesController < ApplicationController
      before_action :authenticate_user!

      ALLOWED_UPLOAD_CONTENT_TYPES = %w[text/plain text/markdown].freeze
      MAX_UPLOAD_SIZE = 1.megabyte
      DOMAIN_TERM_FORMAT_ERROR = "도메인 용어 형식이 없습니다. `- **용어**: 설명` 형식의 라인이 1개 이상 필요합니다.".freeze
      # 확장자 → MIME 폴백(빈 content_type만 대상). meeting_attachment.rb 선례.
      EXTENSION_CONTENT_TYPES = { "md" => "text/markdown", "txt" => "text/plain" }.freeze

      def index
        scope = DomainFile.accessible_by(current_user)
        scope = scope.where(project_id: [ nil, params[:project_id] ]) if params[:project_id].present?

        render json: { domain_files: scope.order(:name).map { |f| summary_json(f) } }
      end

      def create
        if params[:file].present?
          create_from_upload
        else
          create_from_attrs(name: params[:name], content: params[:content] || "")
        end
      end

      def show
        df = DomainFile.find_by(id: params[:id])
        return render json: { error: "Not found" }, status: :not_found unless df
        unless accessible?(df)
          return render json: { error: "이 파일에 접근할 권한이 없습니다" }, status: :forbidden
        end

        render json: { domain_file: detail_json(df) }
      end

      def update
        df = DomainFile.find_by(id: params[:id])
        return render json: { error: "Not found" }, status: :not_found unless df
        unless df.editable_by?(current_user)
          return render json: { error: "이 파일을 수정할 권한이 없습니다" }, status: :forbidden
        end

        attrs = {}
        attrs[:name] = params[:name] if params.key?(:name)
        attrs[:content] = params[:content] if params.key?(:content)

        if df.update(attrs)
          render json: { domain_file: detail_json(df) }
        else
          render json: { errors: df.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        df = DomainFile.find_by(id: params[:id])
        return render json: { error: "Not found" }, status: :not_found unless df
        unless df.editable_by?(current_user)
          return render json: { error: "이 파일을 삭제할 권한이 없습니다" }, status: :forbidden
        end

        df.destroy
        head :no_content
      end

      def merge_terms
        df = DomainFile.find_by(id: params[:id])
        return render json: { error: "Not found" }, status: :not_found unless df
        unless df.editable_by?(current_user)
          return render json: { error: "이 파일을 수정할 권한이 없습니다" }, status: :forbidden
        end

        terms = params[:terms]
        # Rack::Test 등 form-encoded 클라이언트에서 빈 배열([])이 [""]로 왕복되는 경우가 있어
        # Hash-like 항목만 유효 term 후보로 취급한다.
        valid_terms = terms.is_a?(Array) ? terms.select { |t| t.is_a?(Hash) || t.is_a?(ActionController::Parameters) } : []
        unless valid_terms.any? { |t| term_value(t).present? }
          return render json: { error: "병합할 용어가 없습니다" }, status: :unprocessable_entity
        end

        result = df.merge_terms!(valid_terms)
        render json: { domain_file: detail_json(df), added: result[:added], replaced: result[:replaced] }
      end

      private

      def term_value(t)
        return "" unless t.is_a?(Hash) || t.is_a?(ActionController::Parameters)
        (t[:term] || t["term"]).to_s.strip
      end

      def accessible?(df)
        DomainFile.accessible_by(current_user).where(id: df.id).exists?
      end

      # project_id 지정 시 비멤버(비admin)는 403 처리 대상. nil(전역)은 항상 통과.
      # admin override는 남의 개인 프로젝트(personal=true, 소유자 ≠ current_user)에는 적용되지 않는다.
      def project_membership_ok?(project_id)
        return true if project_id.blank?

        if current_user.respond_to?(:admin?) && current_user.admin?
          project = ::Project.find_by(id: project_id)
          return true unless project&.blocks_admin_override?(current_user)
        end

        ProjectMembership.exists?(project_id: project_id, user_id: current_user.id)
      end

      # 업로드(파일) 경로에만 적용하는 형식 검증. 에디터 수기 작성(create_from_attrs)/update 는
      # 초안 작성을 허용하기 위해 검증하지 않는다.
      # (a) 유효 UTF-8, null byte 없음  (b) DomainFile::TERM_LINE_REGEX 매치 라인 1개 이상.
      def valid_domain_term_upload?(raw)
        return false unless raw.valid_encoding?
        return false if raw.include?("\x00")

        raw.each_line.any? { |line| DomainFile::TERM_LINE_REGEX.match?(line) }
      end

      def create_from_attrs(name:, content:)
        project_id = params[:project_id].presence
        unless project_membership_ok?(project_id)
          return render json: { error: "이 프로젝트에 파일을 생성할 권한이 없습니다" }, status: :forbidden
        end

        df = DomainFile.new(
          name: name,
          content: content,
          project_id: project_id,
          created_by_id: current_user.id
        )
        if df.save
          render json: { domain_file: detail_json(df) }, status: :created
        else
          render json: { errors: df.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def create_from_upload
        file = params[:file]
        project_id = params[:project_id].presence
        unless project_membership_ok?(project_id)
          return render json: { error: "이 프로젝트에 파일을 생성할 권한이 없습니다" }, status: :forbidden
        end

        content_type = file.content_type.to_s.split(";").first.to_s.strip
        if content_type.blank?
          ext = File.extname(file.original_filename.to_s).delete_prefix(".").downcase
          content_type = EXTENSION_CONTENT_TYPES[ext]
        end
        unless ALLOWED_UPLOAD_CONTENT_TYPES.include?(content_type)
          return render json: { error: "지원하지 않는 파일 형식입니다 (.md, .txt만 가능)" }, status: :unprocessable_entity
        end

        if file.size > MAX_UPLOAD_SIZE
          return render json: { error: "파일 크기가 너무 큽니다 (최대 1MB)" }, status: :unprocessable_entity
        end

        raw = file.read.force_encoding("UTF-8")
        unless valid_domain_term_upload?(raw)
          return render json: { error: DOMAIN_TERM_FORMAT_ERROR }, status: :unprocessable_entity
        end

        name = params[:name].presence || File.basename(file.original_filename.to_s, ".*")

        df = DomainFile.new(
          name: name,
          content: raw,
          project_id: project_id,
          created_by_id: current_user.id
        )
        if df.save
          render json: { domain_file: detail_json(df) }, status: :created
        else
          render json: { errors: df.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def summary_json(f)
        {
          id: f.id,
          name: f.name,
          project_id: f.project_id,
          created_by_id: f.created_by_id,
          content_chars: f.content.length,
          updated_at: f.updated_at,
          editable: f.editable_by?(current_user)
        }
      end

      def detail_json(f)
        summary_json(f).merge(content: f.content)
      end
    end
  end
end
