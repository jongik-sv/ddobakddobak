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

  # export 경로가 sidecar 의 SpeakerDB 를 조회하므로, 러닝 dev sidecar 로 실요청이 나가지
  # 않도록 전역 stub 을 둔다("화자 DB" describe 블록은 자체 stub 으로 override).
  # 기본 페이로드는 빈 로스터라 speakers/ 엔트리가 생기지 않는다 → 기존 예제는 그대로 통과.
  before do
    default_sidecar = instance_double(SidecarClient,
                                      get_speaker_db: { "next_num" => 1, "speakers" => {}, "names" => {} })
    allow(SidecarClient).to receive(:new).and_return(default_sidecar)
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

  describe "collect_subtree 사이클 가드" do
    # 3단 깊이 A > B > C 서브트리가 전부 수집되는지 확인
    let!(:folder_c) { create(:folder, project: project, name: "C 폴더", parent_id: folder_b.id) }

    it "A>B>C 3단 깊이 서브트리 전체를 수집한다" do
      exporter = described_class.new(folder_a, include_audio: false)
      io = StringIO.new
      exporter.write_to(io)
      entries = read_tar_gz(io)
      parsed = JSON.parse(entries["manifest.json"])

      folder_ids = parsed["folders"].map { |f| f["id"] }
      expect(folder_ids).to include(folder_a.id, folder_b.id, folder_c.id)
    end

    it "자기참조 사이클(parent_id=자신)이 있어도 SystemStackError 없이 수집을 완료한다" do
      # FK 제약 우회하여 직접 update_column 으로 사이클 주입
      folder_b.update_column(:parent_id, folder_b.id)

      exporter = described_class.new(folder_a, include_audio: false)
      io = StringIO.new
      expect { exporter.write_to(io) }.not_to raise_error
    end
  end

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

    # ── 화자 DB(SpeakerDB) 번들링 ──
    #
    # 회의 단건(MeetingExporter)·프로젝트(ProjectExporter)는 로스터를 보존하는데 그 중간
    # 단위인 폴더만 조용히 전부 잃었다. import 쪽은 엔트리가 없으면 "구버전 아카이브"
    # 하위호환 경로로 흘러 경고조차 없다 → 사용자가 예측할 수 없는 비대칭.
    describe "화자 DB(SpeakerDB) 번들링" do
      let(:speaker_db_1) do
        { "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AACAPwAAAEA=" ] },
          "names" => { "SPEAKER_00" => "앨리스" } }
      end
      let(:speaker_db_2) do
        { "next_num" => 3, "speakers" => { "SPEAKER_00" => [ "AABAQA==" ] },
          "names" => { "SPEAKER_00" => "밥" } }
      end
      let(:empty_db) { { "next_num" => 1, "speakers" => {}, "names" => {} } }

      it "서브트리 각 회의의 SpeakerDB 를 speakers/<원본meeting_id>.json 으로 회의별 번들한다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).with(meeting1.id).and_return(speaker_db_1)
        allow(sidecar).to receive(:get_speaker_db).with(meeting2.id).and_return(speaker_db_2)

        io = StringIO.new
        described_class.new(folder_a, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        # 회의2 는 하위 폴더 B 소속 — 서브트리 전체를 돌아야 잡힌다
        expect(JSON.parse(entries["speakers/#{meeting1.id}.json"])).to eq(speaker_db_1)
        expect(JSON.parse(entries["speakers/#{meeting2.id}.json"])).to eq(speaker_db_2)
      end

      it "sidecar 가 다운되어 있으면 speaker 엔트리 없이 export 는 성공한다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

        io = StringIO.new
        expect {
          described_class.new(folder_a, include_audio: false).write_to(io)
        }.not_to raise_error

        entries = read_tar_gz(io)
        expect(entries.keys.none? { |k| k.start_with?("speakers/") }).to be(true)
        expect(entries).to have_key("manifest.json")
      end

      # 회의마다 Exporter 를 새로 만들면 circuit-break 상태가 공유되지 않아
      # "붙어는 있는데 응답 없음" 사이드카에서 회의당 TIMEOUT(30초)을 전부 소모한다.
      it "첫 사이드카 연결 실패 이후 회의는 아예 호출하지 않는다(circuit-break)" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::TimeoutError, "no response")

        io = StringIO.new
        described_class.new(folder_a, include_audio: false).write_to(io)

        expect(Meeting.where(folder_id: [ folder_a.id, folder_b.id ]).count).to eq(2) # 회의는 2건인데
        expect(sidecar).to have_received(:get_speaker_db).once                        # 호출은 1번뿐
      end

      it "로스터가 빈 회의는 speakers/ 엔트리를 만들지 않는다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).with(meeting1.id).and_return(speaker_db_1)
        allow(sidecar).to receive(:get_speaker_db).with(meeting2.id).and_return(empty_db)

        io = StringIO.new
        described_class.new(folder_a, include_audio: false).write_to(io)
        entries = read_tar_gz(io)

        expect(entries).to have_key("speakers/#{meeting1.id}.json")
        expect(entries).not_to have_key("speakers/#{meeting2.id}.json")
      end

      # "엔트리 없음"은 구버전 아카이브 신호이기도 해서, 표식이 없으면 사이드카 문제로
      # 로스터가 통째로 빠진 아카이브가 정상처럼 보이고 import 도 조용히 넘어간다.
      it "로스터를 하나라도 놓치면 manifest 에 speaker_db_degraded=true 를 남긴다" do
        sidecar = instance_double(SidecarClient)
        allow(SidecarClient).to receive(:new).and_return(sidecar)
        allow(sidecar).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

        io = StringIO.new
        described_class.new(folder_a, include_audio: false).write_to(io)
        parsed = JSON.parse(read_tar_gz(io)["manifest.json"])

        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(true)
      end

      it "로스터가 원래 비어있던 회의뿐이면 열화 표식은 false 다" do
        io = StringIO.new
        described_class.new(folder_a, include_audio: false).write_to(io)
        parsed = JSON.parse(read_tar_gz(io)["manifest.json"])

        expect(parsed[Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY]).to be(false)
      end
    end

    # tar.close 가 raise 하면 같은 ensure 의 gz.finish 가 건너뛰어져 gzip 트레일러
    # (CRC+ISIZE) 없는 스트림이 남는다(GzipReader 가 "unexpected end of file"로 죽는다).
    # ProjectExporter/MeetingExporter#close_tar_then_gz 와 같은 형태를 FolderExporter 에도 적용한다.
    describe "add_* 가 raise 해도 tar 는 닫힌다" do
      it "tar.close 가 실패해도 gz.finish 는 건너뛰지 않는다(gzip 트레일러 보존)" do
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        io = StringIO.new
        expect {
          described_class.new(folder_a, include_audio: false).write_to(io)
        }.to raise_error(IOError, "tar close boom")

        io.rewind
        # gz.finish 가 실행됐다는 증거 — 안 됐으면 Zlib::GzipFile::Error 가 난다.
        expect { Zlib::GzipReader.new(io).read }.not_to raise_error
      end

      # 반대로 add_* 가 이미 raise 중이면 close 실패가 원인 예외를 덮어쓰면 안 된다.
      it "진행 중인 예외가 있으면 close 실패로 덮어쓰지 않는다" do
        allow(Transfer::SpeakerDbTransfer::Exporter).to receive(:new).and_raise(RuntimeError, "원인")
        allow_any_instance_of(Gem::Package::TarWriter)
          .to receive(:close).and_raise(IOError, "tar close boom")

        expect {
          described_class.new(folder_a, include_audio: false).write_to(StringIO.new)
        }.to raise_error(RuntimeError, "원인")
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
