require "rails_helper"

# Task 4: 전역 자동 파일(auto_kind=stt_auto, auto_owner_type=nil, project_id=nil)은
# 링크 없이 모든 회의의 실효 세트 맨 끝(project 뒤)에 source "global" 로 붙는다.
RSpec.describe Meeting, "#effective_domain_files 전역 자동 파일" do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }

  def create_global_auto(content: "- **후판** [STT] (오인식: 우판): ")
    create(:domain_file, creator: user, project: nil, name: "STT 오인식(자동) · 전역",
           auto_kind: "stt_auto", auto_owner_type: nil, auto_owner_id: nil, content: content)
  end

  it "전역 자동 파일은 링크 없이 모든 회의 실효 세트 맨 끝(source global)" do
    folder = create(:folder, project: project)
    meeting = create(:meeting, project: project, folder: folder, creator: user)
    other_meeting = create(:meeting, project: create(:project, creator: user), creator: user)

    meeting_file = create(:domain_file, creator: user, name: "M")
    folder_file = create(:domain_file, creator: user, name: "F")
    project_file = create(:domain_file, creator: user, name: "P")
    DomainFileLink.create!(owner: meeting, domain_file: meeting_file)
    DomainFileLink.create!(owner: folder, domain_file: folder_file)
    DomainFileLink.create!(owner: project, domain_file: project_file)
    global = create_global_auto

    result = meeting.effective_domain_files
    expect(result.map { |e| e[:file].id }).to eq([ meeting_file.id, folder_file.id, project_file.id, global.id ])
    expect(result.last).to eq({ file: global, source: "global", owner: nil })

    expect(other_meeting.effective_domain_files).to eq([ { file: global, source: "global", owner: nil } ])
  end

  it "회의가 exclude 하면 빠진다" do
    meeting = create(:meeting, project: project, creator: user)
    global = create_global_auto
    DomainFileLink.create!(owner: meeting, domain_file: global, exclude: true)

    expect(meeting.effective_domain_files).to be_empty
  end

  it "이미 다른 레벨에서 링크된 전역 자동 파일은 그 레벨 소스로 한 번만 남는다" do
    meeting = create(:meeting, project: project, creator: user)
    global = create_global_auto
    DomainFileLink.create!(owner: meeting, domain_file: global)

    expect(meeting.effective_domain_files).to eq([ { file: global, source: "meeting", owner: nil } ])
  end

  it "프로젝트 삭제로 nullify 된 프로젝트 자동 파일(auto_owner_type=Project)은 전역으로 붙지 않는다" do
    meeting = create(:meeting, project: project, creator: user)
    create(:domain_file, creator: user, project: nil, name: "STT 오인식(자동) · 삭제된 P",
           auto_kind: "stt_auto", auto_owner_type: "Project", auto_owner_id: 999_999,
           content: "- **후판** (오인식: 우판): ")

    expect(meeting.effective_domain_files).to be_empty
  end

  it "폴더·프로젝트가 모두 없는 회의도 크래시 없이 전역 자동 파일만 반환한다" do
    meeting = build(:meeting, project: nil, folder: nil, creator: user) # project_id 는 DB NOT NULL — 메모리상 nil 레벨로 nil 가드만 검증
    global = create_global_auto

    expect(meeting.effective_domain_files).to eq([ { file: global, source: "global", owner: nil } ])
  end
end
