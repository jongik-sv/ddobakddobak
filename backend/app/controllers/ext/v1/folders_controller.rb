# GET /api/ext/v1/projects/:project_id/folders — 프로젝트 전체 폴더 트리(평면 배열).
# 해당 프로젝트 멤버가 아니면(혹은 토큰 project_ids 제한 밖이면) 존재를 숨기는 404.
class Ext::V1::FoldersController < Ext::V1::BaseController
  before_action -> { require_scope!("meetings:read") }
  before_action :set_project

  def index
    audit!("folders.index")

    folders = Folder.kept.where(project_id: @project.id).ordered
    render json: { folders: folders.map { |f| serialize_folder(f) } }
  end

  private

  def set_project
    scope = Project.kept.where(id: params[:project_id])
    scope = scope.where(id: api_token.project_ids) if api_token.project_ids.present?
    @project = scope.first

    render_not_found unless @project && @project.member?(current_api_user)
  end

  def serialize_folder(folder)
    { id: folder.id, name: folder.name, parent_id: folder.parent_id, shared: folder.shared }
  end
end
