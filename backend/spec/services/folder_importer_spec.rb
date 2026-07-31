require "rails_helper"
require "stringio"
require "rubygems/package"
require "zlib"

# 라운드트립: FolderExporter 로 폴더 서브트리(A>B, 회의1@A·회의2@B prev=회의1)를
# tar.gz(StringIO) 로 내보낸 뒤 FolderImporter 로 가져와 복원 결과를 검증한다.
RSpec.describe FolderImporter do
  before(:all) { Transcript.ensure_fts_tables! }

  # export 경로가 sidecar 의 SpeakerDB 를 조회하므로, 러닝 dev sidecar 로 실요청이 나가지
  # 않도록 전역 stub 을 둔다(테스트는 하네스 안에서만 검증한다).
  let(:sidecar_stub) do
    instance_double(SidecarClient,
                    get_speaker_db: { "next_num" => 1, "speakers" => {}, "names" => {} },
                    put_speaker_db: { "ok" => true })
  end

  before { allow(SidecarClient).to receive(:new).and_return(sidecar_stub) }

  # ── 시드 데이터 ──

  let!(:owner)         { create(:user, name: "원작성자") }
  let!(:importer_user) { create(:user, name: "가져온사람") }

  # 원본 프로젝트 + 폴더 A > B 계층
  let!(:src_project) { create(:project, creator: owner, name: "소스팀") }
  let!(:folder_a)    { create(:folder, project: src_project, name: "Folder A", parent: nil) }
  let!(:folder_b)    { create(:folder, project: src_project, name: "Folder B", parent: folder_a) }

  # 회의1 @ A (전사 있음 → EmbedBackfillJob 확인용)
  let!(:meeting1) do
    create(:meeting, project: src_project, creator: owner, folder: folder_a, title: "회의1")
  end
  let!(:transcript1) { create(:transcript, meeting: meeting1, content: "전사 내용") }

  # 회의2 @ B, previous_meeting_id = meeting1.id (서브트리 내 이전 회의)
  let!(:meeting2) do
    m = create(:meeting, project: src_project, creator: owner, folder: folder_b, title: "회의2")
    m.update_column(:previous_meeting_id, meeting1.id)
    m
  end

  # 범위 밖 회의: folder_a 서브트리 밖의 회의(previous_meeting_id 범위 밖 테스트용)
  let!(:external_meeting) do
    create(:meeting, project: src_project, creator: owner, title: "외부회의")
  end

  # 회의3 @ A, previous_meeting_id = external_meeting.id (범위 밖 → import 후 nil)
  let!(:meeting3) do
    m = create(:meeting, project: src_project, creator: owner, folder: folder_a, title: "회의3")
    m.update_column(:previous_meeting_id, external_meeting.id)
    m
  end

  # 태그
  let!(:tag)     { create(:tag, project: src_project, name: "중요") }
  let!(:tagging) { Tagging.create!(tag: tag, taggable: meeting1) }

  # 대상 프로젝트 + import 시 주입할 상위 폴더
  let!(:dst_project)       { create(:project, creator: importer_user, name: "대상팀") }
  let!(:dst_parent_folder) { create(:folder, project: dst_project, name: "대상상위", parent: nil) }

  # ── 헬퍼 ──

  def export_io(folder: folder_a, include_audio: false)
    io = StringIO.new
    FolderExporter.new(folder, include_audio: include_audio).write_to(io)
    io.rewind
    io
  end

  def run_import(io = export_io, parent_folder: dst_parent_folder)
    described_class.new(io, user: importer_user, project: dst_project,
                            parent_folder: parent_folder).run!
  end

  # 대상 프로젝트의 임포트된 폴더를 이름으로 탐색
  def new_folder(name)
    Folder.where(project_id: dst_project.id, name: name).first
  end

  # 대상 프로젝트의 임포트된 회의를 제목으로 탐색
  def new_meeting(title)
    Meeting.where(project_id: dst_project.id, title: title).first
  end

  # 최소 manifest 를 담은 tar.gz StringIO 생성 (검증 실패 경로 테스트용).
  # add_file_simple 으로 크기를 미리 전달 — GzipWriter 는 pos= 미지원이므로 필수.
  def build_archive_io(manifest_hash)
    io    = StringIO.new
    gz    = Zlib::GzipWriter.new(io)
    tar   = Gem::Package::TarWriter.new(gz)
    bytes = manifest_hash.to_json.b
    tar.add_file_simple("manifest.json", 0o644, bytes.bytesize) { |f| f.write(bytes) }
    tar.close
    gz.finish
    io.rewind
    io
  end

  # ── 반환값 ──

  describe "#run! 반환값" do
    subject(:result) { run_import }

    it "{ folder_id:, meeting_ids: } 를 반환한다" do
      expect(result).to include(:folder_id, :meeting_ids)
    end

    it "folder_id 는 새 루트 폴더('Folder A') 의 id 다" do
      expect(Folder.find(result[:folder_id]).name).to eq("Folder A")
    end

    it "meeting_ids 는 3건의 새 회의 id 배열이다 (원본과 다름)" do
      expect(result[:meeting_ids].size).to eq(3)
      expect(result[:meeting_ids]).not_to include(meeting1.id, meeting2.id, meeting3.id)
    end

    it "warnings 키를 포함하며(정상 케이스) 비어있다" do
      expect(result).to include(:warnings)
      expect(result[:warnings]).to eq([])
    end
  end

  # ── public_uid 충돌 가드 (T7) ──
  #
  # FolderImporter 는 내부적으로 Transfer::MeetingRestorer 를 재사용하므로 null-out
  # 동작 자체는 이미 이뤄지지만, 그 경고가 result 로 노출되지 않아 컨트롤러/프런트가
  # 사용자에게 알릴 수단이 없었다(T4 리뷰 결함). @restorers 에 누적된 각 restorer 의
  # warnings 를 result[:warnings] 로 노출해야 한다.
  describe "public_uid 충돌 가드 (T7)" do
    before do
      meeting1.update_columns(
        public_uid:      "0199abc0-0000-7000-8000-000000000088",
        dflow_synced_at: Time.zone.parse("2026-07-01 10:00:00"),
        dflow_url:       "https://dflow.example.com/meetings/abc"
      )
    end

    it "로컬에 동일 uid 가 이미 존재하면 result[:warnings] 에 경고 1건이 담기고 import 는 성공한다" do
      result = run_import

      new_m1 = new_meeting("회의1")
      expect(new_m1.public_uid).to be_nil
      expect(result[:warnings]).to contain_exactly(
        "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"
      )
    end
  end

  # ── 폴더 계층 ──

  describe "폴더 계층" do
    subject(:result) { run_import }

    it "새 루트 A.parent_id == dst_parent_folder.id" do
      new_a = Folder.find(result[:folder_id])
      expect(new_a.parent_id).to eq(dst_parent_folder.id)
    end

    it "새 B.parent_id == 새 A.id" do
      new_a = Folder.find(result[:folder_id])
      new_b = new_folder("Folder B")
      expect(new_b).to be_present
      expect(new_b.parent_id).to eq(new_a.id)
    end

    it "parent_folder: nil 이면 새 루트 A.parent_id 가 nil" do
      result2 = described_class.new(export_io, user: importer_user, project: dst_project,
                                               parent_folder: nil).run!
      expect(Folder.find(result2[:folder_id]).parent_id).to be_nil
    end
  end

  # ── 회의 폴더 배치 ──

  describe "회의 폴더 배치" do
    subject(:result) { run_import }

    before { result }  # import 를 eagerly 실행

    it "회의1 이 새 A 에 속한다" do
      new_a  = Folder.find(result[:folder_id])
      new_m1 = new_meeting("회의1")
      expect(new_m1).to be_present
      expect(new_m1.folder_id).to eq(new_a.id)
    end

    it "회의2 가 새 B 에 속한다" do
      new_b  = new_folder("Folder B")
      new_m2 = new_meeting("회의2")
      expect(new_m2).to be_present
      expect(new_m2.folder_id).to eq(new_b.id)
    end
  end

  # ── previous_meeting_id 리맵 ──

  describe "previous_meeting_id 리맵" do
    subject(:result) { run_import }

    before { result }  # import 를 eagerly 실행

    it "회의2.previous_meeting_id == 새 회의1.id (서브트리 내 리맵)" do
      new_m1 = new_meeting("회의1")
      new_m2 = new_meeting("회의2")
      expect(new_m2.previous_meeting_id).to eq(new_m1.id)
    end

    it "범위 밖 previous_meeting_id (회의3→외부회의) 는 nil 이 된다" do
      new_m3 = new_meeting("회의3")
      expect(new_m3.previous_meeting_id).to be_nil
    end
  end

  # ── 소유권 ──

  describe "소유권" do
    it "모든 새 회의의 created_by_id == importer_user.id" do
      result       = run_import
      new_meetings = Meeting.where(id: result[:meeting_ids])
      expect(new_meetings.pluck(:created_by_id).uniq).to eq([importer_user.id])
    end
  end

  # ── 태그 dedup ──

  describe "태그 dedup" do
    it "동명 태그가 미리 존재하면 재사용한다 (Tag 수 불변)" do
      io = export_io
      expect { run_import(io) }.not_to change { Tag.where(name: "중요").count }
    end

    it "import 후 회의1 에 태그 '중요' 가 연결된다" do
      run_import
      expect(new_meeting("회의1").tags.pluck(:name)).to include("중요")
    end
  end

  # ── scope != 'folder' 거부 ──

  describe "scope != 'folder' 거부" do
    it "MeetingExporter tgz 를 FolderImporter 에 넣으면 InvalidArchiveError" do
      meeting_io = StringIO.new
      MeetingExporter.new(meeting1, include_audio: false).write_to(meeting_io)
      meeting_io.rewind

      folder_count_before  = Folder.count
      meeting_count_before = Meeting.count

      expect {
        described_class.new(meeting_io, user: importer_user, project: dst_project).run!
      }.to raise_error(Transfer::Archive::InvalidArchiveError)

      expect(Folder.count).to eq(folder_count_before)
      expect(Meeting.count).to eq(meeting_count_before)
    end
  end

  # ── 빈 folders 가드 ──

  describe "빈 folders 가드" do
    it "manifest folders 가 비어있으면 레코드 생성 없이 InvalidArchiveError 를 발생시킨다" do
      empty_io = build_archive_io(
        "format_version" => FolderImporter::SUPPORTED_FORMAT_VERSION,
        "scope"          => "folder",
        "folders"        => [],
        "meetings"       => []
      )

      folder_count_before  = Folder.count
      meeting_count_before = Meeting.count

      expect {
        described_class.new(empty_io, user: importer_user, project: dst_project).run!
      }.to raise_error(Transfer::Archive::InvalidArchiveError, /folders/)

      expect(Folder.count).to eq(folder_count_before)
      expect(Meeting.count).to eq(meeting_count_before)
    end
  end

  # ── H3: non-file 엔트리 zip-bomb 계량 우회 ──

  # `next unless entry.file?` 은 파일이 아닌 엔트리(디렉터리 등)를 그냥 건너뛴다.
  # 그런 엔트리도 header.size 를 크게 선언할 수 있고, 소비하지 않으면
  # TarReader::Entry#close 가 계량 없이(seek 미응답인 GzipReader 에서 read 드레인 루프로
  # 떨어져) 압축을 다 풀어버린다 — MeetingImporter/ProjectImporter 는 이미
  # Transfer::SpeakerDbTransfer.drain_entry 로 막았다(§H3). FolderImporter 만 남았다.
  describe "non-file 엔트리 계량 (H3)" do
    # typeflag "5"(디렉터리)로 큰 size 를 선언한 엔트리를 수작업으로 tar 에 심는다.
    # Gem::Package::TarWriter 의 공개 API(mkdir 등)는 항상 size=0 이라 흉내낼 수 없으므로
    # TarHeader 를 직접 만들어 gz 스트림에 써 넣는다.
    def build_archive_with_oversized_non_file_entry(manifest_hash, declared_size:)
      io  = StringIO.new
      gz  = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)

      json = JSON.generate(manifest_hash).b
      tar.add_file_simple("manifest.json", 0o644, json.bytesize) { |e| e.write(json) }

      header = Gem::Package::TarHeader.new(
        name: "junkdir/", prefix: "", size: declared_size, mode: 0o755, typeflag: "5"
      )
      gz.write(header.to_s)
      body = "\0" * declared_size # 고압축(0바이트) — 몇 KB 압축이 수백 KB 로 부풀도록
      gz.write(body)
      pad = (512 - (body.bytesize % 512)) % 512
      gz.write("\0" * pad)

      tar.close
      gz.finish
      io.rewind
      [ io, json.bytesize ]
    end

    def folder_only_manifest
      {
        "format_version" => FolderImporter::SUPPORTED_FORMAT_VERSION,
        "scope"          => "folder",
        "folders"        => [ folder_a.attributes.merge("glossary_entries" => [], "tag_ids" => []) ],
        "meetings"       => [],
        "tags"           => []
      }
    end

    it "선언 크기가 큰 non-file 엔트리도 계량되어 zip-bomb 가드가 발화한다" do
      io, manifest_bytes = build_archive_with_oversized_non_file_entry(
        folder_only_manifest, declared_size: 300 * 1024
      )
      stub_const("Transfer::Archive::MAX_DECOMPRESSED_BYTES", manifest_bytes + 100_000)

      folder_count_before  = Folder.count
      meeting_count_before = Meeting.count

      expect {
        described_class.new(io, user: importer_user, project: dst_project,
                                parent_folder: dst_parent_folder).run!
      }.to raise_error(Transfer::Archive::InvalidArchiveError, /압축 해제 크기/)

      expect(Folder.count).to eq(folder_count_before)
      expect(Meeting.count).to eq(meeting_count_before)
    end
  end

  # ── EmbedBackfillJob ──

  describe "EmbedBackfillJob" do
    include ActiveJob::TestHelper

    it "전사가 있는 회의를 import 하면 EmbedBackfillJob 이 enqueue 된다" do
      expect { run_import }.to have_enqueued_job(EmbedBackfillJob)
    end
  end

  # ── 트랜잭션 롤백 ──

  describe "트랜잭션 롤백" do
    it "MeetingRestorer 가 raise 하면 새 Meeting 이 생성되지 않는다" do
      count_before = Meeting.count
      allow_any_instance_of(Transfer::MeetingRestorer).to receive(:restore!).and_raise(
        ActiveRecord::RecordInvalid.new(Meeting.new)
      )

      expect { run_import }.to raise_error(StandardError)

      expect(Meeting.count).to eq(count_before)
    end

    it "1차 restore! 가 복사한 파일이 트랜잭션 롤백 시 디스크에서 삭제된다 (rollback cleanup 회귀)" do
      files_copied = []
      begin
        Dir.mktmpdir do |dir|
          # 3개 회의 모두에 오디오 설정 — 매니페스트 순서 무관하게 첫 restore! 에서 파일 복사 보장
          [meeting1, meeting2, meeting3].each_with_index do |mtg, i|
            path = File.join(dir, "audio_#{i}.mp3")
            File.binwrite(path, "AUDIO-#{i}")
            mtg.update_column(:audio_file_path, path)
          end

          io = export_io(include_audio: true)

          folder_count_before  = Folder.count
          meeting_count_before = Meeting.count

          # FileUtils.cp 를 감시해 실제로 복사된 대상 경로 수집
          allow(FileUtils).to receive(:cp).and_wrap_original do |original, src, dst|
            files_copied << dst
            original.call(src, dst)
          end

          # 첫 번째 restore! 은 실제 실행(파일 복사 포함), 두 번째부터 raise
          call_count = 0
          allow_any_instance_of(Transfer::MeetingRestorer).to receive(:restore!).and_wrap_original do |m|
            call_count += 1
            call_count >= 2 ? raise(ActiveRecord::RecordInvalid.new(Meeting.new)) : m.call
          end

          expect { run_import(io) }.to raise_error(ActiveRecord::RecordInvalid)

          # (a) rollback cleanup 동작 확인: 복사된 파일이 디스크에서 삭제됐어야 함
          expect(files_copied).not_to be_empty,
            "test precondition: 아무 파일도 복사되지 않음 — include_audio 또는 첫 restore! 점검 필요"
          files_copied.each do |path|
            expect(File.file?(path)).to be(false),
              "rollback cleanup 실패: #{path} 가 삭제되지 않음 (데이터손실 회귀)"
          end

          # (b) & (c) DB 롤백: Folder·Meeting 레코드 불변
          expect(Folder.count).to eq(folder_count_before)
          expect(Meeting.count).to eq(meeting_count_before)
        end
      ensure
        # 안전망: rollback cleanup 실패 시에도 테스트 아티팩트 정리
        files_copied.each { |p| FileUtils.rm_f(p) }
      end
    end
  end

  # ── 화자 DB(SpeakerDB) 복원 ──
  #
  # 폴더 스코프는 회의가 **여러 개**다. 회의 단건과 달리 old_id → new_id 매핑이
  # 회의별로 정확해야 한다(엔트리 순서로 짝지으면 남의 로스터가 들어간다).
  describe "화자 DB(SpeakerDB) 복원" do
    let(:speaker_db_2) do
      { "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AACAPwAAAEA=" ] },
        "names" => { "SPEAKER_00" => "앨리스" } }
    end
    let(:speaker_db_3) do
      { "next_num" => 3, "speakers" => { "SPEAKER_00" => [ "AABAQA==" ] },
        "names" => { "SPEAKER_00" => "밥" } }
    end
    let(:empty_db) { { "next_num" => 1, "speakers" => {}, "names" => {} } }

    # 회의2·회의3 만 로스터가 있고 **회의1 은 비어 있다**(=엔트리 없음).
    #
    # 빈 회의를 **맨 앞**에 두는 게 핵심이다. 회의 3건 · 엔트리 2건이라 엔트리 순서로
    # 짝지으면 첫 칸부터 한 칸씩 밀려 남의 로스터가 들어간다. (빈 회의가 매니페스트
    # 마지막이면 밀림이 없어 인덱스 짝짓기 버그도 우연히 통과한다 — 회의 1건짜리
    # 테스트가 교차 혼입을 못 잡는 것과 같은 이유.)
    def stub_rosters
      allow(sidecar_stub).to receive(:get_speaker_db).with(meeting1.id).and_return(empty_db)
      allow(sidecar_stub).to receive(:get_speaker_db).with(meeting2.id).and_return(speaker_db_2)
      allow(sidecar_stub).to receive(:get_speaker_db).with(meeting3.id).and_return(speaker_db_3)
    end

    it "각 회의의 로스터가 자기 회의의 새 id 로만 PUT 된다(교차 혼입 반증)" do
      stub_rosters
      result = run_import

      new_m1 = new_meeting("회의1")
      new_m2 = new_meeting("회의2")
      new_m3 = new_meeting("회의3")

      # 전제: 새 id 는 원본과 다르다(=리맵이 실제로 일어난다)
      expect([ new_m1.id, new_m2.id, new_m3.id ])
        .not_to include(meeting1.id, meeting2.id, meeting3.id)
      expect(result[:meeting_ids]).to match_array([ new_m1.id, new_m2.id, new_m3.id ])

      # 자기 로스터가 자기 새 id 로
      expect(sidecar_stub).to have_received(:put_speaker_db).with(new_m2.id, speaker_db_2)
      expect(sidecar_stub).to have_received(:put_speaker_db).with(new_m3.id, speaker_db_3)
      # 남의 로스터가 새어 들어오지 않는다(인덱스 짝짓기 버그 반증)
      expect(sidecar_stub).not_to have_received(:put_speaker_db).with(new_m1.id, anything)
      expect(sidecar_stub).not_to have_received(:put_speaker_db).with(new_m2.id, speaker_db_3)
      expect(sidecar_stub).not_to have_received(:put_speaker_db).with(new_m3.id, speaker_db_2)
      # 원본 id 로 PUT 하면(리맵 누락) 원본 회의의 로스터를 덮어쓴다
      expect(sidecar_stub).not_to have_received(:put_speaker_db).with(meeting2.id, anything)
      expect(sidecar_stub).not_to have_received(:put_speaker_db).with(meeting3.id, anything)

      expect(sidecar_stub).to have_received(:put_speaker_db).twice # 로스터 2건뿐
      expect(result[:warnings]).to eq([])
    end

    # 스테이징 tempfile 은 트랜잭션 직후 정리되는데 복원은 커밋 **후**에 돈다.
    # 정리 시점이 복원보다 앞서면 전부 ENOENT → 조용히 경고로만 떨어진다(무복원 green).
    it "복원 시점에 스테이징 파일이 살아 있고 내용은 해당 회의의 로스터다" do
      stub_rosters
      io = export_io

      observed = []
      allow(Transfer::SpeakerDbTransfer::Importer)
        .to receive(:new).and_wrap_original do |orig, **kwargs|
          inner = orig.call(**kwargs)
          allow(inner).to receive(:import_file).and_wrap_original do |run, mid, path|
            observed << { meeting_id: mid, exists: File.exist?(path), path: path,
                          content: (File.binread(path) if File.exist?(path)) }
            run.call(mid, path)
          end
          inner
        end

      run_import(io)

      expect(observed.size).to eq(2)
      observed.each do |o|
        expect(o[:exists]).to be(true)                            # 호출 시점에 실재하는 파일
        expect(File.dirname(o[:path])).to start_with(Dir.tmpdir)  # 메모리가 아니라 디스크
      end
      new_m2 = new_meeting("회의2")
      new_m3 = new_meeting("회의3")
      expect(JSON.parse(observed.find { |o| o[:meeting_id] == new_m2.id }[:content]))
        .to eq(speaker_db_2)
      expect(JSON.parse(observed.find { |o| o[:meeting_id] == new_m3.id }[:content]))
        .to eq(speaker_db_3)
    end

    it "sidecar 가 다운되어 있어도 import 자체는 성공하고 나머지 데이터는 보존된다" do
      stub_rosters
      allow(sidecar_stub).to receive(:put_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

      result = nil
      expect { result = run_import }.not_to raise_error
      expect(result[:meeting_ids].size).to eq(3)
      expect(new_meeting("회의1")).to be_present
    end

    it "복원 실패는 result[:warnings] 로 보고되며 여러 건 실패해도 1건으로 합쳐진다" do
      stub_rosters
      allow(sidecar_stub).to receive(:put_speaker_db).and_raise(Errno::ECONNRESET, "reset")

      result = run_import

      expect(result[:warnings]).to eq([ Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING ])
    end

    # import 쪽에도 circuit-break 가 필요하다(export 와 대칭).
    it "첫 회의에서 연결 거부를 만나면 이후 회의는 PUT 을 시도하지 않는다" do
      stub_rosters
      allow(sidecar_stub).to receive(:put_speaker_db).and_raise(Errno::ECONNREFUSED)

      result = run_import

      expect(sidecar_stub).to have_received(:put_speaker_db).once # 로스터는 2건인데 호출은 1번
      expect(result[:warnings]).to include(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
    end

    it "회의마다 복원기를 새로 만들지 않고 하나를 공유한다(circuit 상태·클라이언트 재사용)" do
      stub_rosters
      io = export_io
      allow(Transfer::SpeakerDbTransfer::Importer).to receive(:new).and_call_original

      run_import(io)

      expect(sidecar_stub).to have_received(:put_speaker_db).twice
      expect(Transfer::SpeakerDbTransfer::Importer).to have_received(:new).once
    end

    it "로스터가 빈 회의는 PUT 하지 않는다(엔트리 자체가 없음)" do
      stub_rosters
      run_import

      expect(sidecar_stub).not_to have_received(:put_speaker_db).with(new_meeting("회의1").id, anything)
    end

    # 내보내기 시점에 이미 로스터가 빠진 아카이브는 import 쪽에서 손쓸 수 없다.
    it "내보내기 시점에 로스터가 빠진 아카이브는 import 가 경고로 알린다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")
      io = export_io # 열화 표식이 박힌 아카이브
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(empty_db)

      result = run_import(io)

      expect(result[:warnings]).to include(Transfer::SpeakerDbTransfer::EXPORT_DEGRADED_WARNING)
    end

    it "표식이 없는 구버전 아카이브(화자 엔트리 없음)는 경고 없이 정상 import 된다(하위호환)" do
      legacy_io = build_archive_io(
        "format_version" => FolderImporter::SUPPORTED_FORMAT_VERSION,
        "scope"          => "folder",
        "folders"        => [ folder_a.attributes.merge("glossary_entries" => [], "tag_ids" => []) ],
        "meetings"       => [],
        "tags"           => []
      )

      expect(sidecar_stub).not_to receive(:put_speaker_db)

      result = described_class.new(legacy_io, user: importer_user, project: dst_project).run!
      expect(result[:warnings]).to eq([])
    end

    # 선언 크기를 먼저 보지 않으면 64MB 상한이 디스크에 다 쓴 뒤에야 걸린다.
    it "선언 크기가 상한을 넘는 화자 엔트리는 디스크에 쓰지 않고 경고만 남긴다" do
      stub_rosters
      io = export_io
      stub_const("Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES", 8)

      subject_importer = described_class.new(io, user: importer_user, project: dst_project,
                                                 parent_folder: dst_parent_folder)
      result = subject_importer.run!

      expect(subject_importer.instance_variable_get(:@speaker_paths)).to be_empty
      expect(sidecar_stub).not_to have_received(:put_speaker_db)
      expect(result[:warnings]).to include(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
    end

    # 복원은 커밋 **후**에 돈다 → 여기서 raise 가 새면 run! 의 rescue 가
    # 이미 커밋된 import 의 복사 파일을 지운다(롤백 없는 파손).
    it "스테이징 파일이 사라져도 커밋된 import 를 롤백/파일삭제 하지 않고 경고만 남긴다" do
      stub_rosters
      io = export_io
      allow(Transfer::SpeakerDbTransfer::Importer).to receive(:new).and_wrap_original do |orig, **kwargs|
        inner = orig.call(**kwargs)
        allow(inner).to receive(:import_file).and_wrap_original do |run, mid, path|
          FileUtils.rm_f(path) # 읽기 직전에 스테이징 파일 소실 → ENOENT
          run.call(mid, path)
        end
        inner
      end

      result = nil
      expect { result = run_import(io) }.not_to raise_error
      expect(result[:meeting_ids].size).to eq(3)
      expect(result[:warnings]).to include(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
    end
  end

  # ── post-commit 예외 시 파일 보존 (T3 data-loss 회귀) ──

  describe "post-commit 예외 시 파일 보존" do
    it "EmbedBackfillJob 이 raise 해도 커밋된 회의와 복사 파일이 살아있다" do
      Dir.mktmpdir do |dir|
        # 회의1 에 오디오 파일 설정
        audio_path = File.join(dir, "session.mp3")
        File.binwrite(audio_path, "AUDIO-BYTES")
        meeting1.update_column(:audio_file_path, audio_path)

        # post-commit 단계(EmbedBackfillJob)에서 raise 강제 → rescue 가 copied_paths 를 삭제하면 안 됨
        allow(EmbedBackfillJob).to receive(:perform_later).and_raise(StandardError, "job queue down")

        count_before = Meeting.count

        expect {
          run_import(export_io(include_audio: true))
        }.to raise_error(StandardError, "job queue down")

        # (1) 트랜잭션은 커밋됐으므로 새 Meeting 레코드가 DB 에 존재한다
        expect(Meeting.where(project_id: dst_project.id).count).to be >= 1

        new_m1 = new_meeting("회의1")
        expect(new_m1).to be_present

        # (2) 복사된 오디오 파일이 디스크에 여전히 존재한다
        expect(new_m1.audio_file_path).to be_present
        expect(File.file?(new_m1.audio_file_path)).to be(true),
          "audio file was deleted after post-commit exception (data-loss bug)"
      ensure
        Meeting.where(project_id: dst_project.id).each do |m|
          FileUtils.rm_f(m.audio_file_path) if m.audio_file_path.present?
        end
      end
    end
  end
end
