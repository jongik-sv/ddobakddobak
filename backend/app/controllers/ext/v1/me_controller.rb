# GET /api/ext/v1/me — 이 토큰 자체와 소유자 정보를 반환. 토큰 관리 도구(스킬 등)가
# 자신이 어떤 권한으로 호출 중인지 확인하는 용도.
class Ext::V1::MeController < Ext::V1::BaseController
  def show
    audit!("me.show")

    render json: {
      token: {
        name: api_token.name,
        token_prefix: api_token.token_prefix,
        scopes: api_token.scopes,
        expires_at: api_token.expires_at,
        project_ids: api_token.project_ids,
        folder_ids: api_token.folder_ids
      },
      user: {
        id: current_api_user.id,
        name: current_api_user.name,
        email: current_api_user.email
      }
    }
  end
end
