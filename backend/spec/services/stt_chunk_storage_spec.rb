require "rails_helper"
require "tmpdir"

RSpec.describe SttChunkStorage do
  # ⚠️ sweep! 이 이제 오디오 디렉터리(.redact-backup 회수)도 훑는다. AUDIO_DIR 미설정 시 기본값은
  # Rails.root/storage/audio — 이 저장소는 프로덕션 체크아웃에서 rspec 을 직접 돌리므로
  # 반드시 tmp 로 격리한다(SttChunkStorage::ROOT 가 test 에서 tmp 로 갈라지는 것과 같은 이유).
  # 메서드 자체에도 같은 취지의 구조적 방어선이 있지만(AUDIO_DIR 미설정 + test 면 0 반환),
  # 두 겹으로 둔다 — 스펙 격리는 미래의 스펙이 빠뜨릴 수 있고 구조적 방어선은 그때도 남는다.
  around do |example|
    prev = ENV["AUDIO_DIR"]
    dir = Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s
    ENV["AUDIO_DIR"] = dir
    FileUtils.mkdir_p(dir)
    example.run
  ensure
    prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
    FileUtils.rm_rf(dir)
  end

  before do
    @tmp_root = Pathname.new(Dir.mktmpdir("stt_chunk_storage_spec"))
    stub_const("SttChunkStorage::ROOT", @tmp_root)
  end

  after do
    FileUtils.rm_rf(@tmp_root)
  end

  describe ".write_chunk" do
    it "creates the meeting directory and writes the binary to a .pcm file" do
      path = described_class.write_chunk(42, 3, "binary-audio-bytes")

      expect(File).to exist(path)
      expect(path).to start_with(@tmp_root.join("42").to_s)
      expect(File.binread(path)).to eq("binary-audio-bytes")
    end

    it "names the file with the sequence prefix and .pcm extension" do
      path = described_class.write_chunk(42, 7, "x")

      expect(File.basename(path)).to start_with("7-")
      expect(File.basename(path)).to end_with(".pcm")
    end

    it "does not clobber files across repeated writes with the same sequence" do
      path1 = described_class.write_chunk(1, 0, "a")
      path2 = described_class.write_chunk(1, 0, "b")

      expect(path1).not_to eq(path2)
      expect(File.binread(path1)).to eq("a")
      expect(File.binread(path2)).to eq("b")
    end
  end

  describe ".sweep!" do
    it "deletes files older than the cutoff and returns the removed count" do
      path = described_class.write_chunk(1, 0, "old")
      FileUtils.touch(path, mtime: 7.hours.ago.to_time)

      removed = described_class.sweep!(older_than: 6.hours)

      expect(removed).to eq(1)
      expect(File).not_to exist(path)
    end

    it "preserves files newer than the cutoff" do
      path = described_class.write_chunk(1, 0, "fresh")

      removed = described_class.sweep!(older_than: 6.hours)

      expect(removed).to eq(0)
      expect(File).to exist(path)
    end

    it "removes empty meeting directories once they exceed the 24h grace period" do
      path = described_class.write_chunk(9, 0, "old")
      dir = File.dirname(path)
      FileUtils.touch(path, mtime: 7.hours.ago.to_time)

      described_class.sweep!(older_than: 6.hours) # 파일 삭제 → 디렉터리는 이제 비어 있음
      FileUtils.touch(dir, mtime: 25.hours.ago.to_time) # 방금 비워진 mtime을 25시간 전으로 되돌림

      described_class.sweep!(older_than: 6.hours)

      expect(Dir).not_to exist(dir)
    end

    it "does not remove a directory that just became empty (fresh mtime, within grace period)" do
      path = described_class.write_chunk(9, 0, "old")
      dir = File.dirname(path)
      FileUtils.touch(path, mtime: 7.hours.ago.to_time)

      described_class.sweep!(older_than: 6.hours) # 디렉터리 mtime은 방금(삭제 직후)으로 갱신됨

      expect(Dir).to exist(dir)
    end

    it "keeps non-empty directories even if old" do
      path = described_class.write_chunk(9, 0, "fresh-file-stays")
      dir = File.dirname(path)
      FileUtils.touch(dir, mtime: 25.hours.ago.to_time)

      described_class.sweep!(older_than: 6.hours)

      expect(Dir).to exist(dir)
    end

    it "returns 0 without raising when the root directory does not exist yet" do
      FileUtils.rm_rf(@tmp_root)

      expect(described_class.sweep!).to eq(0)
    end

    it "continues past an individual file deletion failure" do
      path = described_class.write_chunk(1, 0, "old")
      other_path = described_class.write_chunk(1, 1, "old-too")
      FileUtils.touch(path, mtime: 7.hours.ago.to_time)
      FileUtils.touch(other_path, mtime: 7.hours.ago.to_time)

      allow(File).to receive(:delete).and_call_original
      allow(File).to receive(:delete).with(path).and_raise(Errno::EACCES)

      removed = nil
      expect { removed = described_class.sweep!(older_than: 6.hours) }.not_to raise_error
      expect(removed).to eq(1) # other_path만 삭제됨
      expect(File).to exist(path)
      expect(File).not_to exist(other_path)
    end

    it "잔존 .redact-backup 도 함께 회수한다 (스위퍼 배선 — 이게 없으면 회수 경로가 없다)" do
      # transcripts_controller 의 주석이 "(b) 매시간 SttChunkStorage.sweep! 가 회수한다"고
      # 단언하는 지점. sweep_redact_backups! 를 직접 부르는 example 만 두면 sweep! 안의 호출을
      # 통째로 지워도 green 이라 — 없는 방어선을 있다고 문서화한 상태가 그대로 남는다.
      backup = File.join(ENV.fetch("AUDIO_DIR"), "7.mp3.redact-backup")
      File.binwrite(backup, "절단 전 원음")
      FileUtils.touch(backup, mtime: 3.hours.ago.to_time)

      described_class.sweep!

      expect(File.exist?(backup)).to be false
    end

    it "잔존 .upload-tmp 도 함께 회수한다 (AudioUploadJob 이 SIGKILL 당한 경로)" do
      # ensure 는 프로세스가 죽으면 돌지 않는다(배포·OOM·워커 재시작). 그때 남는
      # <id>.mp3.upload-tmp 는 절단 전 오디오 **전체**의 mp3 사본이다.
      tmp = File.join(ENV.fetch("AUDIO_DIR"), "7.mp3.upload-tmp")
      File.binwrite(tmp, "절단 전 오디오의 mp3 사본")
      FileUtils.touch(tmp, mtime: 3.hours.ago.to_time)

      described_class.sweep!

      expect(File.exist?(tmp)).to be false
    end
  end

  describe ".sweep_upload_tmps!" do
    let(:audio_dir) { ENV.fetch("AUDIO_DIR") }

    it "임계보다 오래된 .upload-tmp 를 지운다" do
      old = File.join(audio_dir, "7.mp3.upload-tmp")
      File.binwrite(old, "절단 전 오디오의 mp3 사본")
      FileUtils.touch(old, mtime: 3.hours.ago.to_time)

      expect(described_class.sweep_upload_tmps!).to eq(1)
      expect(File.exist?(old)).to be false
    end

    it "임계보다 최근 파일은 남긴다 (진행 중인 트랜스코딩을 뺏지 않는다)" do
      # ffmpeg 이 쓰는 동안 mtime 이 계속 갱신되므로 "오래됨 = 죽음"이 성립한다.
      fresh = File.join(audio_dir, "8.mp3.upload-tmp")
      File.binwrite(fresh, "지금 인코딩 중")

      expect(described_class.sweep_upload_tmps!).to eq(0)
      expect(File.exist?(fresh)).to be true
    end

    it "오디오 파일 자체는 건드리지 않는다" do
      audio = File.join(audio_dir, "9.mp3")
      File.binwrite(audio, "x")
      FileUtils.touch(audio, mtime: 3.hours.ago.to_time)

      described_class.sweep_upload_tmps!

      expect(File.exist?(audio)).to be true
    end

    it "test 환경에서 AUDIO_DIR 이 없으면 아무것도 하지 않는다 (프로덕션 storage/audio 오염 방지)" do
      prev = ENV.delete("AUDIO_DIR")
      expect(Dir).not_to receive(:glob)
      expect(described_class.sweep_upload_tmps!).to eq(0)
    ensure
      ENV["AUDIO_DIR"] = prev
    end
  end

  describe ".sweep_redact_backups!" do
    let(:audio_dir) { ENV.fetch("AUDIO_DIR") }

    it "임계보다 오래된 .redact-backup 을 지운다 (절단 전 원음 회수)" do
      old = File.join(audio_dir, "7.mp3.redact-backup")
      File.binwrite(old, "절단 전 원음")
      FileUtils.touch(old, mtime: 3.hours.ago.to_time)

      expect(described_class.sweep_redact_backups!).to eq(1)
      expect(File.exist?(old)).to be false
    end

    it "임계보다 최근 파일은 남긴다 (진행 중인 절단의 백업을 뺏지 않는다)" do
      fresh = File.join(audio_dir, "8.mp3.redact-backup")
      File.binwrite(fresh, "지금 절단 중")

      expect(described_class.sweep_redact_backups!).to eq(0)
      expect(File.exist?(fresh)).to be true
    end

    it "오디오 파일 자체는 건드리지 않는다" do
      audio = File.join(audio_dir, "9.mp3")
      File.binwrite(audio, "x")
      FileUtils.touch(audio, mtime: 3.hours.ago.to_time)

      described_class.sweep_redact_backups!

      expect(File.exist?(audio)).to be true
    end

    it "회의 레코드가 없어도 파기한다 (전사 0건·회의 삭제 경로에서도 원음이 남으면 안 된다)" do
      # 백업 파일명은 회의 id 접두일 뿐 DB 를 조회하지 않는다. 전사를 전부 선택해 회의에 전사가
      # 0 건이 된 경우·회의가 삭제된 경우에도 디스크의 기밀 원음은 회수돼야 한다.
      orphan = File.join(audio_dir, "#{Meeting.maximum(:id).to_i + 9999}.webm.redact-backup")
      File.binwrite(orphan, "주인 없는 절단 전 원음")
      FileUtils.touch(orphan, mtime: 3.hours.ago.to_time)

      expect(described_class.sweep_redact_backups!).to eq(1)
      expect(File.exist?(orphan)).to be false
    end

    it "test 환경에서 AUDIO_DIR 이 없으면 아무것도 하지 않는다 (프로덕션 storage/audio 오염 방지)" do
      # 이 저장소는 프로덕션 체크아웃에서 rspec 을 돌린다. AUDIO_DIR 미설정 시 기본값이
      # Rails.root/storage/audio 이므로, 격리를 빠뜨린 미래의 스펙이 실 파일을 지우게 된다.
      prev = ENV.delete("AUDIO_DIR")
      expect(Dir).not_to receive(:glob)
      expect(described_class.sweep_redact_backups!).to eq(0)
    ensure
      ENV["AUDIO_DIR"] = prev
    end
  end
end
