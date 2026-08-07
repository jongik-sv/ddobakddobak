# 기존 데이터 교정: summaries.notes_markdown 에 이미 저장된 변형 인용 마커를
# LlmPrompts::CitationMarkers.normalize 로 일괄 교정한다.
#
# 사용:  bin/rails citation_markers:normalize_summaries              # 실제 갱신
#        DRY_RUN=1 bin/rails citation_markers:normalize_summaries    # 미리보기(갱신 안 함)
namespace :citation_markers do
  desc "summaries.notes_markdown 의 인용 마커를 정본 형식으로 정규화 (DRY_RUN=1 로 미리보기)"
  task normalize_summaries: :environment do
    dry_run = ENV["DRY_RUN"] == "1"
    mode = dry_run ? "DRY-RUN(미리보기)" : "APPLY(실제 갱신)"
    puts "=== citation_markers:normalize_summaries [#{mode}] ==="

    changed = 0
    scanned = 0

    Summary.where.not(notes_markdown: [ nil, "" ]).find_each do |summary|
      scanned += 1
      original = summary.notes_markdown
      normalized = LlmPrompts::CitationMarkers.normalize(original)
      next if normalized == original

      changed += 1
      puts "  ##{summary.id} (meeting_id=#{summary.meeting_id}) #{original.length}자 → #{normalized.length}자"
      summary.update_column(:notes_markdown, normalized) unless dry_run
    end

    puts "\n=== 결과 ==="
    puts "스캔: #{scanned}건 / 변경#{dry_run ? ' 예정' : ''}: #{changed}건"
    puts "DRY_RUN=1 이었습니다 — 실제 갱신하려면 DRY_RUN 없이 재실행하세요." if dry_run
  end
end
