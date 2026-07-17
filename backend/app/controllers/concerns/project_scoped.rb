# 요청의 project_id 를 현재 프로젝트로 해석하고 멤버십을 강제한다.
# 전역 admin 은 모든 프로젝트 접근. 비멤버는 403.
module ProjectScoped
  extend ActiveSupport::Concern

  private

  # 멤버십(또는 admin) 확인된 Project 를 반환. 실패 시 render 후 nil.
  def require_project!(project_id = params[:project_id])
    if project_id.blank?
      render json: { error: "project_id is required" }, status: :bad_request
      return nil
    end
    project = Project.find_by(id: project_id)
    unless project
      render json: { error: "Project not found" }, status: :not_found
      return nil
    end
    unless project_admin_override?(project) || project.member?(current_user)
      render json: { error: "이 프로젝트에 접근할 권한이 없습니다" }, status: :forbidden
      return nil
    end
    project
  end

  # 시스템 admin의 override — 단 남의 개인 프로젝트(personal=true, 소유자 ≠ current_user)는 제외.
  def project_admin_override?(project)
    current_user.respond_to?(:admin?) && current_user.admin? && !project.blocks_admin_override?(current_user)
  end
end
