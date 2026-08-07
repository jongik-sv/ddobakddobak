# 미연결 회의 자동 링크 — D'Flow에 수동 업로드된 회의록(external_id null)과 또박또박의
# 아직 전송 안 했거나(대상 1) 재클레임 대상인(대상 2, RELINK_RESET) 회의를 메타
# (date·team·정규화 제목)로 매칭한다.
#
# 워크리스트: tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md §7.7.
# 결정: tasks/dflow-minutes-upload/artifacts/decisions-final-2026-07-27.md §6.
# 계약: dflow-minutes-upload-api-spec.md §4b(link)·§4b-1(연결 초기화)·§5.1(GET /minutes).
#
# claim(계약 §4b)은 MeetingDflowController#claim 의 인가(authenticate_user!/editable_by?)를
# 그대로 재사용할 수 없다(그 액션은 rake 에서 호출 불가) — 그래서 #perform_claim 은 인가를
# 자체 판정(auto_claimable && !sender_match)으로 대체한다. 순수 claim 시퀀스(ensure_dflow_public_uid!
# 호출 · external_id 조립 · link_minute · dflow_url 조립·저장)는 컨트롤러와 완전히 동일해야
# "링크는 되는데 D'Flow 바로가기가 안 생기는" 회귀(§7.7 머리말 경고)가 재발하지 않으므로
# DflowClaimer(app/services/dflow_claimer.rb) 로 추출해 양쪽이 공유한다.
#
# 사용법:
#   DflowAutoLinkService.call(actor_email: "...", sender_names: [...])                       # dry-run
#   DflowAutoLinkService.call(actor_email: "...", apply: true, sender_names: [...])           # 대상1 exact 만 claim
#   DflowAutoLinkService.call(actor_email: "...", apply: true, relink_reset: true, sender_names: [...])
#   DflowAutoLinkService.rollback(entries)                                                    # W16 역연산(로컬만)
class DflowAutoLinkService
  PER_PAGE = 100
  # 안전판 — per_page 100 기준 최대 2만 건 순회. §7.7이 요구하는 "O(페이지수)"를 지키면서도
  # 응답 total 필드가 이상값을 반환하는 사고에서 무한 루프를 막는다(W12엔 없는 신규 실패 모드 —
  # 페이지 순회 자체가 W12엔 없었다).
  MAX_PAGES = 200

  class ActorEmailRequiredError < StandardError; end
  class NotEnabledError < StandardError; end
  # §7.7 「오매칭의 대가」 4겹 중 4번째 방어선(작성자=전송계정이면 자동 claim 금지, 정본 §6)은
  # 이 값이 있어야 동작한다. 미설정인 채 APPLY=1을 허용하면 방어선이 조용히 무력화된 채 실제
  # claim이 나간다 — ACTOR_EMAIL과 같은 이유로 "기본값 추측 금지"를 적용해 dry-run만 허용한다.
  class SenderNamesRequiredError < StandardError; end

  # D'Flow src/lib/domain/minutes.ts:194 meetingBodyOf 포팅(§7.7 C1) — `_`·공백 토큰화 후
  # 날짜형 5패턴·회차형(12차,제3차)·요일 괄호만 노이즈로 제거하고 공백 1칸으로 재결합한다.
  # 하이픈 접두("설비-L2 점검")는 토큰 경계가 아니므로 원문 그대로 보존된다 — §7.7이 명시적으로
  # "<하위폴더명>- 접두를 벗기는 규칙은 쓰지 않는다"고 못박은 부분과 일치.
  WEEKDAY_TAIL = '(?:\((?:월|화|수|목|금|토|일)\))?'.freeze
  NOISE_PATTERNS = [
    %r{\A\d{6}#{WEEKDAY_TAIL}\z},
    %r{\A\d{8}#{WEEKDAY_TAIL}\z},
    %r{\A\d{4}[.\-/]\d{1,2}(?:[.\-/]\d{1,2})?#{WEEKDAY_TAIL}\z},
    %r{\A\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}#{WEEKDAY_TAIL}\z},
    %r{\A\d{1,2}[.\-/]\d{1,2}#{WEEKDAY_TAIL}\z},
    /\A\(?제?\d{1,4}차\)?\z/,
    /\A\((?:월|화|수|목|금|토|일)\)\z/
  ].freeze

  # ⚠️ 원본 JS(meetingBodyOf)는 NFC 정규화를 하지 않지만 여기서는 한다 — 로컬(맥OS 등에서
  # NFD로 저장됐을 수 있음) vs D'Flow(NFC 리터럴) 비교가 한글 제목에서 전건 0매칭나는 사고를
  # 막기 위함(결정 §7 #10 "가장 시급"). DflowFolderName.normalize(strip+NFC)를 그대로 재사용한다
  # — "폴더명" 전용처럼 보이지만 실제로는 범용 strip+NFC 유틸이고, 전용 문자열 유틸이 따로
  # 생기면 그쪽이 정본이 되어야 한다(사본 금지 원칙과 동일하게 지금은 재사용을 택함).
  def self.meeting_body_of(title)
    nfc = DflowFolderName.normalize(title)
    tokens = nfc.split(/[_\s]+/).reject { |t| t.empty? || NOISE_PATTERNS.any? { |re| re.match?(t) } }
    tokens.empty? ? nfc : tokens.join(" ")
  end

  def self.call(actor_email:, apply: false, relink_reset: false, from: nil, to: nil, sender_names: [])
    new(actor_email: actor_email, apply: apply, relink_reset: relink_reset,
        from: from, to: to, sender_names: sender_names).call
  end

  # W16 역연산 — 순수 로컬 조작(§7.7 「역연산」: "되돌리는 것은 연결이지 본문이 아니다").
  # entries: [{ "meeting_id" => .., "public_uid" => .., "dflow_minute_id" => .. }, ...]
  # (rake 가 tmp/dflow_autolink_<timestamp>.json 에서 읽어 그대로 넘긴다 — 키는 문자열/심볼 무관.)
  def self.rollback(entries)
    results = Array(entries).map { |raw| rollback_one(raw) }
    { results: results }
  end

  def self.rollback_one(raw)
    entry = raw.is_a?(Hash) ? raw.transform_keys(&:to_s) : {}
    meeting = entry["meeting_id"].present? ? Meeting.find_by(id: entry["meeting_id"]) : nil
    return { meeting_id: entry["meeting_id"], status: "not_found" } unless meeting

    recorded_uid = entry["public_uid"]
    if recorded_uid.present? && meeting.public_uid != recorded_uid
      return { meeting_id: meeting.id, status: "skipped_changed",
               reason: "public_uid가 기록 시점과 다릅니다 — 그 사이 다른 조작이 있었을 수 있어 " \
                       "자동 해제하지 않습니다. 수동 확인이 필요합니다" }
    end

    meeting.update!(public_uid: nil, dflow_url: nil)
    { meeting_id: meeting.id, status: "reset", dflow_minute_id: entry["dflow_minute_id"],
      dflow_manual_step_required:
        "D'Flow에서 해당 회의록의 연결을 수동 초기화해야 합니다(§7.7 역연산 — 또박또박 쪽 API로는 " \
        "D'Flow의 external_id를 뗄 수 없습니다). 하지 않으면 재클레임 시 409 link_conflict로 막힙니다. " \
        "⚠️ 이미 replace 전송이 있었다면 D'Flow 본문은 이 역연산으로 복구되지 않습니다(§7.7 경고)" }
  end
  private_class_method :rollback_one

  def initialize(actor_email:, apply: false, relink_reset: false, from: nil, to: nil, sender_names: [])
    @actor_email = actor_email.to_s.strip
    @apply = apply
    @relink_reset = relink_reset
    @from = from.presence
    @to = to.presence
    @sender_names = Array(sender_names).map { |s| DflowFolderName.normalize(s) }.reject(&:blank?)
  end

  def call
    validate_preconditions!
    probe_actor!
    # 항상 강제 평가 — already_linked/대상2 판정의 `public_uid.present? && existing_uid_set.key?`
    # 가드가 `&&` 단락 평가로 인해(대상 전체가 public_uid nil인 경우) 이 순회 자체를 건너뛰지
    # 않도록 명시적으로 먼저 호출한다(지연평가에 맡기면 데이터 모양에 따라 include_archived=true
    # 호출이 조용히 빠질 수 있다 — 스펙에서 실제로 잡힌 회귀).
    existing_uid_set

    t1_known, t1_unknown = split_by_team(target1_meetings)
    t2_known, t2_unknown = split_by_team(target2_meetings)

    t1_results = t1_known.map { |(m, team)| grade_result(m, team, :c1) }
    t2_results = t2_known.map { |(m, team)| grade_result(m, team, :c2) }

    # 대상 2는 RELINK_RESET 과 무관하게 항상 "계산"한다(claim 가능 여부만 그 플래그가 가른다) —
    # 그래야 §7.7 pitfall5(초기화된 minute이 후보 풀에 남아 다른 회의가 오매칭)를 RELINK_RESET
    # 기본값(off)에서도 잡을 수 있다. off일 때만 계산을 건너뛰면 위험이 가장 큰 바로 그 모드에서
    # 경고가 나오지 않는다.
    flag_reset_shadow!(t1_results, t2_results)
    annotate_shared_candidate_collisions!(t1_results + t2_results)
    annotate_sender_matches!(t1_results + t2_results)

    claimed = []
    claim_errors = []
    if @apply
      t1_results.each { |r| perform_claim(r, claimed, claim_errors) if r[:grade] == :exact }
      t2_results.each { |r| perform_claim(r, claimed, claim_errors) if r[:grade] == :exact } if @relink_reset
    end

    build_report(t1_unknown, t2_unknown, t1_results, t2_results, claimed, claim_errors)
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

    return unless @apply
    return if @sender_names.any?

    raise SenderNamesRequiredError,
          "APPLY=1은 SENDER_NAMES(또박또박이 D'Flow 전송에 쓰는 계정의 D'Flow 표시명, 콤마 구분) 없이 " \
          "실행할 수 없습니다 — 미설정 시 §7.7 「오매칭의 대가」 4번째 방어선(작성자가 전송 계정과 " \
          "같으면 자동 claim 금지)이 무력화된 채 실제 claim이 나갑니다"
  end

  # §7.0 공통 프로브 — POST /minutes/link 자체엔 folder_batch 같은 "빈 items + dry_run" 트릭이
  # 없으므로, 같은 ACTOR_EMAIL을 검증하는 W12의 프로브(POST /minutes/folder, items: [], dry_run:
  # true)를 재사용해 대상 1건을 건드리기 전에 계정 유효성을 확인한다(dry-run 모드에서도 실행 —
  # 미리보기 리포트 자체가 검증된 계정 기준이어야 한다). 이 프로브는 pmo_admin 까지 요구해
  # /minutes/link가 실제로 보는 것(unknown_user만, link/route.ts 확인)보다 엄격하지만, 오매칭이
  # D'Flow 본문을 되돌릴 수 없이 덮어쓸 수 있는 도구이므로 더 엄격한 쪽으로 fail-closed 하는 편이
  # 안전하다(확정 ACTOR_EMAIL 자체가 이미 pmo_admin, §7.0).
  def probe_actor!
    client.folder_batch(user_email: @actor_email, items: [], dry_run: true)
  end

  # ── 대상 수집(§7.7 「대상」·「감지 방법」) ──────────────────────────────────

  def base_scope
    # eligible?/current_notes_markdown이 회의당 active_summary를 참조 — summaries preload로
    # Meeting#active_summary의 loaded-aware 분기를 태워 N+1을 없앤다.
    Meeting.kept.where(status: "completed").includes(:summaries)
  end

  # 전송 가능 조건과 동일(§7.7): completed 이고 본문이 있어야 한다. FROM/TO(있으면) 창도 여기서.
  def eligible?(meeting)
    return false if meeting.current_notes_markdown.blank?
    d = kst_date(meeting)
    return false if @from && d < @from
    return false if @to && d > @to
    true
  end

  # dflow_synced_at 없는 전체 회의(대상 1의 상위 모집단) — already_linked 게이트는 여기서
  # 한 번 더 갈린다. 쿼리를 두 번 타지 않도록 배열로 메모이즈한다(§7.7 규모 — 미연결 21건 수준).
  def dflow_synced_nil_meetings
    @dflow_synced_nil_meetings ||= base_scope.where(dflow_synced_at: nil).select { |m| eligible?(m) }
  end

  # ⚠️ 등급 판정보다 먼저 빠져야 하는 게이트(§7.7 대상1 ⚠️) — public_uid가 있고 순회 집합
  # (linked=true+include_archived=true)에서 발견되면 이미 D'Flow에 붙어 있는 것이다. 이게 없으면
  # 같은 rake를 두 번 돌렸을 때 1회차가 링크한 건이 2회차 후보로 재등장한다(멱등성 붕괴).
  def already_linked_meetings
    @already_linked_meetings ||=
      dflow_synced_nil_meetings.select { |m| m.public_uid.present? && existing_uid_set.key?(m.public_uid) }
  end

  # 대상 1 = dflow_synced_at 없음 AND exists_on_dflow==false(already_linked 게이트로 뺀 나머지).
  def target1_meetings
    already_linked_ids = already_linked_meetings.map(&:id).to_set
    dflow_synced_nil_meetings.reject { |m| already_linked_ids.include?(m.id) }
  end

  # 대상 2 = dflow_synced_at 있음 AND exists_on_dflow==false(순회 집합 차집합). RELINK_RESET과
  # 무관하게 항상 계산한다(위 #call 주석 참고) — claim 가능 여부만 @relink_reset이 가른다.
  def target2_meetings
    @target2_meetings ||= base_scope.where.not(dflow_synced_at: nil).select do |m|
      eligible?(m) && m.public_uid.present? && !existing_uid_set.key?(m.public_uid)
    end
  end

  # GET /minutes?linked=true&include_archived=true 전체 순회로 만든 "D'Flow에 존재하는 ddobak
  # public_uid" 집합. already_linked 게이트·대상2 차집합 둘 다 이 하나의 집합으로 판정한다
  # (§7.7 「감지 방법」— O(회의수) 개별 status 호출 대신 O(페이지수) 순회 1회).
  # FROM/TO로 좁히지 않는다 — 이미 연결된 D'Flow 레코드의 minute_date가 어떤 이유로든 우리 kst_date
  # 창 밖에 있으면(이례적이지만) already_linked/대상2 판정 자체가 깨져 §7.7이 가장 경계하는
  # "고아+오매칭"으로 직결된다. 이 판정만큼은 항상 전체를 본다.
  def existing_uid_set
    @existing_uid_set ||= begin
      set = {}
      each_page(linked: true, include_archived: true) do |items|
        items.each do |item|
          m = item["external_id"].to_s.match(/\Addobak:(.+)\z/)
          set[m[1]] = true if m
        end
      end
      set
    end
  end

  # ── team 판정 ────────────────────────────────────────────────────────────

  # team을 판정할 수 없는 회의는 자동 링크 대상에서 제외한다(§7.7 — 매칭 키 하나가 빠지면
  # 오매칭 확률이 급등). [meeting, team] 쌍(known)과 meeting 단독 리스트(unknown)로 분리.
  def split_by_team(meetings)
    known = []
    unknown = []
    meetings.each do |m|
      team = team_for(m)
      team ? known << [ m, team ] : unknown << m
    end
    [ known, unknown ]
  end

  def known_teams
    @known_teams ||= client.meta["teams"].to_a
  end

  def team_for(meeting)
    candidate = meeting.dflow_root_folder_name
    return nil if candidate.blank?
    known_teams.find { |t| DflowFolderName.matches?(t, candidate) }
  end

  # ── D'Flow 미연결 후보 풀(linked=false) ─────────────────────────────────

  def pool
    @pool ||= begin
      items_out = []
      # ⚠️ include_archived 를 켜지 않는다(계약 §5.1 호출 규약) — 보관분은 link 가 409로
      # 거절하므로 후보로 섞이면 "고를 수 없는데 목록엔 있는" 상태가 된다.
      each_page(linked: false) do |items|
        items.each do |item|
          items_out << {
            id: item["id"], title: item["title"].to_s, date: item["date"].to_s,
            team: item["team"].to_s, created_by_name: item["created_by_name"].to_s, url: item["url"]
          }
        end
      end
      items_out
    end
  end

  # per_page=100 페이지 순회 공통 헬퍼 — O(페이지수). 범위 밖 페이지는 D'Flow가 500이 아니라
  # items:[] + total 로 응답하므로(route.ts PGRST103 폴백) items.empty? 만으로도 멈추지만,
  # total 계산으로 한 번 더 확인하고 MAX_PAGES 로 최종 안전판을 둔다.
  def each_page(base_params)
    page = 1
    loop do
      resp = client.list_minutes(base_params.merge(page: page, per_page: PER_PAGE))
      items = resp["items"]
      items = items.is_a?(Array) ? items : []
      yield items
      total = resp["total"].to_i
      break if items.empty?
      break if page * PER_PAGE >= total
      page += 1
      break if page > MAX_PAGES
    end
  end

  # ── 매칭·등급 판정(§7.7 매칭 규칙) ──────────────────────────────────────

  def grade_result(meeting, team, kind)
    cands = candidates_for(meeting, team, kind)
    grade =
      if cands.empty?
        :none
      elsif cands.size > 1
        :ambiguous
      else
        exact_match?(meeting, cands.first, kind) ? :exact : :likely
      end
    { meeting: meeting, kind: kind, team: team, date: kst_date(meeting),
      grade: grade, candidates: cands, auto_claimable: grade == :exact, collision: nil, sender_match: false }
  end

  # C1(대상1) — meetingBodyOf 정규화 완전 일치 비교, 접두 제거 없음.
  # C2(대상2) — dflow_auto_title/dflow_legacy_prefixed_title 재생성값과 완전 일치(휴리스틱 없음,
  # ddobak-W2 전후 두 변형을 모두 시도 — 결정 §7 #10).
  def candidates_for(meeting, team, kind)
    target_date = Date.iso8601(kst_date(meeting))
    pool.select do |c|
      next false unless c[:team] == team
      cand_date = parse_date(c[:date])
      next false unless cand_date

      date_exact = cand_date == target_date
      date_adjacent = !date_exact && (cand_date - target_date).abs <= 1

      if kind == :c1
        title_exact = title_match_c1_exact?(meeting.title, c[:title])
        title_partial = !title_exact && title_match_c1_partial?(meeting.title, c[:title])
        (date_exact && title_exact) || (date_adjacent && title_exact) || (date_exact && title_partial)
      else
        title_exact = title_match_c2_exact?(meeting, c[:title])
        (date_exact && title_exact) || (date_adjacent && title_exact)
      end
    end
  end

  def exact_match?(meeting, candidate, kind)
    cand_date = parse_date(candidate[:date])
    return false unless cand_date == Date.iso8601(kst_date(meeting))
    kind == :c1 ? title_match_c1_exact?(meeting.title, candidate[:title]) : title_match_c2_exact?(meeting, candidate[:title])
  end

  def title_match_c1_exact?(meeting_title, candidate_title)
    self.class.meeting_body_of(meeting_title) == self.class.meeting_body_of(candidate_title)
  end

  # "제목 포함관계"(등급표 likely) — C1에만 적용한다. C2는 재생성값과의 완전 일치만 인정하므로
  # (§7.7 C2 행 "휴리스틱 불필요") 부분일치 개념 자체가 없다.
  def title_match_c1_partial?(meeting_title, candidate_title)
    a = self.class.meeting_body_of(meeting_title)
    b = self.class.meeting_body_of(candidate_title)
    return false if a.empty? || b.empty? || a == b
    a.include?(b) || b.include?(a)
  end

  def title_match_c2_exact?(meeting, candidate_title)
    cand = DflowFolderName.normalize(candidate_title)
    [ meeting.dflow_auto_title, meeting.dflow_legacy_prefixed_title ].any? { |t| DflowFolderName.normalize(t) == cand }
  end

  def parse_date(str)
    Date.iso8601(str)
  rescue ArgumentError, TypeError
    nil
  end

  def kst_date(meeting)
    started = meeting.started_at || Time.current
    started.in_time_zone("Asia/Seoul").strftime("%Y-%m-%d")
  end

  # ── 오매칭 완화(§7.7 「오매칭의 대가」·pitfall5) ────────────────────────

  # pitfall5: "초기화된 minute이 후보 풀에 남는다" — 대상1(C1) 회의가 유일 후보로 고른 D'Flow
  # 레코드가, 사실은 대상2(RELINK_RESET 대상, 즉 누군가 초기화한) 회의 하나의 C2 조건과도 맞으면
  # "그 회의가 방금 끊은 자기 레코드를 남이 가로챌 뻔한" 상황이다. 완전히 막을 수 없어(D'Flow가
  # "이 레코드가 예전에 어떤 external_id로 연결돼 있었는지" 노출하지 않음) 최소한 경고로 드러낸다
  # — RELINK_RESET 값과 무관하게 항상 검사한다(끄져 있어도 대상2 자체는 계산돼 있으므로).
  def flag_reset_shadow!(t1_results, t2_results)
    return if t2_results.empty?

    t1_results.each do |r|
      next unless %i[exact likely].include?(r[:grade]) && r[:candidates].size == 1
      winner_id = r[:candidates].first[:id]
      shadow = t2_results.find { |t2r| t2r[:candidates].any? { |c| c[:id] == winner_id } }
      next unless shadow
      r[:collision] = "reset_shadow:meeting_#{shadow[:meeting].id}"
      r[:auto_claimable] = false
    end
  end

  # 2차 방어선(일반형) — 서로 다른 두 회의가 같은 D'Flow 레코드를 유일 후보로 고르면(어느 kind
  # 조합이든) 근본적으로 모순이다. 어느 한쪽만 claim해도 나머지는 다음 실행에서 다시 등장해
  # 사람이 헷갈릴 여지가 있으므로 둘 다 자동 claim 금지로 내린다.
  def annotate_shared_candidate_collisions!(results)
    index = Hash.new { |h, k| h[k] = [] }
    results.each do |r|
      index[r[:candidates].first[:id]] << r if %i[exact likely].include?(r[:grade]) && r[:candidates].size == 1
    end
    index.each_value do |rs|
      next if rs.size <= 1
      ids = rs.map { |r| r[:meeting].id }.sort.join("_")
      rs.each do |r|
        next if r[:collision] # reset_shadow 가 이미 더 구체적인 사유를 달아 놓았으면 유지
        r[:collision] = "shared_candidate:meetings_#{ids}"
        r[:auto_claimable] = false
      end
    end
  end

  # 「완화 4겹」④(착수 조건, 정본 §6): 후보의 작성자가 또박또박 전송 계정과 같으면 등급이
  # exact여도 자동 claim 금지, 사람 승인으로 강등한다.
  def annotate_sender_matches!(results)
    return if @sender_names.empty?
    results.each do |r|
      next unless r[:candidates].size == 1
      name = DflowFolderName.normalize(r[:candidates].first[:created_by_name])
      next unless @sender_names.include?(name)
      r[:sender_match] = true
      r[:auto_claimable] = false
    end
  end

  # ── claim 실행(§4b + 컨트롤러 부수 로직 재현 — 파일 머리말 참고) ────────

  def perform_claim(result, claimed, claim_errors)
    return unless result[:auto_claimable] && !result[:sender_match]

    meeting = result[:meeting]
    candidate = result[:candidates].first
    # 순수 claim 시퀀스(발급 순서·external_id 조립·dflow_url 조립)는 MeetingDflowController#claim 과
    # 공유 — DflowClaimer 단일 출처(파일 머리말 참고).
    outcome = DflowClaimer.call(meeting: meeting, minute_id: candidate[:id], user_email: @actor_email, client: client)

    claimed << { meeting_id: meeting.id, public_uid: meeting.public_uid, dflow_minute_id: candidate[:id],
                 external_id: outcome[:external_id], dflow_url: outcome[:dflow_url], grade: "exact" }
  rescue DflowClient::LinkConflictError, DflowClient::UnknownUserError, DflowClient::ApiError => e
    claim_errors << { meeting_id: meeting.id, error: e.message, code: (e.respond_to?(:code) ? e.code : nil) }
  end

  # ── 리포트 조립 ──────────────────────────────────────────────────────────

  def build_report(t1_unknown, t2_unknown, t1_results, t2_results, claimed, claim_errors)
    {
      dry_run: !@apply, apply: @apply, relink_reset: @relink_reset, actor_email: @actor_email,
      from: @from, to: @to,
      already_linked_count: already_linked_meetings.size,
      team_unknown: (t1_unknown + t2_unknown).map { |m| { meeting_id: m.id, title: m.title, date: kst_date(m) } },
      target1: summarize(t1_results),
      target2: summarize(t2_results),
      claimed: claimed,
      claim_errors: claim_errors
    }
  end

  def summarize(results)
    {
      exact: serialize(results.select { |r| r[:grade] == :exact }),
      likely: serialize(results.select { |r| r[:grade] == :likely }),
      ambiguous: serialize(results.select { |r| r[:grade] == :ambiguous }),
      none_count: results.count { |r| r[:grade] == :none }
    }
  end

  def serialize(results)
    results.map do |r|
      { meeting_id: r[:meeting].id, meeting_title: r[:meeting].title, team: r[:team], date: r[:date],
        candidates: r[:candidates].map { |c| c.slice(:id, :title, :date, :team, :url) },
        auto_claimable: r[:auto_claimable], collision: r[:collision], sender_match: r[:sender_match] }
    end
  end
end
