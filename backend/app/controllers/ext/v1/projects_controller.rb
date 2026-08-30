# GET /api/ext/v1/projects — 토큰 소유자가 멤버인 프로젝트 목록(토큰 project_ids 제한 교집합).
class Ext::V1::ProjectsController < Ext::V1::BaseController
  before_action -> { require_scope!("meetings:read") }

  def index
    audit!("projects.index")

    projects = Project.kept
                       .joins(:project_memberships)
                       .where(project_memberships: { user_id: current_api_user.id })
                       .distinct
    projects = projects.where(id: api_token.project_ids) if api_token.project_ids.present?

    render json: { projects: projects.order(:name).map { |p| serialize_project(p) } }
  end

  private

  def serialize_project(project)
    {
      id: project.id,
      name: project.name,
      personal: project.personal,
      created_at: project.created_at.iso8601
    }
  end
end
