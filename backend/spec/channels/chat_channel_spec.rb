require "rails_helper"

RSpec.describe ChatChannel, type: :channel do
  let(:owner) { create(:user) }
  let(:meeting) { create(:meeting, creator: owner) }

  before { stub_connection(current_user: owner) }

  it "subscribes to own meeting chat stream" do
    subscribe(meeting_id: meeting.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("meeting_#{meeting.id}_chat_#{owner.id}")
  end

  it "allows a project member with shared visibility to subscribe" do
    reader = create(:user)
    create(:project_membership, user: reader, project: meeting.project)
    stub_connection(current_user: reader)

    subscribe(meeting_id: meeting.id) # 팩토리 기본 shared: true → shared_visible?
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("meeting_#{meeting.id}_chat_#{reader.id}")
  end

  it "rejects a non-member even for a shared meeting" do
    # 공유(shared: true) 회의라도 프로젝트 비멤버는 거부 — REST 읽기 인가·transcription_channel 과 정합.
    non_member = create(:user)
    stub_connection(current_user: non_member)

    subscribe(meeting_id: meeting.id)
    expect(subscription).to be_rejected
  end

  it "allows an admin to subscribe regardless of membership" do
    admin = create(:user, :admin)
    stub_connection(current_user: admin)

    subscribe(meeting_id: meeting.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("meeting_#{meeting.id}_chat_#{admin.id}")
  end

  it "rejects when no meeting read access" do
    # :private_meeting (shared: false) so a stranger genuinely lacks read access.
    private_meeting = create(:meeting, creator: owner, shared: false)
    stranger = create(:user)
    stub_connection(current_user: stranger)

    subscribe(meeting_id: private_meeting.id)
    expect(subscription).to be_rejected
  end
end
