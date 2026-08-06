# 회의(Meeting)를 D'Flow 로 전송(upsert)한다.
# 스펙: tasks/dflow-minutes-upload/artifacts/ddobak-dflow-sender-spec.md §3.2.
#       회의 연결·생성 확장: tasks/dflow-meeting-select/artifacts/ddobak-meeting-select-design.md §2.2.
#
# 사용법:
#   DflowUploadService.call(meeting, current_user, team_override: nil, title_override: nil, meeting_option: nil)
#   → 성공: DflowClient#upload_minute 의 파싱된 응답 Hash(계약 §4.3) 반환. meeting.dflow_synced_at/dflow_url 갱신.
#   → 실패: 아래 전용 에러 중 하나를 raise(전송 없이 중단). DflowClient 의 통신 에러는 그대로 전파된다.
#
# meeting_option — 컨트롤러가 구조 검증(mode 화이트리스트·link/create 필드 혼재)까지 마친 뒤 넘기는 Hash:
#   { mode: "keep" | "link" | "unlink" | "create",
#     meeting_id: <uuid>,                                    # mode=link
#     project_id:, title:, date:, category:,                 # mode=create
#     display: { meeting_title:, project_name: } }           # link/create 시 스냅샷(표시 전용)
#   nil 또는 mode 부재 = "keep"(기존 동작과 완전 동일 — meeting 관련 키를 payload 에 넣지 않는다).
#
# 동기 실행 — 백그라운드 잡·자동 재시도는 v1 제외. 실패 시 사용자가 재클릭(멱등이라 안전).
class DflowUploadService
  BODY_MAX_CHARS = 100_000
  # D'Flow 폴더명 제약(워크리스트 D3 확정): 1~60자, 초과분은 400 거절(절단 안 함).
  # 또박또박은 폴더명을 100자까지 허용하므로 서버에서 미리 걸러야 D'Flow 400 원문이 노출되지 않는다.
  # 실제 값·정규화 규칙은 DflowFolderName(app/lib) 이 단일 소스 — 여기선 참조만 유지.
  FOLDER_NAME_MAX_CHARS = DflowFolderName::MAX_CHARS

  # meeting.mode 화이트리스트(계약 §2.2) — 컨트롤러의 400 검증과 이 서비스가 같은 소스를 본다.
  MEETING_MODES = %w[keep link unlink create].freeze
  MEETING_TITLE_MAX_CHARS = 200
  # D'Flow 회의 category 6종(계약 §1.2) — MEETING_CATEGORIES 하드코딩은 이 상수가 유일한 소스.
  MEETING_CATEGORIES = %w[routine general kickoff review report external].freeze
  MEETING_DATE_RE = /\A\d{4}-\d{2}-\d{2}\z/

  class NotEnabledError < StandardError; end
  class NotCompletedError < StandardError; end
  class NotesBlankError < StandardError; end
  class TeamRequiredError < StandardError; end
  class BodyTooLongError < StandardError; end
  class FolderNameTooLongError < StandardError; end
  # mode=create 필드 검증 실패(제목 presence/길이, 날짜 형식, category enum, project_id presence).
  class MeetingValidationError < StandardError; end

  def self.call(meeting, user, team_override: nil, title_override: nil, meeting_option: nil)
    new(meeting, user, team_override: team_override, title_override: title_override,
                        meeting_option: meeting_option).call
  end

  def initialize(meeting, user, team_override: nil, title_override: nil, meeting_option: nil)
    @meeting = meeting
    @user = user
    @team_override = team_override.presence
    @title_override = title_override.presence
    @meeting_option = (meeting_option || {}).symbolize_keys
    @meeting_mode = @meeting_option[:mode].presence || "keep"
  end

  def call
    validate_preconditions!
    validate_folder_path_names!
    validate_meeting_option!
    team = resolve_team!
    title = @title_override || @meeting.dflow_auto_title

    body = MarkdownExporter.new(@meeting, include_transcript: false).call
    if body.length > BODY_MAX_CHARS
      raise BodyTooLongError, "본문이 #{BODY_MAX_CHARS}자를 초과합니다(#{body.length}자) — 자동 절단하지 않습니다"
    end

    # 발급 순서 불변 규칙(§1.2): uuid 생성 → 커밋은 Meeting#ensure_dflow_public_uid! 단일 소스에
    # 위임한다(MeetingDflowController#claim 과 로직을 공유 — 두 곳에 흩어지지 않게).
    @meeting.ensure_dflow_public_uid!

    payload = {
      user_email: @user.email,
      date: kst_date,
      team: team,
      title: title,
      body_markdown: body,
      # 편철 경로(root-first). 3값 규약(§3.4): 키 부재=구버전(기존 위치 유지) /
      # []=명시적 폴더 없음(팀 루트로 되돌림) / 배열=그 경로.
      # 폴더 없는 회의도 키를 생략하지 않고 [] 를 보낸다 — 생략하면 폴더에서 빼는 조작이 전파되지 않는다.
      folder_path: @meeting.dflow_folder_path_names,
      external_id: "ddobak:#{@meeting.public_uid}",
      on_conflict: "replace"
    }
    apply_meeting_option_to_payload!(payload)

    resp = client.upload_minute(payload)
    apply_dflow_meeting_response!(resp)
    resp
  end

  private

  # meeting 옵션 3값 규약(계약 §2.2): keep(기본) = 키 부재 / link = meeting_id: uuid /
  # unlink = meeting_id: null(키는 반드시 포함) / create = meeting: {...}.
  def apply_meeting_option_to_payload!(payload)
    case @meeting_mode
    when "link"
      payload[:meeting_id] = @meeting_option[:meeting_id]
    when "unlink"
      # 명시적 null 직렬화 — 키를 넣고 값만 nil(Hash#to_json 이 "meeting_id":null 로 낸다).
      payload[:meeting_id] = nil
    when "create"
      payload[:meeting] = {
        project_id: @meeting_option[:project_id],
        title: @meeting_option[:title].to_s.strip,
        date: @meeting_option[:date],
        category: meeting_category
      }
    end
    # keep: 아무 키도 추가하지 않는다 — D'Flow가 기존 연결을 유지(§2.2).
  end

  # 성공 응답 처리(계약 §2.2): keep이면 3필드 update 대상에서 제외(기존 값 유지),
  # unlink 성공 시 3필드 모두 nil, link/create 시 확보된 id + 표시 스냅샷 저장.
  def apply_dflow_meeting_response!(resp)
    update_attrs = { dflow_synced_at: Time.current, dflow_url: resp["url"] }
    case @meeting_mode
    when "unlink"
      update_attrs[:dflow_meeting_id] = nil
      update_attrs[:dflow_meeting_title] = nil
      update_attrs[:dflow_project_name] = nil
    when "link", "create"
      update_attrs[:dflow_meeting_id] = resp["meeting_id"]
      update_attrs[:dflow_meeting_title] = meeting_display_title
      update_attrs[:dflow_project_name] = meeting_display_project_name
    end
    @meeting.update!(update_attrs)
  end

  def meeting_display
    (@meeting_option[:display] || {}).symbolize_keys
  end

  def meeting_display_title
    meeting_display[:meeting_title]
  end

  def meeting_display_project_name
    meeting_display[:project_name]
  end

  def meeting_category
    @meeting_option[:category].presence || "general"
  end

  # mode=create 사전 검증(계약 §1.2): 제목 presence·≤200자, 날짜 YYYY-MM-DD, category 6종 enum,
  # project_id presence. keep/link/unlink 는 여기서 별도 검증할 필드가 없다(link의 meeting_id
  # presence·link·create 동시 지정 방어는 컨트롤러 400 — 계약 §2.3).
  def validate_meeting_option!
    return unless @meeting_mode == "create"

    raise MeetingValidationError, "meeting.project_id 가 필요합니다" if @meeting_option[:project_id].to_s.blank?

    title = @meeting_option[:title].to_s.strip
    raise MeetingValidationError, "회의 제목을 입력하세요" if title.blank?
    if title.length > MEETING_TITLE_MAX_CHARS
      raise MeetingValidationError, "회의 제목은 #{MEETING_TITLE_MAX_CHARS}자를 초과할 수 없습니다(#{title.length}자)"
    end

    date = @meeting_option[:date].to_s
    unless date.match?(MEETING_DATE_RE)
      raise MeetingValidationError, "회의 날짜는 YYYY-MM-DD 형식이어야 합니다"
    end

    category = meeting_category
    unless MEETING_CATEGORIES.include?(category)
      raise MeetingValidationError, "회의 구분은 #{MEETING_CATEGORIES.join('/')} 중 하나여야 합니다"
    end
  end

  def client
    @client ||= DflowClient.new
  end

  def validate_preconditions!
    cfg = AppSettings.load
    dflow_cfg = cfg["dflow"] || {}
    raise NotEnabledError, "D'Flow 연동이 비활성화되어 있습니다" unless dflow_cfg["enabled"]
    raise NotCompletedError, "완료된 회의만 전송할 수 있습니다" unless @meeting.status == "completed"
    raise NotesBlankError, "전송할 회의록 내용이 없습니다" if @meeting.current_notes_markdown.blank?
  end

  # 폴더명 길이 사전 검사(워크리스트 W4·D3): D'Flow가 61자 이상을 400으로 거절하므로 여기서
  # 전용 에러로 먼저 막는다 — D'Flow 400 원문을 그대로 노출하면 사용자가 어느 폴더가 문제인지 알 수 없다.
  # 길이는 DflowFolderName(btrim + NFC) 기준으로 잰다 — D'Flow 자체가 NFC 정규화 이후 길이로
  # 60자를 판정하므로(계약 §0 D20), NFD로 저장된 한글 폴더명(자모 분리로 원문 길이가 부풀어
  # 보임)을 원문 길이로만 재면 D'Flow에선 통과할 이름을 여기서 선제 거절하게 된다.
  # 체인 중 첫 위반 폴더 하나만 보고한다 — root-first 순서라 사용자가 보는 폴더 트리 순서와 일치한다.
  def validate_folder_path_names!
    offender = @meeting.dflow_folder_path_names.find { |name| DflowFolderName.too_long?(name) }
    return unless offender

    normalized_length = DflowFolderName.normalize(offender).length
    raise FolderNameTooLongError,
          "폴더명 \"#{offender}\"이(가) #{FOLDER_NAME_MAX_CHARS}자를 초과합니다(#{normalized_length}자) — " \
          "D'Flow는 폴더명을 #{FOLDER_NAME_MAX_CHARS}자까지만 허용합니다. 폴더명을 줄인 뒤 다시 시도하세요."
  end

  # team 판정(§1.3): override 우선, 아니면 최상위 폴더명 ∈ DflowClient#meta 의 teams.
  # override 가 있으면 meta 조회 자체를 하지 않는다(불필요한 네트워크 호출 방지).
  # 동등 비교는 DflowFolderName(NFC) 기준 — candidate(우리 DB, NFD로 저장됐을 수 있음)와
  # teams(D'Flow meta, NFC 리터럴)를 원문 그대로 비교하면 같은 이름인데도 매칭이 깨진다
  # (예: 유일한 한글 team "가공"). 일치하면 teams 쪽 리터럴(정본, 항상 NFC)을 반환한다 —
  # candidate 원문을 그대로 돌려주면 이후 로그·표시에 NFD 바이트가 새어나갈 수 있어서다.
  def resolve_team!
    return @team_override if @team_override

    candidate = @meeting.dflow_root_folder_name
    teams = client.meta["teams"].to_a
    matched = candidate.present? ? teams.find { |t| DflowFolderName.matches?(t, candidate) } : nil
    return matched if matched

    raise TeamRequiredError, "team 을 자동으로 판정할 수 없습니다(폴더 미설정 또는 최상위 폴더명이 team 목록에 없음)"
  end

  def kst_date
    started = @meeting.started_at || Time.current
    started.in_time_zone("Asia/Seoul").strftime("%Y-%m-%d")
  end
end
