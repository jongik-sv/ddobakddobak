require "rails_helper"

# 계량대(project 15) 회귀 — 쿼리 확장 대조(contrast) 검증.
# 단일쿼리 "시리얼 통신"으론 RS232 전사를 놓치고(top-60 밖), expansions=["RS232"]가
# 들어오면 RS232 서브쿼리가 rank0로 끌어올려 발췌에 포함됨을 한 테스트로 동시 단언한다.
# 디코이 61개([0,1]) + TOP_K=60 결합이 식별 조건: 확장 없으면 rs232(score 0)는 62번째 → 배제.
RSpec.describe FolderChatContext, "쿼리 확장 회귀(계량대 대조)", type: :service do
  let(:project) { create(:project) }
  let(:user) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let(:meeting) { create(:meeting, project: project, creator: user, folder: folder) }

  # 본문에 "시리얼"·"통신" prefix 토큰 없음(FTS 단일쿼리 미스). 임베딩 [1.0, 0.0].
  # ⚠️ 본문에서 "RS232"를 의도적으로 제거 — 확장어 "RS232"의 FTS prefix 매칭이 이 전사에 닿지 못하게 하여
  #    단언 2의 포함을 오직 "RS232" 벡터 서브쿼리(→RRF) 경로로만 달성하게 만든다(대조 검증의 식별력 확보).
  let!(:rs232) { create(:transcript, meeting: meeting, content: "직접 연결 되나요?", speaker_label: "화자1") }

  let(:sidecar) { instance_double(SidecarClient) }

  before do
    ActiveRecord::Base.connection.execute("DELETE FROM transcripts_fts")
    rs232.save! # FTS 재색인

    TranscriptEmbedding.delete_all
    # 디코이 61개: 모두 [0,1] (쿼리벡터 [1,0]과 직교 → score 0). 61개라 top-60을 채워 rs232를 밀어냄.
    61.times do |n|
      t = create(:transcript, meeting: meeting, content: "잡담 #{n}", speaker_label: "화자2")
      t.save!
      TranscriptEmbedding.create!(transcript: t, meeting_id: meeting.id, model_version: "kure-v1",
                                  dim: 2, embedding: TranscriptEmbedding.pack_vector([0.0, 1.0]))
    end
    # rs232 임베딩 명시 생성: [1.0, 0.0].
    TranscriptEmbedding.create!(transcript: rs232, meeting_id: meeting.id, model_version: "kure-v1",
                               dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))

    allow(SidecarClient).to receive(:new).and_return(sidecar)
    # 쿼리별 다른 벡터: "RS232" 포함 쿼리는 rs232 방향[1,0], 그 외는 디코이 방향[0,1].
    allow(sidecar).to receive(:embed) { |texts| texts.map { |t| t.include?("RS232") ? [1.0, 0.0] : [0.0, 1.0] } }
  end

  it "확장 없으면 RS232를 놓치고, 확장이 있으면 잡는다" do
    # 단언 1 (확장 없음 → 놓침): 벡터쿼리 "시리얼 통신"=[0,1] → 디코이 61개가 rs232(score 0)보다 상위
    #   → top-60 밖 → 미포함. FTS도 "시리얼/통신" prefix 토큰이 본문에 없어 미스.
    without_exp = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                       keywords: %w[시리얼 통신], query_text: "시리얼 통신")
    expect(without_exp[:user_content]).not_to include("직접 연결")

    # 단언 2 (확장 있음 → 잡음): "RS232" 서브쿼리=[1,0]가 rs232를 rank0로 → 통합 RRF 상위 → 포함.
    #   본문에 "RS232"가 없으므로 FTS는 이 전사를 못 잡고, 오직 벡터-확장→RRF 경로만이 발췌에 올린다.
    with_exp = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                     keywords: %w[시리얼 통신], expansions: ["시리얼 통신", "RS232"],
                                     query_text: "시리얼 통신")
    expect(with_exp[:user_content]).to include("직접 연결")
  end
end
