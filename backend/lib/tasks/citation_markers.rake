# 기존 데이터 교정: 저장된 레코드에 이미 남아 있는 변형/오염 인용 마커를
# CitationMarkerBackfill(오타 사전 역치환 → LlmPrompts::CitationMarkers.normalize 2단계)로
# 일괄 교정한다. 실제 로직은 app/services/citation_marker_backfill.rb — 이 파일은 출력만 한다
# (다른 rake 태스크들과 동일한 관례, lib/tasks/dflow.rake 참고).
#
# 대상: Summary#{notes_markdown,key_points,decisions,discussion_details}, ChatMessage#content,
#       Block#content.
#
# 사용:  bin/rails citation_markers:normalize_summaries              # 실제 갱신
#        DRY_RUN=1 bin/rails citation_markers:normalize_summaries    # 미리보기(갱신 안 함)
namespace :citation_markers do
  desc "저장된 레코드의 인용 마커를 정본 형식으로 정규화 (DRY_RUN=1 로 미리보기)"
  task normalize_summaries: :environment do
    dry_run = ENV["DRY_RUN"] == "1"
    mode = dry_run ? "DRY-RUN(미리보기)" : "APPLY(실제 갱신)"
    puts "=== citation_markers:normalize_summaries [#{mode}] ==="

    result = CitationMarkerBackfill.call(dry_run: dry_run)

    result.events.each do |e|
      label = "#{e.record_class}##{e.record_id}"
      label += " (meeting=#{e.meeting_id})" if e.meeting_id
      after_display = case e.kind
      when :deleted then "(삭제)"
      when :held    then "(보류)"
      else e.after
      end
      puts "  #{label}  #{e.before} ⇒ #{after_display}  [#{e.reason}]"
    end

    by_kind = result.events.group_by(&:kind)
    puts "\n=== 결과 ==="
    puts "스캔: #{result.scanned}건(레코드) / 변경#{dry_run ? ' 예정' : ''}: #{result.changed}건(레코드)"
    puts "마커: 역치환 복원 #{by_kind[:glossary_restored]&.size.to_i}건 / " \
         "정규화 복원 #{by_kind[:normalize_restored]&.size.to_i}건 / " \
         "삭제 #{by_kind[:deleted]&.size.to_i}건 / " \
         "보류(수동 확인 필요) #{by_kind[:held]&.size.to_i}건 / " \
         "기타(마커 사이 텍스트) #{by_kind[:other]&.size.to_i}건"
    puts "DRY_RUN=1 이었습니다 — 실제 갱신하려면 DRY_RUN 없이 재실행하세요." if dry_run
  end
end
