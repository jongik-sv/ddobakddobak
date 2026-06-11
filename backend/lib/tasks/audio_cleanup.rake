# 음성 저장소 정리: (1) 비-mp3 활성 오디오를 mp3로 변환, (2) 고아 파일·미완 업로드 잔재 삭제.
# 안전장치:
#   - 변환은 기존 AudioUploadJob(transcode→DB갱신→원본삭제 검증된 순서) 재사용
#   - 보존 기준 = meetings.audio_file_path 참조 집합 (재생이 실제로 읽는 경로)
#   - 최근 1시간 내 수정 파일은 고아여도 보존(녹음 진행 중 보호)
#   - 기본 DRY-RUN. 실제 실행은 APPLY=1
#
# 사용:  bin/rails audio:cleanup            # 미리보기(삭제 안 함)
#        APPLY=1 bin/rails audio:cleanup    # 실제 변환+삭제
namespace :audio do
  desc "WAV/webm/m4a → mp3 변환 + 고아/미완 잔재 삭제 (APPLY=1 로 실제 실행)"
  task cleanup: :environment do
    apply = ENV["APPLY"] == "1"
    audio_dir = ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s }
    recent_guard = 3600 # 초: 최근 수정 파일은 고아여도 보존
    mode = apply ? "APPLY(실삭제)" : "DRY-RUN(미리보기)"
    puts "=== audio:cleanup [#{mode}] dir=#{audio_dir} ==="

    def dir_size(dir)
      `du -sk #{dir.shellescape} 2>/dev/null`.to_i # KB
    end
    before_kb = dir_size(audio_dir)

    # ── Phase 1: 비-mp3 활성 오디오 → mp3 변환 ──────────────────────────
    convert_targets = Meeting.where.not(audio_file_path: [nil, ""]).select do |m|
      p = m.audio_file_path
      File.exist?(p) && File.extname(p).casecmp(".mp3") != 0
    end
    puts "\n[1] mp3 변환 대상: #{convert_targets.size}건"
    convert_targets.each do |m|
      old = m.audio_file_path
      old_kb = (File.size(old) / 1024.0).round
      if apply
        AudioUploadJob.perform_now(meeting_id: m.id)
        m.reload
        new_kb = m.audio_file_path && File.exist?(m.audio_file_path) ? (File.size(m.audio_file_path) / 1024.0).round : 0
        ok = File.extname(m.audio_file_path.to_s).casecmp(".mp3").zero?
        puts "    ##{m.id} #{File.basename(old)} (#{old_kb}KB) → #{File.basename(m.audio_file_path)} (#{new_kb}KB) #{ok ? '✓' : '✗변환실패·원본유지'}"
      else
        puts "    ##{m.id} #{File.basename(old)} (#{old_kb}KB) → mp3 변환 예정"
      end
    end

    # ── Phase 2: 고아·잔재 삭제 ───────────────────────────────────────
    # 변환 후 기준으로 참조 집합 재계산
    referenced = Meeting.where.not(audio_file_path: [nil, ""])
                        .pluck(:audio_file_path)
                        .map { |p| File.basename(p) }.to_set
    now = Time.now

    keep = lambda do |path|
      base = File.basename(path)
      return true if referenced.include?(base)                       # 활성 오디오
      if base.end_with?(".peaks.json")                               # 현재 오디오의 peaks
        return true if referenced.include?(base.sub(/\.peaks\.json\z/, ""))
      end
      false
    end

    orphans = []   # [path, kb, 사유]
    Dir.children(audio_dir).sort.each do |name|
      path = File.join(audio_dir, name)
      if File.directory?(path)
        if name.end_with?("_parts")
          kb = dir_size(path)
          orphans << [path, kb, "미완 업로드(_parts)"]
        end
        next
      end
      next if keep.call(path)
      mtime = File.mtime(path)
      if now - mtime < recent_guard
        puts "    (보존) 최근수정 #{name} — 녹음중 보호"
        next
      end
      kb = (File.size(path) / 1024.0).round
      reason =
        if name.end_with?(".peaks.json") then "고아 peaks"
        elsif name.end_with?(".raw") then "전사 임시(raw)"
        elsif name.end_with?(".part") then "미완 업로드(.part)"
        else "고아 오디오"
        end
      orphans << [path, kb, reason]
    end

    puts "\n[2] 고아/잔재: #{orphans.size}건 (#{(orphans.sum { |o| o[1] } / 1024.0).round} MB)"
    orphans.each do |path, kb, reason|
      puts "    #{apply ? '삭제' : '삭제예정'} #{File.basename(path)} (#{kb >= 1024 ? "#{(kb / 1024.0).round(1)}MB" : "#{kb}KB"}) — #{reason}"
      FileUtils.rm_rf(path) if apply
    end

    # ── 결과 ──────────────────────────────────────────────────────────
    after_kb = dir_size(audio_dir)
    puts "\n=== 결과 ==="
    if apply
      puts "이전: #{(before_kb / 1048576.0).round(2)} GB → 이후: #{(after_kb / 1048576.0).round(2)} GB (#{((before_kb - after_kb) / 1048576.0).round(2)} GB 절감)"
    else
      puts "현재: #{(before_kb / 1048576.0).round(2)} GB. APPLY=1 로 실제 실행하세요."
    end
  end
end
