# 기존 D'Flow 전송분(팀 루트에 평평하게 쌓인 회의)을 실제 폴더 경로로 일괄 재편철한다.
# 스펙: tasks/dflow-minutes-upload/artifacts/ddobak-folder-path-worklist-2026-07-27.md §7.2~§7.3-b.
# 실제 로직은 DflowFolderMigrationService(§7.2 대상 정의·프로브·분할 호출)에 있다 — 이 태스크는
# ENV 파싱 + 결과 출력만 한다.
#
# 안전장치:
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
end
