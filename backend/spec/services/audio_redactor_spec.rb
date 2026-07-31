require "rails_helper"

RSpec.describe AudioRedactor do
  let(:meeting) { create(:meeting) }
  let(:audio_dir) { Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s }
  let(:redactor) { described_class.new(meeting) }

  around do |example|
    prev = ENV["AUDIO_DIR"]
    ENV["AUDIO_DIR"] = audio_dir
    FileUtils.mkdir_p(audio_dir)
    example.run
  ensure
    prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
    FileUtils.rm_rf(audio_dir)
  end

  # 10초 무음 16kHz mono WAV (ffmpeg 이 디코딩 가능한 최소 유효 파일)
  def write_wav(path, seconds: 10.0, rate: 16_000)
    samples = (rate * seconds).to_i
    data = ("\x00\x00".b * samples)
    File.open(path, "wb") do |f|
      f.write("RIFF"); f.write([ 36 + data.bytesize ].pack("V")); f.write("WAVE")
      f.write("fmt "); f.write([ 16 ].pack("V")); f.write([ 1 ].pack("v")); f.write([ 1 ].pack("v"))
      f.write([ rate ].pack("V")); f.write([ rate * 2 ].pack("V"))
      f.write([ 2 ].pack("v")); f.write([ 16 ].pack("v"))
      f.write("data"); f.write([ data.bytesize ].pack("V")); f.write(data)
    end
  end

  def probe_ms(path)
    out = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (out.to_f * 1000).to_i
  end

  describe "#audio_paths" do
    it "본 오디오만 고르고 peaks·merged 임시본·백업은 제외한다" do
      %W[#{meeting.id}.mp3 #{meeting.id}.webm].each { |n| File.binwrite(File.join(audio_dir, n), "x") }
      File.binwrite(File.join(audio_dir, "#{meeting.id}.mp3.peaks.json"), "{}")
      File.binwrite(File.join(audio_dir, "#{meeting.id}.webm.merged.webm"), "x")
      File.binwrite(File.join(audio_dir, "#{meeting.id}.mp3.redact-backup"), "x")
      File.binwrite(File.join(audio_dir, "#{meeting.id}0.mp3"), "x") # 다른 회의(id 접두 충돌)

      expect(redactor.audio_paths.map { |p| File.basename(p) })
        .to contain_exactly("#{meeting.id}.mp3", "#{meeting.id}.webm")
    end
  end

  describe "#purge_duplicate_sources!" do
    it "_parts/ · stt_chunks/ · *.merged.* 를 지운다" do
      parts = File.join(audio_dir, "#{meeting.id}_parts")
      FileUtils.mkdir_p(parts)
      File.binwrite(File.join(parts, "0.part"), "x")
      chunks = SttChunkStorage::ROOT.join(meeting.id.to_s)
      FileUtils.mkdir_p(chunks)
      File.binwrite(chunks.join("0-abc.pcm"), "x")
      merged = File.join(audio_dir, "#{meeting.id}.webm.merged.webm")
      File.binwrite(merged, "x")

      redactor.purge_duplicate_sources!

      expect(Dir.exist?(parts)).to be false
      expect(Dir.exist?(chunks)).to be false
      expect(File.exist?(merged)).to be false
    end

    it "이전 절단이 남긴 .redact-backup 을 지운다 (절단 전 원음 = 기밀)" do
      stale = File.join(audio_dir, "#{meeting.id}.mp3.redact-backup")
      File.binwrite(stale, "절단 전 원음 전체")

      redactor.purge_duplicate_sources!

      expect(File.exist?(stale)).to be false
    end

    it "다른 회의의 .redact-backup 은 건드리지 않는다" do
      other = File.join(audio_dir, "#{meeting.id}0.mp3.redact-backup")
      File.binwrite(other, "남의 회의")

      redactor.purge_duplicate_sources!

      expect(File.exist?(other)).to be true
    end

    it "swap_in! 뒤에 호출하면 raise 한다 (순서 계약을 코드로 강제)" do
      # ⭐ 주석·호출순서만으로는 리팩토링하다 깨진다. 잘못된 순서가 조용히 통과하면 이번 실행의
      # 백업이 지워져 롤백 복구 경로가 끊긴다 — 그 상태에서 커밋이 실패하면 오디오가 사라진다.
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      tmp = "#{src}.redact-tmp.wav"
      write_wav(tmp, seconds: 5.0)

      redactor.swap_in!(src => tmp)

      expect { redactor.purge_duplicate_sources! }
        .to raise_error(described_class::PurgeFailed, /먼저 호출/)
      expect(File.exist?("#{src}.redact-backup")).to be true # 백업은 그대로 살아 있다
    end

    it "고아 오디오(audio_file_path 가 아닌 <id>.*)를 peaks 와 함께 삭제한다" do
      primary = File.join(audio_dir, "#{meeting.id}.mp3")
      File.binwrite(primary, "x")
      meeting.update!(audio_file_path: primary)
      orphan = File.join(audio_dir, "#{meeting.id}.webm")
      File.binwrite(orphan, "절단 전 기밀 오디오")
      File.binwrite("#{orphan}.peaks.json", "{}")

      redactor.purge_duplicate_sources!

      expect(File.exist?(orphan)).to be false
      expect(File.exist?("#{orphan}.peaks.json")).to be false
      expect(File.exist?(primary)).to be true # primary 는 절단 대상이라 남는다
    end
  end

  describe "#primary_audio_path / #orphan_audio_paths" do
    it "audio_file_path 만 primary 이고 나머지 <id>.* 는 고아다" do
      primary = File.join(audio_dir, "#{meeting.id}.mp3")
      orphan  = File.join(audio_dir, "#{meeting.id}.webm")
      [ primary, orphan ].each { |p| File.binwrite(p, "x") }
      meeting.update!(audio_file_path: primary)

      expect(redactor.primary_audio_path).to eq(primary)
      expect(redactor.orphan_audio_paths).to eq([ orphan ])
    end
  end

  describe "#cut_to_temp" do
    it "남길 세그먼트를 concat 해 기대 길이(±1초)의 임시본을 만든다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      # [3s, 6s] 절단 → 남길 세그먼트 [0,3000] + [6000,10000] = 7초
      map = redactor.cut_to_temp([ [ 0, 3_000 ], [ 6_000, 10_000 ] ], 3_000)

      expect(map.keys).to eq([ src ])
      expect(probe_ms(map[src])).to be_within(1_000).of(7_000)
      expect(File.exist?(src)).to be true # 원본은 아직 그대로
    end

    it "지원하지 않는 확장자면 UnsupportedFormat" do
      flac = File.join(audio_dir, "#{meeting.id}.flac")
      File.binwrite(flac, "x")
      meeting.update!(audio_file_path: flac)
      expect { redactor.cut_to_temp([ [ 0, 1_000 ] ], 0) }.to raise_error(described_class::UnsupportedFormat)
    end

    it "ffmpeg 이 실패하면 TranscodeFailed 이고 임시본이 남지 않는다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      File.binwrite(src, "not audio at all")
      meeting.update!(audio_file_path: src)
      expect { redactor.cut_to_temp([ [ 0, 1_000 ] ], 0) }.to raise_error(described_class::TranscodeFailed)
      expect(Dir.glob(File.join(audio_dir, "*.redact-tmp*"))).to be_empty
    end
  end

  describe "#swap_in! / #restore_backups! / #drop_backups!" do
    it "교체 후 restore 하면 원본 내용이 되돌아온다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      original = File.binread(src)
      tmp = "#{src}.redact-tmp.wav"
      write_wav(tmp, seconds: 5.0)

      redactor.swap_in!(src => tmp)
      expect(File.binread(src)).not_to eq(original)

      redactor.restore_backups!
      expect(File.binread(src)).to eq(original)
      expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
    end

    it "drop_backups! 후에는 백업이 남지 않는다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      tmp = "#{src}.redact-tmp.wav"
      write_wav(tmp, seconds: 5.0)

      redactor.swap_in!(src => tmp)
      redactor.drop_backups!

      expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
      expect(File.exist?(src)).to be true
    end
  end

  describe "#purge_peaks! / #move_all_audio_to_backup!" do
    it "peaks 캐시를 지운다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      File.binwrite(src, "x")
      peaks = "#{src}.peaks.json"
      File.binwrite(peaks, "{}")

      redactor.purge_peaks!

      expect(File.exist?(peaks)).to be false
      expect(File.exist?(src)).to be true
    end

    it "move_all_audio_to_backup! 은 rm 이 아니라 백업으로 옮겨 롤백 복구를 남긴다" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      original = File.binread(src)

      redactor.move_all_audio_to_backup!
      expect(File.exist?(src)).to be false

      redactor.restore_backups!
      expect(File.binread(src)).to eq(original)
    end

    it "move_all_audio_to_backup! 은 peaks 를 즉시 파기한다 (백업 대상 아님)" do
      src = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(src)
      meeting.update!(audio_file_path: src)
      File.binwrite("#{src}.peaks.json", "{}")

      redactor.move_all_audio_to_backup!

      expect(File.exist?("#{src}.peaks.json")).to be false
    end
  end
end
