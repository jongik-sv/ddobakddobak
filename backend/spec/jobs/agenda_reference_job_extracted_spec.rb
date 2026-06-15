require "rails_helper"
require "tmpdir"

RSpec.describe AgendaReferenceJob, "extracted md collection" do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  it "includes extracted .md from a non-text attachment's extraction dir" do
    Dir.mktmpdir do |dir|
      pptx = File.join(dir, "deck.pptx"); File.write(pptx, "binary")
      att = meeting.meeting_attachments.create!(
        kind: "file", category: "agenda", display_name: "deck.pptx", original_filename: "deck.pptx",
        content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        file_size: 6, file_path: pptx, uploaded_by_id: user.id, position: 1
      )
      FileUtils.mkdir_p(att.extraction_dir)
      File.write(File.join(att.extraction_dir, "deck.pptx.md"), "## 슬라이드\n핵심 안건")

      captured = nil
      allow_any_instance_of(LlmService).to receive(:compress_agenda) { |_s, text, **| captured = text; "C" }

      described_class.perform_now(meeting.id)

      expect(captured).to include("핵심 안건")
    end
  end
end
