require "rails_helper"

RSpec.describe MeetingAttachment, "extraction dir" do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  def file_attachment(path)
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: "d.pptx", original_filename: "d.pptx",
      content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      file_size: 3, file_path: path, uploaded_by_id: user.id, position: 1
    )
  end

  it "derives extraction_dir from file_path" do
    att = file_attachment("/tmp/x/d.pptx")
    expect(att.extraction_dir).to eq("/tmp/x/d.pptx.extracted")
  end

  it "returns nil extraction_dir for links (no file_path)" do
    link = meeting.meeting_attachments.create!(
      kind: "link", category: "agenda", display_name: "l", url: "https://e.io",
      uploaded_by_id: user.id, position: 2
    )
    expect(link.extraction_dir).to be_nil
  end

  it "removes the extraction dir when the attachment is destroyed" do
    dir = Dir.mktmpdir
    file = File.join(dir, "d.pptx"); File.write(file, "x")
    att = file_attachment(file)
    FileUtils.mkdir_p(att.extraction_dir); File.write(File.join(att.extraction_dir, "d.pptx.md"), "md")

    att.destroy

    expect(File.exist?(att.extraction_dir)).to be(false)
    expect(File.exist?(file)).to be(false)
  end
end
