require "rails_helper"
require "tmpdir"

RSpec.describe SttChunkStorage do
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
  end
end
