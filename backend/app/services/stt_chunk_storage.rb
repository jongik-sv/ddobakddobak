# 실시간 STT 오디오 청크를 디스크에 저장/정리하는 서비스.
#
# 배경: TranscriptionChannel#audio_chunk가 base64 오디오(최대 ~427KB)를
# TranscriptionJob.perform_later 인자로 그대로 넘기면 solid_queue_jobs.arguments(TEXT)에
# 통째로 저장되어 큐 DB가 비대해지고 BusyException·청크 유실로 이어진다.
# 오디오는 디스크 파일로 우회시키고, 잡 인자에는 경로만 넘긴다(레버①).
class SttChunkStorage
  # test 환경은 tmp/storage 하위로 분리한다(Active Storage의 config/storage.yml 관례와 동일) —
  # 이 리포는 프로덕션 체크아웃에서 rspec을 직접 돌리므로, stub_const 누락 시에도
  # 프로덕션 storage/stt_chunks/가 오염·삭제되지 않도록 하는 구조적 방어선.
  ROOT = Rails.env.test? ? Rails.root.join("tmp", "storage", "stt_chunks") : Rails.root.join("storage", "stt_chunks")

  class << self
    # 디코딩된 PCM 바이너리를 파일로 저장하고 경로 문자열을 반환한다.
    # 디렉터리 생성·쓰기 실패 시 예외를 그대로 전파한다 — 호출부(channel)가
    # 인라인 base64 폴백으로 처리한다.
    def write_chunk(meeting_id, sequence, binary)
      dir = ROOT.join(meeting_id.to_s)
      FileUtils.mkdir_p(dir)
      path = dir.join("#{sequence}-#{SecureRandom.uuid}.pcm")
      File.binwrite(path, binary)
      path.to_s
    end

    # older_than 보다 오래된 청크 파일을 삭제하고, 비어 있으면서 24시간 넘게
    # 방치된 회의별 디렉터리도 함께 정리한다. 개별 파일/디렉터리 실패는 무시하고
    # 계속 진행한다(전체 스윕이 한 항목 때문에 중단되지 않도록). 삭제 건수 반환.
    def sweep!(older_than: 6.hours)
      return 0 unless Dir.exist?(ROOT)

      removed = 0
      file_cutoff = older_than.ago

      Dir.glob(ROOT.join("*", "*.pcm")).each do |path|
        begin
          next unless File.mtime(path) < file_cutoff

          File.delete(path)
          removed += 1
        rescue Errno::ENOENT
          # glob과 mtime/delete 사이에 다른 프로세스(TranscriptionJob 등)가 먼저
          # 지운 경우 — 무해, 다음 파일로 계속 진행.
        rescue StandardError => e
          Rails.logger.warn("[SttChunkStorage] 파일 삭제 실패 #{path}: #{e.message}")
        end
      end

      dir_cutoff = 24.hours.ago

      Dir.glob(ROOT.join("*")).each do |dir|
        begin
          next unless File.directory?(dir)
          next unless Dir.empty?(dir)
          next unless File.mtime(dir) < dir_cutoff

          Dir.rmdir(dir)
        rescue StandardError => e
          Rails.logger.warn("[SttChunkStorage] 디렉터리 삭제 실패 #{dir}: #{e.message}")
        end
      end

      # 이미 매시간 도는 유일한 훅이라 여기에 붙인다. config/recurring.yml:22,42 는 이 메서드를
      # **커맨드 문자열로 직접** 부르므로 스케줄 설정 변경·신규 잡·스키마 변경이 필요 없다.
      # 반환값(removed)에는 더하지 않는다 — 이 메서드의 계약은 "삭제한 PCM 청크 수"다.
      sweep_redact_backups!
      sweep_upload_tmps!

      removed
    end

    # 기밀 구간 절단(transcripts#redact)이 남긴 <id>.*.redact-backup 회수. 삭제 건수 반환.
    #
    # 이 파일은 절단 **전** 오디오 전체 = 기밀 원음이다. 정상 경로에서는 커밋 직후 drop_backups!
    # 가 지우지만, 그 호출이 실패하면(디스크 오류·권한·프로세스 사망) 남는다.
    # AudioRedactor#audio_paths 가 .redact-backup 을 제외하므로 이후 절단에서도 잘리지 않고,
    # "다음 절단이 스윕한다"(purge_stale_backups!)는 대부분의 회의가 두 번 절단되지 않아
    # 실질적으로 회수가 아니다. 시간 기반 회수가 두 번째 경로다.
    #
    # 회의 레코드를 조회하지 않는다 — 파일명의 id 접두는 힌트일 뿐이고, 전사를 전부 선택해
    # 전사가 0 건이 된 회의·삭제된 회의의 백업도 똑같이 회수돼야 한다.
    #
    # older_than 을 1시간으로 둔 이유: 진행 중인 절단의 백업을 뺏으면 안 된다. 절단 한 건은
    # 길어야 수십 초(ffmpeg 재인코딩)라 1시간이면 충분히 안전하다.
    def sweep_redact_backups!(older_than: 1.hour)
      sweep_audio_dir_glob!("*.redact-backup", older_than: older_than, label: "절단 백업")
    end

    # AudioUploadJob 이 남긴 <id>.mp3.upload-tmp 회수. 삭제 건수 반환.
    #
    # 이 파일은 소스 오디오 **전체**의 mp3 사본이다 — 절단 전 회의라면 기밀 오디오 그 자체.
    # 정상 경로에서는 잡의 ensure 가 지우지만, ensure 는 프로세스가 통째로 죽으면(SIGKILL·
    # OOM·배포 중 워커 재시작) 돌지 않는다. AudioRedactor#audio_paths 가 ".upload-tmp" 를
    # 제외하므로 이후 절단에도 잘리지 않고 고아 파기 대상도 아니다 — 회수 경로가 여기뿐이다.
    #
    # older_than 1시간: 진행 중인 트랜스코딩의 tmp 를 뺏으면 안 된다. ffmpeg 이 쓰는 동안
    # mtime 이 계속 갱신되므로 "1시간 넘게 안 자란 tmp = 죽은 잡의 잔해"가 성립한다.
    def sweep_upload_tmps!(older_than: 1.hour)
      sweep_audio_dir_glob!("*.upload-tmp", older_than: older_than, label: "변환 임시파일")
    end

    private

    # 오디오 디렉터리에서 pattern 에 맞고 older_than 보다 오래된 파일을 지운다. 삭제 건수 반환.
    # 개별 실패는 삼키고 계속 진행한다(한 파일 때문에 전체 스윕이 멈추지 않도록).
    def sweep_audio_dir_glob!(pattern, older_than:, label:)
      dir = ENV["AUDIO_DIR"].presence
      # ⚠️ test 에서 AUDIO_DIR 이 없으면 기본값이 **프로덕션** storage/audio 다. 이 저장소는
      # 프로덕션 체크아웃에서 rspec 을 직접 돌리므로(ROOT 가 test 에서 tmp 로 갈라지는 것과 같은
      # 이유) 명시적으로 지정되지 않은 test 실행에서는 아무것도 하지 않는다 — 스펙의 around
      # 격리를 빠뜨린 **미래의 스펙까지** 막는 구조적 방어선.
      return 0 if dir.nil? && Rails.env.test?

      dir ||= Rails.root.join("storage", "audio").to_s
      return 0 unless Dir.exist?(dir)

      cutoff = older_than.ago
      removed = 0

      Dir.glob(File.join(dir, pattern)).each do |path|
        begin
          next unless File.mtime(path) < cutoff

          File.delete(path)
          removed += 1
          Rails.logger.info("[SttChunkStorage] 잔존 #{label} 회수: #{File.basename(path)}")
        rescue Errno::ENOENT
          # 다른 프로세스(다음 절단의 purge_stale_backups!·잡의 ensure 등)가 먼저 지움 — 무해.
        rescue StandardError => e
          Rails.logger.warn("[SttChunkStorage] #{label} 삭제 실패 #{path}: #{e.message}")
        end
      end

      removed
    end
  end
end
