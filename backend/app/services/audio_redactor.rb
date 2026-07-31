# 기밀 구간 절단의 파일시스템 담당. 본 오디오 절단 + 중복 기밀 사본 파기 + 백업/복구.
#
# 파일시스템은 트랜잭션이 아니므로 순서를 코드로 못 박는다:
#   purge_duplicate_sources!  (트랜잭션·ffmpeg 보다 먼저 — 남겨두면 finalize 가 재구성한다)
#   cut_to_temp               (DB 무변경. 여기서 실패하면 아무것도 안 바뀐다)
#   swap_in!                  (트랜잭션 마지막. 같은 디렉토리 mv = rename = 사실상 원자적)
#   drop_backups! / restore_backups!
# 설계: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
class AudioRedactor
  include AudioStorage

  class Error < StandardError; end
  class UnsupportedFormat < Error; end
  class TranscodeFailed < Error; end
  class PurgeFailed < Error; end

  # 확장자별 인코더. -c copy 는 임의 지점 절단에 쓸 수 없어 재인코딩이 강제된다(한 세대 손실 수용).
  # 추측 기본값을 두지 않는다 — 모르는 형식은 조용히 망가뜨리는 대신 422 로 거부한다.
  CODECS = {
    ".mp3"  => [ "-c:a", "libmp3lame", "-b:a", AudioUploadJob::MP3_BITRATE ],
    ".webm" => [ "-c:a", "libopus" ],
    ".ogg"  => [ "-c:a", "libopus" ],
    ".m4a"  => [ "-c:a", "aac" ],
    ".mp4"  => [ "-c:a", "aac" ],
    ".wav"  => [ "-c:a", "pcm_s16le" ]
  }.freeze

  DURATION_TOLERANCE_MS = 1000

  def initialize(meeting)
    @meeting = meeting
    @backups = {}
    @swapped = false # swap_in! 이 한 번이라도 돌았는지 — purge_stale_backups! 순서 강제용
  end

  # <id>.* 중 파생물을 제외한 오디오 파일 전부. 절단 대상(primary)과 삭제 대상(orphan)을 가르는
  # 재료일 뿐, 이걸 그대로 절단하지 않는다 — 아래 primary_audio_path / orphan_audio_paths 참조.
  # .redact-backup 제외가 특히 중요하다: 앞선 시도가 두 mv 사이에서 죽으면 백업이 잔존하는데,
  # 다음 시도가 이걸 '오디오'로 오인해 절단하면 마지막 남은 원본까지 오염된다. 대신 그 잔존
  # 백업은 purge_stale_backups! 가 통째로 파기한다 — 제외만 하고 끝내면 기밀 원음이 영구히 남는다.
  def audio_paths
    Dir.glob(File.join(audio_dir, "#{@meeting.id}.*")).reject { |p|
      b = File.basename(p)
      b.end_with?(".peaks.json", ".redact-backup") || b.include?(".merged.") ||
        b.include?(".redact-tmp") || b.include?(".upload-tmp")
    }.sort
  end

  # 실제로 절단할 파일 — meeting.audio_file_path 하나뿐이다.
  def primary_audio_path
    path = @meeting.audio_file_path
    path.presence && File.exist?(path) ? path : nil
  end

  # 나머지 <id>.* 오디오 = **고아 파일**. 절단하지 않고 삭제한다.
  #
  # 왜 자르지 않고 지우는가: kept_segments 는 primary 의 타임라인 기준인데, V3 가 지적한
  # webm+mp3 공존은 정확히 **길이가 다른 두 파일**이다(재녹음 병합 시 dest 확장자가 새 업로드
  # 기준으로 바뀌어 옛 <id>.mp3 가 그대로 남는다). 짧은 쪽에 같은 세그먼트를 적용하면 뒤쪽
  # 세그먼트가 통째로 잘려 ffprobe 길이 검증에 걸리고 → 그 회의는 **영원히 절단 불가**가 된다.
  # 게다가 이 파일들은 audio_file_path 가 가리키지 않아 어디서도 재생·다운로드되지 않는
  # 절단 전 기밀 오디오다. 남길 이유가 없다. AudioUploadJob 이 나중에 이걸 집어 갈 위험도
  # 함께 사라진다(그 경합은 별도로 인플라이트 409 + 소스 identity 검증이 막는다).
  def orphan_audio_paths
    primary = primary_audio_path
    audio_paths.reject { |p| p == primary }
  end

  # 중복 기밀 사본 선삭제. 본 오디오에 이미 병합된 조각들이라 롤백 시 잃어도 무해하고,
  # 남겨두는 쪽이 위험하다 — finalize 에는 회의 상태 가드가 없어 <id>_parts/ 가 있으면
  # 잘리지 않은 청크로 오디오를 재구성한다(V6-b). stt_chunks 는 6시간 스위퍼가 유일한
  # 정리 경로라 완료된 회의에도 원시 PCM 이 남아 있을 수 있다(V1).
  #
  # ⚠️ 반드시 swap_in! **전에** 호출한다. 이 메서드는 잔존 .redact-backup 도 쓸어내는데,
  # swap_in! 뒤에 부르면 방금 만든 이번 실행의 백업까지 지워 롤백 복구 경로가 끊긴다.
  # 컨트롤러가 cut_to_temp 앞에서 한 번만 호출하는 것으로 순서를 고정한다.
  def purge_duplicate_sources!
    purge_tree!(File.join(audio_dir, "#{@meeting.id}_parts"))
    purge_tree!(SttChunkStorage::ROOT.join(@meeting.id.to_s).to_s)
    Dir.glob(File.join(audio_dir, "#{@meeting.id}*.merged.*")).each do |p|
      FileUtils.rm_f(p)
      raise PurgeFailed, "임시 병합 파일을 지우지 못했습니다: #{p}" if File.exist?(p)
    end
    # 고아 오디오(<id>.* 중 audio_file_path 가 아닌 것) — 참조되지 않는 절단 전 기밀 오디오다.
    orphan_audio_paths.each do |p|
      FileUtils.rm_f("#{p}.peaks.json")
      FileUtils.rm_f(p)
      raise PurgeFailed, "고아 오디오를 지우지 못했습니다: #{p}" if File.exist?(p)
    end
    purge_stale_backups!
  end

  # 이전 절단이 남긴 .redact-backup 스윕. 이건 "임시 파일"이 아니라 **절단 전 오디오 전체**,
  # 즉 기밀 원음이다. 커밋 뒤 drop_backups! 가 실패하면 남는데, 그때 복구하는 것은 금지돼 있고
  # (DB 는 이미 커밋됐다 — 되살리면 전사만 지워진 채 기밀 오디오가 부활한다) audio_paths 글롭도
  # .redact-backup 을 제외하므로(작업 중인 백업을 자기가 자르면 안 되니까) 이후 절단에서도
  # 영원히 잘리지 않는다. 지우는 코드가 여기 말고는 없다 → 다음 절단이 파기 책임을 진다.
  # 순서 계약을 **코드로** 강제한다. 주석만으로는 리팩토링하다 깨지고, "본문이 스스로 올바른
  # 순서로 부르는" 유닛 테스트는 순서를 규정할 뿐 검증하지 못한다. swap 이후 호출은 즉시 raise.
  def purge_stale_backups!
    if @swapped
      raise PurgeFailed, "purge_stale_backups! 는 swap_in! 보다 먼저 호출해야 합니다 (이번 실행의 백업까지 지워 롤백 복구가 끊긴다)"
    end

    Dir.glob(File.join(audio_dir, "#{@meeting.id}.*.redact-backup")).each do |p|
      FileUtils.rm_f(p)
      raise PurgeFailed, "이전 절단의 잔존 백업을 지우지 못했습니다: #{p}" if File.exist?(p)
    end
  end

  # primary 오디오 하나만 임시본으로 절단한다(고아는 purge_duplicate_sources! 가 이미 지웠다).
  # 실패하면 만들던 임시본을 지우고 예외를 올린다.
  def cut_to_temp(kept_segments, total_cut_ms)
    produced = {}
    created = []
    begin
      Array(primary_audio_path).each do |path|
        ext = File.extname(path).downcase
        codec = CODECS[ext]
        raise UnsupportedFormat, "지원하지 않는 오디오 형식입니다: #{ext}" if codec.nil?

        src_duration_ms = probe_duration_ms(path)
        tmp = "#{path}.redact-tmp#{ext}"
        created << tmp

        ok = system(
          "ffmpeg", "-y", "-loglevel", "error",
          "-i", path,
          "-filter_complex", filter_graph(kept_segments, src_duration_ms),
          "-map", "[out]", *codec, tmp,
          out: File::NULL, err: File::NULL
        )
        unless ok && File.exist?(tmp) && File.size(tmp) > 0
          raise TranscodeFailed, "오디오 절단에 실패했습니다: #{File.basename(path)}"
        end

        expected = src_duration_ms - total_cut_ms
        actual = probe_duration_ms(tmp)
        if (actual - expected).abs > DURATION_TOLERANCE_MS
          raise TranscodeFailed,
                "절단 결과 길이가 기대와 다릅니다(#{File.basename(path)}): 기대 #{expected}ms, 실측 #{actual}ms"
        end

        produced[path] = tmp
      end
      produced
    rescue StandardError
      created.each { |t| FileUtils.rm_f(t) }
      raise
    end
  end

  # 트랜잭션 마지막에 호출. 같은 디렉토리 안 mv = rename 이라 사실상 원자적이다.
  def swap_in!(mapping)
    @swapped = true
    mapping.each do |path, tmp|
      backup = "#{path}.redact-backup"
      FileUtils.mv(path, backup)
      @backups[path] = backup
      FileUtils.mv(tmp, path)
    end
  end

  # 커밋 후에만 호출한다.
  def drop_backups!
    @backups.each_value { |b| FileUtils.rm_f(b) }
    @backups = {}
  end

  def restore_backups!
    @backups.each do |path, backup|
      next unless File.exist?(backup)

      FileUtils.rm_f(path)
      FileUtils.mv(backup, path)
    end
    @backups = {}
  end

  # 파형 캐시 무효화. peaks 는 파일 존재 여부로만 캐시 판정하므로
  # (meetings_audio_controller.rb:100-101) 안 지우면 절단 전 파형이 영구히 서빙된다.
  # 같은 경로 in-place 교체는 cleanup_original 의 무효화 경로에 걸리지 않는다.
  # **멱등이며 swap_in! 직전과 커밋 직후 두 번 호출한다** — 커밋 뒤 한 번만 부르면 그 사이
  # 프로세스가 죽었을 때 절단 전 파형이 회수 경로 없이 영구히 서빙된다(peaks 는 재생성 트리거가
  # "파일 없음" 뿐이라 스스로 낫지 않는다). 먼저 지워도 손해가 없다: 요청 시 재생성된다.
  def purge_peaks!
    audio_paths.each { |p| FileUtils.rm_f("#{p}.peaks.json") }
  end

  # 남길 세그먼트가 하나도 없는 경우(전사 전체 선택). ffmpeg 필터 그래프가 성립하지 않으므로
  # 절단 대신 오디오 자체를 치운다. reset_content(meetings_controller.rb:475-483)의 선례를 따르되,
  # 경로를 비우는 것은 set_audio_file!(meeting.rb:134-140)의 담당 범위가 아니라 호출부가 처리한다.
  #
  # **rm 이 아니라 swap 경로와 같은 백업 규율을 쓴다.** 그냥 지우면 이 호출 뒤 커밋이 실패했을 때
  # "전사는 그대로인데 오디오만 사라진 500" 이 되어 복구할 수 없다. .redact-backup 으로 옮겨두면
  # 기존 rescue 의 restore_backups! 가 그대로 되살린다(커밋 후 drop_backups! 가 파기).
  def move_all_audio_to_backup!
    @swapped = true
    audio_paths.each do |p|
      FileUtils.rm_f("#{p}.peaks.json")
      backup = "#{p}.redact-backup"
      FileUtils.mv(p, backup)
      @backups[p] = backup
    end
  end

  private

  def purge_tree!(path)
    return unless File.exist?(path)

    FileUtils.rm_rf(path)
    raise PurgeFailed, "중복 오디오 사본을 지우지 못했습니다: #{path}" if File.exist?(path)
  end

  # asplit=N 을 명시한다. 입력 pad 재사용을 split 없이 허용할지는 ffmpeg 빌드마다 달라
  # (실서버 WSL2 vs dev macOS) 명시하는 쪽이 안전하다. N 은 "남길 세그먼트 수"다.
  def filter_graph(kept_segments, duration_ms)
    n = kept_segments.length
    parts = [ "[0:a]asplit=#{n}#{(0...n).map { |i| "[s#{i}]" }.join}" ]
    kept_segments.each_with_index do |(s, e), i|
      trim = "atrim=start=#{seconds(s)}"
      # 마지막 세그먼트가 파일 끝까지면 end 를 생략한다(부동소수 반올림으로 EOF 를 넘지 않게).
      trim += ":end=#{seconds(e)}" if e < duration_ms
      parts << "[s#{i}]#{trim},asetpts=N/SR/TB[a#{i}]"
    end
    parts << "#{(0...n).map { |i| "[a#{i}]" }.join}concat=n=#{n}:v=0:a=1[out]"
    parts.join("; ")
  end

  def seconds(ms)
    format("%.3f", ms / 1000.0)
  end

  def probe_duration_ms(path)
    out = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (out.to_f * 1000).to_i
  end
end
