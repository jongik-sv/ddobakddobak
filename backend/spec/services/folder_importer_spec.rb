require "rails_helper"
require "stringio"

# 라운드트립: FolderExporter 로 폴더 서브트리(A>B, 회의1@A·회의2@B prev=회의1)를
# tar.gz(StringIO) 로 내보낸 뒤 FolderImporter 로 가져와 복원 결과를 검증한다.
RSpec.describe FolderImporter do
  before(:all) { Transcript.ensure_fts_tables! }

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
