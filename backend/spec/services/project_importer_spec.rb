require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"
require "tmpdir"

# 라운드트립: ProjectExporter 로 시드 프로젝트를 tar.gz(StringIO) 로 내보낸 뒤
# ProjectImporter 로 가져와 복원 결과를 검증한다. (export 의 엔트리·매니페스트 규약에 의존)
RSpec.describe ProjectImporter do
  before(:all) { Transcript.ensure_fts_tables! }

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
end
