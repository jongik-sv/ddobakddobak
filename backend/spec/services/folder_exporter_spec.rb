require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"
require "tmpdir"

RSpec.describe FolderExporter do
  # tar.gz 스트림을 되읽어 엔트리 맵으로 반환
  def read_tar_gz(io)
    io.rewind
    entries = {}
    gz = Zlib::GzipReader.new(io)
    Gem::Package::TarReader.new(gz) do |tar|
      tar.each do |entry|
        next unless entry.file?
        entries[entry.full_name] = entry.read
      end
    end
    entries
  end

  let!(:owner)   { create(:user) }
  let!(:project) { create(:project, creator: owner, name: "기획팀") }

  # 폴더 A (루트), 폴더 B (A의 자식)
  let!(:folder_a) { create(:folder, project: project, name: "A 폴더", parent_id: nil) }
  let!(:folder_b) { create(:folder, project: project, name: "B 폴더", parent_id: folder_a.id) }

  # 회의1은 폴더 A, 회의2는 폴더 B (previous_meeting_id → 회의1)
  let!(:meeting1) do
    create(:meeting, project: project, creator: owner, title: "회의 1", folder: folder_a)
  end
  let!(:meeting2) do
    create(:meeting, project: project, creator: owner, title: "회의 2", folder: folder_b,
                     previous_meeting_id: meeting1.id)
  end

  let!(:tag)         { create(:tag, project: project, name: "중요") }
  let!(:tagging_a)   { Tagging.create!(tag: tag, taggable: folder_a) }
  let!(:tagging_m1)  { Tagging.create!(tag: tag, taggable: meeting1) }

  describe "#filename" do
    it "<slug>-folder-YYYYMMDD.ddobak-folder.tgz 형식이다 (ASCII name)" do
      folder_a.update_column(:name, "My Folder")
      exporter = described_class.new(folder_a, include_audio: false)
      expect(exporter.filename).to match(/\Amy-folder-folder-\d{8}\.ddobak-folder\.tgz\z/)
    end

    it "parameterize 결과가 없으면 'folder' 로 폴백한다 (한글 전용)" do
      folder_a.update_column(:name, "한글폴더")
      exporter = described_class.new(folder_a, include_audio: false)
      expect(exporter.filename).to match(/\Afolder-folder-\d{8}\.ddobak-folder\.tgz\z/)
    end
  end

  describe "#write_to (tar.gz)" do
    let(:base_entries) do
      io = StringIO.new
      described_class.new(folder_a, include_audio: false).write_to(io)
      read_tar_gz(io)
    end

    it "유효한 tar.gz 를 만들고 manifest.json 엔트리를 포함한다" do
      expect(base_entries).to have_key("manifest.json")
    end

    describe "manifest 구조" do
      subject(:parsed) { JSON.parse(base_entries["manifest.json"]) }

      it 'scope="folder" 이다' do
        expect(parsed["scope"]).to eq("folder")
      end

      it "format_version=1 이다" do
        expect(parsed["format_version"]).to eq(1)
      end

      it "include_audio 값을 기록한다" do
        expect(parsed["include_audio"]).to eq(false)
      end

      it "folders 에 A·B 가 모두 포함되고 parent_id 가 원본 보존된다" do
        folder_ids = parsed["folders"].map { |f| f["id"] }
        expect(folder_ids).to contain_exactly(folder_a.id, folder_b.id)

        b_hash = parsed["folders"].find { |f| f["id"] == folder_b.id }
        expect(b_hash["parent_id"]).to eq(folder_a.id)
      end

      it "meetings 에 회의1·2 가 모두 포함되고 folder_id 가 원본 보존된다" do
        meeting_ids = parsed["meetings"].map { |m| m["id"] }
        expect(meeting_ids).to contain_exactly(meeting1.id, meeting2.id)

        m2_hash = parsed["meetings"].find { |m| m["id"] == meeting2.id }
        expect(m2_hash["folder_id"]).to eq(folder_b.id)
      end

      it "회의2 의 previous_meeting_id 가 회의1 의 원본 id 이다" do
        m2_hash = parsed["meetings"].find { |m| m["id"] == meeting2.id }
        expect(m2_hash["previous_meeting_id"]).to eq(meeting1.id)
      end

      it "tags 배열에 중복 없이 태그가 포함된다" do
        tag_names = parsed["tags"].map { |t| t["name"] }
        # folder_a tagging + meeting1 tagging 둘 다 같은 tag → dedup 결과 1건
        expect(tag_names).to contain_exactly("중요")
      end

      it "exported_at 이 ISO8601 형식이다" do
        expect { Time.iso8601(parsed["exported_at"]) }.not_to raise_error
      end
    end

    context "include_audio=false" do
      it "오디오 엔트리를 0개 포함한다" do
        Dir.mktmpdir do |dir|
          audio_path = File.join(dir, "audio.mp3")
          File.binwrite(audio_path, "FAKEAUDIO")
          meeting1.update_column(:audio_file_path, audio_path)

          io = StringIO.new
          described_class.new(folder_a, include_audio: false).write_to(io)
          result = read_tar_gz(io)

          expect(result.keys.none? { |k| k.start_with?("audio/") }).to be(true)
        end
      end
    end

    context "include_audio=true" do
      it "실제 오디오 파일이 있으면 audio/<meeting_id>.<ext> 로 포함한다" do
        Dir.mktmpdir do |dir|
          audio_path = File.join(dir, "m1.mp3")
          File.binwrite(audio_path, "AUDIODATA")
          meeting1.update_column(:audio_file_path, audio_path)

          io = StringIO.new
          described_class.new(folder_a, include_audio: true).write_to(io)
          result = read_tar_gz(io)

          expect(result).to have_key("audio/#{meeting1.id}.mp3")
          expect(result["audio/#{meeting1.id}.mp3"]).to eq("AUDIODATA")
        end
      end

      it "오디오 파일이 존재하지 않으면 audio 엔트리를 스킵한다" do
        meeting1.update_column(:audio_file_path, "/nonexistent/missing.mp3")

        io = StringIO.new
        described_class.new(folder_a, include_audio: true).write_to(io)
        result = read_tar_gz(io)

        expect(result.keys.none? { |k| k.start_with?("audio/") }).to be(true)
      end
    end

    context "첨부 파일" do
      it "실제 첨부가 있으면 attachments/<basename> 으로 포함한다" do
        Dir.mktmpdir do |dir|
          attach_path = File.join(dir, "report.pdf")
          File.binwrite(attach_path, "PDFDATA")
          create(:meeting_attachment, meeting: meeting1, file_path: attach_path,
                                      uploaded_by_id: owner.id)

          io = StringIO.new
          described_class.new(folder_a, include_audio: false).write_to(io)
          result = read_tar_gz(io)

          expect(result).to have_key("attachments/report.pdf")
          expect(result["attachments/report.pdf"]).to eq("PDFDATA")
        end
      end
    end
  end
end
