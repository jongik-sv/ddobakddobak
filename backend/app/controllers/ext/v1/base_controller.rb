# 세컨드 브레인 외부 공개 API(/api/ext/v1) 공통 베이스.
#
# ApplicationController를 절대 상속하지 않는다 — application_controller.rb의
# resolve_current_user는 SERVER_MODE가 아니거나 loopback 요청이면 로컬 admin(desktop@local)
# 으로 폴백하는 하이브리드 인증 함정을 갖고 있고, 외부 PAT 인증은 그 폴백과 완전히 무관한
# 독립 경로여야 하기 때문이다.
#
# ⚠️ 다만 ActionController::API도 :action_controller 로드훅을 타므로 Devise::Controllers::Helpers
# (current_user/authenticate_user!/user_signed_in?/warden/sign_in/sign_out)가 그대로 주입된다
# (실측 확인됨). 이걸 실수로 호출하면 웹 로그인 세션 인증이 조용히 섞여 들어가는 사고로 이어지므로
# 아래에서 명시적으로 undef해 호출 즉시 NoMethodError로 실패하게 막는다.
class Ext::V1::BaseController < ActionController::API
  DEVISE_HELPER_METHODS_TO_BLOCK = %i[
    current_user authenticate_user! user_signed_in? warden sign_in sign_out
  ].freeze

  DEVISE_HELPER_METHODS_TO_BLOCK.each do |m|
    undef_method(m) if method_defined?(m) || private_method_defined?(m)
  end

  # require_scope!가 스코프 부족 시 이 예외를 raise하고, rescue_from이 403을 렌더한다.
  # (이전엔 render만 하고 메서드가 반환돼 액션 본문 실행이 계속되는 버그가 있었다 — before_action
  # 에서 호출할 때는 halt됐지만, 액션 본문에서 직접 호출하면 가드로 동작하지 않았다.)
  class InsufficientScopeError < StandardError
    attr_reader :scope

    def initialize(scope)
      @scope = scope
      super("insufficient_scope: #{scope}")
    end
  end

  before_action :authenticate_api_token!

  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
  rescue_from InsufficientScopeError, with: :render_insufficient_scope

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

  # before_action에서든 액션 본문 중간에서든 항상 가드로 동작한다 — 통과 못 하면 즉시 raise해
  # 이후 코드가 실행되지 않는다(render만 하고 반환하는 이전 구현은 액션 본문 호출 시 계속 실행됨).
  def require_scope!(scope)
    raise InsufficientScopeError, scope unless api_token.has_scope?(scope)
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

  def render_insufficient_scope(exception)
    render_error(:forbidden, "insufficient_scope", "이 토큰에는 '#{exception.scope}' 스코프가 없습니다")
  end

  def render_error(status, code, message)
    render json: { error: { code: code, message: message } }, status: status
  end
end
