require "rails_helper"

RSpec.describe TranscriptVectorSearch, type: :service do
  let(:sidecar) { instance_double(SidecarClient) }
  before { allow(SidecarClient).to receive(:new).and_return(sidecar) }

  def embed_row(transcript, vec)
    TranscriptEmbedding.create!(transcript: transcript, meeting_id: transcript.meeting_id,
      model_version: "kure-v1", dim: vec.size, embedding: TranscriptEmbedding.pack_vector(vec))
  end

  let(:meeting) { create(:meeting) }
  let!(:t_near) { create(:transcript, meeting: meeting, content: "가깝다") }
  let!(:t_far)  { create(:transcript, meeting: meeting, content: "멀다") }

  before do
    TranscriptEmbedding.delete_all
    embed_row(t_near, [1.0, 0.0])   # 쿼리와 동일 방향
    embed_row(t_far,  [0.0, 1.0])   # 직교
  end

  it "쿼리에 가까운 전사를 먼저 반환한다" do
    allow(sidecar).to receive(:embed).with(["q"]).and_return([[1.0, 0.0]])
    res = described_class.search(query_text: "q", meeting_ids: [meeting.id], limit: 10)
    expect(res.first[:transcript_id]).to eq(t_near.id)
    expect(res.first[:score]).to be > res.last[:score]
  end

  it "meeting_ids 밖 전사는 절대 포함하지 않는다 (인가)" do
    other_mtg = create(:meeting)
    other_t = create(:transcript, meeting: other_mtg, content: "타인")
    embed_row(other_t, [1.0, 0.0]) # 쿼리와 완벽 일치하지만 스코프 밖
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]])
    res = described_class.search(query_text: "q", meeting_ids: [meeting.id], limit: 10)
    ids = res.map { |r| r[:transcript_id] }
    expect(ids).not_to include(other_t.id)
  end

  it "현 MODEL_VERSION만 매칭한다" do
    stale = create(:transcript, meeting: meeting, content: "구버전")
    TranscriptEmbedding.create!(transcript: stale, meeting_id: meeting.id, model_version: "old", dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]])
    res = described_class.search(query_text: "q", meeting_ids: [meeting.id], limit: 10)
    expect(res.map { |r| r[:transcript_id] }).not_to include(stale.id)
  end

  it "빈 meeting_ids/빈 쿼리는 빈 배열" do
    expect(described_class.search(query_text: "", meeting_ids: [meeting.id])).to eq([])
    expect(described_class.search(query_text: "q", meeting_ids: [])).to eq([])
  end

  describe ".search_multi" do
    it "쿼리 N개당 리스트 N개를 반환하고 쿼리별로 상위가 다르다" do
      # embed가 쿼리별 다른 벡터 반환: q1=[1,0]→t_near 우선, q2=[0,1]→t_far 우선
      allow(sidecar).to receive(:embed).with(["q1", "q2"]).and_return([[1.0, 0.0], [0.0, 1.0]])
      res = described_class.search_multi(queries: ["q1", "q2"], meeting_ids: [meeting.id], limit: 10)

      expect(res.size).to eq(2)
      expect(res[0]).to be_an(Array)
      expect(res[1]).to be_an(Array)
      expect(res[0].first).to include(:transcript_id, :score)
      expect(res[0].first[:transcript_id]).to eq(t_near.id)
      expect(res[1].first[:transcript_id]).to eq(t_far.id)
    end

    it "meeting_ids 밖 전사는 search_multi에도 포함하지 않는다 (인가)" do
      other_mtg = create(:meeting)
      other_t = create(:transcript, meeting: other_mtg, content: "타인")
      embed_row(other_t, [1.0, 0.0]) # 쿼리와 완벽 일치하지만 스코프 밖
      allow(sidecar).to receive(:embed).and_return([[1.0, 0.0], [0.0, 1.0]])
      res = described_class.search_multi(queries: ["q1", "q2"], meeting_ids: [meeting.id], limit: 10)
      ids = res.flatten.map { |r| r[:transcript_id] }
      expect(ids).not_to include(other_t.id)
    end

    it "빈 입력은 빈 배열" do
      expect(described_class.search_multi(queries: [], meeting_ids: [meeting.id])).to eq([])
      expect(described_class.search_multi(queries: ["q1"], meeting_ids: [])).to eq([])
    end
  end
end
