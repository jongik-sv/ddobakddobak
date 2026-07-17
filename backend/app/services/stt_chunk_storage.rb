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

      removed
    end
  end
end
