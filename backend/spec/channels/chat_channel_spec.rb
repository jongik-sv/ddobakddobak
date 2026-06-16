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

  it "allows an active participant to subscribe" do
    participant = create(:user)
    create(:meeting_participant, meeting: meeting, user: participant, role: "viewer", joined_at: Time.current)
    stub_connection(current_user: participant)

    subscribe(meeting_id: meeting.id)
    expect(subscription).to be_confirmed
    expect(subscription).to have_stream_from("meeting_#{meeting.id}_chat_#{participant.id}")
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
