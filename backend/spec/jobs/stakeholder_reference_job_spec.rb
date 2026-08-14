require "rails_helper"

# 이해관계자 압축 잡: stakeholder 카테고리의 텍스트 첨부(.md/.txt)를 모아 LLM 으로 압축해
# meeting.stakeholder_reference 컬럼에 캐시하고, 1회주입 플래그(stakeholder_reference_applied_at)를 리셋한다.
# AgendaReferenceJob 미러.
RSpec.describe StakeholderReferenceJob, type: :job do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  def write_tmp(content)
    path = Rails.root.join("tmp", "stakeholder_#{SecureRandom.hex(6)}.md").to_s
    File.write(path, content)
    path
  end

  def stakeholder_file(content, content_type: "text/markdown", position: 1)
    meeting.meeting_attachments.create!(
      kind: "file", category: "stakeholder", display_name: "s.md",
      original_filename: "s.md", content_type: content_type,
      file_size: content.bytesize, file_path: write_tmp(content),
      uploaded_by_id: user.id, position: position
    )
  end

  before do
    allow_any_instance_of(LlmService).to receive(:compress_stakeholder) do |_svc, text, **|
      "COMPRESSED(#{text.length})"
    end
  end

  it "compresses stakeholder text attachments into stakeholder_reference and resets the applied flag" do
    meeting.update_column(:stakeholder_reference_applied_at, Time.current)
    stakeholder_file("김철수 / 기획팀 / 팀장")

    described_class.perform_now(meeting.id)

    meeting.reload
    expect(meeting.stakeholder_reference).to start_with("COMPRESSED(")
    expect(meeting.stakeholder_reference_applied_at).to be_nil
  end

  it "concatenates multiple stakeholder files in position order before compressing" do
    captured = nil
    allow_any_instance_of(LlmService).to receive(:compress_stakeholder) do |_svc, text, **|
      captured = text
      "ok"
    end
    stakeholder_file("첫번째 이해관계자", position: 1)
    stakeholder_file("두번째 이해관계자", position: 2)

    described_class.perform_now(meeting.id)

    expect(captured.index("첫번째 이해관계자")).to be < captured.index("두번째 이해관계자")
  end

  it "ignores non-stakeholder and non-text attachments" do
    meeting.meeting_attachments.create!(
      kind: "file", category: "reference", display_name: "r.md",
      original_filename: "r.md", content_type: "text/markdown",
      file_size: 3, file_path: write_tmp("참고자료"),
      uploaded_by_id: user.id, position: 5
    )

    described_class.perform_now(meeting.id)

    expect(meeting.reload.stakeholder_reference).to be_nil
  end

  it "clears stakeholder_reference when there are no stakeholder files" do
    meeting.update_column(:stakeholder_reference, "예전 이해관계자")

    described_class.perform_now(meeting.id)

    expect(meeting.reload.stakeholder_reference).to be_nil
  end

  it "no-ops when the meeting does not exist" do
    expect { described_class.perform_now(-1) }.not_to raise_error
  end

  it "includes extracted .md from a non-text attachment's extraction dir" do
    require "tmpdir"
    Dir.mktmpdir do |dir|
      pptx = File.join(dir, "deck.pptx"); File.write(pptx, "binary")
      att = meeting.meeting_attachments.create!(
        kind: "file", category: "stakeholder", display_name: "deck.pptx", original_filename: "deck.pptx",
        content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        file_size: 6, file_path: pptx, uploaded_by_id: user.id, position: 1
      )
      FileUtils.mkdir_p(att.extraction_dir)
      File.write(File.join(att.extraction_dir, "deck.pptx.md"), "## 조직도\n핵심 이해관계자")

      captured = nil
      allow_any_instance_of(LlmService).to receive(:compress_stakeholder) { |_s, text, **| captured = text; "C" }

      described_class.perform_now(meeting.id)

      expect(captured).to include("핵심 이해관계자")
    end
  end
end
