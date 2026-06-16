require "rails_helper"

# 오타 수정 적용(POST /feedback): 교정어가 회의의 모든 텍스트 표면에 적용되는지 검증.
# 회귀: 과거엔 active summary notes_markdown + transcripts 만 교정 → 구조화 요약필드/
# 비활성 summary/action_items/decisions/blocks 에 오타 잔존("적용이 다 안됨").
RSpec.describe "Api::V1::Meetings feedback (term corrections)", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

  before { login_as(user) }

  def post_feedback(corrections)
    post "/api/v1/meetings/#{meeting.id}/feedback",
         params: { corrections: corrections }, as: :json
  end

  it "교정어를 모든 텍스트 표면에 적용한다" do
    # active(final) summary — notes + 구조화 JSON 필드 모두 오타 포함
    final = create(:summary, meeting: meeting, summary_type: "final",
                   notes_markdown: "## 회의록\n분목별 매출 정리",
                   key_points: [ "분목별 분석" ].to_json,
                   decisions: [ "분목별 기준 확정" ].to_json,
                   discussion_details: "분목별 논의".to_json,
                   generated_at: 1.minute.ago)
    # 비활성(realtime) summary 도 교정돼야
    realtime = create(:summary, meeting: meeting, summary_type: "realtime",
                      notes_markdown: "분목별 임시 메모",
                      key_points: [].to_json, decisions: [].to_json,
                      discussion_details: "".to_json,
                      generated_at: 2.minutes.ago)
    t1 = create(:transcript, meeting: meeting, content: "분목별 어쩌고")
    ai = create(:action_item, meeting: meeting, content: "분목별 표 작성")
    dec = create(:decision, meeting: meeting, content: "분목별 기준 채택")
    blk = create(:block, meeting: meeting, content: "분목별 블록 본문")

    post_feedback([ { from: "분목별", to: "품목별" } ])

    expect(response).to have_http_status(:ok)

    [ final, realtime, t1, ai, dec, blk ].each(&:reload)

    corrected = {
      "final.notes_markdown" => final.notes_markdown,
      "final.key_points" => final.key_points,
      "final.decisions" => final.decisions,
      "final.discussion_details" => final.discussion_details,
      "realtime.notes_markdown" => realtime.notes_markdown,
      "transcript.content" => t1.content,
      "action_item.content" => ai.content,
      "decision.content" => dec.content,
      "block.content" => blk.content,
    }
    corrected.each do |label, text|
      expect(text).to(include("품목별"), -> { "#{label} should contain corrected term: #{text.inspect}" })
      expect(text).not_to(include("분목별"), -> { "#{label} still has typo: #{text.inspect}" })
    end
  end

  it "변경된 트랜스크립트 수를 반환한다" do
    create(:transcript, meeting: meeting, content: "분목별 하나")
    create(:transcript, meeting: meeting, content: "변경 없음")

    post_feedback([ { from: "분목별", to: "품목별" } ])

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["corrected_transcripts"]).to eq(1)
  end

  it "빈 corrections 는 422" do
    post_feedback([])
    expect(response).to have_http_status(:unprocessable_entity)
  end
end
