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

  # sidecar 는 개발 환경에서 실행 중일 수 있으므로 테스트가 실제 네트워크를 타지 않도록
  # 기본 stub 을 전역 적용한다("화자 DB" describe 블록은 자체 stub 으로 override).
  before do
    default_sidecar = instance_double(SidecarClient,
                                       get_speaker_db: { "next_num" => 1, "speakers" => {}, "names" => {} })
    allow(SidecarClient).to receive(:new).and_return(default_sidecar)
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

    describe "화자 DB(SpeakerDB) 번들링" do
      let(:sidecar) { instance_double(SidecarClient) }
      let(:speaker_db_payload) do
        {
          "next_num" => 3,
          "speakers" => { "SPEAKER_00" => [ "AACAPwAAAEA=" ] }, # base64(float32 1.0, 2.0)
          "names"    => { "SPEAKER_00" => "앨리스" }
        }
      end

      before do
        allow(SidecarClient).to receive(:new).and_return(sidecar)
      end

      it "sidecar 가 정상 응답하면 speakers/<meeting_id>.json 엔트리에 임베딩 포함 전체를 그대로 담는다" do
        allow(sidecar).to receive(:get_speaker_db).with(meeting.id).and_return(speaker_db_payload)

        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        expect(entries).to have_key("speakers/#{meeting.id}.json")
        expect(JSON.parse(entries["speakers/#{meeting.id}.json"])).to eq(speaker_db_payload)
      end

      it "sidecar 가 다운되어 있으면(ConnectionError) speaker 엔트리 없이 export 는 성공한다" do
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

        io = StringIO.new
        expect {
          described_class.new(meeting, include_audio: false).write_to(io)
        }.not_to raise_error

        entries = read_tar_gz(io)
        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
        expect(entries).to have_key("manifest.json") # 나머지 export 는 정상
      end

      # 적대 검토 #1: with_connection 이 SidecarError 로 변환하지 **못하는** 예외들.
      # 응답 도중 연결이 끊기거나(ECONNRESET/EOFError) 200 인데 본문이 깨진 경우
      # (JSON::ParserError)에도 export 는 완주해야 한다.
      {
        "Errno::ECONNRESET(응답 중 연결 리셋)" => -> { Errno::ECONNRESET.new("reset by peer") },
        "EOFError(응답 도중 EOF)"             => -> { EOFError.new("end of file reached") },
        "JSON::ParserError(200인데 본문 파손)"  => -> { JSON::ParserError.new("unexpected token") }
      }.each do |label, builder|
        it "#{label} 이어도 speaker 엔트리 없이 export 는 성공한다" do
          allow(sidecar).to receive(:get_speaker_db).and_raise(builder.call)

          io = StringIO.new
          expect {
            described_class.new(meeting, include_audio: false).write_to(io)
          }.not_to raise_error

          entries = read_tar_gz(io)
          expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
          expect(entries).to have_key("manifest.json")
        end
      end

      # 적대 검토 #6: 로스터가 비어 있으면 tar 엔트리를 만들지 않는다
      # (import 쪽 하위호환 경로가 엔트리 부재를 이미 처리한다).
      it "로스터가 비어 있으면 speakers/ 엔트리를 만들지 않는다" do
        allow(sidecar).to receive(:get_speaker_db)
          .and_return({ "next_num" => 1, "speakers" => {}, "names" => {} })

        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
      end
    end

    # H1: 회의 단건 export 가 사이드카 문제로 로스터를 놓쳐도 아카이브에 신호가 없어
    # import 가 "구버전 하위호환"으로 오인하고 조용히 넘어간다(§ProjectExporter/FolderExporter
    # 와 동일한 R3 문제). ProjectExporter/FolderExporter 를 미러링해 표식을 쓴다.
    describe "열화 표식(speaker_db_degraded, H1)" do
      let(:sidecar) { instance_double(SidecarClient) }

      before do
        allow(SidecarClient).to receive(:new).and_return(sidecar)
      end

      it "정상 export 는 표식이 false 다" do
        allow(sidecar).to receive(:get_speaker_db)
          .and_return({ "next_num" => 1, "speakers" => {}, "names" => {} })

        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)
        parsed = JSON.parse(read_tar_gz(io)["manifest.json"])

        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(false)
      end

      it "사이드카가 다운되면 표식이 true 로 기록된다" do
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)
        entries = read_tar_gz(io)
        parsed  = JSON.parse(entries["manifest.json"])

        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(true)
      end

      # manifest 는 append-only tar 에서 로스터 수집이 끝나야 표식값이 확정된다
      # (ProjectExporter/FolderExporter 와 동일한 이유). MeetingImporter 는 이름으로
      # manifest.json 을 찾으므로(순서 무관) 마지막으로 옮겨도 안전하다.
      it "manifest 엔트리를 로스터 수집 뒤에 쓴다" do
        allow(sidecar).to receive(:get_speaker_db)
          .and_return({ "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AA==" ] }, "names" => {} })

        io = StringIO.new
        described_class.new(meeting, include_audio: false).write_to(io)

        io.rewind
        names = []
        Gem::Package::TarReader.new(Zlib::GzipReader.new(io)) do |tar|
          tar.each { |e| names << e.full_name if e.file? }
        end
        expect(names).to include("speakers/#{meeting.id}.json")
        expect(names.last).to eq("manifest.json") # 표식을 채우려면 로스터가 먼저 끝나야 한다
      end
    end

    # H2: tar.close 가 raise 하면 같은 ensure 의 gz.finish 가 건너뛰어져 gzip 트레일러
    # (CRC+ISIZE) 없는 스트림이 남는다(GzipReader 가 "unexpected end of file"로 죽는다).
    # ProjectExporter#close_tar_then_gz 와 같은 형태를 MeetingExporter 에도 적용한다.
    describe "add_* 가 raise 해도 tar 는 닫힌다 (H2)" do
      it "tar.close 가 실패해도 gz.finish 는 건너뛰지 않는다(gzip 트레일러 보존)" do
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        io = StringIO.new
        expect {
          described_class.new(meeting, include_audio: false).write_to(io)
        }.to raise_error(IOError, "tar close boom")

        io.rewind
        # gz.finish 가 실행됐다는 증거 — 안 됐으면 Zlib::GzipFile::Error 가 난다.
        expect { Zlib::GzipReader.new(io).read }.not_to raise_error
      end

      # tar.close 실패를 조용히 삼키면 잘린 아카이브가 200 으로 나간다.
      it "tar.close 실패를 삼키지 않는다 — 진행 중인 예외가 없으면 그대로 올린다" do
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        expect {
          described_class.new(meeting, include_audio: false).write_to(StringIO.new)
        }.to raise_error(IOError, "tar close boom")
      end

      # 반대로 add_* 가 이미 raise 중이면 close 실패가 원인 예외를 덮어쓰면 안 된다.
      it "진행 중인 예외가 있으면 close 실패로 덮어쓰지 않는다" do
        allow(Transfer::SpeakerDbTransfer::Exporter).to receive(:new).and_raise(RuntimeError, "원인")
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        expect {
          described_class.new(meeting, include_audio: false).write_to(StringIO.new)
        }.to raise_error(RuntimeError, "원인")
      end
    end
  end
end
