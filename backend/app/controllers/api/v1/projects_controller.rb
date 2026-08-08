module Api
  module V1
    class ProjectsController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_project, only: %i[show update destroy members add_member update_member remove_member domain_files update_domain_files]
      before_action :authorize_project_admin!, only: %i[update destroy add_member update_member remove_member update_domain_files]

      def index
        # 개인 프로젝트는 소유자(멤버)에게만 — admin도 남의 개인 프로젝트는 목록에서 제외.
        projects = if current_user.admin?
          Project.kept.where(personal: false).or(Project.kept.where(id: current_user.project_ids)).includes(:creator)
        else
          current_user.projects.kept.includes(:creator)
        end
        projects = projects.distinct.to_a
        project_ids = projects.map(&:id)
        # role/member_count/meeting_count을 프로젝트당 쿼리 대신 사전 배치 조회(3쿼리)로 대체.
        # ⚠️ meeting_count는 원본대로 .kept 미적용(휴지통 포함 카운트) 유지.
        roles = ProjectMembership.where(project_id: project_ids, user_id: current_user.id)
                                  .pluck(:project_id, :role).to_h
        member_counts = ProjectMembership.where(project_id: project_ids).group(:project_id).count
        meeting_counts = Meeting.where(project_id: project_ids).group(:project_id).count
        render json: { projects: projects.map { |p| project_json(p, roles[p.id], member_counts[p.id] || 0, meeting_counts[p.id] || 0) } }
      end

      def show
        render json: { project: project_json(@project) }
      end

      def create
        unless current_user.manager_or_above?
          return render json: { error: "프로젝트를 생성할 권한이 없습니다" }, status: :forbidden
        end

        project = Project.new(project_params.merge(creator: current_user))
        if project.save
          ProjectMembership.create!(project: project, user: current_user, role: "admin")
          render json: { project: project_json(project) }, status: :created
        else
          render json: { errors: project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @project.update(project_params)
          render json: { project: project_json(@project) }
        else
          render json: { errors: @project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        if @project.personal?
          return render json: { error: "개인 프로젝트는 삭제할 수 없습니다" }, status: :conflict
        end
        Trash::SoftDeleter.call(@project, by: current_user)
        head :no_content
      end

      def members
        render json: { members: @project.project_memberships.includes(:user).map { |pm| member_json(pm) } }
      end

      def add_member
        if @project.personal?
          return render json: { error: "개인 프로젝트에는 멤버를 추가할 수 없습니다" }, status: :conflict
        end

        role = params[:role].presence || "member"
        unless %w[admin member].include?(role)
          return render json: { error: "잘못된 역할입니다" }, status: :unprocessable_entity
        end

        email = params[:email].to_s.strip
        name = params[:name].to_s.strip

        if params[:user_id].present?
          user = ::User.find_by(id: params[:user_id])
        elsif email.present?
          user = ::User.where("LOWER(email) = ?", email.downcase).first
        elsif name.present?
          matches = ::User.where("LOWER(name) = ?", name.downcase).to_a
          if matches.size > 1
            return render json: { candidates: matches.map { |u| { id: u.id, name: u.name, email: u.email } } }, status: :ok
          end
          user = matches.first
        else
          return render json: { error: "name 또는 email이 필요합니다" }, status: :unprocessable_entity
        end

        return render json: { error: "해당 사용자를 찾을 수 없습니다" }, status: :not_found unless user

        existing = @project.project_memberships.find_by(user_id: user.id)
        if existing
          return render json: { member: member_json(existing) }, status: :ok
        end

        pm = @project.project_memberships.create!(user: user, role: role)
        render json: { member: member_json(pm) }, status: :created
      end

      def update_member
        pm = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "멤버를 찾을 수 없습니다" }, status: :not_found unless pm
        if pm.update(role: params[:role])
          render json: { member: member_json(pm) }
        else
          render json: { errors: pm.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def remove_member
        pm = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "멤버를 찾을 수 없습니다" }, status: :not_found unless pm
        pm.destroy
        head :no_content
      end

      # 프로젝트에 링크된(적용된) 도메인 파일(용어집) 목록. 읽기는 멤버면 충분(set_project).
      def domain_files
        render json: { domain_files: project_domain_files_json(@project) }
      end

      # 프로젝트의 도메인 파일 링크 세트를 통째로 교체(빈 배열=전체 해제). 프로젝트 관리 권한 필요.
      def update_domain_files
        ids = Array(params[:domain_file_ids]).reject(&:blank?).map(&:to_i).uniq

        if ids.any?
          accessible_ids = DomainFile.accessible_by(current_user).where(id: ids).pluck(:id)
          if accessible_ids.sort != ids.sort
            return render json: { error: "선택할 수 없는 파일이 포함되어 있습니다" }, status: :unprocessable_entity
          end
        end

        ActiveRecord::Base.transaction do
          @project.domain_file_links.destroy_all
          ids.each { |id| @project.domain_file_links.create!(domain_file_id: id) }
        end

        render json: { domain_files: project_domain_files_json(@project.reload) }
      end

      private

      def set_project
        @project = require_project!(params[:id])
      end

      def authorize_project_admin!
        return if @project.nil? # require_project! 가 이미 렌더

        if @project.personal?
          # 개인 프로젝트: 기존 로직 그대로 — 소유자 본인(=프로젝트 admin)이면 시스템 role 무관 통과.
          return if project_admin_override?(@project) || @project.admin?(current_user)
        else
          # 팀 프로젝트: 시스템 manager 이상 + 프로젝트 admin(또는 override)이어야 관리 가능.
          return if current_user.manager_or_above? && (project_admin_override?(@project) || @project.admin?(current_user))
        end

        render json: { error: "프로젝트 관리 권한이 없습니다" }, status: :forbidden
      end

      def project_params
        params.permit(:name, :description, :icon_type, :icon_value, :color)
      end

      # role/member_count/meeting_count은 index의 배치 조회 결과를 넘길 때만 사용,
      # 그 외(show/create/update)는 nil로 두어 기존 per-record 쿼리 경로를 그대로 탄다.
      def project_json(p, role = :unset, member_count = nil, meeting_count = nil)
        {
          id: p.id, name: p.name, description: p.description,
          icon_type: p.icon_type, icon_value: p.icon_value, color: p.color,
          personal: p.personal,
          owner: p.creator&.name,
          role: role == :unset ? p.project_memberships.find_by(user_id: current_user.id)&.role : role,
          member_count: member_count || p.project_memberships.count,
          meeting_count: meeting_count || p.meetings.count
        }
      end

      def member_json(pm)
        { user_id: pm.user_id, name: pm.user.name, email: pm.user.email, role: pm.role }
      end

      def project_domain_files_json(project)
        project.domain_files.order("domain_file_links.id").map { |f| f.summary_json(current_user) }
      end
    end
  end
end
