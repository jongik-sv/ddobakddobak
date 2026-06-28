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

      expect {
        described_class.new(meeting_io, user: importer_user, project: dst_project).run!
      }.to raise_error(Transfer::Archive::InvalidArchiveError)
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
  end
end
