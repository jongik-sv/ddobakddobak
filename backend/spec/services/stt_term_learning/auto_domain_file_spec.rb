require "rails_helper"

RSpec.describe SttTermLearning::AutoDomainFile do
  let(:project) { create(:project, name: "프로젝트A") }
  let(:fallback) { create(:user) }
  let(:level_for) { ->(o) { SttTermLearning::Level.for(o) } }

  it "폴더 레벨 자동 파일 생성 + 폴더에 링크, 두 번째 호출은 같은 파일" do
    folder = create(:folder, project: project, name: "하위")
    f = described_class.find_or_create_for!(level_for.(folder), fallback_creator: fallback)
    expect(f).to be_stt_auto
    expect(f.name).to eq("STT 오인식(자동) · 하위 [F#{folder.id}]")
    expect(f.project_id).to eq(project.id)
    expect(f.auto_owner_type).to eq("Folder")
    expect(folder.domain_files).to include(f)
    expect(described_class.find_or_create_for!(level_for.(folder), fallback_creator: fallback)).to eq(f)
    expect(described_class.find_for(level_for.(folder))).to eq(f)
  end

  it "조상→자신 경로" do
    p = create(:folder, project: project, name: "상위")
    c = create(:folder, project: project, name: "하위", parent: p)
    f = described_class.find_or_create_for!(level_for.(c), fallback_creator: fallback)
    expect(f.name).to eq("STT 오인식(자동) · 상위/하위 [F#{c.id}]")
  end

  it "프로젝트 레벨" do
    f = described_class.find_or_create_for!(level_for.(project), fallback_creator: fallback)
    expect(f.name).to eq("STT 오인식(자동) · 프로젝트A")
    expect(f.project_id).to eq(project.id)
    expect(project.domain_files).to include(f)
  end

  it "사람이 링크를 지웠으면 다시 링크" do
    f = described_class.find_or_create_for!(level_for.(project), fallback_creator: fallback)
    DomainFileLink.where(domain_file: f).destroy_all
    described_class.find_or_create_for!(level_for.(project), fallback_creator: fallback)
    expect(project.reload.domain_files).to include(f)
  end

  it "같은 이름 폴더 두 개도 [F id] 로 이름 충돌 없음" do
    a = create(:folder, project: project, name: "같음")
    b = create(:folder, project: project, name: "같음")
    fa = described_class.find_or_create_for!(level_for.(a), fallback_creator: fallback)
    fb = described_class.find_or_create_for!(level_for.(b), fallback_creator: fallback)
    expect(fa).not_to eq(fb)
  end

  it "아주 긴 경로도 100자 이하, [F id] 보존" do
    p = create(:folder, project: project, name: "가" * 100)
    c = create(:folder, project: project, name: "나" * 100, parent: p)
    f = described_class.find_or_create_for!(level_for.(c), fallback_creator: fallback)
    expect(f.name.length).to be <= 100
    expect(f.name).to end_with(" [F#{c.id}]")
    expect(f.name).to start_with("STT 오인식(자동) · ")
  end

  it "전역 자동 파일은 링크 없이 project_id nil" do
    f = described_class.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: fallback)
    expect(f.name).to eq("STT 오인식(자동)")
    expect(f.project_id).to be_nil
    expect(f.auto_owner_type).to be_nil
    expect(DomainFileLink.where(domain_file: f)).to be_empty
    expect(described_class.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: fallback)).to eq(f)
    expect(described_class.find_for(SttTermLearning::Level.global)).to eq(f)
  end

  it "creator 는 첫 admin, admin 이 없으면 fallback_creator" do
    f1 = described_class.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: fallback)
    expect(f1.creator).to eq(fallback)
    admin = create(:user, :admin)
    f2 = described_class.find_or_create_for!(level_for.(project), fallback_creator: fallback)
    expect(f2.creator).to eq(admin)
  end

  it "RecordNotUnique 면 재조회" do
    existing = described_class.find_or_create_for!(level_for.(project), fallback_creator: fallback)
    existing.update_column(:name, "other")
    calls = 0
    allow(described_class).to receive(:find_for).and_wrap_original do |m, *a|
      calls += 1
      calls == 1 ? nil : m.call(*a)
    end
    expect(described_class.find_or_create_for!(level_for.(project), fallback_creator: fallback)).to eq(existing)
  end
end
