require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"
require "tmpdir"

RSpec.describe ProjectExporter do
  # 시드: project + folder(계층) + meeting + 모든 자식 + tag/tagging + glossary
  let!(:owner)   { create(:user) }
  let!(:project) { create(:project, creator: owner, name: "기획팀") }
  let!(:root_folder)  { create(:folder, project: project, name: "루트", parent: nil) }
  let!(:child_folder) { create(:folder, project: project, name: "자식", parent: root_folder) }

  let!(:meeting) do
    create(:meeting, project: project, creator: owner, folder: child_folder,
                     title: "주간 회의")
  end

  let!(:transcript) { create(:transcript, meeting: meeting, content: "안녕하세요 회의 시작합니다") }
  let!(:summary)    { create(:summary, meeting: meeting) }
  let!(:action_item) { create(:action_item, meeting: meeting) }
  let!(:decision)    { create(:decision, meeting: meeting) }
  let!(:block)       { create(:block, meeting: meeting) }
  let!(:contact)     { create(:meeting_contact, meeting: meeting) }
  let!(:bookmark)    { create(:meeting_bookmark, meeting: meeting) }
  let!(:chat_message) { create(:chat_message, meeting: meeting, user: owner) }

  let!(:tag)     { create(:tag, project: project, name: "긴급") }
  let!(:tagging) { Tagging.create!(tag: tag, taggable: meeting) }

  let!(:glossary_entry) do
    GlossaryEntry.create!(owner: meeting, from_text: "또박", to_text: "또박또박", match_type: "literal")
  end

  describe "#manifest" do
    subject(:manifest) { described_class.new(project, include_audio: false).manifest }

    it "포맷 메타데이터를 포함한다" do
      expect(manifest[:format_version]).to eq(1)
      expect(manifest[:include_audio]).to eq(false)
      expect(manifest[:exported_at]).to be_present
    end

    it "프로젝트를 원본 속성 그대로 직렬화한다" do
      expect(manifest[:project]["id"]).to eq(project.id)
      expect(manifest[:project]["name"]).to eq("기획팀")
    end

    it "폴더를 원본 PK·parent_id 보존해 직렬화한다" do
      ids = manifest[:folders].map { |f| f["id"] }
      expect(ids).to contain_exactly(root_folder.id, child_folder.id)
      child = manifest[:folders].find { |f| f["id"] == child_folder.id }
      expect(child["parent_id"]).to eq(root_folder.id)
    end

    it "프로젝트의 태그를 직렬화한다" do
      expect(manifest[:tags].map { |t| t["id"] }).to contain_exactly(tag.id)
      expect(manifest[:tags].first["name"]).to eq("긴급")
    end

    describe "폴더 소유 glossary_entries (F3)" do
      let!(:folder_glossary) do
        GlossaryEntry.create!(owner: child_folder, from_text: "폴더오타", to_text: "폴더정정",
                              match_type: "literal")
      end

      it "각 folder 의 glossary_entries 를 직렬화한다" do
        child = manifest[:folders].find { |f| f["id"] == child_folder.id }
        expect(child).to have_key(:glossary_entries)
        expect(child[:glossary_entries].map { |g| g["from_text"] }).to contain_exactly("폴더오타")
      end
    end

    describe "폴더 taggings (F4)" do
      let!(:folder_tag) { create(:tag, project: project, name: "폴더태그") }
      let!(:folder_tagging) { Tagging.create!(tag: folder_tag, taggable: child_folder) }

      it "각 folder 의 tag_ids 를 직렬화한다" do
        child = manifest[:folders].find { |f| f["id"] == child_folder.id }
        expect(child).to have_key(:tag_ids)
        expect(child[:tag_ids]).to contain_exactly(folder_tag.id)
      end
    end

    describe "meetings 중첩 구조" do
      subject(:m) { manifest[:meetings].first }

      it "회의 원본 PK 를 보존한다" do
        expect(manifest[:meetings].size).to eq(1)
        expect(m["id"]).to eq(meeting.id)
      end

      it "모든 자식 컬렉션을 중첩한다" do
        expect(m[:transcripts].map { |t| t["id"] }).to contain_exactly(transcript.id)
        expect(m[:transcripts].first["content"]).to eq("안녕하세요 회의 시작합니다")
        expect(m[:summaries].map { |s| s["id"] }).to contain_exactly(summary.id)
        expect(m[:action_items].map { |a| a["id"] }).to contain_exactly(action_item.id)
        expect(m[:decisions].map { |d| d["id"] }).to contain_exactly(decision.id)
        expect(m[:blocks].map { |b| b["id"] }).to contain_exactly(block.id)
        expect(m[:contacts].map { |c| c["id"] }).to contain_exactly(contact.id)
        expect(m[:bookmarks].map { |b| b["id"] }).to contain_exactly(bookmark.id)
        expect(m[:chat_messages].map { |c| c["id"] }).to contain_exactly(chat_message.id)
        expect(m[:glossary_entries].map { |g| g["id"] }).to contain_exactly(glossary_entry.id)
      end

      it "tag_ids 를 회의별로 직렬화한다" do
        expect(m[:tag_ids]).to contain_exactly(tag.id)
      end

      it "attachments 컬렉션을 포함한다" do
        expect(m).to have_key(:attachments)
        expect(m[:attachments]).to eq([])
      end
    end
  end

  describe "#write_to (tar.gz)" do
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

    it "유효한 tar.gz 를 만들고 manifest.json 엔트리를 포함한다" do
      io = StringIO.new
      described_class.new(project, include_audio: false).write_to(io)

      entries = read_tar_gz(io)
      expect(entries).to have_key("manifest.json")

      parsed = JSON.parse(entries["manifest.json"])
      expect(parsed["format_version"]).to eq(1)
      expect(parsed["meetings"].first["id"]).to eq(meeting.id)
    end

    context "include_audio=false" do
      it "오디오 엔트리를 넣지 않는다" do
        Dir.mktmpdir do |dir|
          audio_path = File.join(dir, "#{meeting.id}.mp3")
          File.binwrite(audio_path, "FAKEAUDIO")
          meeting.update_column(:audio_file_path, audio_path)

          io = StringIO.new
          described_class.new(project, include_audio: false).write_to(io)
          entries = read_tar_gz(io)

          expect(entries.keys.none? { |k| k.start_with?("audio/") }).to be(true)
        end
      end
    end

    context "include_audio=true" do
      it "실제 오디오 파일이 있으면 audio/<meeting_id>.<ext> 로 추가한다" do
        Dir.mktmpdir do |dir|
          audio_path = File.join(dir, "src.mp3")
          File.binwrite(audio_path, "FAKEAUDIO-BYTES")
          meeting.update_column(:audio_file_path, audio_path)

          io = StringIO.new
          described_class.new(project, include_audio: true).write_to(io)
          entries = read_tar_gz(io)

          expect(entries).to have_key("audio/#{meeting.id}.mp3")
          expect(entries["audio/#{meeting.id}.mp3"]).to eq("FAKEAUDIO-BYTES")
        end
      end

      it "오디오 파일이 없으면 스킵하되 매니페스트엔 원본 audio_file_path 를 보존한다" do
        meeting.update_column(:audio_file_path, "/nonexistent/path.mp3")

        io = StringIO.new
        described_class.new(project, include_audio: true).write_to(io)
        entries = read_tar_gz(io)

        expect(entries.keys.none? { |k| k.start_with?("audio/") }).to be(true)
        parsed = JSON.parse(entries["manifest.json"])
        expect(parsed["meetings"].first["audio_file_path"]).to eq("/nonexistent/path.mp3")
      end
    end

    context "첨부 파일" do
      it "실제 첨부 파일을 attachments/<basename> 로 추가하고 매니페스트엔 basename 을 기록한다" do
        Dir.mktmpdir do |dir|
          attach_path = File.join(dir, "#{meeting.id}_deadbeef_report.pdf")
          File.binwrite(attach_path, "PDFDATA")
          create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                      uploaded_by_id: owner.id)

          io = StringIO.new
          described_class.new(project, include_audio: false).write_to(io)
          entries = read_tar_gz(io)

          basename = File.basename(attach_path)
          expect(entries).to have_key("attachments/#{basename}")
          expect(entries["attachments/#{basename}"]).to eq("PDFDATA")

          parsed = JSON.parse(entries["manifest.json"])
          att = parsed["meetings"].first["attachments"].first
          expect(att["file_path"]).to eq(basename)
        end
      end
    end
  end
end
