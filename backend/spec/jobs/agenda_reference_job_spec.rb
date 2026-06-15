require "rails_helper"

# 안건 자료 압축 잡: agenda 카테고리의 텍스트 첨부(.md/.txt)를 모아 LLM 으로 압축해
# meeting.agenda_reference 컬럼에 캐시하고, 1회주입 플래그(agenda_reference_applied_at)를 리셋한다.
RSpec.describe AgendaReferenceJob, type: :job do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  def write_tmp(content)
    path = Rails.root.join("tmp", "agenda_#{SecureRandom.hex(6)}.md").to_s
    File.write(path, content)
    path
  end

  def agenda_file(content, content_type: "text/markdown", position: 1)
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: "a.md",
      original_filename: "a.md", content_type: content_type,
      file_size: content.bytesize, file_path: write_tmp(content),
      uploaded_by_id: user.id, position: position
    )
  end

  before do
    allow_any_instance_of(LlmService).to receive(:compress_agenda) do |_svc, text, **|
      "COMPRESSED(#{text.length})"
    end
  end

  it "compresses agenda text attachments into agenda_reference and resets the applied flag" do
    meeting.update_column(:agenda_reference_applied_at, Time.current)
    agenda_file("1. 예산안\n2. 일정")

    described_class.perform_now(meeting.id)

    meeting.reload
    expect(meeting.agenda_reference).to start_with("COMPRESSED(")
    expect(meeting.agenda_reference_applied_at).to be_nil
  end

  it "concatenates multiple agenda files in position order before compressing" do
    captured = nil
    allow_any_instance_of(LlmService).to receive(:compress_agenda) do |_svc, text, **|
      captured = text
      "ok"
    end
    agenda_file("첫번째 안건", position: 1)
    agenda_file("두번째 안건", position: 2)

    described_class.perform_now(meeting.id)

    expect(captured.index("첫번째 안건")).to be < captured.index("두번째 안건")
  end

  it "ignores non-agenda and non-text attachments" do
    meeting.meeting_attachments.create!(
      kind: "file", category: "reference", display_name: "r.md",
      original_filename: "r.md", content_type: "text/markdown",
      file_size: 3, file_path: write_tmp("참고자료"),
      uploaded_by_id: user.id, position: 5
    )

    described_class.perform_now(meeting.id)

    expect(meeting.reload.agenda_reference).to be_nil
  end

  it "clears agenda_reference when there are no agenda files" do
    meeting.update_column(:agenda_reference, "예전 안건")

    described_class.perform_now(meeting.id)

    expect(meeting.reload.agenda_reference).to be_nil
  end

  it "no-ops when the meeting does not exist" do
    expect { described_class.perform_now(-1) }.not_to raise_error
  end
end
