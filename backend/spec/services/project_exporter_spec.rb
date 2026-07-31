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

  # sidecar 는 개발 환경에서 실행 중일 수 있으므로 테스트가 실제 네트워크를 타지 않도록
  # 기본 stub 을 전역 적용한다("화자 DB" describe 블록은 자체 stub 으로 override).
  before do
    default_sidecar = instance_double(SidecarClient,
                                       get_speaker_db: { "next_num" => 1, "speakers" => {}, "names" => {} })
    allow(SidecarClient).to receive(:new).and_return(default_sidecar)
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

    describe "화자 DB(SpeakerDB) 번들링" do
      let!(:meeting2) do
        create(:meeting, project: project, creator: owner, folder: child_folder, title: "두 번째 회의")
      end

      let(:speaker_db_1) do
        { "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AACAPwAAAEA=" ] }, "names" => { "SPEAKER_00" => "앨리스" } }
      end
      let(:speaker_db_2) do
        { "next_num" => 3, "speakers" => { "SPEAKER_00" => [ "AABAQA==" ] }, "names" => { "SPEAKER_00" => "밥" } }
      end

      it "각 회의의 SpeakerDB 를 speakers/<원본meeting_id>.json 으로 회의별 번들한다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).with(meeting.id).and_return(speaker_db_1)
        allow(sidecar).to receive(:get_speaker_db).with(meeting2.id).and_return(speaker_db_2)

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        expect(JSON.parse(entries["speakers/#{meeting.id}.json"])).to eq(speaker_db_1)
        expect(JSON.parse(entries["speakers/#{meeting2.id}.json"])).to eq(speaker_db_2)
      end

      it "sidecar 가 다운되어 있으면 speaker 엔트리 없이 export 는 성공한다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

        io = StringIO.new
        expect {
          described_class.new(project, include_audio: false).write_to(io)
        }.not_to raise_error

        entries = read_tar_gz(io)
        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
        expect(entries).to have_key("manifest.json")
      end

      # 적대 검토 #6: 붙어는 있는데 응답이 없는 사이드카면 회의당 최대 TIMEOUT(30초).
      # 회의 100개면 50분 — 첫 실패로 단축(circuit-break)해 완주 시간을 유한하게 만든다.
      it "첫 사이드카 실패 이후 회의는 아예 호출하지 않는다(circuit-break)" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::TimeoutError, "no response")

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)

        expect(project.meetings.count).to eq(2) # 회의는 2건인데
        expect(sidecar).to have_received(:get_speaker_db).once # 호출은 1번뿐
      end

      # 적대 검토 #6: 로스터가 없는 회의도 매번 호출한다(get_speaker_db 는 "없음" 신호가
      # 아니라 빈 기본 페이로드를 준다) → 빈 로스터는 tar 엔트리를 만들지 않는다.
      it "로스터가 빈 회의는 speakers/ 엔트리를 만들지 않는다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).with(meeting.id).and_return(speaker_db_1)
        allow(sidecar).to receive(:get_speaker_db).with(meeting2.id)
          .and_return({ "next_num" => 1, "speakers" => {}, "names" => {} })

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        expect(entries).to have_key("speakers/#{meeting.id}.json")
        expect(entries).not_to have_key("speakers/#{meeting2.id}.json")
      end
    end

    # 적대 검토 #7: add_* 중 하나가 raise 하면 tar.close 가 건너뛰어져
    # tar 끝 마커(1024 zero bytes)가 없는 gzip 스트림이 그대로 남을 수 있다.
    describe "add_* 가 raise 해도 tar 는 닫힌다" do
      it "예외는 그대로 올리되 tar 끝 마커가 있는 아카이브를 남긴다" do
        allow(Transfer::SpeakerDbTransfer::Exporter).to receive(:new).and_raise(RuntimeError, "boom")

        io = StringIO.new
        expect {
          described_class.new(project, include_audio: false).write_to(io)
        }.to raise_error(RuntimeError, "boom")

        io.rewind
        raw = Zlib::GzipReader.new(io).read
        expect(raw.bytesize % 512).to eq(0)
        expect(raw.end_with?("\0" * 1024)).to be(true) # tar 끝 마커
      end

      # R9: 2라운드가 tar.close 를 ensure 로 옮겼는데, tar.close 가 raise 하면
      # 같은 ensure 안의 gz.finish 가 건너뛰어진다 → gzip 트레일러(CRC+ISIZE) 없는
      # 스트림이 남아 GzipReader 가 "unexpected end of file" 로 죽는다.
      it "tar.close 가 실패해도 gz.finish 는 건너뛰지 않는다(gzip 트레일러 보존)" do
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        io = StringIO.new
        expect {
          described_class.new(project, include_audio: false).write_to(io)
        }.to raise_error(IOError, "tar close boom")

        io.rewind
        # gz.finish 가 실행됐다는 증거 — 안 됐으면 Zlib::GzipFile::Error 가 난다.
        expect { Zlib::GzipReader.new(io).read }.not_to raise_error
      end

      # tar.close 실패를 조용히 삼키면 잘린 아카이브가 200 으로 나간다
      # (컨트롤러는 write_to 가 정상 반환하면 그대로 send_file 한다).
      it "tar.close 실패를 삼키지 않는다 — 진행 중인 예외가 없으면 그대로 올린다" do
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        expect {
          described_class.new(project, include_audio: false).write_to(StringIO.new)
        }.to raise_error(IOError)
      end

      # 반대로 add_* 가 이미 raise 중이면 close 실패가 원인 예외를 덮어쓰면 안 된다.
      it "진행 중인 예외가 있으면 close 실패로 덮어쓰지 않는다" do
        allow(Transfer::SpeakerDbTransfer::Exporter).to receive(:new).and_raise(RuntimeError, "원인")
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        expect {
          described_class.new(project, include_audio: false).write_to(StringIO.new)
        }.to raise_error(RuntimeError, "원인")
      end
    end

    # R3: export 열화(사이드카 문제로 로스터가 통째로 빠진 아카이브)가
    # 사용자에게 보이지 않는다 → 아카이브에 표식을 남겨 import 가 경고로 승격한다.
    describe "열화 표식(speaker_db_degraded)" do
      let!(:meeting_b) do
        create(:meeting, project: project, creator: owner, folder: child_folder, title: "두 번째 회의")
      end

      it "정상 export 는 표식이 false 다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db)
          .and_return({ "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AA==" ] }, "names" => {} })

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)
        parsed = JSON.parse(read_tar_gz(io)["manifest.json"])

        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(false)
      end

      it "로스터가 원래 비어 있을 뿐이면 표식이 서지 않는다" do
        io = StringIO.new # 전역 stub = 빈 기본 로스터
        described_class.new(project, include_audio: false).write_to(io)
        parsed = JSON.parse(read_tar_gz(io)["manifest.json"])

        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(false)
      end

      it "사이드카가 다운되면 표식이 true 로 기록된다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)
        entries = read_tar_gz(io)
        parsed  = JSON.parse(entries["manifest.json"])

        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(true)
      end

      # R6: export 에 상한이 없으면 같은 상한을 쓰는 importer 가 자기 아카이브를 거부한다.
      it "상한을 넘는 로스터는 엔트리를 만들지 않고 표식만 남긴다" do
        stub_const("Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES", 8)
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db)
          .and_return({ "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AA==" ] }, "names" => {} })

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
        expect(JSON.parse(entries["manifest.json"])[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY])
          .to be(true)
      end

      # manifest 를 마지막에 쓰는 이유(tar 는 append-only 라 표식을 나중에 고칠 수 없다).
      # 순서가 바뀌어도 importer 는 이름으로 고르므로 문제없지만, 표식이 채워지려면
      # 로스터 수집이 manifest 보다 **먼저** 끝나야 한다.
      it "manifest 엔트리를 로스터 수집 뒤에 쓴다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db)
          .and_return({ "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AA==" ] }, "names" => {} })

        io = StringIO.new
        described_class.new(project, include_audio: false).write_to(io)

        io.rewind
        names = []
        Gem::Package::TarReader.new(Zlib::GzipReader.new(io)) do |tar|
          tar.each { |e| names << e.full_name if e.file? }
        end
        expect(names).to include("speakers/#{meeting.id}.json")
        expect(names.last).to eq("manifest.json") # 표식을 채우려면 로스터가 먼저 끝나야 한다
      end
    end
  end
end
