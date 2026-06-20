require "rails_helper"

RSpec.describe EmbedBackfillJob, type: :job do
  let(:sidecar) { instance_double(SidecarClient) }
  before do
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    # 호출되는 텍스트 수만큼 더미 벡터 반환
    allow(sidecar).to receive(:embed) { |texts| texts.map { [1.0, 0.0] } }
  end

  it "임베딩 없는 전사를 전부 채운다" do
    3.times { |i| create(:transcript, content: "내용 #{i}") }
    TranscriptEmbedding.delete_all # 콜백으로 enqueue만 됐을 수 있으니 정리
    expect {
      described_class.perform_now(batch_size: 2)
    }.to change(TranscriptEmbedding, :count).by(3)
  end

  it "idempotent — 두 번 돌려도 중복 생성 없음" do
    2.times { |i| create(:transcript, content: "x#{i}") }
    TranscriptEmbedding.delete_all
    described_class.perform_now
    expect { described_class.perform_now }.not_to change(TranscriptEmbedding, :count)
  end

  it "구버전 model_version 행만 재처리한다" do
    t = create(:transcript, content: "재처리 대상")
    TranscriptEmbedding.delete_all
    TranscriptEmbedding.create!(transcript: t, meeting_id: t.meeting_id, model_version: "old-v0", dim: 2, embedding: TranscriptEmbedding.pack_vector([0.0, 0.0]))
    described_class.perform_now
    rec = TranscriptEmbedding.find_by(transcript_id: t.id)
    expect(rec.model_version).to eq("kure-v1")
    expect(rec.vector.map { |x| x.round(1) }).to eq([1.0, 0.0])
  end
end
