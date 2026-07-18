require "rails_helper"
require "rubygems/package"
require "zlib"
require "stringio"
require "tmpdir"

# 라운드트립: MeetingExporter 로 회의를 tar.gz(StringIO) 로 내보낸 뒤
# MeetingImporter 로 가져와 복원 결과를 검증한다.
RSpec.describe MeetingImporter do
  before(:all) { Transcript.ensure_fts_tables! }

  # ── 시드 데이터 ──
  let!(:owner)         { create(:user, name: "원작성자") }
  let!(:importer_user) { create(:user, name: "가져온사람") }

  # 원본 프로젝트 + 회의
  let!(:src_project) { create(:project, creator: owner, name: "소스팀") }
  let!(:meeting) do
    create(:meeting, project: src_project, creator: owner, title: "주간 회의",
                     locked_at: Time.current)
  end

  let!(:transcript)   { create(:transcript, meeting: meeting, content: "안녕하세요 회의 시작합니다 검색어포함") }
  let!(:summary)      { create(:summary, meeting: meeting) }
  let!(:action_item)  { create(:action_item, meeting: meeting) }
  let!(:decision)     { create(:decision, meeting: meeting) }
  let!(:parent_block) { create(:block, meeting: meeting, parent_block_id: nil) }
  let!(:child_block)  { create(:block, meeting: meeting, parent_block_id: parent_block.id) }
  let!(:contact)      { create(:meeting_contact, meeting: meeting) }
  let!(:bookmark)     { create(:meeting_bookmark, meeting: meeting) }
  let!(:chat_message) { create(:chat_message, meeting: meeting, user: owner, content: "질문이요") }

  let!(:tag)     { create(:tag, project: src_project, name: "긴급") }
  let!(:tagging) { Tagging.create!(tag: tag, taggable: meeting) }

  let!(:glossary_entry) do
    GlossaryEntry.create!(owner: meeting, from_text: "또박", to_text: "또박또박", match_type: "literal")
  end

  # 대상 프로젝트 + 폴더
  let!(:dst_project) { create(:project, creator: importer_user, name: "대상팀") }
  let!(:dst_folder)  { create(:folder, project: dst_project, name: "대상폴더", parent: nil) }

  # ── 헬퍼 ──

  # 회의를 tar.gz StringIO 로 익스포트
  def export_io(include_audio: false)
    io = StringIO.new
    MeetingExporter.new(meeting, include_audio: include_audio).write_to(io)
    io.rewind
    io
  end

  # MeetingImporter 실행 헬퍼
  def run_import(io = export_io, folder: dst_folder)
    described_class.new(io, user: importer_user, project: dst_project, folder: folder).run!
  end

  # ── EmbedBackfillJob ──

  describe "EmbedBackfillJob enqueue" do
    include ActiveJob::TestHelper

    it "전사가 있는 회의를 import 하면 EmbedBackfillJob 이 enqueue 된다" do
      expect { run_import }.to have_enqueued_job(EmbedBackfillJob)
    end
  end

  # ── 라운드트립 ──

  describe "#run! 라운드트립" do
    subject(:result) { run_import }

    let(:new_meeting) { Meeting.find(result[:meeting_id]) }

    it "{ meeting_id: } 를 반환하고 원본과 다른 id 다" do
      expect(result).to have_key(:meeting_id)
      expect(result[:meeting_id]).not_to eq(meeting.id)
    end

    it "대상 프로젝트에 소속된다" do
      expect(new_meeting.project_id).to eq(dst_project.id)
    end

    it "대상 폴더에 소속된다" do
      expect(new_meeting.folder_id).to eq(dst_folder.id)
    end

    it "실행자가 created_by 다" do
      expect(new_meeting.created_by_id).to eq(importer_user.id)
    end

    it "제목이 보존된다" do
      expect(new_meeting.title).to eq("주간 회의")
    end

    it "previous_meeting_id 는 nil 이다" do
      expect(new_meeting.previous_meeting_id).to be_nil
    end

    it "locked_at 은 nil 이다 (잠금 해제)" do
      expect(new_meeting.locked_at).to be_nil
    end

    it "status 는 'completed' 로 정상화된다 (진행 중 상태 제거)" do
      expect(new_meeting.status).to eq("completed")
    end

    it "recording_client_id 는 nil 이다" do
      expect(new_meeting.recording_client_id).to be_nil
    end

    it "recorder_heartbeat_at 는 nil 이다" do
      expect(new_meeting.recorder_heartbeat_at).to be_nil
    end

    it "자식 레코드 카운트가 일치한다" do
      expect(new_meeting.transcripts.count).to eq(1)
      expect(new_meeting.summaries.count).to eq(1)
      expect(new_meeting.action_items.count).to eq(1)
      expect(new_meeting.decisions.count).to eq(1)
      expect(new_meeting.blocks.count).to eq(2)
      expect(new_meeting.meeting_contacts.count).to eq(1)
      expect(new_meeting.meeting_bookmarks.count).to eq(1)
      expect(new_meeting.chat_messages.count).to eq(1)
      expect(new_meeting.glossary_entries.count).to eq(1)
    end

    it "트랜스크립트 content 가 일치한다" do
      expect(new_meeting.transcripts.first.content).to eq("안녕하세요 회의 시작합니다 검색어포함")
    end

    it "blocks parent_block_id 계층이 보존된다" do
      blocks  = new_meeting.blocks.to_a
      parent  = blocks.find { |b| b.parent_block_id.nil? }
      child   = blocks.find { |b| b.parent_block_id.present? }
      expect(parent).to be_present
      expect(child).to be_present
      expect(child.parent_block_id).to eq(parent.id)
    end

    it "소유권: chat user_id · contact created_by_id 는 실행자다" do
      expect(new_meeting.chat_messages.first.user_id).to eq(importer_user.id)
      expect(new_meeting.meeting_contacts.first.created_by_id).to eq(importer_user.id)
    end

    it "태그 이름이 보존된다" do
      expect(new_meeting.tags.pluck(:name)).to contain_exactly("긴급")
    end

    it "folder: nil 이면 folder_id 가 nil 이다 (루트)" do
      result_root = described_class.new(export_io, user: importer_user, project: dst_project, folder: nil).run!
      m = Meeting.find(result_root[:meeting_id])
      expect(m.folder_id).to be_nil
    end
  end

  # ── 진행 중 회의 lifecycle 정상화 ──

  describe "진행 중 회의 lifecycle 정상화" do
    it "status='recording' + recording_client_id 세팅된 회의 export→import→복원본 status='completed'·recording_client_id nil·recorder_heartbeat_at nil" do
      meeting.update_columns(
        status:                "recording",
        recording_client_id:   "client-abc-123",
        recorder_heartbeat_at: Time.current,
        paused_at:             nil
      )

      result      = run_import(export_io)
      new_meeting = Meeting.find(result[:meeting_id])

      expect(new_meeting.status).to eq("completed")
      expect(new_meeting.recording_client_id).to be_nil
      expect(new_meeting.recorder_heartbeat_at).to be_nil
    end

    it "status='transcribing' 인 회의도 복원본 status='completed'·recording_client_id nil" do
      meeting.update_columns(status: "transcribing", recording_client_id: "cid-xyz")

      result      = run_import(export_io)
      new_meeting = Meeting.find(result[:meeting_id])

      expect(new_meeting.status).to eq("completed")
      expect(new_meeting.recording_client_id).to be_nil
    end
  end

  # ── 태그 dedup ──

  describe "tag dedupe" do
    # Tag.name 은 전역 unique.
    it "동명 tag 가 미리 존재하면 재사용한다 (tag 수 불변)" do
      io = export_io
      expect(Tag.where(name: "긴급").count).to eq(1)

      result = run_import(io)
      new_meeting = Meeting.find(result[:meeting_id])

      expect(Tag.where(name: "긴급").count).to eq(1)
      expect(new_meeting.tags.pluck(:name)).to contain_exactly("긴급")
    end

    it "manifest 의 신규 tag 는 대상 프로젝트에 생성된다" do
      io = export_io  # tag 포함 상태로 캡처
      # tag 와 tagging 를 미리 삭제 → import 가 신규 생성해야 함
      Tagging.where(tag_id: tag.id).delete_all
      tag.delete

      run_import(io)

      new_tag = Tag.find_by(name: "긴급")
      expect(new_tag).to be_present
      expect(new_tag.project_id).to eq(dst_project.id)
    end
  end

  # ── 오디오 ──

  describe "include_audio" do
    it "include_audio=true 면 오디오 파일을 복사하고 audio_file_path 가 채워진다" do
      Dir.mktmpdir do |dir|
        audio_path = File.join(dir, "src.mp3")
        File.binwrite(audio_path, "FAKEAUDIO-BYTES")
        meeting.update_column(:audio_file_path, audio_path)

        result = run_import(export_io(include_audio: true))
        m = Meeting.find(result[:meeting_id])

        expect(m.audio_file_path).to be_present
        expect(File.file?(m.audio_file_path)).to be(true)
        expect(File.binread(m.audio_file_path)).to eq("FAKEAUDIO-BYTES")
        expect(m.audio_file_path).to include(m.id.to_s)
      ensure
        FileUtils.rm_f(m.audio_file_path) if defined?(m) && m&.audio_file_path
      end
    end

    it "include_audio=false 면 audio_file_path 가 nil 이다" do
      Dir.mktmpdir do |dir|
        audio_path = File.join(dir, "src.mp3")
        File.binwrite(audio_path, "FAKEAUDIO-BYTES")
        meeting.update_column(:audio_file_path, audio_path)

        result = run_import(export_io(include_audio: false))
        m = Meeting.find(result[:meeting_id])
        expect(m.audio_file_path).to be_nil
      end
    end
  end

  # ── 첨부 파일 ──

  describe "첨부 파일" do
    it "첨부를 새 경로로 복사하고 uploaded_by 는 실행자다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "#{meeting.id}_deadbeef_report.pdf")
        File.binwrite(attach_path, "PDFDATA")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                    uploaded_by_id: owner.id)

        result = run_import
        m = Meeting.find(result[:meeting_id])
        att = m.meeting_attachments.find { |a| a.file_path.present? && File.file?(a.file_path) }

        expect(att).to be_present
        expect(att.uploaded_by_id).to eq(importer_user.id)
        expect(File.binread(att.file_path)).to eq("PDFDATA")
      ensure
        m.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) } if defined?(m) && m
      end
    end

    it "contacts source_attachment_id 가 새 첨부 id 로 리맵된다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "#{meeting.id}_card.pdf")
        File.binwrite(attach_path, "CARDDATA")
        att = create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                         uploaded_by_id: owner.id)
        contact.update_column(:source_attachment_id, att.id)

        result = run_import
        m = Meeting.find(result[:meeting_id])
        new_att     = m.meeting_attachments.find { |a| a.file_path.present? && File.file?(a.file_path) }
        new_contact = m.meeting_contacts.first

        expect(new_contact.source_attachment_id).to eq(new_att.id)
      ensure
        m.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) } if defined?(m) && m
      end
    end

    it "kind=file 인데 아카이브에 바이트 없으면 InvalidArchiveError" do
      create(:meeting_attachment, meeting: meeting,
                                  file_path: "/nonexistent/dir/#{meeting.id}_missing.pdf",
                                  kind: "file", uploaded_by_id: owner.id)
      count_before = Meeting.count

      expect {
        run_import
      }.to raise_error(Transfer::Archive::InvalidArchiveError)
      expect(Meeting.count).to eq(count_before)
    end

    it ".extracted 디렉토리도 새 첨부 옆으로 복사된다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "agenda.pdf")
        File.binwrite(attach_path, "PDF")
        ed_src = "#{attach_path}.extracted"
        FileUtils.mkdir_p(File.join(ed_src, "sub"))
        File.write(File.join(ed_src, "x.txt"), "EXTRACTED")
        File.write(File.join(ed_src, "sub", "y.md"), "SUB")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path, uploaded_by_id: owner.id)

        result = run_import
        m = Meeting.find(result[:meeting_id])
        att = m.meeting_attachments.find { |a| a.file_path.present? && File.file?(a.file_path) }
        ed = "#{att.file_path}.extracted"

        expect(File.read(File.join(ed, "x.txt"))).to eq("EXTRACTED")
        expect(File.read(File.join(ed, "sub", "y.md"))).to eq("SUB")
      ensure
        if defined?(m) && m
          m.meeting_attachments.each do |a|
            FileUtils.rm_f(a.file_path)
            FileUtils.rm_rf("#{a.file_path}.extracted")
          end
        end
      end
    end

    it "kind=link 첨부는 파일 없이도 import 성공한다 (롤백 없음)" do
      create(:meeting_attachment, meeting: meeting,
                                  kind: "link", url: "https://example.com/doc",
                                  file_path: nil, content_type: nil, file_size: nil,
                                  original_filename: nil, uploaded_by_id: owner.id)

      result = run_import
      m = Meeting.find(result[:meeting_id])
      link_att = m.meeting_attachments.find { |a| a.kind == "link" }
      expect(link_att).to be_present
      expect(link_att.url).to eq("https://example.com/doc")
    end
  end

  # ── staged Tempfile 수명 (GC 버그 방지) ──

  describe "staged Tempfile 수명 (GC 버그 방지)" do
    it "GC 강제 후에도 staged 파일이 살아있어 첨부 복사가 성공한다" do
      Dir.mktmpdir do |dir|
        attach_path = File.join(dir, "#{meeting.id}_gc_test.pdf")
        File.binwrite(attach_path, "GCDATA")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                    uploaded_by_id: owner.id)

        svc = described_class.new(export_io, user: importer_user, project: dst_project)
        # FileUtils.cp 호출 직전에 GC 강제 → @staged_files 미참조면 Tempfile 이 unlink 됨
        allow(FileUtils).to receive(:cp).and_wrap_original do |orig, *args|
          GC.start
          GC.start
          orig.call(*args)
        end

        result = svc.run!
        m = Meeting.find(result[:meeting_id])
        att = m.meeting_attachments.find { |a| a.file_path.present? && File.file?(a.file_path) }
        expect(att).to be_present
        expect(File.binread(att.file_path)).to eq("GCDATA")
      ensure
        m.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) } if defined?(m) && m
      end
    end
  end

  # ── wrong-scope 가드 ──

  describe "wrong-scope 가드" do
    it "ProjectExporter tgz → MeetingImporter → InvalidArchiveError" do
      project_io = StringIO.new
      ProjectExporter.new(src_project, include_audio: false).write_to(project_io)
      project_io.rewind

      expect {
        described_class.new(project_io, user: importer_user, project: dst_project).run!
      }.to raise_error(Transfer::Archive::InvalidArchiveError)
    end
  end

  # ── path-traversal 가드 ──

  describe "path-traversal 가드" do
    # 악성 엔트리명을 가진 최소 .ddobak-meeting.tgz 를 직접 생성
    def malicious_meeting_io(entry_name)
      io = StringIO.new
      gz  = Zlib::GzipWriter.new(io)
      tar = Gem::Package::TarWriter.new(gz)
      manifest = {
        "format_version" => 1,
        "scope"          => "meeting",
        "meeting"        => meeting.attributes.merge(
          "transcripts" => [], "summaries" => [], "action_items" => [],
          "decisions"   => [], "blocks"    => [], "attachments"  => [],
          "contacts"    => [], "bookmarks" => [],
          "chat_messages" => [], "tag_ids" => [], "glossary_entries" => []
        ),
        "tags" => []
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

    it "엔트리명에 .. 가 있으면 UnsafeEntryError" do
      expect {
        described_class.new(malicious_meeting_io("../escape.txt"),
                            user: importer_user, project: dst_project).run!
      }.to raise_error(Transfer::Archive::UnsafeEntryError)
    end

    it "절대경로 엔트리명을 거부한다" do
      expect {
        described_class.new(malicious_meeting_io("/etc/passwd"),
                            user: importer_user, project: dst_project).run!
      }.to raise_error(Transfer::Archive::UnsafeEntryError)
    end
  end

  # ── 트랜잭션 롤백 ──

  describe "트랜잭션 롤백" do
    it "실패 시 새 Meeting 이 생성되지 않는다" do
      count_before = Meeting.count
      allow_any_instance_of(Transfer::MeetingRestorer).to receive(:restore!).and_raise(
        ActiveRecord::RecordInvalid.new(Meeting.new)
      )

      expect {
        run_import
      }.to raise_error(StandardError)
      expect(Meeting.count).to eq(count_before)
    end
  end

  # ── post-commit 예외 시 파일 보존 (data-loss 회귀) ──

  describe "post-commit 예외 시 파일 보존" do
    it "EmbedBackfillJob 이 raise 해도 커밋된 회의와 복사 파일이 살아있다" do
      Dir.mktmpdir do |dir|
        audio_path = File.join(dir, "session.mp3")
        File.binwrite(audio_path, "AUDIO-BYTES")
        meeting.update_column(:audio_file_path, audio_path)

        attach_path = File.join(dir, "#{meeting.id}_doc.pdf")
        File.binwrite(attach_path, "PDF-BYTES")
        create(:meeting_attachment, meeting: meeting, file_path: attach_path,
                                    uploaded_by_id: owner.id)

        # post-commit 단계에서 raise 를 강제 → 수정 전이라면 copied_paths 삭제됨
        allow(EmbedBackfillJob).to receive(:perform_later).and_raise(StandardError, "job queue down")

        count_before = Meeting.count

        expect {
          run_import(export_io(include_audio: true))
        }.to raise_error(StandardError, "job queue down")

        # (1) 트랜잭션이 커밋됐으므로 새 Meeting 레코드가 DB 에 존재한다
        expect(Meeting.count).to eq(count_before + 1)

        new_meeting = Meeting.order(:id).last

        # (2) 복사된 오디오 파일이 디스크에 여전히 존재한다
        expect(new_meeting.audio_file_path).to be_present
        expect(File.file?(new_meeting.audio_file_path)).to be(true), \
          "audio file was deleted after post-commit exception (data-loss bug)"

        # (3) 복사된 첨부 파일이 디스크에 여전히 존재한다
        att = new_meeting.meeting_attachments.find { |a| a.file_path.present? }
        expect(att).to be_present
        expect(File.file?(att.file_path)).to be(true), \
          "attachment file was deleted after post-commit exception (data-loss bug)"
      ensure
        if defined?(new_meeting) && new_meeting
          FileUtils.rm_f(new_meeting.audio_file_path)
          new_meeting.meeting_attachments.each { |a| FileUtils.rm_f(a.file_path) }
        end
      end
    end
  end

  # ── 전사 배치 복원 (insert_all 회귀 가드) ──

  describe "전사 배치 복원" do
    # 여러 전사가 필드·정렬 그대로 라운드트립되는지 검증한다.
    # 시퀀스 역순으로 생성하고, 필드값을 서로 다르게 두어 행-필드 매핑 오류를 잡는다.
    let!(:multi_meeting) do
      create(:meeting, project: src_project, creator: owner, title: "전사 다건 회의")
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

    def import_multi
      io = StringIO.new
      MeetingExporter.new(multi_meeting, include_audio: false).write_to(io)
      io.rewind
      described_class.new(io, user: importer_user, project: dst_project, folder: dst_folder).run!
    end

    it "모든 전사를 개수·필드·정렬(sequence_number) 그대로 복원한다" do
      result      = import_multi
      new_meeting = Meeting.find(result[:meeting_id])
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
      result      = import_multi
      new_meeting = Meeting.find(result[:meeting_id])

      conn       = ActiveRecord::Base.connection
      rows       = conn.execute("SELECT source_id FROM transcripts_fts WHERE transcripts_fts MATCH '유니크토큰'")
      source_ids = rows.map { |r| r.is_a?(Hash) ? r["source_id"] : r.first }
      target     = new_meeting.transcripts.find { |t| t.content.include?("유니크토큰") }

      expect(source_ids).to include(target.id)
    end

    # 실제 버그(35k 전사 = 건당 create! → ~117s) 회귀 가드.
    # 단일 insert_all 은 SQLite 변수 상한(32766)을 넘겨 3000+ 행에서 실패하므로
    # 배치 분할이 필수다. MeetingRestorer 를 직접 구동해 3100 전사를 복원하고,
    # (a) 전량 복원 + 정렬 보존, (b) 건당 insert 가 아닌 소수 배치 쿼리임을 단언한다.
    it "3100 전사를 전량 복원하며 건당 insert 가 아닌 배치로 처리한다" do
      base         = create(:meeting, project: src_project, creator: owner, title: "대량 전사")
      meeting_hash = base.attributes.merge(
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

      restorer = Transfer::MeetingRestorer.new(
        meeting_hash,
        user:                importer_user,
        project:             dst_project,
        file_lookup:         {},
        folder_id:           nil,
        previous_meeting_id: nil,
        tag_resolver:        ->(_old_id) { nil }
      )

      transcript_inserts = 0
      counter = lambda do |*args|
        sql = args.last[:sql].to_s
        if sql.start_with?("INSERT INTO") && sql.include?("transcripts") && !sql.include?("transcripts_fts")
          transcript_inserts += 1
        end
      end

      new_meeting = nil
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record") do
        new_meeting = restorer.restore!
      end

      expect(new_meeting.transcripts.count).to eq(3100)
      expect(new_meeting.transcripts.pluck(:sequence_number)).to eq((1..3100).to_a)
      # 건당 insert(3100회) 가 아니라 배치(수십 회 이하) 여야 한다.
      expect(transcript_inserts).to be < 100
    end
  end
end
