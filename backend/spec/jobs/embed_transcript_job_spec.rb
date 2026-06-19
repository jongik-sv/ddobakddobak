require "rails_helper"

RSpec.describe EmbedTranscriptJob, type: :job do
  let(:transcript) { create(:transcript, content: "분기 예산을 오천만원으로 확정") }
  let(:sidecar) { instance_double(SidecarClient) }

  before { allow(SidecarClient).to receive(:new).and_return(sidecar) }

  it "임베딩을 받아 transcript_embeddings에 upsert한다" do
    allow(sidecar).to receive(:embed).with([transcript.content]).and_return([[1.0, 0.0, 0.0]])
    expect {
      described_class.perform_now(transcript.id)
    }.to change(TranscriptEmbedding, :count).by(1)
    rec = TranscriptEmbedding.find_by(transcript_id: transcript.id)
    expect(rec.meeting_id).to eq(transcript.meeting_id)
    expect(rec.model_version).to eq("kure-v1")
    expect(rec.vector.map { |x| x.round(2) }).to eq([1.0, 0.0, 0.0])
  end

  it "재실행 시 갱신(중복 생성 안 함)" do
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]], [[0.0, 1.0]])
    described_class.perform_now(transcript.id)
    expect { described_class.perform_now(transcript.id) }.not_to change(TranscriptEmbedding, :count)
    expect(TranscriptEmbedding.find_by(transcript_id: transcript.id).vector.map { |x| x.round(2) }).to eq([0.0, 1.0])
  end

  it "content가 비면 skip" do
    blank = create(:transcript, content: "x")
    blank.update_column(:content, "")
    expect(sidecar).not_to receive(:embed)
    expect { described_class.perform_now(blank.id) }.not_to change(TranscriptEmbedding, :count)
  end

  it "없는 id는 조용히 무시" do
    expect { described_class.perform_now(-1) }.not_to raise_error
  end
end
