require "rails_helper"

RSpec.describe Trashable do
  let(:user) { User.create!(email: "t@e.com", password: "password123", name: "T") }
  let(:project) { Project.create!(name: "P", creator: user) }
  let(:meeting) { Meeting.create!(title: "M", project: project, creator: user) }

  it "starts kept" do
    expect(meeting.trashed?).to be false
    expect(Meeting.kept).to include(meeting)
    expect(Meeting.trashed).not_to include(meeting)
  end

  it "soft_delete! sets fields and moves to trashed scope" do
    meeting.soft_delete!(by: user, group: "grp-1", root: true)
    expect(meeting.trashed?).to be true
    expect(meeting.deleted_by_id).to eq(user.id)
    expect(meeting.trash_group_id).to eq("grp-1")
    expect(meeting.trashed_as_root).to be true
    expect(Meeting.kept).not_to include(meeting)
    expect(Meeting.trashed).to include(meeting)
  end

  it "restore! clears fields" do
    meeting.soft_delete!(by: user, group: "grp-1", root: true)
    meeting.restore!
    expect(meeting.trashed?).to be false
    expect(meeting.deleted_at).to be_nil
    expect(meeting.trash_group_id).to be_nil
    expect(meeting.trashed_as_root).to be false
    expect(Meeting.kept).to include(meeting)
  end
end
