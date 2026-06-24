require "rails_helper"

RSpec.describe "Transcript embedding lifecycle", type: :model do
  include ActiveJob::TestHelper

  it "생성 시 인라인 임베딩 잡을 enqueue하지 않는다(백필이 흡수)" do
    expect {
      create(:transcript, content: "안건 논의")
    }.not_to have_enqueued_job(EmbedTranscriptJob)
  end

  it "content 변경 시 기존 임베딩 행을 무효화(삭제)한다" do
    t = create(:transcript, content: "처음")
    TranscriptEmbedding.create!(
      transcript: t, meeting_id: t.meeting_id,
      model_version: TranscriptEmbedding::MODEL_VERSION, dim: 2,
      embedding: TranscriptEmbedding.pack_vector([0.1, 0.2])
    )
    expect {
      t.update!(content: "수정됨")
    }.to change { TranscriptEmbedding.exists?(transcript_id: t.id) }.from(true).to(false)
  end

  it "content 외 컬럼만 바뀌면 임베딩을 무효화하지 않는다" do
    t = create(:transcript, content: "고정")
    TranscriptEmbedding.create!(
      transcript: t, meeting_id: t.meeting_id,
      model_version: TranscriptEmbedding::MODEL_VERSION, dim: 2,
      embedding: TranscriptEmbedding.pack_vector([0.1, 0.2])
    )
    expect {
      t.update!(speaker_name: "김철수")
    }.not_to change { TranscriptEmbedding.exists?(transcript_id: t.id) }
  end
end
