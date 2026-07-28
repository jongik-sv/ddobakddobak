# 이미 D'Flow로 전송된 회의(팀 루트에 평평하게 쌓인 것)를 실제 폴더 경로로 일괄 재편철한다.
# 워크리스트: tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md §7.2~§7.3-b.
# 계약: POST /minutes/folder(§4c) — 신규 생성·본문 갱신 없음, minutes.folder_id 만 바꾼다.
#
# 사용법:
#   DflowFolderMigrationService.call(actor_email: "donseok75@gmail.com")                    # dry-run
#   DflowFolderMigrationService.call(actor_email: "...", apply: true)                        # 실제 이동
#   DflowFolderMigrationService.call(actor_email: "...", apply: true, overwrite_manual: true,
#                                     meeting_ids: [ 12, 34 ])                                # §7.3-b ⑤ 부분 적용
#
# ⚠️ 대상 정의는 §7.2 그대로다 — §7.7(자동 링크, W15·W16)의 "대상 1" 정의(dflow_synced_at 없음
# AND exists_on_dflow==false)와 다른 개념이니 섞지 말 것. 여기서는 exists_on_dflow 를 보지 않는다
# — 그러려면 회의별 status 호출이 필요한데, 그건 §7.7 이 O(회의수) 패턴이라 명시적으로 금지한 것이다
# (§7.7 「감지 방법」 — linked=true 페이지 순회 1회로 대체). §7.2 는 애초에 "이미 전송된 회의를
# 편철만 다시 한다"이므로 D'Flow 존재 여부를 사전 확인할 필요가 없다 — 없어졌으면 배치가 건별로
# not_found/archived 로 보고한다.
class DflowFolderMigrationService
  BATCH_SIZE = 200 # D'Flow 요청당 상한(계약 §4c.1) — 초과분은 분할 호출.

  class ActorEmailRequiredError < StandardError; end
  class NotEnabledError < StandardError; end

  # §7.3-b ⑤: overwrite_manual 은 "사람이 대조해 D'Flow 위치가 오답이라고 판정한 건"에만 적용해야
  # 한다("items 한정이 유일한 부분 적용 수단"). meeting_ids 로 범위를 좁히지 않은 채 전체 대상에
  # 켜면, 사람이 다른 가지로 정리해 둔 회의까지 통째로 덮어써 §7.3·§4c.5 가 반복 경고하는 사고를
  # 코드가 직접 저지르게 된다. 그래서 범위 지정 없는 overwrite_manual 은 하드 거부한다.
  class OverwriteManualRequiresScopeError < StandardError; end

  def self.call(actor_email:, apply: false, overwrite_manual: false, meeting_ids: nil)
    new(actor_email: actor_email, apply: apply, overwrite_manual: overwrite_manual, meeting_ids: meeting_ids).call
  end

  def initialize(actor_email:, apply: false, overwrite_manual: false, meeting_ids: nil)
    @actor_email = actor_email.to_s.strip
    @apply = apply
    @overwrite_manual = overwrite_manual
    @meeting_ids = meeting_ids.presence
  end

  def call
    validate_preconditions!
    probe!

    targets = target_meetings.to_a
    eligible, excluded_name_too_long = partition_by_folder_name_length(targets)

    summary = empty_summary
    results = []
    folder_path_status_counts = Hash.new(0)

    eligible.each_slice(BATCH_SIZE) do |chunk|
      by_external_id = chunk.index_by { |m| external_id_for(m) }
      items = chunk.map { |m| build_item(m) }

      resp = client.folder_batch(
        user_email: @actor_email, items: items,
        dry_run: !@apply, overwrite_manual: @overwrite_manual
      )

      merge_summary!(summary, resp["summary"])
      raw_results(resp).each do |raw|
        meeting = by_external_id[raw["external_id"]]
        entry = build_item_summary(raw, meeting)
        results << entry
        folder_path_status_counts[entry[:folder_path_status]] += 1 if moved_with_status?(entry)
      end
    end

    {
      dry_run: !@apply,
      overwrite_manual: @overwrite_manual,
      actor_email: @actor_email,
      total_targets: targets.size,
      excluded_folder_name_too_long: excluded_name_too_long,
      summary: summary,
      folder_path_status_counts: folder_path_status_counts,
      # 절단(truncated)은 "성공으로 기록되는 오배치"라 APPLY 후 자기 복구가 안 된다(계약 §4c.2) —
      # dry-run 단계에서 걸러 사람이 확인할 수 있게 별도로 뽑아 둔다.
      truncated_or_partial: results.select { |r| moved_with_status?(r) && r[:folder_path_status] != "exact" },
      results: results
    }
  end

  private

  def client
    @client ||= DflowClient.new
  end

  def validate_preconditions!
    raise ActorEmailRequiredError, "ACTOR_EMAIL이 필요합니다 — 기본값을 추측하지 않습니다" if @actor_email.blank?

    cfg = AppSettings.load
    dflow_cfg = cfg["dflow"] || {}
    raise NotEnabledError, "D'Flow 연동이 비활성화되어 있습니다" unless dflow_cfg["enabled"]

    return unless @overwrite_manual
    return if @meeting_ids.present?

    raise OverwriteManualRequiresScopeError,
          "overwrite_manual 은 meeting_ids 로 범위를 좁힌 요청에만 허용됩니다(§7.3-b ⑤) — " \
          "전체 대상에 대한 overwrite_manual 은 사람이 정리해 둔 회의까지 덮어씁니다"
  end

  # 배치 시작 전 프로브(§7.0): 빈 items + dry_run:true 1회로 ACTOR_EMAIL 유효성(계정 실재·
  # pmo_admin 권한, §4c 머리말 role 게이트)을 확인한다. 실패 시 예외가 여기서 전파되어 대상
  # 1건도 보내기 전에 중단된다 — 잘못된 계정으로 수백 건을 전부 403 태우는 사고 방지.
  def probe!
    client.folder_batch(user_email: @actor_email, items: [], dry_run: true)
  end

  # §7.2 대상 정의(verbatim): 이미 전송된(dflow_synced_at 있음) + 삭제되지 않은 회의.
  # public_uid 존재는 방어적 필터 — dflow_synced_at 이 있으면 ensure_dflow_public_uid! 가 전송
  # 전에 이미 커밋했어야 하지만, 만에 하나 비어 있으면 items[].external_id 부재로 봉투 400을
  # 유발해 그 청크 전체가 죽으므로 여기서 미리 배제한다.
  def target_meetings
    scope = Meeting.where.not(dflow_synced_at: nil).where.not(public_uid: [ nil, "" ]).kept.order(:id)
    scope = scope.where(id: @meeting_ids) if @meeting_ids.present?
    scope
  end

  # W1(DflowUploadService)과 동일 코드 경로 재사용(§7.2 요건 1) — 별도 구현 금지.
  # team 키는 의도적으로 생략한다(§7.2 요건 2) — D'Flow가 회의록의 기존 team_code를 그대로 쓴다.
  def build_item(meeting)
    { external_id: external_id_for(meeting), folder_path: meeting.dflow_folder_path_names }
  end

  def external_id_for(meeting)
    "ddobak:#{meeting.public_uid}"
  end

  # 61자 이상 폴더가 체인에 있으면 전송 전에 걸러낸다(§7.2 요건 7, W4와 동일 검사·상수 재사용).
  # 길이는 DflowFolderName(NFC) 기준 — W1(DflowUploadService#validate_folder_path_names!)과
  # 동일 판정을 공유한다(사본 금지). 이유는 그쪽 주석 참고.
  def partition_by_folder_name_length(meetings)
    eligible = []
    excluded = []
    meetings.each do |m|
      names = m.dflow_folder_path_names
      offender = names.find { |n| DflowFolderName.too_long?(n) }
      if offender
        excluded << {
          meeting_id: m.id, external_id: external_id_for(m),
          folder_name: offender, length: DflowFolderName.normalize(offender).length, folder_path: names
        }
      else
        eligible << m
      end
    end
    [ eligible, excluded ]
  end

  # Kernel#Array() 는 Hash 를 쌍 배열로 바꿔버리므로(meeting_dflow_controller.rb 의 같은 함정
  # 참고) is_a? 로만 판정한다. 배열이 아니면(비정상 응답) 빈 배열로 취급한다.
  def raw_results(resp)
    results = resp["results"]
    results.is_a?(Array) ? results : []
  end

  def empty_summary
    { "total" => 0, "moved" => 0, "already_correct" => 0, "skipped" => 0, "not_found" => 0, "failed" => 0 }
  end

  def merge_summary!(summary, raw)
    raw = {} unless raw.is_a?(Hash)
    summary.each_key { |k| summary[k] += raw[k].to_i }
  end

  # from: string[] | null(§7.2 요건 9) — key 존재 여부와 null 을 구분해 그대로 보존한다(키 부재 =
  # 보고 대상 아님, null = 미분류. 둘을 같은 값으로 뭉개지 말 것 — 계약 §4c.2).
  # folder_path_status: moved 건에만 실린다(§7.2 요건 10) — 있으면 그대로 echo.
  def build_item_summary(raw, meeting)
    entry = { meeting_id: meeting&.id, external_id: raw["external_id"], status: raw["status"] }
    entry[:reason] = raw["reason"] if raw.key?("reason")
    entry[:from] = raw["from"] if raw.key?("from")
    entry[:to] = raw["to"] if raw.key?("to")
    entry[:folder_id] = raw["folder_id"] if raw.key?("folder_id")
    entry[:folder_path_status] = raw["folder_path_status"] if raw.key?("folder_path_status")
    entry
  end

  def moved_with_status?(entry)
    entry[:status] == "moved" && entry.key?(:folder_path_status)
  end
end
