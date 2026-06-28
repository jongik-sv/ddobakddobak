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
                     share_code: "ABC123", locked_at: Time.current)
  end

  let!(:transcript)   { create(:transcript, meeting: meeting, content: "안녕하세요 회의 시작합니다 검색어포함") }
  let!(:summary)      { create(:summary, meeting: meeting) }
  let!(:action_item)  { create(:action_item, meeting: meeting) }
  let!(:decision)     { create(:decision, meeting: meeting) }
  let!(:parent_block) { create(:block, meeting: meeting, parent_block_id: nil) }
  let!(:child_block)  { create(:block, meeting: meeting, parent_block_id: parent_block.id) }
  let!(:contact)      { create(:meeting_contact, meeting: meeting) }
  let!(:bookmark)     { create(:meeting_bookmark, meeting: meeting) }
  let!(:participant)  { create(:meeting_participant, meeting: meeting, user: owner) }
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

    it "share_code 는 nil 로 초기화한다" do
      expect(new_meeting.share_code).to be_nil
    end

    it "previous_meeting_id 는 nil 이다" do
      expect(new_meeting.previous_meeting_id).to be_nil
    end

    it "locked_at 은 nil 이다 (잠금 해제)" do
      expect(new_meeting.locked_at).to be_nil
    end

    it "자식 레코드 카운트가 일치한다" do
      expect(new_meeting.transcripts.count).to eq(1)
      expect(new_meeting.summaries.count).to eq(1)
      expect(new_meeting.action_items.count).to eq(1)
      expect(new_meeting.decisions.count).to eq(1)
      expect(new_meeting.blocks.count).to eq(2)
      expect(new_meeting.meeting_contacts.count).to eq(1)
      expect(new_meeting.meeting_bookmarks.count).to eq(1)
      expect(new_meeting.meeting_participants.count).to eq(1)
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

    it "소유권: participant user_id 는 실행자다" do
      expect(new_meeting.meeting_participants.first.user_id).to eq(importer_user.id)
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

  # ── 다참석자 (활성 1 cap) ──

  describe "다참석자 회의 (활성 1 cap)" do
    let!(:other_user) { create(:user, name: "두번째참석자") }

    before do
      participant.update_columns(role: "host", left_at: nil)
      create(:meeting_participant, meeting: meeting, user: other_user, role: "viewer", left_at: nil)
    end

    it "활성 2명 회의도 import 성공한다" do
      expect { run_import }.not_to raise_error
    end

    it "새 meeting 의 활성 참석자(left_at nil)는 정확히 1건이다" do
      m = Meeting.find(run_import[:meeting_id])
      expect(m.meeting_participants.where(left_at: nil).count).to eq(1)
      expect(m.meeting_participants.where(left_at: nil).first.user_id).to eq(importer_user.id)
    end

    it "모든 참석자 ROW 는 보존된다 (2건)" do
      m = Meeting.find(run_import[:meeting_id])
      expect(m.meeting_participants.count).to eq(2)
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
          "contacts"    => [], "bookmarks" => [], "participants" => [],
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
end
