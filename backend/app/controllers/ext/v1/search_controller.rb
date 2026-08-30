# GET /api/ext/v1/search — 하이브리드(FTS+벡터 RRF) 회의 검색. search:read 스코프 필요.
# 인가 경계는 BaseController#scoped_meetings(+선택적 project_id/folder_id 필터) 하나뿐이며,
# 그 결과를 ExtMeetingSearch에 relation 그대로 넘긴다(서비스 내부에서 pluck(:id)로 재확정).
class Ext::V1::SearchController < Ext::V1::BaseController
  before_action { require_scope!("search:read") }

  DEFAULT_LIMIT = 20
  MAX_LIMIT     = 50

  def index
    q = params[:q].to_s.strip
    return render_error(:unprocessable_entity, "query_required", "검색어(q)가 필요합니다") if q.blank?

    audit!("search.index")

    result = ExtMeetingSearch.call(user: current_api_user, meetings: filtered_meetings, q: q, limit: resolved_limit)

    render json: {
      results: {
        transcripts: result.transcript_results,
        summaries: result.summary_results
      },
      meta: { query: q, vector_used: result.vector_used }
    }
  end

  private

  def filtered_meetings
    relation = scoped_meetings
    relation = relation.where(project_id: params[:project_id]) if params[:project_id].present?

    if params[:folder_id].present?
      subtree_ids = Folder.where(id: params[:folder_id]).flat_map(&:subtree_ids).uniq
      relation = relation.where(folder_id: subtree_ids)
    end

    relation
  end

  def resolved_limit
    val = params[:limit].presence&.to_i
    return DEFAULT_LIMIT if val.blank? || val <= 0
    [ val, MAX_LIMIT ].min
  end
end
