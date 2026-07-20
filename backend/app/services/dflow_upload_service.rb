# 회의(Meeting)를 D'Flow 로 전송(upsert)한다.
# 스펙: tasks/dflow-minutes-upload/artifacts/ddobak-dflow-sender-spec.md §3.2.
#
# 사용법:
#   DflowUploadService.call(meeting, current_user, team_override: nil, title_override: nil)
#   → 성공: DflowClient#upload_minute 의 파싱된 응답 Hash(계약 §4.3) 반환. meeting.dflow_synced_at/dflow_url 갱신.
#   → 실패: 아래 전용 에러 중 하나를 raise(전송 없이 중단). DflowClient 의 통신 에러는 그대로 전파된다.
#
# 동기 실행 — 백그라운드 잡·자동 재시도는 v1 제외. 실패 시 사용자가 재클릭(멱등이라 안전).
class DflowUploadService
  BODY_MAX_CHARS = 100_000

  class NotEnabledError < StandardError; end
  class NotCompletedError < StandardError; end
  class NotesBlankError < StandardError; end
  class TeamRequiredError < StandardError; end
  class BodyTooLongError < StandardError; end

  def self.call(meeting, user, team_override: nil, title_override: nil)
    new(meeting, user, team_override: team_override, title_override: title_override).call
  end

  def initialize(meeting, user, team_override: nil, title_override: nil)
    @meeting = meeting
    @user = user
    @team_override = team_override.presence
    @title_override = title_override.presence
  end

  def call
    validate_preconditions!
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
      external_id: "ddobak:#{@meeting.public_uid}",
      on_conflict: "replace"
    }

    resp = client.upload_minute(payload)
    @meeting.update!(dflow_synced_at: Time.current, dflow_url: resp["url"])
    resp
  end

  private

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

  # team 판정(§1.3): override 우선, 아니면 최상위 폴더명 ∈ DflowClient#meta 의 teams.
  # override 가 있으면 meta 조회 자체를 하지 않는다(불필요한 네트워크 호출 방지).
  def resolve_team!
    return @team_override if @team_override

    candidate = @meeting.dflow_root_folder_name
    teams = client.meta["teams"].to_a
    return candidate if candidate.present? && teams.include?(candidate)

    raise TeamRequiredError, "team 을 자동으로 판정할 수 없습니다(폴더 미설정 또는 최상위 폴더명이 team 목록에 없음)"
  end

  def kst_date
    started = @meeting.started_at || Time.current
    started.in_time_zone("Asia/Seoul").strftime("%Y-%m-%d")
  end
end
