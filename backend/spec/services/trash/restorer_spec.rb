require "rails_helper"

RSpec.describe Trash::Restorer do
  let(:user) { User.create!(email: "u@e.com", password: "password123", name: "U") }
  let(:project) { Project.create!(name: "P", creator: user) }

  it "restores all rows in the group" do
    folder = Folder.create!(name: "F", project: project)
    meeting = Meeting.create!(title: "M", project: project, folder: folder, creator: user)
    group = Trash::SoftDeleter.call(folder, by: user)
    Trash::Restorer.call(group)
    [folder, meeting].each(&:reload)
    expect(folder.trashed?).to be false
    expect(meeting.trashed?).to be false
  end

  it "detaches a restored meeting whose folder is still trashed" do
    folder = Folder.create!(name: "F", project: project)
    meeting = Meeting.create!(title: "M", project: project, folder: folder, creator: user)
    folder.soft_delete!(by: user, group: "other", root: true)
    mgroup = Trash::SoftDeleter.call(meeting, by: user)
    Trash::Restorer.call(mgroup)
    meeting.reload
    expect(meeting.trashed?).to be false
    expect(meeting.folder_id).to be_nil
  end
end
