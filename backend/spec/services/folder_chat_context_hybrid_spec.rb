require "rails_helper"

RSpec.describe FolderChatContext, "hybrid retrieval", type: :service do
  let(:project) { create(:project) }
  let(:user) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let(:meeting) { create(:meeting, project: project, creator: user, folder: folder) }

  let!(:t_kw)  { create(:transcript, meeting: meeting, content: "예산 배정 논의", speaker_label: "화자1") }
  let!(:t_sem) { create(:transcript, meeting: meeting, content: "비용 집행 계획", speaker_label: "화자2") }

  let(:sidecar) { instance_double(SidecarClient) }

  before do
    ActiveRecord::Base.connection.execute("DELETE FROM transcripts_fts")
    # FTS 재색인(콜백이 이미 넣었을 수 있으나 명시)
    [t_kw, t_sem].each(&:save!)
    TranscriptEmbedding.delete_all
    # 벡터: 의미상 t_sem이 쿼리에 가깝다고 가정
    TranscriptEmbedding.create!(transcript: t_sem, meeting_id: meeting.id, model_version: "kure-v1", dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))
    TranscriptEmbedding.create!(transcript: t_kw,  meeting_id: meeting.id, model_version: "kure-v1", dim: 2, embedding: TranscriptEmbedding.pack_vector([0.0, 1.0]))
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]]) # t_sem 방향
  end

  it "FTS 키워드 히트와 벡터 의미 히트를 모두 발췌에 포함한다" do
    ctx = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                keywords: ["예산"], query_text: "비용은 어떻게 쓰나")
    block = ctx[:user_content]
    expect(block).to include("예산 배정 논의")  # FTS 히트
    expect(block).to include("비용 집행 계획")  # 벡터 히트(키워드 '예산' 없음)
  end

  it "sidecar 실패 시 FTS-only로 fallback (예외 안 남)" do
    allow(SidecarClient).to receive(:new).and_raise(SidecarClient::ConnectionError, "down")
    ctx = nil
    expect {
      ctx = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                  keywords: ["예산"], query_text: "비용")
    }.not_to raise_error
    expect(ctx[:user_content]).to include("예산 배정 논의")
  end

  it "expansions 토큰이 FTS 매칭에 추가된다 (키워드에 없는 단어 → 대조)" do
    t_exp = create(:transcript, meeting: meeting, content: "납기 일정 지연", speaker_label: "화자3")
    t_exp.save! # FTS 재색인
    allow(sidecar).to receive(:embed).and_return([]) # 벡터 빈 결과 → 순수 FTS 경로 증명

    # 확장 없음: 키워드 "예산"은 "납기 일정 지연"에 매칭 안 됨 → 미포함
    without_exp = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                       keywords: ["예산"], query_text: "예산")
    expect(without_exp[:user_content]).not_to include("납기 일정 지연")

    # 확장 있음: expansions의 "납기" 토큰이 fts_terms에 추가 → FTS 히트 → 포함
    with_exp = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                     keywords: ["예산"], expansions: ["납기"], query_text: "예산")
    expect(with_exp[:user_content]).to include("납기 일정 지연")
  end

  it "스코프 밖 회의 전사는 발췌에 노출되지 않는다 (인가)" do
    other = create(:meeting, project: create(:project), creator: create(:user))
    secret = create(:transcript, meeting: other, content: "비밀 예산 비용")
    secret.save!
    TranscriptEmbedding.create!(transcript: secret, meeting_id: other.id, model_version: "kure-v1", dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))
    ctx = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                keywords: ["예산"], query_text: "비용")
    expect(ctx[:user_content]).not_to include("비밀 예산 비용")
  end
end
