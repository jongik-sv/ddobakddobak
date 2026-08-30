# 세컨드 브레인 외부 공개 API(/api/ext/v1) 공통 베이스.
#
# ApplicationController를 절대 상속하지 않는다 — application_controller.rb의
# resolve_current_user는 SERVER_MODE가 아니거나 loopback 요청이면 로컬 admin(desktop@local)
# 으로 폴백하는 하이브리드 인증 함정을 갖고 있고, 외부 PAT 인증은 그 폴백과 완전히 무관한
# 독립 경로여야 하기 때문이다. warden/devise 훅도 거치지 않는다.
class Ext::V1::BaseController < ActionController::API
  before_action :authenticate_api_token!

  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found

  attr_reader :api_token, :current_api_user

  private

  def authenticate_api_token!
    plaintext = request.headers["Authorization"].to_s[/\ABearer\s+(.+)\z/, 1]
    @api_token = ApiToken.authenticate(plaintext)

    unless @api_token
      return render_error(:unauthorized, "unauthorized", "유효한 API 토큰이 필요합니다")
    end

    @current_api_user = @api_token.user
    @api_token.touch_last_used!
  end

  def require_scope!(scope)
    return if api_token.has_scope?(scope)

    render_error(:forbidden, "insufficient_scope", "이 토큰에는 '#{scope}' 스코프가 없습니다")
  end

  # scoped_meetings: B/C/D가 회의 조회·검색·쓰기에 공통으로 쓰는 범위 relation.
  # Meeting.ext_accessible_by ∩ 토큰의 project_ids(있으면) ∩ folder_ids(있으면, subtree 전개).
  def scoped_meetings
    relation = Meeting.ext_accessible_by(current_api_user)
    relation = relation.where(project_id: api_token.project_ids) if api_token.project_ids.present?

    if api_token.folder_ids.present?
      subtree_folder_ids = Folder.where(id: api_token.folder_ids).flat_map(&:subtree_ids).uniq
      relation = relation.where(folder_id: subtree_folder_ids)
    end

    relation
  end

  def audit!(action, meeting_id: nil)
    ApiTokenAuditLog.create!(
      api_token: api_token,
      action: action,
      meeting_id: meeting_id,
      path: request.fullpath,
      ip: request.remote_ip
    )
  end

  # 범위 밖 존재를 숨기는 공통 404 — "권한 없음"과 "존재 안 함"을 구분해 정보를 흘리지 않는다.
  def render_not_found(*)
    render_error(:not_found, "not_found", "요청한 리소스를 찾을 수 없습니다")
  end

  def render_error(status, code, message)
    render json: { error: { code: code, message: message } }, status: status
  end
end
