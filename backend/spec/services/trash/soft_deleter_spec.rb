require "rails_helper"

RSpec.describe Trash::SoftDeleter do
  let(:user) { User.create!(email: "u@e.com", password: "password123", name: "U") }
  let(:project) { Project.create!(name: "P", creator: user) }

  it "trashes a single meeting as root" do
    meeting = Meeting.create!(title: "M", project: project, creator: user)
    described_class.call(meeting, by: user)
    meeting.reload
    expect(meeting.trashed?).to be true
    expect(meeting.trashed_as_root).to be true
    expect(meeting.trash_group_id).to be_present
  end

  it "cascades folder: subfolders + kept meetings share group, only folder is root" do
    folder = Folder.create!(name: "F", project: project)
    child  = Folder.create!(name: "C", project: project, parent: folder)
    m1 = Meeting.create!(title: "M1", project: project, folder: folder, creator: user)
    m2 = Meeting.create!(title: "M2", project: project, folder: child, creator: user)
    described_class.call(folder, by: user)
    [folder, child, m1, m2].each(&:reload)
    group = folder.trash_group_id
    expect([child, m1, m2].map(&:trash_group_id)).to all(eq(group))
    expect(folder.trashed_as_root).to be true
    expect([child, m1, m2].map(&:trashed_as_root)).to all(be false)
  end

  it "does not touch already-trashed children" do
    folder = Folder.create!(name: "F", project: project)
    m1 = Meeting.create!(title: "M1", project: project, folder: folder, creator: user)
    m1.soft_delete!(by: user, group: "old-group", root: true)
    described_class.call(folder, by: user)
    m1.reload
    expect(m1.trash_group_id).to eq("old-group")
  end

  it "cascades project: kept folders + meetings share group" do
    folder = Folder.create!(name: "F", project: project)
    meeting = Meeting.create!(title: "M", project: project, folder: folder, creator: user)
    described_class.call(project, by: user)
    [project, folder, meeting].each(&:reload)
    group = project.trash_group_id
    expect([folder, meeting].map(&:trash_group_id)).to all(eq(group))
    expect(project.trashed_as_root).to be true
  end
end
