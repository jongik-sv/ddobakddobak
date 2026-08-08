# D'Flow 전송(업로드/편철/재전송 판정) 관련 동작.
module Meeting::Dflow
  extend ActiveSupport::Concern

  included do
    # ── D'Flow 전송 상태 필터(목록 dflow_status 파라미터용) ──
    scope :dflow_not_sent, -> { where(dflow_synced_at: nil) }
    # #dflow_needs_resync? 를 SQL로 미러링한다. 활성 요약(#active_summary) 선택 규칙까지 그대로
    # 옮겨야 한다 — "아무 요약이나 동기화 이후 갱신됐으면 재전송 필요"로 단순화하면 비활성 요약만
    # 수정된 행(completed 인데 안 쓰는 realtime 이 갱신된 경우 등)까지 오탐한다. CASE 로 completed
    # 여부에 따라 분기하고, 각 분기 안에서 다시 (a) final 최소 id 우선 (b) 없으면
    # [generated_at, id] 최댓값 폴백을 그대로 재현한다(Ruby 쪽과 순서 규칙을 1:1로 맞춤).
    scope :dflow_needs_resync, -> {
      where(<<~SQL.squish)
        meetings.public_uid IS NOT NULL AND meetings.dflow_synced_at IS NOT NULL AND (
          meetings.last_user_edit_at > meetings.dflow_synced_at
          OR (
            CASE WHEN meetings.status = 'completed' THEN
              COALESCE(
                (SELECT s.updated_at FROM summaries s
                 WHERE s.meeting_id = meetings.id AND s.summary_type = 'final'
                 ORDER BY s.id ASC LIMIT 1),
                (SELECT s.updated_at FROM summaries s
                 WHERE s.meeting_id = meetings.id
                 ORDER BY s.generated_at DESC, s.id DESC LIMIT 1)
              )
            ELSE
              (SELECT s.updated_at FROM summaries s
               WHERE s.meeting_id = meetings.id
               ORDER BY s.generated_at DESC, s.id DESC LIMIT 1)
            END
          ) > meetings.dflow_synced_at
        )
      SQL
    }
    # dflow_synced 는 dflow_needs_resync 집합을 제외해야 한다 — 프론트 4지선다(전체/전송됨/재전송
    # 필요/미전송)가 사용자에게 배타적 분할로 보이므로, "전송됨"을 고르면 재전송 필요(amber) 배지
    # 행이 함께 나오면 안 된다(리뷰 지적: "재전송 필요" 필터가 초록 배지 행을 반환하는 버그의
    # 거울상 — 위 dflow_needs_resync 정의 다음에 둬야 참조할 수 있다).
    scope :dflow_synced, -> { where.not(dflow_synced_at: nil).where.not(id: dflow_needs_resync.select(:id)) }
  end

  # D'Flow 전송 team 자동 판정 재료: 폴더 체인의 최상위 폴더명. 폴더 없으면 nil.
  def dflow_root_folder_name
    dflow_folder_chain.last&.name
  end

  # D'Flow 전송 제목 자동 조립 재료: 최상위 바로 아래 폴더명. 3단계 이상이면 그 아래는 무시.
  def dflow_sub_folder_name
    chain = dflow_folder_chain
    chain.length >= 2 ? chain[-2].name : nil
  end

  # D'Flow 편철 경로(root-first). dflow_folder_chain 은 leaf-first(자기폴더→조상)라 반드시 뒤집는다.
  # 폴더 없으면 [] — 뒤집어도 빈 배열 그대로다(§3.4 3값 규약: 키 생략 아님).
  def dflow_folder_path_names
    dflow_folder_chain.reverse.map(&:name)
  end

  # D'Flow 전송 제목: 원제목 그대로(200자 캡). folder_path로 실제 폴더에 편철되므로
  # 하위폴더명 접두를 붙이면 이중 라벨이 된다(워크리스트 §4 W2) — 접두 버전은
  # #dflow_legacy_prefixed_title 로 분리 보존.
  def dflow_auto_title
    title.to_s.strip[0, 200]
  end

  # (레거시) D'Flow 전송 제목: "<하위폴더명>-<원제목>" (하위 폴더 없으면 원제목). 200자 초과 시 원제목 쪽을 잘라 맞춘다.
  # #dflow_auto_title 에서 접두를 걷어낸 뒤에도 보존한다 — 자동 링크 매칭(워크리스트 §7.7 C2)이
  # 기존 19건 연동의 접두 있는 D'Flow 제목을 재현·비교해야 하기 때문(접두 없이 비교하면 전건 0매칭).
  def dflow_legacy_prefixed_title
    stripped = title.to_s.strip
    sub = dflow_sub_folder_name
    return stripped[0, 200] if sub.nil?

    prefix = "#{sub}-"
    full = "#{prefix}#{stripped}"
    return full unless full.length > 200

    prefix + stripped[0, 200 - prefix.length]
  end

  # 최초 전송 이후 재전송이 필요한지(로컬 편집/요약 갱신이 마지막 전송보다 최신인지).
  def dflow_needs_resync?
    return false if public_uid.blank? || dflow_synced_at.blank?
    edited = [ last_user_edit_at, active_summary&.updated_at ].compact.max
    edited.present? && edited > dflow_synced_at
  end

  # 발급 순서 불변 규칙(§1.2, 계약 §4.6): uuid 생성 → update! 로 DB 커밋. D'Flow 전송(업로드/link)은
  # 이 메서드가 반환한 뒤 호출부가 별도로 수행하며, 전송이 실패해도 여기서 커밋된 public_uid 는
  # 유지된다(재발급 절대 금지 — 재시도 시 같은 external_id 를 재사용해야 D'Flow 쪽 upsert 가 멱등하다).
  # DflowUploadService#call 과 MeetingDflowController#claim 양쪽이 이 메서드 하나만 호출해
  # 불변식이 두 곳에 흩어지지 않도록 한다(이미 발급된 경우 재사용 — 아무 것도 하지 않음).
  def ensure_dflow_public_uid!
    return if public_uid.present?
    update!(public_uid: SecureRandom.uuid_v7)
  end

  private

  # 폴더 체인(가까운→먼): 자기 폴더 + 조상들. ancestor_records가 자기 자신을 제외하므로 앞에 붙인다
  # (effective_domain_files 등 기존 선례와 동일 패턴, meeting.rb / meetings_controller.rb).
  def dflow_folder_chain
    return [] unless folder
    [ folder ] + folder.ancestor_records
  end
end
