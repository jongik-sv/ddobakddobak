class AudioUploadJob < ApplicationJob
  queue_as :default

  # 음성용 mp3 비트레이트 (mono 64kbps면 회의 음성에 충분하고 WAV 대비 ~1/15)
  MP3_BITRATE = "64k".freeze

  # 같은 회의의 미완료 AudioUploadJob 이 큐에 있는지. transcripts#redact 의 **값싼 조기 409(UX)**
  # 전용이며 경합 보증이 아니다 — 정말 위험한 잡은 이미 claim 되어 실행 중인 잡이고, 검사와
  # 파일 교체 사이의 창은 이걸로 닫히지 않는다. 실제 방어는 아래 perform 의 소스 identity 검증이다.
  # dev/test 는 큐 어댑터가 :async 라 solid_queue_jobs 테이블 자체가 없어 항상 false 가 된다.
  # where.missing 을 쓰지 않는다 — missing 은 WhereChain 메서드라 스펙에서 relation double 로
  # 체인을 재현할 수 없다(verified double 이 거부). 같은 의미의 left_joins 한 단계 체인으로 쓴다.
  def self.in_flight_for?(meeting_id)
    SolidQueue::Job.where(class_name: name, finished_at: nil)
                   .left_joins(:failed_execution)
                   .where(solid_queue_failed_executions: { id: nil })
                   .to_a
                   .any? { |job| job_meeting_id(job) == meeting_id }
  rescue ActiveRecord::StatementInvalid, NameError
    false
  end

  # ActiveJob 직렬화: perform(meeting_id:) 는 arguments 가 [{"meeting_id"=>1, "_aj_symbol_keys"=>[...]}].
  def self.job_meeting_id(job)
    args = job.arguments
    return nil unless args.is_a?(Hash)

    first = Array(args["arguments"]).first
    first.is_a?(Hash) ? first["meeting_id"] : nil
  end

  def perform(meeting_id:)
    tmp_path = nil
    meeting = Meeting.find(meeting_id)

    # ⭐ 기밀 구간 절단 표식이 서 있으면 변환 자체를 하지 않는다. 아래 identity 검증과
    # **중복이 아니다** — identity 는 전체 트랜스코딩이 끝난 뒤에야 판정하므로, 그 시점엔
    # 이미 절단 전(기밀) 오디오의 mp3 사본이 tmp 로 디스크에 쓰여 있다. 표식은 그보다 이르다.
    # 반대로 표식만으로는 부족하다 — 여기서 한 번 읽는 값이라 트랜스코딩 **중에** 커밋된
    # 절단은 못 본다. 그건 identity 가 잡는다. 둘 다 필요하다(어느 쪽도 지우지 말 것).
    if meeting.transcripts_redacted_at.present?
      Rails.logger.info "[AudioUploadJob] meeting=#{meeting_id} 기밀 절단된 회의 — 변환 생략"
      return
    end

    src = meeting.audio_file_path
    return unless src.present? && File.exist?(src) && File.size(src) > 0

    # 이미 mp3면 변환 불필요
    return if File.extname(src).casecmp(".mp3").zero?

    src_identity = file_identity(src)
    mp3_path = "#{src.sub(/#{Regexp.escape(File.extname(src))}\z/, '')}.mp3"
    # ⚠️ 최종 경로에 직접 쓰지 않는다. 최종 파일명으로 먼저 쓰면 identity 검사 **이전에** 절단 전
    # (기밀) 오디오가 정식 파일명으로 디스크에 올라간다 — 그 사이 프로세스가 죽으면(배포·OOM·
    # 워커 재시작) 검사가 영영 안 돌아 기밀 mp3 가 그대로 남는다. webm+mp3 공존(V3)에서는 방금
    # 절단한 <id>.mp3 를 미절단본으로 덮어쓰기까지 한다. tmp 로 쓰고 검증 통과 후에만 mv 한다.
    tmp_path = "#{mp3_path}.upload-tmp"

    unless transcode_to_mp3(src, tmp_path)
      FileUtils.rm_f(tmp_path)
      Rails.logger.error "[AudioUploadJob] meeting=#{meeting_id} mp3 변환 실패, 원본 유지 #{src}"
      return
    end

    # ⭐ 쓰기 직전 재검증 — 표식과 소스 identity 를 **여기서 함께** 다시 본다(감사 MAJOR:
    # 가드를 실제 쓰기(mv/set_audio_file!/cleanup_original)와 인접시킨다). 두 검사는 서로를
    # 대신하지 않는다:
    #  - identity 만으로는 부족하다 — "파일이 바뀌면 반드시 inode 도 바뀐다"는 불변식에만
    #    기대는 것이라, 표식은 섰지만 (아직) 파일 자체는 안 바뀐 순간의 창을 못 잡는다.
    #  - 표식(진입 시 1 회 읽기)만으로도 부족하다 — 트랜스코딩(수십 초) 중 커밋된 절단을
    #    입구에서는 볼 수 없고, 기밀 구간 절단(transcripts#redact)이 변환 중 소스를 통째로
    #    교체했을 수도 있다(ffmpeg 은 열린 fd·옛 inode 를 계속 읽으므로 방금 만든 mp3 는
    #    "절단 전" 오디오다 — 그대로 set_audio_file! + cleanup_original 하면 절단한 파일을
    #    지우고 기밀을 복원한다).
    # 진입 가드(큐 조회)로는 못 막는다(검사와 mv 사이 창 + dev/test 는 큐 테이블 없음).
    # 쓰기를 소유한 여기서 경합을 닫는다.
    if Meeting.where(id: meeting_id).pick(:transcripts_redacted_at).present? || file_identity(src) != src_identity
      FileUtils.rm_f(tmp_path)
      Rails.logger.warn "[AudioUploadJob] meeting=#{meeting_id} 소스 오디오가 변환 중 교체(또는 절단)됨 — 결과 폐기 #{src}"
      return
    end

    FileUtils.mv(tmp_path, mp3_path)
    meeting.set_audio_file!(mp3_path)
    cleanup_original(src)
    Rails.logger.info "[AudioUploadJob] meeting=#{meeting_id} mp3 변환 완료 #{mp3_path}"
  rescue ActiveRecord::RecordNotFound
    Rails.logger.error "[AudioUploadJob] Meeting not found: #{meeting_id}"
  ensure
    # ⭐ tmp 는 **소스 오디오 전체의 mp3 사본** = 절단 전 기밀 오디오다. 남기면 안 된다.
    # AudioRedactor#audio_paths 가 ".upload-tmp" 를 제외하므로 이후 절단에서도 잘리지 않고
    # 고아 파기 대상도 아니다 — 이 잡이 성공·실패 **모든** 경로에서 지운다.
    # 성공 경로는 이미 mv 로 옮겼으니 rm_f(force)가 무해한 no-op 이다.
    # ensure 로도 못 막는 경로(SIGKILL·OOM·배포로 프로세스가 통째로 죽는 경우)가 남으므로
    # 시간 기반 회수(SttChunkStorage.sweep_upload_tmps!)를 두 번째 방어선으로 둔다.
    FileUtils.rm_f(tmp_path) if tmp_path
  end

  private

  # 소스 파일 동일성 지문. 절단은 같은 디렉토리 mv(rename)로 교체하므로 inode 만으로도
  # 잡히지만, inode 재사용·복사 교체까지 덮도록 (inode, size, mtime) 셋을 합친다.
  # 파일이 사라졌으면 nil — 이것도 "달라졌다"로 취급된다.
  def file_identity(path)
    stat = File.stat(path)
    [ stat.ino, stat.size, stat.mtime.to_r ]
  rescue Errno::ENOENT
    nil
  end

  def transcode_to_mp3(src, dest)
    ok = system(
      "ffmpeg", "-y", "-loglevel", "error",
      "-i", src,
      "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", MP3_BITRATE,
      # dest 는 이제 "<id>.mp3.upload-tmp" 라 확장자로 muxer 를 못 고른다
      # ("Unable to find a suitable output format"). 포맷을 명시한다.
      "-f", "mp3",
      dest
    )
    ok && File.exist?(dest) && File.size(dest) > 0
  end

  # 변환 성공 시 원본 오디오와 원본 기준 peaks 캐시를 제거 (peaks는 mp3 기준으로 재생성됨)
  def cleanup_original(src)
    File.delete(src) if File.exist?(src)
    old_peaks = "#{src}.peaks.json"
    File.delete(old_peaks) if File.exist?(old_peaks)
  end
end
