require "rails_helper"

RSpec.describe TranscriptEmbedding, type: :model do
  it "pack/unpack roundtrips fp32 vectors" do
    vec = [0.1, -0.2, 0.3, 1.5]
    blob = TranscriptEmbedding.pack_vector(vec)
    back = TranscriptEmbedding.unpack_vector(blob)
    expect(back.map { |x| x.round(4) }).to eq([0.1, -0.2, 0.3, 1.5])
  end

  it "stores and reads an embedding row" do
    t = create(:transcript)
    rec = TranscriptEmbedding.create!(
      transcript: t, meeting_id: t.meeting_id,
      model_version: TranscriptEmbedding::MODEL_VERSION, dim: 4,
      embedding: TranscriptEmbedding.pack_vector([1.0, 0.0, 0.0, 0.0])
    )
    expect(rec.reload.vector.map { |x| x.round(2) }).to eq([1.0, 0.0, 0.0, 0.0])
  end

  it "enforces unique transcript_id" do
    t = create(:transcript)
    attrs = { transcript: t, meeting_id: t.meeting_id, model_version: "kure-v1", dim: 1, embedding: TranscriptEmbedding.pack_vector([1.0]) }
    TranscriptEmbedding.create!(attrs)
    expect { TranscriptEmbedding.create!(attrs) }.to raise_error(ActiveRecord::RecordNotUnique)
  end
end
