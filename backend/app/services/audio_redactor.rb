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
  # 인코더 지연·패딩(LAME 의 1152 샘플 프라이밍, opus 프리스킵)과 컨테이너 duration 반올림의 하한.
  # 이 아래로는 "안 잘렸다"와 "인코더 오차"를 길이만으로 구분할 수 없다.
  MIN_DURATION_TOLERANCE_MS = 50

  def initialize(meeting)
    @meeting = meeting
    @backups = {}
    @swapped = false # swap_in! 이 한 번이라도 돌았는지 — purge_stale_backups! 순서 강제용
    # 소스 identity 스냅샷(R1). 경로는 생성 시점, 파일 지문은 cut_to_temp 진입 시점에 잡는다.
    # 경로를 여기서 잡는 이유: 전사 전체 선택 경로는 cut_to_temp 를 타지 않지만
    # move_all_audio_to_backup! 로 오디오를 통째로 치우므로 그쪽도 보호받아야 한다.
    @source_path = meeting.audio_file_path
    @source_identities = {}
    @audio_set_snapshot = nil
  end

  # 전사 전체 선택 경로(cut_to_temp 를 타지 않는다)의 소스 스냅샷.
  # move_all_audio_to_backup! 은 <id>.* 를 **전부** 파기하므로 절단 경로보다 파괴 범위가 넓은데,
  # cut_to_temp 를 안 타면 지문이 하나도 없어 경로 문자열 비교만 남는다 — 같은 경로에 새 파일이
  # mv 로 확정되는 이어녹음 케이스(정확히 R1 이 막으려는 그 케이스)를 그대로 통과시킨다.
  # 파일 목록 자체도 함께 잡는다: 새 오디오가 **추가**된 경우는 지문 비교로는 보이지 않는데
  # 파기 대상에는 들어간다.
  #
  # ⚠️ purge_duplicate_sources! **뒤에** 부른다. 앞에서 부르면 고아 삭제로 정상적으로 사라진
  # 파일이 "변경됨"으로 잡혀 멀쩡한 요청이 409 가 된다.
  def capture_audio_identities!
    @audio_set_snapshot = audio_paths
    @source_identities = @audio_set_snapshot.to_h { |p| [ p, file_identity(p) ] }
  end

  # 절단을 시작할 때 읽은 그 오디오가 지금도 그대로인가. 다르면 호출부가 409 로 거부한다.
  #
  # 왜 필요한가: cut_to_temp 는 -c copy 가 불가해 1시간 mp3 면 수십 초가 걸리는데, swap_in! 은
  # **절단 전에 캡처한 경로**에 되쓴다. 그 창으로 이어녹음 병합(meetings_audio_controller.rb:155
  # 의 mv)·AudioUploadJob 의 set_audio_file! 이 그대로 들어와 소스를 갈아치울 수 있고, 그러면
  # 절단 결과가 **새 오디오를 덮어쓴다**. 트랜잭션 안 전사 재검증은 이 실패를 원리적으로 못 본다.
  #
  # ⚠️ audio_file_path 는 반드시 **DB 에서 다시 읽는다**. AudioUploadJob 은 다른 Meeting 인스턴스로
  # set_audio_file! 을 부르므로 호출부의 @meeting 은 그 변경을 영원히 못 본다 — 메모리 값끼리
  # 비교하면 항상 참인 자기충족 검사가 된다(이 클래스가 이미 한 번 겪은 실패 모드).
  def source_unchanged?
    return false unless Meeting.where(id: @meeting.id).pick(:audio_file_path) == @source_path
    # 파일 목록 스냅샷은 capture_audio_identities! 를 부른 경로(전사 전체 선택)에만 있다.
    # 절단 경로는 primary 하나만 되쓰므로 새 파일이 늘어도 파괴 대상이 아니다.
    return false if @audio_set_snapshot && audio_paths != @audio_set_snapshot

    @source_identities.all? { |path, captured| captured.present? && file_identity(path) == captured }
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
  #
  # ⭐ @meeting.audio_file_path(인메모리, 가변)가 아니라 **생성 시점에 캡처한 @source_path**를
  # 쓴다(감사 MAJOR: 메모리/DB 비대칭). source_unchanged? 는 DB 를 재조회해 이 값과 비교하는데
  # (자기충족적 비교를 피하려고 — 이 클래스가 이미 겪은 실패 모드), primary_audio_path 가
  # @meeting 의 인메모리 속성을 따라가면 두 메서드가 서로 다른 기준점을 갖는 창이 생긴다.
  # @meeting 객체가 (다른 코드에 의해) 생성 뒤 in-place 로 드리프트해도 — 예: 어딘가 이
  # 인스턴스에 attribute 를 다시 대입하거나 reload 하는 미래의 호출부 — orphan_audio_paths 가
  # 실제 절단 대상을 "고아"로 오분류해 purge_duplicate_sources! 가 지워버리는 사고를 막는다.
  def primary_audio_path
    path = @source_path
    path.presence && File.exist?(path) ? path : nil
  end

  # 나머지 <id>.* 오디오 = **고아 파일**. 절단하지 않고 삭제한다.
  #
  # ⚠️ primary 가 nil 이면(audio_file_path 가 nil 이거나 그 파일이 없음) **빈 목록**이다.
  # `reject { |p| p == nil }` 로 두면 <id>.* 오디오 전부가 고아가 되는데, purge_duplicate_sources!
  # 는 트랜잭션·ffmpeg·재검증보다 먼저 돌므로 그 뒤 409/422 로 끝나는 요청에서도 이미 전부
  # 삭제된 뒤가 된다. "가리키는 곳이 없다"는 "전부 버려도 된다"가 아니다 — 경로 컬럼이 비어 있고
  # 파일만 남은 상태는 복구 가능한 상태이지 파기 대상이 아니다.
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
    return [] if primary.nil?

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
    # ⚠️ id 뒤의 점을 반드시 앵커한다. `#{id}*.merged.*` 로 두면 회의 1 을 절단할 때
    # 회의 12·13·100… 의 병합 임시본까지 잡는다 — merge_audio_files 는
    # `<audio_dir>/<id><ext>.merged.webm`(meetings_audio_controller.rb:137)에 쓰고 :155 에서 mv 로
    # 확정하므로, 진행 중인 남의 이어녹음 병합 산출물을 지워 그 회의의 추가 녹음분이 유실된다.
    Dir.glob(File.join(audio_dir, "#{@meeting.id}.*.merged.*")).each do |p|
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
    purge_stale_upload_tmps!
  end

  # 죽은 AudioUploadJob 이 남긴 <id>.mp3.upload-tmp 회수. audio_paths 글롭이 이 확장자를
  # 제외만 하고(진행 중인 변환을 절단이 오인해 자르면 안 되니까) 지우는 코드가 없었다 —
  # 방치하면 소스 오디오 **전체**의 mp3 사본, 즉 절단 전 기밀 오디오가 그대로 남는다.
  # 시간 기반 회수(SttChunkStorage.sweep_upload_tmps!, 1시간)만으로는 부족하다 — 절단은
  # "즉시 파기"가 원칙인데 대부분의 회의는 두 번 절단되지 않아 다음 절단이 회수해 줄 기회도 없다.
  #
  # ⭐ 진행 중인 업로드는 건드리지 않는다(AudioUploadJob.in_flight_for?). 지워도 열린 fd 자체는
  # POSIX 상 안전하지만, 그 잡의 transcode_to_mp3 는 `File.exist?(dest)` 로 성공을 판정하므로
  # (audio_upload_job.rb) 디렉터리 엔트리가 사라지면 멀쩡히 진행 중이던 변환이 조용히 "실패"로
  # 처리돼 사용자 업로드가 통째로 날아간다. 그 잡은 성공·실패 **모든** 경로에서 ensure 로 자기
  # tmp 를 지우므로(+ 그마저 못 지운 경우를 위한 hourly sweep) 여기서 남겨둬도 기밀 잔존
  # 위험이 없다 — 이 메서드는 **죽은 잡이 남긴 것**만 지운다.
  # in_flight_for? 는 값싼 조기 판정(dev/test 는 :async 큐라 항상 false)이지 보증이 아니지만,
  # 여기서 필요한 건 정확히 그 정도다 — 진짜 안전장치는 위 문단의 ensure/hourly sweep 이다.
  def purge_stale_upload_tmps!
    return if AudioUploadJob.in_flight_for?(@meeting.id)

    Dir.glob(File.join(audio_dir, "#{@meeting.id}.*.upload-tmp")).each do |p|
      FileUtils.rm_f(p)
      raise PurgeFailed, "변환 임시파일을 지우지 못했습니다: #{p}" if File.exist?(p)
    end
  end

  # 이전 절단이 남긴 .redact-backup 스윕. 이건 "임시 파일"이 아니라 **절단 전 오디오 전체**,
  # 즉 기밀 원음이다. 커밋 뒤 drop_backups! 가 실패하면 남는데, 그때 복구하는 것은 금지돼 있고
  # (DB 는 이미 커밋됐다 — 되살리면 전사만 지워진 채 기밀 오디오가 부활한다) audio_paths 글롭도
  # .redact-backup 을 제외하므로(작업 중인 백업을 자기가 자르면 안 되니까) 이후 절단에서도
  # 영원히 잘리지 않는다. 지우는 코드가 여기 말고는 없다 → 다음 절단이 파기 책임을 진다.
  # 순서 계약을 **코드로** 강제한다. 주석만으로는 리팩토링하다 깨지고, "본문이 스스로 올바른
  # 순서로 부르는" 유닛 테스트는 순서를 규정할 뿐 검증하지 못한다. swap 이후 호출은 즉시 raise.
  #
  # ⚠️ 알려진 잔여 위험 (A5, 미해결 — 의도적으로 남긴다).
  # 이 글롭은 <id>.*.redact-backup 을 **전부** 지우므로, 같은 회의에 절단 두 건이 겹치면 B 의 이
  # 호출이 A 의 백업을 지울 수 있다. @swapped 가드는 같은 인스턴스 안에서만 유효하다.
  # 그럼에도 지금 고치지 않는 근거:
  #  (a) 창이 매우 좁다. B 의 purge 는 cut_to_temp **앞에서 한 번만** 돌고, A 의 백업은 swap_in!
  #      (트랜잭션 마지막) ~ drop_backups!(커밋 직후) 사이에만 존재한다. 겹치려면 B 의 진입이
  #      A 의 커밋 구간(수십 ms)에 정확히 떨어져야 한다. A 의 ffmpeg 구간(수십 초)과 겹치는
  #      흔한 경우는 아직 백업이 없어 아무 일도 일어나지 않는다.
  #  (b) 동시 절단의 **내용** 위험은 이미 닫혀 있다. 소스 identity 검증(source_unchanged?)이
  #      진 쪽을 409 로 되돌리므로 두 절단이 서로의 오디오를 덮어쓰는 일은 없다.
  #      (stamp_backup! 의 touch 는 **백업 경로에만** 걸리므로 이 지문 비교와 무관하다 —
  #       소스 경로의 identity 는 swap_in! 의 mv 시점에 이미 달라진다.)
  #  (c) 제대로 된 해법은 회의 단위 클레임(예: meetings 에 redacting_at 컬럼 + 원자적 UPDATE)인데
  #      SQLite 에는 advisory lock 이 없고 컬럼 추가는 마이그레이션 = 이 작업 범위 밖이다.
  #  (d) mtime 유예(갓 만든 백업은 건너뛰기)는 검토 후 기각했다. A2 의 touch 로 mtime 이 이제
  #      신뢰할 수 있게 됐지만, 그러면 "다음 절단이 이전 잔존 백업을 즉시 파기한다"는 계약이
  #      시간 의존이 되고(잔존 기밀 원음이 최대 유예 시간만큼 더 살아남는다) 그 계약을 고정한
  #      기존 테스트 두 건과 정면으로 충돌한다.
  # 후속: 회의 단위 클레임 컬럼 도입 시 이 글롭을 "내 것이 아닌 백업만" 으로 좁힐 것.
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

        # ffmpeg 을 돌리기 **전에** 소스 지문을 잡는다 — source_unchanged? 가 트랜잭션 안에서
        # 이 값과 대조해 "우리가 읽은 그 파일이 맞는지" 확인한다(위 source_unchanged? 주석).
        @source_identities[path] = file_identity(path)

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
        tolerance = duration_tolerance_ms(total_cut_ms)
        if (actual - expected).abs > tolerance
          raise TranscodeFailed,
                "절단 결과 길이가 기대와 다릅니다(#{File.basename(path)}): 기대 #{expected}ms, 실측 #{actual}ms (허용 ±#{tolerance}ms)"
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
      stamp_backup!(backup)
      @backups[path] = backup
      FileUtils.mv(tmp, path)
    end
  end

  # 커밋 후에만 호출한다. **지우지 못한 백업 경로 배열**을 반환한다(빈 배열 = 전부 파기).
  #
  # raise 하지 않는 이유: 이미 커밋된 뒤라 되돌릴 수 없다. 그런데 `FileUtils.rm_f` 는 force:true 라
  # 실패해도 **절대 예외를 던지지 않는다**(쓰기 금지 디렉토리에서 조용히 반환, 파일은 그대로).
  # 그래서 호출부의 `begin/rescue → backup_retained = true` 는 도달 불가였고 응답 필드는 영구히
  # false 였다 — 남은 기밀 원음을 아무도 모르는 상태. 이 클래스의 다른 파기 경로(purge_tree!·
  # purge_stale_backups!·고아 루프)와 똑같이 `rm_f` 뒤 `File.exist?` 로 확인하되, 커밋 뒤라는
  # 위치만 다르므로 raise 대신 실패 목록을 반환해 호출부가 노출·로깅하게 한다.
  # 실패해도 @backups 는 반드시 비운다 — 커밋 뒤 restore_backups! 가 돌면 "전사는 지워졌는데
  # 기밀 오디오는 부활"이라는 설계가 금지한 방향이 된다.
  def drop_backups!
    retained = @backups.each_value.filter_map do |b|
      FileUtils.rm_f(b)
      b if File.exist?(b)
    end
    @backups = {}
    retained
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
      stamp_backup!(backup)
      @backups[p] = backup
    end
  end

  private

  # ⭐ 길이 검증 톨러런스를 **절단 길이에 비례**시킨다(A4).
  # 이 비교는 cut_to_temp 가 "ffmpeg 이 실제로 뭔가 잘랐는가"를 확인하는 **유일한** 검증이다.
  # 고정 1초로 두면 1초 미만 절단에서 **아무것도 안 자른 결과가 그대로 통과한다** — 그리고 짧은
  # 발언 한 마디를 자르는 것이 이 기능의 가장 흔한 사용법이다. 통과하면 전사만 사라지고 기밀
  # 오디오는 그대로 남은 채 200 이 나간다.
  # 절반(total_cut_ms / 2)을 쓰는 이유: no-op 결과의 오차는 정확히 total_cut_ms 이므로 그 절반을
  # 임계로 두면 반드시 걸리고, 인코더 오차(수~수십 ms)는 통과한다. 상한은 기존 1초, 하한은
  # 인코더 패딩 바닥(MIN_DURATION_TOLERANCE_MS).
  def duration_tolerance_ms(total_cut_ms)
    [ DURATION_TOLERANCE_MS, [ total_cut_ms / 2, MIN_DURATION_TOLERANCE_MS ].max ].min
  end

  # ⭐ 백업의 mtime 을 **생성 시각**으로 만든다. 이게 없으면 시간 기반 회수가 통째로 성립하지 않는다.
  # 백업은 같은 디렉토리 안 FileUtils.mv = rename 으로 만들어지는데 rename 은 mtime 을 **보존한다**
  # (바뀌는 건 ctime 과 디렉토리 mtime 이다). 원본 녹음 파일의 mtime 은 보통 수 시간~수일 전이므로,
  # 갓 만든 백업이 생성되는 그 순간부터 SttChunkStorage.sweep_redact_backups! 의 1시간 cutoff 를
  # 넘어 있다 → 스위퍼가 **진행 중인 절단의 롤백 복구 대상**을 뺏어간다(커밋 실패 시 원본 영구 소실).
  # 반대 방향으로도 깨진다: "오래된 백업만 회수"라는 판정이 원본 녹음 시각에 좌우돼 의도와 무관해진다.
  # touch 실패는 삼킨다 — 백업 자체는 이미 만들어졌고, 여기서 raise 하면 절단이 통째로 롤백된다.
  # (최악의 경우 판정이 예전 동작으로 되돌아갈 뿐이다.)
  def stamp_backup!(backup)
    FileUtils.touch(backup)
  rescue SystemCallError => e
    Rails.logger.warn("[AudioRedactor] 백업 타임스탬프 갱신 실패 #{backup}: #{e.message}")
  end

  # 파일 동일성 지문. 같은 경로에 mv 로 새 파일이 확정되면 inode 가 바뀌고(같은 디렉토리 rename),
  # 같은 inode 에 덧쓰기면 size·mtime 이 바뀐다. 파일이 사라졌으면 nil → 비교에서 반드시 어긋난다
  # (캡처 시점에는 ffmpeg 이 읽는 파일이라 nil 이 될 수 없으므로 "사라짐 = 변경"으로 판정된다).
  def file_identity(path)
    stat = File.stat(path)
    [ stat.ino, stat.size, stat.mtime.to_f ]
  rescue SystemCallError
    nil
  end

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
