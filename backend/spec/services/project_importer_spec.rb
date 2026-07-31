require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"
require "tmpdir"

# 라운드트립: ProjectExporter 로 시드 프로젝트를 tar.gz(StringIO) 로 내보낸 뒤
# ProjectImporter 로 가져와 복원 결과를 검증한다. (export 의 엔트리·매니페스트 규약에 의존)
RSpec.describe ProjectImporter do
  before(:all) { Transcript.ensure_fts_tables! }

  # sidecar 는 개발 환경에서 실행 중일 수 있으므로 테스트가 실제 네트워크를 타지 않도록
  # 기본 stub 을 전역 적용한다(화자 DB 전용 describe 블록은 자체 stub 으로 override).
  let(:default_speaker_db) { { "next_num" => 1, "speakers" => {}, "names" => {} } }
  let(:sidecar_stub) do
    instance_double(SidecarClient, get_speaker_db: default_speaker_db, put_speaker_db: { "ok" => true })
  end

  before { allow(SidecarClient).to receive(:new).and_return(sidecar_stub) }

  # ── 시드 데이터 ──
  let!(:owner)    { create(:user, name: "원작성자") }
  let!(:importer) { create(:user, name: "가져온사람", role: "admin") }

  let!(:project) { create(:project, creator: owner, name: "기획팀") }
  let!(:root_folder)  { create(:folder, project: project, name: "루트", parent: nil) }
  let!(:child_folder) { create(:folder, project: project, name: "자식", parent: root_folder) }

  # previous_meeting: 범위 밖(다른 프로젝트)을 가리켜 import 시 nil 이 되는지 검증.
  let!(:other_project) { create(:project, creator: owner, name: "다른프로젝트") }
  let!(:out_of_scope_prev) { create(:meeting, project: other_project, creator: owner, title: "범위밖") }

  let!(:meeting) do
    create(:meeting, project: project, creator: owner, folder: child_folder,
                     title: "주간 회의",
                     previous_meeting: out_of_scope_prev)
  end

  let!(:transcript) { create(:transcript, meeting: meeting, content: "안녕하세요 회의 시작합니다 검색어포함") }
  let!(:summary)    { create(:summary, meeting: meeting) }
  let!(:action_item) { create(:action_item, meeting: meeting) }
  let!(:decision)    { create(:decision, meeting: meeting) }
  let!(:block)       { create(:block, meeting: meeting) }
  let!(:contact)     { create(:meeting_contact, meeting: meeting) }
  let!(:bookmark)    { create(:meeting_bookmark, meeting: meeting) }
  let!(:chat_message) { create(:chat_message, meeting: meeting, user: owner, content: "질문이요") }

  let!(:tag)     { create(:tag, project: project, name: "긴급") }
  let!(:tagging) { Tagging.create!(tag: tag, taggable: meeting) }

  let!(:glossary_entry) do
    GlossaryEntry.create!(owner: meeting, from_text: "또박", to_text: "또박또박", match_type: "literal")
  end

  # export → tar.gz(StringIO) 헬퍼
  def export_io(include_audio: false)
    io = StringIO.new
    ProjectExporter.new(project, include_audio: include_audio).write_to(io)
    io.rewind
    io
  end

  # 아카이브 안 특정 엔트리의 압축해제 크기(누적 상한 stub 값을 계산할 때 쓴다).
  def read_entry_size(io, entry_name)
    io.rewind
    size = 0
    Gem::Package::TarReader.new(Zlib::GzipReader.new(io)) do |tar|
      tar.each { |e| size = e.header.size if e.file? && e.full_name == entry_name }
    end
    io.rewind
    size
  end

  describe "EmbedBackfillJob enqueue (reconcile_embeddings!)" do
    include ActiveJob::TestHelper

    it "전사가 있는 회의를 import하면 EmbedBackfillJob이 enqueue된다" do
      # transcript let!(:transcript) 로 시드 회의에 전사 1건이 이미 존재한다.
      expect {
        described_class.new(export_io, importer).run!
      }.to have_enqueued_job(EmbedBackfillJob)
    end
  end

  describe "#run! 라운드트립" do
    subject(:new_project) { described_class.new(export_io, importer).run! }

    it "새 Project 를 반환한다" do
      expect(new_project).to be_a(Project)
      expect(new_project.id).not_to eq(project.id)
    end

    it "프로젝트 이름에 '(가져옴' 접미사를 붙이고 creator 는 실행자다" do
      expect(new_project.name).to include("기획팀")
      expect(new_project.name).to include("(가져옴")
      expect(new_project.created_by_id).to eq(importer.id)
    end

    it "실행자만 admin 멤버로 등록한다" do
      memberships = new_project.project_memberships
      expect(memberships.count).to eq(1)
      expect(memberships.first.user_id).to eq(importer.id)
      expect(memberships.first.role).to eq("admin")
    end

    it "folders 카운트가 일치하고 계층(parent)이 보존된다" do
      folders = new_project.folders.to_a
      expect(folders.size).to eq(2)
      root  = folders.find { |f| f.name == "루트" }
      child = folders.find { |f| f.name == "자식" }
      expect(root.parent_id).to be_nil
      expect(child.parent_id).to eq(root.id)
    end

    it "meetings 와 모든 자식 카운트가 일치한다" do
      m = new_project.meetings.first
      expect(new_project.meetings.count).to eq(1)
      expect(m.transcripts.count).to eq(1)
      expect(m.summaries.count).to eq(1)
      expect(m.action_items.count).to eq(1)
      expect(m.decisions.count).to eq(1)
      expect(m.blocks.count).to eq(1)
      expect(m.meeting_contacts.count).to eq(1)
      expect(m.meeting_bookmarks.count).to eq(1)
      expect(m.chat_messages.count).to eq(1)
      expect(m.glossary_entries.count).to eq(1)
    end

    it "트랜스크립트 content 가 일치한다" do
      m = new_project.meetings.first
      expect(m.transcripts.first.content).to eq("안녕하세요 회의 시작합니다 검색어포함")
    end

    it "소유권을 실행자로 재지정한다 (회의 created_by · 챗 user · 첨부 uploaded_by)" do
      m = new_project.meetings.first
      expect(m.created_by_id).to eq(importer.id)
      expect(m.chat_messages.first.user_id).to eq(importer.id)
    end

    it "범위 밖 previous_meeting_id 는 nil 이다" do
      m = new_project.meetings.first
      expect(m.previous_meeting_id).to be_nil
    end

    it "tags 카운트가 일치한다" do
      tag_ids = new_project.meetings.first.tags.pluck(:name)
      expect(tag_ids).to contain_exactly("긴급")
    end

    it "import 후 FTS 로 트랜스크립트를 검색할 수 있다" do
      new_project # 강제 실행
      conn = ActiveRecord::Base.connection
      rows = conn.execute("SELECT source_id FROM transcripts_fts WHERE transcripts_fts MATCH '검색어포함'")
      source_ids = rows.map { |r| r.is_a?(Hash) ? r["source_id"] : r.first }
      new_transcript = new_project.meetings.first.transcripts.first
      expect(source_ids).to include(new_transcript.id)
    end
  end

  describe "tag dedupe" do
    # Tag.name 은 전역 unique. 시드의 "긴급" tag 가 이미 존재하므로 import 는 이를 재사용해야 한다.
    it "동명 tag 가 미리 존재하면 재사용한다 (동명 tag 가 늘지 않는다)" do
      io = export_io
      count_before = Tag.where(name: "긴급").count
      expect(count_before).to eq(1) # 시드에서 1건 존재

      new_project = described_class.new(io, importer).run!

      # import 가 "긴급" 을 재사용 → 동명 tag 수가 그대로 1.
      expect(Tag.where(name: "긴급").count).to eq(1)
      # 새 회의도 같은(재사용된) tag 를 가리킨다.
      expect(new_project.meetings.first.tags.pluck(:name)).to contain_exactly("긴급")
    end
  end

  describe "include_audio" do
    it "include_audio=true 면 오디오 파일을 새 경로로 복사하고 audio_file_path 가 채워진다" do
      Dir.mktmpdir do |dir|
        audio_path = File.join(dir, "src.mp3")
        File.binwrite(audio_path, "FAKEAUDIO-BYTES")
        meeting.update_column(:audio_file_path, audio_path)

        new_project = described_class.new(export_io(include_audio: true), importer).run!
        m = new_project.meetings.first

        expect(m.audio_file_path).to be_present
        expect(File.file?(m.audio_file_path)).to be(true)
        expect(File.binread(m.audio_file_path)).to eq("FAKEAUDIO-BYTES")
        expect(m.audio_file_path).to include(m.id.to_s)
      ensure
        FileUtils.rm_f(new_project.meetings.first.audio_file_path) if defined?(new_project) && new_project
      end
    end

    it "include_audio=false 면 audio_file_path 가 nil 이다" do
      Dir.mktmpdir do |dir|
        audio_path = File.join(dir, "src.mp3")
        File.binwrite(audio_path, "FAKEAUDIO-BYTES")
        meeting.update_column(:audio_file_path, audio_path)

        new_project = described_class.new(export_io(include_audio: false), importer).run!
        m = new_project.meetings.first
        expect(m.audio_file_path).to be_nil
      end
    end
  end

  describe "첨부 파일" do
    it "첨부 파일을 새 경로로 복사하고 uploaded_by 는 실행자다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "#{meeting.id}_deadbeef_report.pdf")
        File.binwrite(attach_path, "PDFDATA")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                    uploaded_by_id: owner.id)

        new_project = described_class.new(export_io, importer).run!
        m = new_project.meetings.first
        att = m.meeting_attachments.first

        expect(att.uploaded_by_id).to eq(importer.id)
        expect(att.file_path).to be_present
        expect(File.file?(att.file_path)).to be(true)
        expect(File.binread(att.file_path)).to eq("PDFDATA")
      ensure
        if defined?(new_project) && new_project
          new_project.meetings.first.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) }
        end
      end
    end
  end

  describe "staged Tempfile 수명 (F2 GC 버그)" do
    # F2 스트리밍 추출은 첨부/오디오를 디스크 Tempfile 로 staging 한다. staging 과
    # storage/ 복사 사이에 GC 가 돌면, importer 가 Tempfile **객체** 참조를 잃은 경우
    # finalizer 가 파일을 unlink → copy 시 ENOENT(500). 객체 참조를 유지해야 한다.

    it "staging 후 GC 를 강제해도 staged 파일이 살아있어 첨부 복사가 성공한다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "#{meeting.id}_deadbeef_report.pdf")
        File.binwrite(attach_path, "PDFDATA")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                    uploaded_by_id: owner.id)

        svc = described_class.new(export_io, importer)
        # 실제 복사 직전에 GC 를 강제 → 객체 미참조면 staged 파일이 unlink 되어 ENOENT.
        original = svc.method(:copy_staged)
        allow(svc).to receive(:copy_staged) do |src, dest|
          GC.start
          GC.start
          original.call(src, dest)
        end

        new_project = svc.run!
        m = new_project.meetings.first
        att = m.meeting_attachments.first

        expect(att.file_path).to be_present
        expect(File.file?(att.file_path)).to be(true)
        expect(File.binread(att.file_path)).to eq("PDFDATA")
      ensure
        if defined?(new_project) && new_project
          new_project.meetings.first.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) }
        end
      end
    end

    it "staged Tempfile 들은 GC.start 후에도(=copy 전) 디스크에 존재한다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "#{meeting.id}_deadbeef_report.pdf")
        File.binwrite(attach_path, "PDFDATA")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                    uploaded_by_id: owner.id)

        svc = described_class.new(export_io, importer)
        existed_after_gc = nil
        # staging 완료(read_archive) 직후 GC 를 강제하고, 바로 그 시점에 존재를 단언한다.
        # cleanup 은 run! 종료 ensure 에서만 도므로 이 시점엔 아직 살아있어야 한다.
        original = svc.method(:read_archive)
        allow(svc).to receive(:read_archive) do
          manifest = original.call
          staged_paths = svc.instance_variable_get(:@attach_paths).values
          GC.start
          GC.start
          existed_after_gc = staged_paths.present? && staged_paths.all? { |p| File.file?(p) }
          manifest
        end

        new_project = svc.run!

        expect(existed_after_gc).to be(true)
      ensure
        if defined?(new_project) && new_project
          new_project.meetings.first.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) }
        end
      end
    end
  end

  describe "path-traversal 가드" do
    # 악성 엔트리명(../ 또는 절대경로)을 가진 tar.gz 를 만들어 거부됨을 검증.
    def malicious_io(entry_name)
      io = StringIO.new
      gz = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)
      # 최소 유효 manifest
      manifest = {
        "format_version" => 1,
        "project" => { "name" => "악성" },
        "folders" => [], "tags" => [], "meetings" => []
      }
      json = JSON.generate(manifest).b
      tar.add_file_simple("manifest.json", 0o644, json.bytesize) { |e| e.write(json) }
      payload = "EVIL".b
      tar.add_file_simple(entry_name, 0o644, payload.bytesize) { |e| e.write(payload) }
      tar.close
      gz.finish
      io.rewind
      io
    end

    it "엔트리명에 .. 가 있으면 거부한다" do
      expect {
        described_class.new(malicious_io("../escape.txt"), importer).run!
      }.to raise_error(ProjectImporter::UnsafeEntryError)
    end

    it "절대경로 엔트리명을 거부한다" do
      expect {
        described_class.new(malicious_io("/etc/passwd"), importer).run!
      }.to raise_error(ProjectImporter::UnsafeEntryError)
    end
  end

  describe "트랜잭션 롤백" do
    it "실패 시 새 Project 가 생성되지 않는다" do
      project_count_before = Project.count
      # meeting 생성 시 예외를 강제 → 트랜잭션 롤백.
      allow_any_instance_of(Meeting).to receive(:save!).and_raise(ActiveRecord::RecordInvalid.new(Meeting.new))

      expect {
        described_class.new(export_io, importer).run!
      }.to raise_error(StandardError)
      expect(Project.count).to eq(project_count_before)
    end
  end

  describe "폴더 소유 glossary_entries (F3)" do
    # GlossaryEntry 는 polymorphic owner. Folder 도 owner(폴더별 오타사전).
    # exporter 가 meeting.glossary_entries 만 직렬화하면 폴더 glossary 가 이관 시 소실.
    let!(:folder_glossary) do
      GlossaryEntry.create!(owner: child_folder, from_text: "폴더오타", to_text: "폴더정정",
                            match_type: "literal")
    end

    it "라운드트립 후 새 folder 의 glossary_entries 가 존재하고 내용이 일치한다" do
      new_project = described_class.new(export_io, importer).run!
      new_child = new_project.folders.find { |f| f.name == "자식" }
      entries = new_child.glossary_entries.to_a
      expect(entries.size).to eq(1)
      expect(entries.first.from_text).to eq("폴더오타")
      expect(entries.first.to_text).to eq("폴더정정")
    end
  end

  describe "폴더 taggings (F4)" do
    # Folder 는 taggable. exporter 가 폴더 태그를 직렬화하지 않으면 소실.
    let!(:folder_tag) { create(:tag, project: project, name: "폴더태그") }
    let!(:folder_tagging) { Tagging.create!(tag: folder_tag, taggable: child_folder) }

    it "라운드트립 후 새 folder 가 동일 이름 tag 로 태깅된다" do
      new_project = described_class.new(export_io, importer).run!
      new_child = new_project.folders.find { |f| f.name == "자식" }
      expect(new_child.tags.pluck(:name)).to include("폴더태그")
    end
  end

  describe "첨부 바이트 누락 (F7)" do
    # exporter 가 첨부 바이트를 동봉하지 않은(파일 미존재) kind="file" 첨부는
    # 조용히 bare basename 을 저장하지 말고 InvalidArchiveError 로 롤백해야 한다.
    it "kind=file 인데 아카이브에 바이트가 없으면 InvalidArchiveError 로 롤백한다" do
      # 파일이 존재하지 않는 경로 → exporter 가 바이트를 못 넣음.
      create(:meeting_attachment, meeting: meeting,
                                  file_path: "/nonexistent/dir/#{meeting.id}_x_missing.pdf",
                                  kind: "file", uploaded_by_id: owner.id)
      project_count_before = Project.count

      expect {
        described_class.new(export_io, importer).run!
      }.to raise_error(ProjectImporter::InvalidArchiveError)
      expect(Project.count).to eq(project_count_before)
    end

    it "kind=link 첨부는 파일 없이도 import 에 성공한다 (롤백 없음)" do
      create(:meeting_attachment, meeting: meeting,
                                  kind: "link", url: "https://example.com/doc",
                                  file_path: nil, content_type: nil, file_size: nil,
                                  original_filename: nil, uploaded_by_id: owner.id)

      new_project = described_class.new(export_io, importer).run!
      m = new_project.meetings.first
      link_att = m.meeting_attachments.find { |a| a.kind == "link" }
      expect(link_att).to be_present
      expect(link_att.url).to eq("https://example.com/doc")
    end
  end

  # ── public_uid 충돌 가드 (T7) ──
  #
  # 재현 시나리오: 회의를 D'Flow 전송(public_uid 발급) → 그 프로젝트를 export →
  # 같은 서버에 import(복사). 원본 회의가 로컬에 남아있는 채로 동일 public_uid 를
  # 가진 아카이브를 import 하면, Meeting.public_uid 의 unique index 때문에
  # RecordNotUnique 로 프로젝트 import 전체가 롤백되던 결함(T4 리뷰에서 확인).
  # Transfer::MeetingRestorer 의 사전검사 가드(§3.4)를 ProjectImporter 경로에도
  # 적용해, 충돌 시 3필드만 null 로 복원하고 warnings 를 남기며 나머지는 정상
  # 복원되어야 한다.
  describe "public_uid 충돌 가드 (T7)" do
    before do
      meeting.update_columns(
        public_uid:      "0199abc0-0000-7000-8000-000000000099",
        dflow_synced_at: Time.zone.parse("2026-07-01 10:00:00"),
        dflow_url:       "https://dflow.example.com/meetings/xyz"
      )
    end

    it "로컬에 동일 uid 가 이미 존재하면 전체 import 는 성공하고 해당 회의 3필드는 null, warnings 1건이 남는다" do
      archive  = export_io
      importer_svc = described_class.new(archive, importer)

      new_project = importer_svc.run!
      m = new_project.meetings.first

      expect(m.public_uid).to be_nil
      expect(m.dflow_synced_at).to be_nil
      expect(m.dflow_url).to be_nil
      expect(importer_svc.warnings).to contain_exactly(
        "D'Flow 연결 식별자가 이미 사용 중이라 해제된 채 복원됨 — 연결 관리에서 재설정"
      )
      # 충돌과 무관한 필드는 정상 복원
      expect(m.title).to eq("주간 회의")
    end

    it "충돌이 없으면(로컬에 해당 uid 가 없는 서버 이동 시나리오) 3필드를 그대로 보존하고 warnings 가 비어있다" do
      archive = export_io
      meeting.destroy! # 원본을 제거해 "다른 서버로 이동" 상황을 재현

      importer_svc = described_class.new(archive, importer)
      new_project  = importer_svc.run!
      m = new_project.meetings.first

      expect(m.public_uid).to eq("0199abc0-0000-7000-8000-000000000099")
      expect(m.dflow_synced_at).to be_within(1).of(Time.zone.parse("2026-07-01 10:00:00"))
      expect(m.dflow_url).to eq("https://dflow.example.com/meetings/xyz")
      expect(importer_svc.warnings).to be_empty
    end

    it "충돌이 RecordNotUnique 예외 없이 사전 검사로 처리된다(전체 import 롤백 회귀 가드)" do
      archive = export_io
      expect {
        described_class.new(archive, importer).run!
      }.not_to raise_error
    end
  end

  # ── 전사 배치 복원 (insert_all 회귀 가드) ──
  #
  # 실제 버그(35k 전사 = 건당 create! → ~73k쿼리·117s) 회귀 가드.
  # Transfer::MeetingRestorer#restore_transcripts 에 적용된 것과 동일한 배치 insert_all
  # 접근을 ProjectImporter#import_meeting_children 에도 적용했는지 검증한다.
  describe "전사 배치 복원" do
    # 여러 전사가 필드·정렬 그대로 라운드트립되는지 검증한다.
    # 시퀀스 역순으로 생성하고, 필드값을 서로 다르게 두어 행-필드 매핑 오류를 잡는다.
    let!(:multi_meeting) do
      create(:meeting, project: project, creator: owner, title: "전사 다건 회의")
    end
    let!(:t3) do
      create(:transcript, meeting: multi_meeting, sequence_number: 3, content: "세 번째 발화",
                          speaker_label: "SPEAKER_02", speaker_name: "다희",
                          started_at_ms: 6000, ended_at_ms: 9000)
    end
    let!(:t1) do
      create(:transcript, meeting: multi_meeting, sequence_number: 1, content: "첫 번째 발화 유니크토큰",
                          speaker_label: "SPEAKER_00", speaker_name: "가영",
                          started_at_ms: 0, ended_at_ms: 3000)
    end
    let!(:t2) do
      create(:transcript, meeting: multi_meeting, sequence_number: 2, content: "두 번째 발화",
                          speaker_label: "SPEAKER_01", speaker_name: nil,
                          started_at_ms: 3000, ended_at_ms: 6000)
    end

    it "모든 전사를 개수·필드·정렬(sequence_number)·meeting_id 그대로 복원한다" do
      new_project = described_class.new(export_io, importer).run!
      new_meeting = new_project.meetings.find { |mtg| mtg.title == "전사 다건 회의" }
      ts          = new_meeting.transcripts.to_a  # default_scope: order(:sequence_number)

      expect(ts.size).to eq(3)
      expect(ts.map(&:sequence_number)).to eq([ 1, 2, 3 ])
      expect(ts.map(&:content)).to eq([ "첫 번째 발화 유니크토큰", "두 번째 발화", "세 번째 발화" ])
      expect(ts.map(&:speaker_label)).to eq([ "SPEAKER_00", "SPEAKER_01", "SPEAKER_02" ])
      expect(ts.map(&:speaker_name)).to eq([ "가영", nil, "다희" ])
      expect(ts.map(&:started_at_ms)).to eq([ 0, 3000, 6000 ])
      expect(ts.map(&:ended_at_ms)).to eq([ 3000, 6000, 9000 ])

      # meeting_id 재지정 확인
      expect(ts.map(&:meeting_id).uniq).to eq([ new_meeting.id ])
      # insert_all 은 타임스탬프를 자동 설정하지 않으므로 수동 세팅 회귀 가드
      # (transcripts 테이블에는 created_at 만 있고 updated_at 컬럼은 없다)
      expect(ts.map(&:created_at)).to all(be_present)
    end

    it "복원된 전사를 FTS 로 검색할 수 있다 (insert_all 이 콜백을 건너뛰므로 수동 색인 회귀 가드)" do
      new_project = described_class.new(export_io, importer).run!
      new_meeting = new_project.meetings.find { |mtg| mtg.title == "전사 다건 회의" }

      conn       = ActiveRecord::Base.connection
      rows       = conn.execute("SELECT source_id FROM transcripts_fts WHERE transcripts_fts MATCH '유니크토큰'")
      source_ids = rows.map { |r| r.is_a?(Hash) ? r["source_id"] : r.first }
      target     = new_meeting.transcripts.find { |t| t.content.include?("유니크토큰") }

      expect(source_ids).to include(target.id)
    end

    # 단일 insert_all 은 SQLite 변수 상한(32766)을 넘겨 3000+ 행에서 실패하므로
    # 배치 분할이 필수다. 원본 소스 전사를 3100건 실제로 생성하지 않고(느림·목적과 무관)
    # manifest 를 직접 조립해 ProjectImporter 에 먹여, (a) 전량 복원 + 정렬 보존 +
    # meeting_id 재지정, (b) 건당 insert 가 아닌 소수 배치 쿼리임을 단언한다.
    def manifest_io(manifest_hash)
      io  = StringIO.new
      gz  = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)
      json = JSON.generate(manifest_hash).b
      tar.add_file_simple("manifest.json", 0o644, json.bytesize) { |e| e.write(json) }
      tar.close
      gz.finish
      io.rewind
      io
    end

    it "3100 전사를 전량 복원하며 건당 insert 가 아닌 배치로 처리한다" do
      base_meeting = create(:meeting, project: project, creator: owner, title: "대량 전사")
      manifest = {
        "format_version" => 1,
        "project"        => project.attributes,
        "folders"        => [],
        "tags"           => [],
        "meetings"       => [
          base_meeting.attributes.merge(
            "transcripts" => (1..3100).map do |i|
              {
                "content"         => "대량 발화 #{i}",
                "speaker_label"   => "SPEAKER_00",
                "started_at_ms"   => i * 10,
                "ended_at_ms"     => i * 10 + 5,
                "sequence_number" => i
              }
            end
          )
        ]
      }

      transcript_inserts = 0
      counter = lambda do |*args|
        sql = args.last[:sql].to_s
        if sql.start_with?("INSERT INTO") && sql.include?("transcripts") && !sql.include?("transcripts_fts")
          transcript_inserts += 1
        end
      end

      new_project = nil
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record") do
        new_project = described_class.new(manifest_io(manifest), importer).run!
      end

      new_meeting = new_project.meetings.find { |mtg| mtg.title == "대량 전사" }
      expect(new_meeting.transcripts.count).to eq(3100)
      expect(new_meeting.transcripts.pluck(:sequence_number)).to eq((1..3100).to_a)
      # 건당 insert(3100회) 가 아니라 배치(수십 회 이하) 여야 한다.
      # (관찰값: 배치크기 1000 → 3100건은 4회. 정확한 배치 수를 하드코딩하지 않고
      #  느슨한 상한으로 둔다 — MeetingRestorer 회귀 가드와 동일한 설계.)
      expect(transcript_inserts).to be < 100
    end
  end

  # ── 화자 DB(SpeakerDB) 복원 ──

  describe "화자 DB(SpeakerDB) 복원" do
    let!(:meeting2) do
      create(:meeting, project: project, creator: owner, folder: child_folder, title: "두 번째 회의")
    end

    let(:speaker_db_1) do
      { "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "AACAPwAAAEA=" ] }, "names" => { "SPEAKER_00" => "앨리스" } }
    end
    let(:speaker_db_2) do
      { "next_num" => 3, "speakers" => { "SPEAKER_00" => [ "AABAQA==" ] }, "names" => { "SPEAKER_00" => "밥" } }
    end

    it "각 회의의 화자 DB 가 각자의 새 meeting_id 로 PUT 되어 서로 섞이지 않는다" do
      allow(sidecar_stub).to receive(:get_speaker_db).with(meeting.id).and_return(speaker_db_1)
      allow(sidecar_stub).to receive(:get_speaker_db).with(meeting2.id).and_return(speaker_db_2)

      new_project = described_class.new(export_io, importer).run!

      new_meeting1 = new_project.meetings.find { |m| m.title == "주간 회의" }
      new_meeting2 = new_project.meetings.find { |m| m.title == "두 번째 회의" }

      expect(new_meeting1.id).not_to eq(meeting.id)
      expect(new_meeting2.id).not_to eq(meeting2.id)
      expect(sidecar_stub).to have_received(:put_speaker_db).with(new_meeting1.id, speaker_db_1)
      expect(sidecar_stub).to have_received(:put_speaker_db).with(new_meeting2.id, speaker_db_2)
    end

    it "sidecar 가 다운되어 있으면(import PUT 실패) import 자체는 성공하고 나머지 데이터는 보존된다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      allow(sidecar_stub).to receive(:put_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

      new_project = nil
      expect { new_project = described_class.new(export_io, importer).run! }.not_to raise_error
      expect(new_project.meetings.count).to eq(2)
    end

    # 적대 검토 #3: 반환값(true/false)을 아무도 안 쓰면 사용자에게 보고가 없다.
    # public_uid 충돌과 같은 채널(importer.warnings)로 흘려보낸다.
    it "복원 실패는 importer.warnings 로 보고되며 회의가 여러 건 실패해도 1건으로 합쳐진다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      allow(sidecar_stub).to receive(:put_speaker_db).and_raise(SidecarClient::ConnectionError, "down")

      subject_importer = described_class.new(export_io, importer)
      subject_importer.run!

      expect(subject_importer.warnings)
        .to eq([ Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING ])
    end

    it "복원에 성공하면 경고가 없다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)

      subject_importer = described_class.new(export_io, importer)
      subject_importer.run!

      expect(subject_importer.warnings).to be_empty
    end

    # 적대 검토 #5: 모든 speakers/ 엔트리 전체 바이트를 DB 트랜잭션 내내 RAM 에 들고
    # 있었다 → audio/attachments 처럼 Tempfile 로 스테이징한다.
    #
    # ⚠️ 스테이징 여부는 **실행 중에** 확인해야 한다. run! 의 ensure 가
    # cleanup_staged_files 로 Tempfile 을 unlink 하므로 run! 이 끝난 뒤
    # File.exist? 를 보면 항상 false 이고, "값이 String 이다"는 바이트열도 String 이라
    # 아무것도 반증하지 못한다(2라운드 R7 무반증 스펙).
    it "화자 엔트리를 메모리에 들지 않고 실제 디스크 경로로 스테이징한다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      io = export_io

      observed = []
      allow(Transfer::SpeakerDbTransfer::Importer)
        .to receive(:new).and_wrap_original do |orig, **kwargs|
          inner = orig.call(**kwargs)
          allow(inner).to receive(:import_file).and_wrap_original do |run, mid, path|
            observed << {
              path:    path,
              exists:  File.exist?(path),
              content: (File.binread(path) if File.exist?(path))
            }
            run.call(mid, path)
          end
          inner
        end

      subject_importer = described_class.new(io, importer)
      subject_importer.run!

      expect(observed.size).to eq(2)
      observed.each do |o|
        expect(o[:exists]).to be(true)                                  # 호출 시점에 실재하는 파일
        expect(File.dirname(o[:path])).to start_with(Dir.tmpdir)        # tmpdir 하위
        expect(JSON.parse(o[:content])).to eq(speaker_db_1)             # 내용은 로스터 JSON
      end

      staged = subject_importer.instance_variable_get(:@speaker_paths)
      expect(staged.keys).to contain_exactly(
        "speakers/#{meeting.id}.json", "speakers/#{meeting2.id}.json"
      )
      # 값이 "경로"임을 확인 — 바이트열이면 로스터 본문(next_num)이 들어 있을 것이다.
      expect(staged.values).to contain_exactly(*observed.map { |o| o[:path] })
      expect(staged.values.none? { |v| v.include?("next_num") }).to be(true)
    end

    # R4: import 쪽에도 circuit-break 가 필요하다(export 와 대칭).
    # 없으면 "붙어는 있는데 응답 없음" 사이드카에서 회의당 TIMEOUT 30초를 전부 소모한다.
    it "첫 회의에서 연결 거부를 만나면 이후 회의는 PUT 을 시도하지 않는다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      allow(sidecar_stub).to receive(:put_speaker_db).and_raise(Errno::ECONNREFUSED)

      subject_importer = described_class.new(export_io, importer)
      subject_importer.run!

      expect(sidecar_stub).to have_received(:put_speaker_db).once # 회의는 2건인데 호출은 1번
      expect(subject_importer.warnings)
        .to include(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
    end

    it "일시적 끊김(ECONNRESET)이면 두 번째 회의도 계속 복원한다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      call = 0
      allow(sidecar_stub).to receive(:put_speaker_db) do
        call += 1
        raise Errno::ECONNRESET, "reset" if call == 1
        { "ok" => true }
      end

      described_class.new(export_io, importer).run!

      expect(sidecar_stub).to have_received(:put_speaker_db).twice
    end

    it "회의마다 복원기를 새로 만들지 않고 하나를 공유한다(circuit 상태·클라이언트 재사용)" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      io = export_io
      allow(Transfer::SpeakerDbTransfer::Importer).to receive(:new).and_call_original

      described_class.new(io, importer).run!

      expect(sidecar_stub).to have_received(:put_speaker_db).twice # 회의 2건 복원
      expect(Transfer::SpeakerDbTransfer::Importer).to have_received(:new).once
    end

    # R5: MeetingImporter 는 header.size 를 먼저 검사하는데 ProjectImporter 는
    # speakers/ 를 곧장 stage_entry 로 보내, 64MB 상한이 디스크에 다 쓴 **뒤에야** 걸렸다.
    it "선언 크기가 상한을 넘는 화자 엔트리는 디스크에 쓰지 않고 경고만 남긴다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      io = export_io
      stub_const("Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES", 8)

      subject_importer = described_class.new(io, importer)
      new_project = subject_importer.run!

      expect(subject_importer.instance_variable_get(:@speaker_paths)).to be_empty
      expect(sidecar_stub).not_to have_received(:put_speaker_db)
      expect(subject_importer.warnings)
        .to include(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
      expect(new_project.meetings.count).to eq(2) # 나머지는 정상 복원
    end

    # R1 과 같은 이유 — 스킵해도 엔트리는 **계량하며** 드레인해야 한다.
    # 소비하지 않으면 TarReader::Entry#close 가 계량 없이 대신 읽어(zip-bomb 계량 우회)
    # 누적 상한 가드가 전혀 발화하지 않는다.
    it "스킵한 화자 엔트리도 계량되어 zip-bomb 가드가 발화한다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(
        { "next_num" => 2, "speakers" => { "SPEAKER_00" => [ "A" * 300_000 ] }, "names" => {} }
      )
      io = export_io
      manifest_bytes = read_entry_size(io, "manifest.json")
      stub_const("Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES", 8)
      stub_const("ProjectImporter::MAX_DECOMPRESSED_BYTES", manifest_bytes + 100_000)

      expect { described_class.new(io, importer).run! }
        .to raise_error(ProjectImporter::InvalidArchiveError, /압축 해제 크기/)
    end

    # R1 의 같은 우회가 **알 수 없는 엔트리**에도 있다 — ProjectImporter 의 read_archive 는
    # audio/·attachments/·speakers/·manifest.json 이 아닌 엔트리를 아예 읽지 않아
    # Entry#close 가 계량 없이 압축을 다 풀어버린다.
    it "알 수 없는 엔트리도 계량되어 zip-bomb 가드가 발화한다" do
      io  = StringIO.new
      gz  = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)
      json = JSON.generate({ "format_version" => 1, "project" => project.attributes,
                             "folders" => [], "tags" => [], "meetings" => [] }).b
      tar.add_file_simple("manifest.json", 0o644, json.bytesize) { |e| e.write(json) }
      junk = "\0" * (300 * 1024)
      tar.add_file_simple("junk/blob.bin", 0o644, junk.bytesize) { |e| e.write(junk) }
      tar.close
      gz.finish
      io.rewind

      stub_const("ProjectImporter::MAX_DECOMPRESSED_BYTES", json.bytesize + 100_000)

      expect { described_class.new(io, importer).run! }
        .to raise_error(ProjectImporter::InvalidArchiveError, /압축 해제 크기/)
    end

    # R3: 사이드카 문제로 로스터가 통째로 빠진 아카이브가 정상처럼 보이면 안 된다.
    it "내보내기 시점에 로스터가 빠진 아카이브는 import 가 경고로 알린다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_raise(SidecarClient::ConnectionError, "down")
      io = export_io # 열화 표식이 박힌 아카이브
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(default_speaker_db)

      subject_importer = described_class.new(io, importer)
      subject_importer.run!

      expect(subject_importer.warnings)
        .to include(Transfer::SpeakerDbTransfer::EXPORT_DEGRADED_WARNING)
    end

    it "표식이 없는 구버전 아카이브는 export 열화 경고를 올리지 않는다(하위호환)" do
      manifest = {
        "format_version" => 1,
        "project"        => project.attributes,
        "folders"        => [], "tags" => [], "meetings" => []
      }
      io  = StringIO.new
      gz  = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)
      json = JSON.generate(manifest).b
      tar.add_file_simple("manifest.json", 0o644, json.bytesize) { |e| e.write(json) }
      tar.close
      gz.finish
      io.rewind

      subject_importer = described_class.new(io, importer)
      subject_importer.run!

      expect(subject_importer.warnings).to be_empty
    end

    # 스테이징 도입의 함정: restore_speaker_dbs 는 **커밋 후**에 돈다.
    # 여기서 raise 하면 run! 의 rescue 가 이미 커밋된 import 의 복사 파일을 지운다.
    it "스테이징 파일이 사라져도 커밋된 import 를 롤백/파일삭제 하지 않고 경고만 남긴다" do
      allow(sidecar_stub).to receive(:get_speaker_db).and_return(speaker_db_1)
      io = export_io
      subject_importer = described_class.new(io, importer)
      # 스테이징 직후 파일을 지워 File 읽기가 ENOENT 로 실패하게 만든다.
      # (복원은 공유 Importer 인스턴스를 거치므로 그 인스턴스의 import_file 을 감싼다.)
      allow(Transfer::SpeakerDbTransfer::Importer).to receive(:new).and_wrap_original do |orig, **kwargs|
        inner = orig.call(**kwargs)
        allow(inner).to receive(:import_file).and_wrap_original do |run, mid, path|
          FileUtils.rm_f(path)
          run.call(mid, path)
        end
        inner
      end

      expect(subject_importer).not_to receive(:cleanup_copied_files)

      new_project = nil
      expect { new_project = subject_importer.run! }.not_to raise_error
      expect(new_project.meetings.count).to eq(2)
      expect(subject_importer.warnings)
        .to include(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
    end

    it "구버전 아카이브(화자 엔트리 없음)도 정상 import 된다 (하위호환)" do
      manifest = {
        "format_version" => 1,
        "project"        => project.attributes,
        "folders"        => [],
        "tags"           => [],
        "meetings"       => [ meeting.attributes.merge(
          "transcripts" => [], "summaries" => [], "action_items" => [],
          "decisions"   => [], "blocks"    => [], "attachments"  => [],
          "contacts"    => [], "bookmarks" => [],
          "chat_messages" => [], "tag_ids" => [], "glossary_entries" => []
        ) ]
      }
      io  = StringIO.new
      gz  = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)
      json = JSON.generate(manifest).b
      tar.add_file_simple("manifest.json", 0o644, json.bytesize) { |e| e.write(json) }
      tar.close
      gz.finish
      io.rewind

      expect(sidecar_stub).not_to receive(:put_speaker_db)

      new_project = described_class.new(io, importer).run!
      expect(new_project.meetings.count).to eq(1)
    end
  end
end
