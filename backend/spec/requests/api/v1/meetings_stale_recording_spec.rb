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

  it "GET index 는 다른 유저가 만든 stale recording 은 종결하지 않는다(blast 한정)" do
    # 같은 (접근 가능한) 프로젝트의 다른 유저 회의여도, index lazy heal 은 본인 소유분만 종결한다.
    other = create(:user)
    theirs = create(:meeting, project: project, creator: other, status: "recording",
                    started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    # 전제 확인: 이 회의는 현재 유저의 접근 스코프 안에 있다(그래서 단순 accessible_by heal 이면 종결됐을 것).
    expect(Meeting.accessible_by(user)).to include(theirs)

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
