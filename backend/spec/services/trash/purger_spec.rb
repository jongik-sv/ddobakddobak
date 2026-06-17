require "rails_helper"

RSpec.describe Trash::Purger do
  let(:user) { User.create!(email: "u@e.com", password: "password123", name: "U") }
  let(:project) { Project.create!(name: "P", creator: user) }

  it "destroys all rows in the group" do
    folder = Folder.create!(name: "F", project: project)
    meeting = Meeting.create!(title: "M", project: project, folder: folder, creator: user)
    group = Trash::SoftDeleter.call(folder, by: user)
    Trash::Purger.call(group)
    expect(Meeting.exists?(meeting.id)).to be false
    expect(Folder.exists?(folder.id)).to be false
  end

  it "removes audio file on purge" do
    path = Rails.root.join("tmp", "purge_test_#{SecureRandom.hex(4)}.wav").to_s
    File.write(path, "x")
    meeting = Meeting.create!(title: "M", project: project, creator: user, audio_file_path: path)
    group = Trash::SoftDeleter.call(meeting, by: user)
    Trash::Purger.call(group)
    expect(File.exist?(path)).to be false
  end
end
