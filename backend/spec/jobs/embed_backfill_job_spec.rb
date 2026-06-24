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

  it "라이브/전사중 회의의 전사는 백필하지 않는다(라이브 핫패스 보호)" do
    live   = create(:meeting, status: "recording")
    proc_m = create(:meeting, status: "transcribing")
    done   = create(:meeting, status: "completed")
    create(:transcript, meeting: live, content: "라이브 내용")
    create(:transcript, meeting: proc_m, content: "전사중 내용")
    t_done = create(:transcript, meeting: done, content: "완료 내용")
    TranscriptEmbedding.delete_all

    described_class.perform_now

    expect(TranscriptEmbedding.where(meeting_id: live.id).count).to eq(0)
    expect(TranscriptEmbedding.where(meeting_id: proc_m.id).count).to eq(0)
    expect(TranscriptEmbedding.exists?(transcript_id: t_done.id)).to be(true)
  end

  it "활성 회의가 하나도 없으면 NOT IN 빈집합이 전체를 막지 않는다(회귀 가드)" do
    done = create(:meeting, status: "completed")
    t = create(:transcript, meeting: done, content: "완료 회의 내용")
    TranscriptEmbedding.delete_all
    expect(Meeting.where(status: %w[recording transcribing])).to be_empty

    described_class.perform_now

    expect(TranscriptEmbedding.exists?(transcript_id: t.id)).to be(true)
  end

  it "meeting_id 스코핑 — 그 회의 전사만 처리한다" do
    m1 = create(:meeting)
    m2 = create(:meeting)
    t1 = create(:transcript, meeting: m1, content: "회의1 내용")
    create(:transcript, meeting: m2, content: "회의2 내용")
    TranscriptEmbedding.delete_all

    described_class.perform_now(meeting_id: m1.id)

    expect(TranscriptEmbedding.where(meeting_id: m1.id).count).to eq(1)
    expect(TranscriptEmbedding.where(meeting_id: m2.id).count).to eq(0)
    expect(TranscriptEmbedding.exists?(transcript_id: t1.id)).to be(true)
  end
end
