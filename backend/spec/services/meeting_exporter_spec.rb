require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"
require "tmpdir"

RSpec.describe MeetingExporter do
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

  # 시드: project + meeting + 모든 자식 + tag/tagging + glossary
  let!(:owner)   { create(:user) }
  let!(:project) { create(:project, creator: owner, name: "기획팀") }

  let!(:meeting) do
    create(:meeting, project: project, creator: owner, title: "주간 회의")
  end

  let!(:transcript)   { create(:transcript, meeting: meeting, content: "회의 시작합니다") }
  let!(:summary)      { create(:summary, meeting: meeting) }
  let!(:parent_block) { create(:block, meeting: meeting, parent_block_id: nil) }
  let!(:child_block)  { create(:block, meeting: meeting, parent_block_id: parent_block.id) }
  let!(:contact)      { create(:meeting_contact, meeting: meeting) }
  let!(:bookmark)     { create(:meeting_bookmark, meeting: meeting) }
  let!(:chat_message) { create(:chat_message, meeting: meeting, user: owner) }

  let!(:tag)     { create(:tag, project: project, name: "긴급") }
  let!(:tagging) { Tagging.create!(tag: tag, taggable: meeting) }

  let!(:glossary_entry) do
    GlossaryEntry.create!(owner: meeting, from_text: "또박", to_text: "또박또박", match_type: "literal")
  end

  # 첨부 + .extracted 디렉토리는 tmpdir 를 사용하므로 각 컨텍스트에서 설정
  # (여기서는 파일 없는 기본 첨부)
  let!(:attachment) do
    create(:meeting_attachment, meeting: meeting, file_path: "/nonexistent/doc.pdf",
                                uploaded_by_id: owner.id)
  end

  describe "#filename" do
    it "<slug>-meeting-YYYYMMDD.ddobak-meeting.tgz 형식이다(ASCII title)" do
      meeting.update_column(:title, "Weekly Sync")
      exporter = described_class.new(meeting, include_audio: false)
      expect(exporter.filename).to match(/\Aweekly-sync-meeting-\d{8}\.ddobak-meeting\.tgz\z/)
    end

    it "parameterize 결과가 없으면(한글 전용 등) 'meeting' 으로 폴백한다" do
      # 한글은 parameterize 가 빈 문자열을 반환 → 폴백 'meeting'
      exporter = described_class.new(meeting, include_audio: false)
      expect(exporter.filename).to match(/\Ameeting-meeting-\d{8}\.ddobak-meeting\.tgz\z/)
    end

    it "특수문자만 있으면 'meeting' 으로 폴백한다" do
      meeting.update_column(:title, "!!!")
      exporter = described_class.new(meeting, include_audio: false)
      expect(exporter.filename).to match(/\Ameeting-meeting-\d{8}\.ddobak-meeting\.tgz\z/)
    end
  end

  describe "#write_to (tar.gz)" do
    it "유효한 tar.gz 를 만들고 manifest.json 을 포함한다" do
      io = StringIO.new
      described_class.new(meeting, include_audio: false).write_to(io)
      entries = read_tar_gz(io)
      expect(entries).to have_key("manifest.json")
    end

    describe "manifest 구조" do
      subject(:parsed) do
        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)
        JSON.parse(read_tar_gz(io)["manifest.json"])
      end

      it "format_version=1 이다" do
        expect(parsed["format_version"]).to eq(1)
      end

      it 'scope="meeting" 이다' do
        expect(parsed["scope"]).to eq("meeting")
      end

      it "meeting 키에 회의 원본 PK 를 포함한다" do
        expect(parsed["meeting"]["id"]).to eq(meeting.id)
      end

      it "transcripts 배열 크기가 일치한다" do
        expect(parsed["meeting"]["transcripts"].size).to eq(1)
        expect(parsed["meeting"]["transcripts"].first["content"]).to eq("회의 시작합니다")
      end

      it "summaries/blocks/contacts/bookmarks/chat_messages/glossary_entries 를 중첩한다" do
        expect(parsed["meeting"]["summaries"].size).to eq(1)
        expect(parsed["meeting"]["blocks"].size).to eq(2)
        expect(parsed["meeting"]["contacts"].size).to eq(1)
        expect(parsed["meeting"]["bookmarks"].size).to eq(1)
        expect(parsed["meeting"]["chat_messages"].size).to eq(1)
        expect(parsed["meeting"]["glossary_entries"].size).to eq(1)
      end

      it "tags 배열에 태그 name 이 포함된다" do
        expect(parsed["tags"].map { |t| t["name"] }).to include("긴급")
      end

      it "tag_ids 가 회의 tagging 태그 id 를 담는다" do
        expect(parsed["meeting"]["tag_ids"]).to contain_exactly(tag.id)
      end

      it "include_audio 값을 기록한다" do
        expect(parsed["include_audio"]).to eq(false)
      end
    end

    context "include_audio=false" do
      it "오디오 엔트리를 0개 포함한다" do
        Dir.mktmpdir do |dir|
          audio_path = File.join(dir, "meeting.mp3")
          File.binwrite(audio_path, "FAKEAUDIO")
          meeting.update_column(:audio_file_path, audio_path)

          io = StringIO.new
          described_class.new(meeting, include_audio: false).write_to(io)
          entries = read_tar_gz(io)

          expect(entries.keys.none? { |k| k.start_with?("audio/") }).to be(true)
        end
      end

      it "메타데이터(audio_file_path)는 manifest 에 보존한다" do
        meeting.update_column(:audio_file_path, "/nonexistent/path.mp3")

        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        parsed = JSON.parse(entries["manifest.json"])
        expect(parsed["meeting"]["audio_file_path"]).to eq("/nonexistent/path.mp3")
      end
    end

    context "include_audio=true" do
      it "실제 오디오 파일이 있으면 audio/<id>.<ext> 로 포함한다" do
        Dir.mktmpdir do |dir|
          audio_path = File.join(dir, "src.mp3")
          File.binwrite(audio_path, "FAKEAUDIO-BYTES")
          meeting.update_column(:audio_file_path, audio_path)

          io = StringIO.new
          described_class.new(meeting, include_audio: true).write_to(io)
          entries = read_tar_gz(io)

          expect(entries).to have_key("audio/#{meeting.id}.mp3")
          expect(entries["audio/#{meeting.id}.mp3"]).to eq("FAKEAUDIO-BYTES")
        end
      end

      it "오디오 파일이 없으면 audio 엔트리를 스킵한다" do
        meeting.update_column(:audio_file_path, "/nonexistent/missing.mp3")

        io = StringIO.new
        described_class.new(meeting, include_audio: true).write_to(io)
        entries = read_tar_gz(io)

        expect(entries.keys.none? { |k| k.start_with?("audio/") }).to be(true)
      end
    end

    context "첨부 파일 + .extracted 디렉토리" do
      it "실제 첨부를 attachments/<basename> 으로 포함하고 manifest 엔 basename 기록" do
        Dir.mktmpdir do |dir|
          attach_path = File.join(dir, "#{meeting.id}_deadbeef_report.pdf")
          File.binwrite(attach_path, "PDFDATA")

          att = create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                           uploaded_by_id: owner.id)

          io = StringIO.new
          described_class.new(meeting, include_audio: false).write_to(io)
          entries = read_tar_gz(io)

          basename = File.basename(attach_path)
          expect(entries).to have_key("attachments/#{basename}")
          expect(entries["attachments/#{basename}"]).to eq("PDFDATA")

          parsed = JSON.parse(entries["manifest.json"])
          # 파일 없는 기본 attachment 와 이 첨부 2개 중, file_path 가 basename 인 것을 찾는다
          att_hash = parsed["meeting"]["attachments"].find { |a| a["file_path"] == basename }
          expect(att_hash).not_to be_nil
        end
      end

      it ".extracted 디렉토리가 있으면 attachments/<basename>.extracted/<rel> 로 번들한다" do
        Dir.mktmpdir do |dir|
          # 원본 첨부 파일
          attach_path = File.join(dir, "agenda.pdf")
          File.binwrite(attach_path, "PDF")

          # .extracted 디렉토리 및 파일
          extraction_dir = "#{attach_path}.extracted"
          FileUtils.mkdir_p(extraction_dir)
          FileUtils.mkdir_p(File.join(extraction_dir, "sub"))
          File.write(File.join(extraction_dir, "x.txt"), "EXTRACTED")
          File.write(File.join(extraction_dir, "sub", "y.md"), "SUB")

          att = create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                           uploaded_by_id: owner.id)

          io = StringIO.new
          described_class.new(meeting, include_audio: false).write_to(io)
          entries = read_tar_gz(io)

          expect(entries).to have_key("attachments/agenda.pdf.extracted/x.txt")
          expect(entries["attachments/agenda.pdf.extracted/x.txt"]).to eq("EXTRACTED")
          expect(entries).to have_key("attachments/agenda.pdf.extracted/sub/y.md")
        end
      end
    end
  end
end
