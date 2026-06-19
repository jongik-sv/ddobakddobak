require "rails_helper"

RSpec.describe "Transcript embedding sync", type: :model do
  include ActiveJob::TestHelper

  it "생성 시 EmbedTranscriptJob을 enqueue한다" do
    expect {
      create(:transcript, content: "안건 논의")
    }.to have_enqueued_job(EmbedTranscriptJob)
  end

  it "content 변경 시 enqueue한다" do
    t = create(:transcript, content: "처음")
    expect {
      t.update!(content: "수정됨")
    }.to have_enqueued_job(EmbedTranscriptJob).with(t.id)
  end

  it "content 외 컬럼만 바뀌면 enqueue 안 함" do
    t = create(:transcript, content: "고정")
    expect {
      t.update!(speaker_name: "김철수")
    }.not_to have_enqueued_job(EmbedTranscriptJob)
  end
end
