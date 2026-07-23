require "rails_helper"
require "stringio"

RSpec.describe SummaryZipExporter do
  # zip 스트림을 되읽어 { 엔트리경로 => 내용 } 맵으로 반환
  def read_zip(io)
    io.rewind
    entries = {}
    Zip::File.open_buffer(io.read) do |zip|
      zip.each do |entry|
        # rubyzip 3.4 는 entry.name 을 ASCII-8BIT 로 반환 — UTF-8 강제
        entries[entry.name.dup.force_encoding("UTF-8")] = entry.get_input_stream.read.force_encoding("UTF-8")
      end
    end
    entries
  end

  def export_entries(exporter)
    io = StringIO.new
    exporter.write_to(io)
    read_zip(io)
  end

  # completed 회의 + final summary 를 붙여 active_summary 를 보장하는 헬퍼
  def add_summary!(meeting, body)
    meeting.update_column(:status, "completed")
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: body)
  end

  let!(:owner)   { create(:user) }
  let!(:project) { create(:project, creator: owner, name: "기획팀") }
  let!(:root)    { create(:folder, project: project, name: "주간 회의") }
  let!(:child)   { create(:folder, project: project, name: "7월", parent_id: root.id) }

  describe "생성자" do
    it "folder·project 를 동시에 주거나 둘 다 없으면 ArgumentError" do
      expect { described_class.new }.to raise_error(ArgumentError)
      expect { described_class.new(folder: root, project: project) }.to raise_error(ArgumentError)
    end
  end

  describe "폴더 스코프" do
    it "서브트리 폴더 구조를 zip 내부 경로로 재현한다 (한글 보존)" do
      m1 = create(:meeting, project: project, creator: owner, folder: root,  title: "킥오프")
      m2 = create(:meeting, project: project, creator: owner, folder: child, title: "중간점검")
      add_summary!(m1, "## 회의록\n킥오프 내용")
      add_summary!(m2, "## 회의록\n점검 내용")

      entries = export_entries(described_class.new(folder: root))
      date1 = (m1.started_at || m1.created_at).to_date.iso8601
      date2 = (m2.started_at || m2.created_at).to_date.iso8601

      expect(entries.keys).to contain_exactly(
        "킥오프_#{date1}.md",
        "7월/중간점검_#{date2}.md"
      )
      expect(entries["킥오프_#{date1}.md"]).to include("킥오프 내용")
    end

    it "active_summary 없는 회의는 파일을 만들지 않는다" do
      create(:meeting, project: project, creator: owner, folder: root, title: "요약없음")
      with = create(:meeting, project: project, creator: owner, folder: root, title: "요약있음")
      add_summary!(with, "내용")

      entries = export_entries(described_class.new(folder: root))
      expect(entries.keys.join).not_to include("요약없음")
      expect(entries.size).to eq(1)
    end

    it "같은 디렉토리 내 동명 회의는 -2 suffix 를 붙인다" do
      m1 = create(:meeting, project: project, creator: owner, folder: root, title: "정기회의")
      m2 = create(:meeting, project: project, creator: owner, folder: root, title: "정기회의")
      add_summary!(m1, "1차")
      add_summary!(m2, "2차")
      # 같은 날짜로 고정해 파일명 충돌 유도
      m2.update_column(:created_at, m1.created_at)
      m2.update_column(:started_at, m1.started_at)

      entries = export_entries(described_class.new(folder: root))
      date = (m1.started_at || m1.created_at).to_date.iso8601
      expect(entries.keys).to contain_exactly(
        "정기회의_#{date}.md",
        "정기회의_#{date}-2.md"
      )
    end

    it "파일시스템 금지 문자만 제거하고 공백·한글은 보존한다" do
      m = create(:meeting, project: project, creator: owner, folder: root, title: 'Q3: 매출/전략 "검토"')
      add_summary!(m, "내용")

      entries = export_entries(described_class.new(folder: root))
      date = (m.started_at || m.created_at).to_date.iso8601
      expect(entries.keys).to contain_exactly("Q3 매출전략 검토_#{date}.md")
    end

    it "휴지통 회의·휴지통 폴더 하위는 제외한다" do
      kept_m    = create(:meeting, project: project, creator: owner, folder: root, title: "정상")
      trashed_m = create(:meeting, project: project, creator: owner, folder: root, title: "버림", deleted_at: Time.current)
      trashed_f = create(:folder, project: project, name: "버린폴더", parent_id: root.id, deleted_at: Time.current)
      in_trashed = create(:meeting, project: project, creator: owner, folder: trashed_f, title: "버린폴더속")
      add_summary!(kept_m, "a")
      add_summary!(trashed_m, "b")
      add_summary!(in_trashed, "c")

      entries = export_entries(described_class.new(folder: root))
      expect(entries.size).to eq(1)
      expect(entries.keys.first).to start_with("정상_")
    end

    it "스코프 루트 자체가 휴지통이면 kept 자식이 있어도 빈 결과다 (T3 리뷰 E2E)" do
      trashed_root = create(:folder, project: project, name: "버린루트", deleted_at: Time.current)
      kept_child   = create(:folder, project: project, name: "버린루트속유지폴더", parent_id: trashed_root.id)
      m1 = create(:meeting, project: project, creator: owner, folder: trashed_root, title: "루트직속")
      m2 = create(:meeting, project: project, creator: owner, folder: kept_child,   title: "자식속")
      add_summary!(m1, "a")
      add_summary!(m2, "b")

      exporter = described_class.new(folder: trashed_root)
      expect(exporter.empty?).to be(true)
      expect(export_entries(exporter)).to be_empty
    end

    it "kept 루트 폴더의 부모가 휴지통이면 빈 결과다 (픽스2 재리뷰 E2E: 조상 체인 가드)" do
      trashed_parent = create(:folder, project: project, name: "버린부모", deleted_at: Time.current)
      kept_root = create(:folder, project: project, name: "유지루트", parent_id: trashed_parent.id)
      m = create(:meeting, project: project, creator: owner, folder: kept_root, title: "회의")
      add_summary!(m, "내용")

      exporter = described_class.new(folder: kept_root)
      expect(exporter.empty?).to be(true)
      expect(export_entries(exporter)).to be_empty
    end

    it "kept 루트 폴더의 소유 project 가 휴지통이면 빈 결과다 (픽스2 재리뷰 E2E: 소유 프로젝트 가드)" do
      trashed_project = create(:project, creator: owner, name: "버린프로젝트", deleted_at: Time.current)
      kept_root = create(:folder, project: trashed_project, name: "유지루트")
      m = create(:meeting, project: trashed_project, creator: owner, folder: kept_root, title: "회의")
      add_summary!(m, "내용")

      exporter = described_class.new(folder: kept_root)
      expect(exporter.empty?).to be(true)
      expect(export_entries(exporter)).to be_empty
    end

    it "폴더 사이클이 있어도 무한루프 없이 종료한다" do
      # root→child(기존)에 root.parent_id=child 를 더해 진짜 순환을 만든다 —
      # walk 가 child.children 에서 root 를 다시 만나 seen 가드가 실제 발동된다.
      # (child 자기참조로는 walk 경로가 사이클을 지나지 않아 가드 검증이 안 됨.)
      root.update_column(:parent_id, child.id)
      m = create(:meeting, project: project, creator: owner, folder: root, title: "회의")
      add_summary!(m, "a")
      expect { export_entries(described_class.new(folder: root)) }.not_to raise_error
    end
  end

  describe "프로젝트 스코프" do
    it "folder_id nil 루트 회의를 zip 루트에, 폴더 회의를 폴더 경로에 넣는다" do
      root_m   = create(:meeting, project: project, creator: owner, folder: nil,   title: "루트회의")
      nested_m = create(:meeting, project: project, creator: owner, folder: child, title: "중첩회의")
      add_summary!(root_m, "루트")
      add_summary!(nested_m, "중첩")

      entries = export_entries(described_class.new(project: project))
      d1 = (root_m.started_at || root_m.created_at).to_date.iso8601
      d2 = (nested_m.started_at || nested_m.created_at).to_date.iso8601
      expect(entries.keys).to contain_exactly(
        "루트회의_#{d1}.md",
        "주간 회의/7월/중첩회의_#{d2}.md"
      )
    end

    it "휴지통 폴더 하위의 kept 회의는 제외한다" do
      trashed_f = create(:folder, project: project, name: "버린폴더", deleted_at: Time.current)
      in_trashed = create(:meeting, project: project, creator: owner, folder: trashed_f, title: "버린폴더속")
      ok = create(:meeting, project: project, creator: owner, folder: nil, title: "정상루트")
      add_summary!(in_trashed, "a")
      add_summary!(ok, "b")

      entries = export_entries(described_class.new(project: project))
      expect(entries.size).to eq(1)
      expect(entries.keys.first).to start_with("정상루트_")
    end

    it "프로젝트 자체가 휴지통이면 kept 회의가 있어도 빈 결과다 (T3 리뷰 E2E)" do
      m = create(:meeting, project: project, creator: owner, folder: nil, title: "정상루트")
      add_summary!(m, "a")
      project.update_column(:deleted_at, Time.current)

      exporter = described_class.new(project: project)
      expect(exporter.empty?).to be(true)
      expect(export_entries(exporter)).to be_empty
    end
  end

  describe "#empty?" do
    it "요약 있는 회의가 하나도 없으면 true" do
      create(:meeting, project: project, creator: owner, folder: root, title: "요약없음")
      expect(described_class.new(folder: root).empty?).to be(true)
      expect(described_class.new(project: project).empty?).to be(true)
    end
  end

  describe "#filename" do
    it "한글 이름은 parameterize 로 비면 폴백 slug 를 쓴다" do
      today = Date.current.strftime("%Y%m%d")
      expect(described_class.new(folder: root).filename).to eq("folder-summaries-#{today}.zip")
      expect(described_class.new(project: project).filename).to eq("project-summaries-#{today}.zip")
    end

    it "ASCII 이름은 slug 를 쓴다" do
      f = create(:folder, project: project, name: "Weekly Sync")
      today = Date.current.strftime("%Y%m%d")
      expect(described_class.new(folder: f).filename).to eq("weekly-sync-summaries-#{today}.zip")
    end
  end
end
