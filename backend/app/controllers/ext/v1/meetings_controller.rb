# /api/ext/v1/meetings — 읽기 전용(index/show/transcripts/summary).
# 쓰기 액션(create/audio/summarize/notes)은 Ext::V1::MeetingWritesController·MeetingNotesController
# 소유(Task D) — 이 컨트롤러에는 절대 추가하지 않는다.
class Ext::V1::MeetingsController < Ext::V1::BaseController
  include Ext::V1::MeetingSerialization

  MAX_PER_PAGE = 100
  DEFAULT_PER_PAGE = 20

  before_action -> { require_scope!("meetings:read") }, only: %i[index show]
  before_action -> { require_scope!("transcripts:read") }, only: %i[transcripts]
  before_action -> { require_scope!("summaries:read") }, only: %i[summary]
  before_action :set_meeting, only: %i[show transcripts summary]

  def index
    audit!("meetings.index")

    meetings = scoped_meetings
    meetings = meetings.where(project_id: params[:project_id]) if params[:project_id].present?
    meetings = filter_by_folder(meetings)
    meetings = filter_by_date_range(meetings)
    meetings = meetings.where(status: params[:status]) if params[:status].present?
    meetings = meetings.order(created_at: :desc)

    page = [ params[:page].to_i, 1 ].max
    per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, MAX_PER_PAGE) : DEFAULT_PER_PAGE
    total = meetings.count
    records = meetings.offset((page - 1) * per_page).limit(per_page)

    render json: {
      meetings: records.map { |m| serialize_meeting_list_item(m) },
      meta: {
        page: page,
        per_page: per_page,
        total: total,
        total_pages: per_page.positive? ? (total.to_f / per_page).ceil : 0
      }
    }
  end

  def show
    audit!("meetings.show", meeting_id: @meeting.id)
    render json: { meeting: serialize_meeting_detail(@meeting) }
  end

  def transcripts
    audit!("meetings.transcripts", meeting_id: @meeting.id)

    ordered_transcripts = @meeting.transcripts.order(:sequence_number)
    render json: { transcripts: ordered_transcripts.map { |t| serialize_transcript(t) } }
  end

  def summary
    audit!("meetings.summary", meeting_id: @meeting.id)

    final_summary = @meeting.summaries.where(summary_type: "final").order(generated_at: :desc, id: :desc).first
    # 진행중 회의(recording/transcribing)는 final이 아직 없다 — realtime(매분 갱신되는 회의록)으로 폴백한다.
    summary = final_summary || @meeting.summaries.where(summary_type: "realtime").order(generated_at: :desc, id: :desc).first
    return render_error(:not_found, "summary_not_found", "요약이 없습니다") unless summary

    render json: { summary: serialize_ext_summary(summary) }
  end

  private

  # 존재 은폐 404 — scoped_meetings(토큰 범위 반영) 밖이면 권한 없음과 구분하지 않는다.
  def set_meeting
    @meeting = scoped_meetings.find_by(id: params[:id])
    render_not_found unless @meeting
  end

  def filter_by_folder(relation)
    return relation if params[:folder_id].blank?

    folder = Folder.kept.find_by(id: params[:folder_id])
    return relation.none unless folder

    # FoldersController#set_project와 동일한 토큰 project_ids 제한 — 필터로 지정한 폴더가
    # 토큰이 허용한 프로젝트 밖이면 존재하지 않는 폴더와 동일하게(빈 결과) 처리한다. scoped_meetings
    # 자체가 이미 project_id로 교집합하므로 실제 유출은 없었지만, 폴더 단위 인가 검사가 빠져 있었다.
    if api_token.project_ids.present? && api_token.project_ids.exclude?(folder.project_id)
      return relation.none
    end

    relation.where(folder_id: folder.subtree_ids)
  end

  def filter_by_date_range(relation)
    from = parse_time(params[:from])
    to = parse_time(params[:to])
    relation = relation.where(meetings: { created_at: from.. }) if from
    relation = relation.where(meetings: { created_at: ..to }) if to
    relation
  end

  # 잘못된 형식은 조용히 무시한다(필터 미적용) — 400 대신 관대하게 처리.
  def parse_time(value)
    return nil if value.blank?

    Time.zone.parse(value.to_s)
  rescue ArgumentError
    nil
  end
end
