require "rails_helper"

RSpec.describe "Stale recording reaper (requests)", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before do
    RecordingLock.reset!
    login_as(user)
  end

  it "GET show 시 stale recording 자동 종결" do
    m = create(:meeting, project: project, creator: user, status: "recording",
               started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    get "/api/v1/meetings/#{m.id}"
    expect(m.reload.status).to eq("completed")
  end

  it "GET index 시 stale recording 자동 종결, 활성은 보존" do
    stale  = create(:meeting, project: project, creator: user, status: "recording",
                    started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    active = create(:meeting, project: project, creator: user, status: "recording",
                    started_at: 1.minute.ago, recorder_heartbeat_at: 2.seconds.ago)
    get "/api/v1/meetings"
    expect(stale.reload.status).to eq("completed")
    expect(active.reload.status).to eq("recording")
  end

  it "GET index 는 admin 이 조회하면 다른 유저가 만든 (보이는) stale recording 도 종결한다 (#213 회귀 가드)" do
    # #213: 타신분(다른 created_by)으로 만든 stuck recording 이 본인-소유분 한정 청소에서 빠져
    # 영구 '녹음중' 잔존했음. admin 의 accessible_by 는 전체(kept)라 이 회의가 목록에 보이므로,
    # '보이는 것 기준' 청소로 바뀐 지금은 누가 만들었든 healed 되어야 한다.
    admin = create(:user, :admin)
    login_as(admin) # before 블록의 login_as(user) 위에 재스텁
    other = create(:user)
    theirs = create(:meeting, project: project, creator: other, status: "recording",
                    started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    # 전제: admin 에게 이 회의가 접근(보이는) 가능하다.
    expect(Meeting.accessible_by(admin)).to include(theirs)

    get "/api/v1/meetings"
    expect(theirs.reload.status).to eq("completed")
  end

  it "GET index 는 접근 불가(비공유·비멤버) 타유저 stale recording 은 종결하지 않는다 (스코프 밖)" do
    # 비admin 사용자에겐 멤버십 없는 프로젝트의 회의가 목록에 안 보인다 → 청소 대상도 아님.
    other = create(:user)
    other_project = create(:project, creator: other)
    theirs = create(:meeting, project: other_project, creator: other, status: "recording",
                    started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    # 전제: 현재(비admin) 유저의 접근 스코프 밖이다(그래서 보이지도, 청소되지도 않아야 한다).
    expect(Meeting.accessible_by(user)).not_to include(theirs)

    get "/api/v1/meetings"
    expect(theirs.reload.status).to eq("recording")
  end

  it "POST start 가 recording_client_id/platform/heartbeat 도장" do
    m = create(:meeting, project: project, creator: user, status: "pending")
    post "/api/v1/meetings/#{m.id}/start",
         headers: { "X-Client-Id" => "dev-uuid-1", "X-Client-Platform" => "desktop" }
    m.reload
    expect(m.status).to eq("recording")
    expect(m.recording_client_id).to eq("dev-uuid-1")
    expect(m.recording_client_platform).to eq("desktop")
    expect(m.recorder_heartbeat_at).to be_present
  end

  it "POST reopen 후 show 가 방금 reopen 한 회의를 다시 종결하지 않는다" do
    # reopen 은 completed→recording 으로 되돌린다. 이때 하트비트를 stamp 하지 않으면
    # 옛(완료 시점) 하트비트로 다음 show/index 가 stale 판정해 즉시 재종결된다(회귀).
    m = create(:meeting, project: project, creator: user, status: "completed",
               ended_at: 1.hour.ago, recorder_heartbeat_at: 1.hour.ago)
    post "/api/v1/meetings/#{m.id}/reopen"
    expect(m.reload.status).to eq("recording")

    get "/api/v1/meetings/#{m.id}"
    expect(m.reload.status).to eq("recording")
  end
end
