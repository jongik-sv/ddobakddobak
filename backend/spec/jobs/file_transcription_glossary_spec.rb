require "rails_helper"

RSpec.describe "FileTranscriptionJob glossary hook" do
  it "store_transcripts 직후 resolver 교정을 트랜스크립트에 적용한다" do
    folder  = create(:folder)
    meeting = create(:meeting, folder_id: folder.id, status: "transcribing")
    folder.glossary_entries.create!(from_text: "회진", to_text: "회의")

    job = FileTranscriptionJob.new
    # store_transcripts 가 만든 상태를 흉내: 트랜스크립트를 직접 만들고 훅 메서드만 호출
    create(:transcript, meeting: meeting, content: "회진 결과")

    job.send(:apply_glossary_corrections, meeting)

    expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
  end
end
