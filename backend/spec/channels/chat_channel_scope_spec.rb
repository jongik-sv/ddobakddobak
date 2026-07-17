require "rails_helper"

RSpec.describe ChatChannel, type: :channel do
  let(:project) { create(:project) }
  let(:owner) { project.creator }
  let(:folder) { create(:folder, project: project) }

  # 컨트롤러(authorize_scope!)와 동일하게 채널도 project.member? 로 인가한다.
  # creator 라고 자동 멤버가 되지 않으므로, "멤버" 케이스는 명시적 멤버십을 만든다.
  before { create(:project_membership, project: project, user: owner, role: "admin") }

  it "멤버는 폴더 scope 스트림을 구독한다" do
    stub_connection current_user: owner
    subscribe(scope_type: "folder", scope_id: folder.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("chat_folder_#{folder.id}_#{owner.id}")
  end

  it "비멤버는 폴더 scope 구독을 거부당한다" do
    stub_connection current_user: create(:user)
    subscribe(scope_type: "folder", scope_id: folder.id)
    expect(subscription).to be_rejected
  end

  it "기존 meeting_id 구독은 그대로 동작한다(무회귀)" do
    meeting = create(:meeting, creator: owner)
    stub_connection current_user: owner
    subscribe(meeting_id: meeting.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("meeting_#{meeting.id}_chat_#{owner.id}")
  end

  it "admin도 남의 개인 프로젝트 scope 구독은 거부당한다" do
    other = create(:user)
    other_personal = other.projects.find_by(personal: true)
    stub_connection current_user: create(:user, :admin)
    subscribe(scope_type: "project", scope_id: other_personal.id)
    expect(subscription).to be_rejected
  end

  it "admin은 남의 팀 프로젝트 scope는 구독할 수 있다" do
    stub_connection current_user: create(:user, :admin)
    subscribe(scope_type: "project", scope_id: project.id)
    expect(subscription).to be_confirmed
  end
end
