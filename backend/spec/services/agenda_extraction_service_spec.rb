require "rails_helper"
require "tmpdir"

RSpec.describe AgendaExtractionService do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  def att(content_type:, filename:, path:)
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: filename, original_filename: filename,
      content_type: content_type, file_size: 3, file_path: path, uploaded_by_id: user.id, position: 1
    )
  end

  describe "#extraction_prompt" do
    it "instructs uv run + python-pptx for pptx and names <base>.pptx.md" do
      a = att(content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              filename: "deck.pptx", path: "/tmp/deck.pptx")
      prompt = described_class.new(a).extraction_prompt("/tmp/deck.pptx.extracted")
      expect(prompt).to include("uv run --with python-pptx")
      expect(prompt).to include("deck.pptx.md")
      expect(prompt).to include("네이티브 차트")
      expect(prompt).to include("임베디드 이미지")
    end

    it "instructs openpyxl and per-sheet naming for xlsx" do
      a = att(content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              filename: "book.xlsx", path: "/tmp/book.xlsx")
      prompt = described_class.new(a).extraction_prompt("/tmp/book.xlsx.extracted")
      expect(prompt).to include("uv run --with openpyxl")
      expect(prompt).to include("book.xlsx.sheet1.md")
    end

    it "instructs Vision Read (not python) for images" do
      a = att(content_type: "image/png", filename: "p.png", path: "/tmp/p.png")
      prompt = described_class.new(a).extraction_prompt("/tmp/p.png.extracted")
      expect(prompt).to include("Read")
      expect(prompt).not_to include("uv run")
      expect(prompt).to include("p.png.md")
    end
  end

  describe "#call" do
    it "creates the dir, runs the CLI, and returns written md paths" do
      Dir.mktmpdir do |dir|
        path = File.join(dir, "deck.pptx"); File.write(path, "x")
        a = att(content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                filename: "deck.pptx", path: path)
        svc = described_class.new(a)
        allow(svc).to receive(:run_cli) do
          File.write(File.join(a.extraction_dir, "deck.pptx.md"), "## Slide 1\n내용")
        end

        result = svc.call

        expect(result).to eq([ File.join(a.extraction_dir, "deck.pptx.md") ])
      end
    end

    it "returns [] for a missing source file" do
      a = att(content_type: "application/pdf", filename: "x.pdf", path: "/tmp/does-not-exist.pdf")
      expect(described_class.new(a).call).to eq([])
    end
  end
end
