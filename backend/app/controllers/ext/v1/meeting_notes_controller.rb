# /api/ext/v1/meetings/:id/notes — index(meetings:read)·create(meetings:write).
# "노트"는 Block(source: "ext_api")로 저장한다 — 회의 화면의 일반 사용자 블록(source: "user")과
# 같은 테이블에 섞이되, source로 출처를 구분해 GET에서 에이전트가 남긴 노트만 노출한다.
class Ext::V1::MeetingNotesController < Ext::V1::BaseController
  include Ext::V1::MeetingWriteAuthorization

  # 소유자는 Block::EXT_API_SOURCE(app/models/block.rb) — transcript_redaction_service.rb도
  # 동일 상수를 참조해 리터럴 드리프트를 막는다.
  EXT_NOTE_SOURCE = Block::EXT_API_SOURCE

  before_action -> { require_scope!("meetings:read") }, only: %i[index]
  before_action -> { require_scope!("meetings:write") }, only: %i[create]
  before_action :set_readable_meeting!, only: %i[index]
  before_action :set_writable_meeting!, only: %i[create]
  before_action :reject_if_meeting_redacted!, only: %i[create]
  before_action :reject_if_meeting_locked!, only: %i[create]

  # GET /api/ext/v1/meetings/:id/notes — source="ext_api" Block만(user 블록은 노출하지 않는다).
  def index
    audit!("notes.index", meeting_id: @meeting.id)

    notes = @meeting.blocks.where(source: EXT_NOTE_SOURCE).order(:position)
    render json: { notes: notes.map { |b| note_json(b) } }
  end

  # POST /api/ext/v1/meetings/:id/notes — 회의 블록 목록 말미에 append.
  def create
    content = params[:content].to_s
    return render_error(:unprocessable_entity, "invalid_content", "content은 필수입니다") if content.blank?

    audit!("notes.create", meeting_id: @meeting.id)

    # 말미 append: FractionalIndexing.position_for(nil, nil, meeting)이 정확히 그 의미
    # (blocks_controller.rb#create와 동일 호출 — 블록 없으면 DEFAULT_START, 있으면 last+GAP).
    position = FractionalIndexing.position_for(nil, nil, @meeting)
    block = @meeting.blocks.create!(
      block_type: "text",
      content: content,
      position: position,
      source: EXT_NOTE_SOURCE
    )

    render json: { note: note_json(block) }, status: :created
  end

  private

  # 읽기 인가 — Ext::V1::MeetingsController#set_meeting(Task B)와 동일 원칙(scoped_meetings
  # 범위 밖은 404). 쓰기 티어를 요구하지 않는다(GET은 meetings:read 스코프로 충분).
  def set_readable_meeting!
    @meeting = scoped_meetings.find_by(id: params[:id])
    render_not_found unless @meeting
  end

  def note_json(block)
    { id: block.id, content: block.content, created_at: block.created_at.iso8601 }
  end
end
