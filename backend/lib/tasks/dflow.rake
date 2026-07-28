# D'Flow 기존 전송분 폴더 재편철(migrate_folders, §7.2~§7.3-b) + 미연결 회의 자동 링크
# (autolink/autolink_rollback, §7.7). 실제 로직은 각 서비스 객체(DflowFolderMigrationService·
# DflowAutoLinkService)에 있다 — 이 파일은 ENV 파싱 + 결과 출력만 한다.
#
# 안전장치(migrate_folders):
#   - ACTOR_EMAIL 필수(기본값 추측 금지, §7.0) — D'Flow auth.users 에 실재 + pmo_admin 이어야 한다
#   - 기본 DRY-RUN. 실제 이동은 APPLY=1 이 있어야 한다
#   - OVERWRITE_MANUAL=1 은 MEETING_IDS 로 범위를 좁힌 요청에만 허용된다(§7.3-b ⑤ — 서비스가 강제)
#
# 사용:
#   bin/rails dflow:migrate_folders ACTOR_EMAIL=donseok75@gmail.com                       # dry-run
#   bin/rails dflow:migrate_folders ACTOR_EMAIL=donseok75@gmail.com APPLY=1               # 실제 이동
#   bin/rails dflow:migrate_folders ACTOR_EMAIL=... APPLY=1 OVERWRITE_MANUAL=1 MEETING_IDS=12,34
namespace :dflow do
  desc "D'Flow 기존 전송분 폴더 재편철 (기본 DRY-RUN, APPLY=1 실제 이동)"
  task migrate_folders: :environment do
    actor_email = ENV["ACTOR_EMAIL"].presence
    abort "ACTOR_EMAIL이 필요합니다 (예: ACTOR_EMAIL=donseok75@gmail.com) — 기본값을 추측하지 않습니다" if actor_email.blank?

    apply = ENV["APPLY"] == "1"
    overwrite_manual = ENV["OVERWRITE_MANUAL"] == "1"
    meeting_ids = ENV["MEETING_IDS"].to_s.split(",").map(&:strip).reject(&:blank?).map(&:to_i).presence

    mode = apply ? "APPLY(실이동)" : "DRY-RUN(미리보기)"
    scope_note = meeting_ids ? " meeting_ids=#{meeting_ids.join(',')}" : ""
    puts "=== dflow:migrate_folders [#{mode}] actor=#{actor_email} overwrite_manual=#{overwrite_manual}#{scope_note} ==="

    result = begin
      DflowFolderMigrationService.call(
        actor_email: actor_email, apply: apply,
        overwrite_manual: overwrite_manual, meeting_ids: meeting_ids
      )
    rescue DflowFolderMigrationService::OverwriteManualRequiresScopeError,
           DflowFolderMigrationService::NotEnabledError,
           DflowFolderMigrationService::ActorEmailRequiredError => e
      abort e.message
    rescue DflowClient::UnknownUserError => e
      abort "ACTOR_EMAIL(#{actor_email})이 D'Flow 계정과 일치하지 않습니다(unknown_user) — #{e.message}"
    rescue DflowClient::ApiError => e
      if e.code == "forbidden_role"
        abort "ACTOR_EMAIL(#{actor_email})은 pmo_admin 이 아닙니다(403 forbidden_role) — #{e.message}"
      end
      abort "D'Flow 프로브/배치 실패(#{e.code}): #{e.message}"
    rescue DflowClient::AuthError, DflowClient::ConnectionError, DflowClient::TimeoutError => e
      abort "D'Flow 연결 실패: #{e.message}"
    end

    puts "\n대상: #{result[:total_targets]}건 (제외: 폴더명 61자 이상 #{result[:excluded_folder_name_too_long].size}건)"
    if result[:excluded_folder_name_too_long].any?
      puts "  [61자 이상 — 전송 제외, D'Flow 400 아님]"
      result[:excluded_folder_name_too_long].each do |x|
        puts "    meeting##{x[:meeting_id]} \"#{x[:folder_name]}\"(#{x[:length]}자) — #{x[:folder_path].join('/')}"
      end
    end

    s = result[:summary]
    puts "\n요약: total=#{s['total']} moved=#{s['moved']} already_correct=#{s['already_correct']} " \
         "skipped=#{s['skipped']} not_found=#{s['not_found']} failed=#{s['failed']}"

    if result[:folder_path_status_counts].any?
      counts = result[:folder_path_status_counts].map { |k, v| "#{k}=#{v}" }.join(" ")
      puts "  folder_path_status(moved 건만): #{counts}"
    end

    if result[:truncated_or_partial].any?
      puts "\n⚠️ 절단/부분 편철 — dry-run이면 APPLY 전에 경로를 줄이세요(APPLY 후엔 자기복구 불가, 계약 §4c.2):"
      result[:truncated_or_partial].each do |r|
        puts "    meeting##{r[:meeting_id]} #{r[:external_id]} status=#{r[:folder_path_status]} to=#{r[:to]&.join('/')}"
      end
    end

    %w[skipped not_found failed].each do |st|
      items = result[:results].select { |r| r[:status].to_s == st }
      next if items.empty?

      puts "\n[#{st}] #{items.size}건"
      items.each do |r|
        detail = [ r[:reason], (r.key?(:from) ? "from=#{r[:from].inspect}" : nil) ].compact.join(" ")
        puts "    meeting##{r[:meeting_id]} #{r[:external_id]} #{detail}".rstrip
      end
    end

    puts "\n#{apply ? '실행 완료' : 'DRY-RUN 완료 — 실제 이동하려면 APPLY=1'}"
  end

  # 안전장치(autolink, §7.7):
  #   - ACTOR_EMAIL 필수(§7.0과 동일 규칙) — 프로브(POST /minutes/folder, items: [] dry_run)로
  #     대상 1건을 건드리기 전에 검증한다(DflowAutoLinkService#probe_actor!)
  #   - 기본 DRY-RUN. 실제 claim 은 APPLY=1 이 있어야 하고, 그마저도 등급 exact 만 claim 한다
  #   - APPLY=1 은 SENDER_NAMES(콤마 구분, 또박또박 전송 계정의 D'Flow 표시명) 없이 거부된다
  #     (완화 4겹 ④ — 서비스가 강제, §7.7 정본 §6)
  #   - 대상2(초기화 재연결)는 RELINK_RESET=1 을 줘야만 claim 대상이 된다(기본은 리포트만)
  #   - 실제 claim 이 1건 이상 나가면 tmp/dflow_autolink_<timestamp>.json 에 역연산용 기록을 남긴다
  #
  # 사용:
  #   bin/rails dflow:autolink ACTOR_EMAIL=donseok75@gmail.com                             # dry-run
  #   bin/rails dflow:autolink ACTOR_EMAIL=... APPLY=1 SENDER_NAMES="또박또박 전송"          # exact 만 claim
  #   bin/rails dflow:autolink ACTOR_EMAIL=... APPLY=1 SENDER_NAMES=... FROM=2026-01-01 TO=2026-07-27
  #   bin/rails dflow:autolink ACTOR_EMAIL=... APPLY=1 SENDER_NAMES=... RELINK_RESET=1     # 초기화분 포함
  desc "미연결 회의 자동 링크 (기본 DRY-RUN, APPLY=1 exact만 claim, RELINK_RESET=1 로 초기화분 포함)"
  task autolink: :environment do
    actor_email = ENV["ACTOR_EMAIL"].presence
    abort "ACTOR_EMAIL이 필요합니다 (예: ACTOR_EMAIL=donseok75@gmail.com) — 기본값을 추측하지 않습니다" if actor_email.blank?

    apply = ENV["APPLY"] == "1"
    relink_reset = ENV["RELINK_RESET"] == "1"
    from = ENV["FROM"].presence
    to = ENV["TO"].presence
    sender_names = ENV["SENDER_NAMES"].to_s.split(",").map(&:strip).reject(&:blank?)

    mode = apply ? "APPLY(실claim)" : "DRY-RUN(미리보기)"
    puts "=== dflow:autolink [#{mode}] actor=#{actor_email} relink_reset=#{relink_reset} " \
         "from=#{from || '-'} to=#{to || '-'} ==="

    result = begin
      DflowAutoLinkService.call(
        actor_email: actor_email, apply: apply, relink_reset: relink_reset,
        from: from, to: to, sender_names: sender_names
      )
    rescue DflowAutoLinkService::ActorEmailRequiredError, DflowAutoLinkService::NotEnabledError,
           DflowAutoLinkService::SenderNamesRequiredError => e
      abort e.message
    rescue DflowClient::UnknownUserError => e
      abort "ACTOR_EMAIL(#{actor_email})이 D'Flow 계정과 일치하지 않습니다(unknown_user) — #{e.message}"
    rescue DflowClient::ApiError => e
      if e.code == "forbidden_role"
        abort "ACTOR_EMAIL(#{actor_email})은 pmo_admin 이 아닙니다(403 forbidden_role) — #{e.message}"
      end
      abort "D'Flow 프로브/조회 실패(#{e.code}): #{e.message}"
    rescue DflowClient::AuthError, DflowClient::ConnectionError, DflowClient::TimeoutError => e
      abort "D'Flow 연결 실패: #{e.message}"
    end

    puts "\nalready_linked(등급 판정 전 제외): #{result[:already_linked_count]}건"
    if result[:team_unknown].any?
      puts "team 판정 불가(자동 링크 대상 제외, 목록만): #{result[:team_unknown].size}건"
      result[:team_unknown].each { |t| puts "    meeting##{t[:meeting_id]} #{t[:date]} \"#{t[:title]}\"" }
    end

    { target1: "대상1(미전송)", target2: "대상2(초기화 재연결)" }.each do |key, label|
      bucket = result[key]
      claimable_note = key == :target2 ? (relink_reset ? " — RELINK_RESET on" : " — RELINK_RESET off, claim 안 함(리포트만)") : ""
      puts "\n[#{label}#{claimable_note}] exact=#{bucket[:exact].size} likely=#{bucket[:likely].size} " \
           "ambiguous=#{bucket[:ambiguous].size} none=#{bucket[:none_count]}"

      bucket[:exact].each do |r|
        c = r[:candidates].first
        flag = r[:auto_claimable] ? "" : " ⚠️claim 보류(#{r[:collision] || (r[:sender_match] ? 'sender_match' : '?')})"
        puts "    exact meeting##{r[:meeting_id]} \"#{r[:meeting_title]}\" → dflow:#{c[:id]} \"#{c[:title]}\"(#{c[:date]})#{flag}"
      end
      bucket[:likely].each do |r|
        c = r[:candidates].first
        puts "    likely(사람 승인 필요) meeting##{r[:meeting_id]} \"#{r[:meeting_title]}\" → dflow:#{c[:id]} \"#{c[:title]}\"(#{c[:date]})"
      end
      bucket[:ambiguous].each do |r|
        puts "    ambiguous meeting##{r[:meeting_id]} \"#{r[:meeting_title]}\" — 후보 #{r[:candidates].size}건, 자동 링크 금지"
        r[:candidates].each { |c| puts "        dflow:#{c[:id]} \"#{c[:title]}\"(#{c[:date]})" }
      end
    end

    if result[:claimed].any?
      puts "\n실제 claim: #{result[:claimed].size}건"
      result[:claimed].each { |c| puts "    meeting##{c[:meeting_id]} public_uid=#{c[:public_uid]} dflow_minute=#{c[:dflow_minute_id]}" }

      file = Rails.root.join("tmp", "dflow_autolink_#{Time.current.strftime('%Y%m%d%H%M%S')}.json")
      File.write(file, JSON.pretty_generate(result[:claimed]))
      puts "  → 역연산용 기록: #{file} (오매칭 발견 시 `rake dflow:autolink_rollback FILE=#{file}`)"
    end

    if result[:claim_errors].any?
      puts "\n⚠️ claim 실패: #{result[:claim_errors].size}건"
      result[:claim_errors].each { |e| puts "    meeting##{e[:meeting_id]} #{e[:code]}: #{e[:error]}" }
    end

    puts "\n#{apply ? '실행 완료' : 'DRY-RUN 완료 — 실제 claim 하려면 APPLY=1(exact만, SENDER_NAMES 필수)'}"
  end

  # §7.7 「역연산」 — 되돌리는 것은 "연결"이지 "본문"이 아니다(이미 replace 전송이 있었다면 D'Flow
  # 본문은 복구되지 않는다). 로컬(public_uid/dflow_url)만 해제한다 — D'Flow 쪽 external_id 초기화는
  # 자동화 API가 없어(§4b-1) 각 건마다 사람이 D'Flow UI에서 수동으로 해야 한다.
  #
  # 사용: bin/rails dflow:autolink_rollback FILE=tmp/dflow_autolink_20260727120000.json
  desc "dflow:autolink 역연산 — 로컬 public_uid/dflow_url 해제만(D'Flow 쪽은 수동 초기화 필요, §7.7)"
  task autolink_rollback: :environment do
    file = ENV["FILE"].presence
    abort "FILE이 필요합니다 (예: FILE=tmp/dflow_autolink_20260727120000.json)" if file.blank?
    abort "파일을 찾을 수 없습니다: #{file}" unless File.exist?(file)

    entries = JSON.parse(File.read(file))
    abort "FILE 내용이 배열이 아닙니다: #{file}" unless entries.is_a?(Array)

    puts "=== dflow:autolink_rollback file=#{file} (#{entries.size}건) ==="
    result = DflowAutoLinkService.rollback(entries)

    result[:results].each do |r|
      case r[:status]
      when "reset"
        puts "  meeting##{r[:meeting_id]} reset — #{r[:dflow_manual_step_required]}"
      when "skipped_changed"
        puts "  meeting##{r[:meeting_id]} skipped_changed — #{r[:reason]}"
      when "not_found"
        puts "  meeting##{r[:meeting_id]} not_found"
      end
    end

    reset_count = result[:results].count { |r| r[:status] == "reset" }
    puts "\n로컬 해제: #{reset_count}/#{entries.size}건. ⚠️ D'Flow 쪽 연결 초기화는 각 건마다 수동으로 해야 합니다(§7.7 역연산)."
  end
end
