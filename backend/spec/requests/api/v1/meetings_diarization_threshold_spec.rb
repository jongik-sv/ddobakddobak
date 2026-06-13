require "rails_helper"

# 회의별 화자분리 임계값(diarization_threshold)
#  - PATCH /api/v1/meetings/:id 로 소유자가 임계값을 설정/해제할 수 있다.
#  - 빈 문자열("")은 nil 로 해석되어 회의별 오버라이드를 해제한다.
RSpec.describe "Api::V1::Meetings diarization_threshold", type: :request do
  let(:user) { create(:user) }

  before { login_as(user) }

  it "소유자는 update 로 diarization_threshold 를 설정할 수 있다(200, 응답에도 포함=round-trip)" do
    meeting = create(:meeting, creator: user)
    patch "/api/v1/meetings/#{meeting.id}", params: { diarization_threshold: 0.4 }, as: :json
    expect(response).to have_http_status(:ok)
    expect(meeting.reload.diarization_threshold).to eq(0.4)
    expect(response.parsed_body.dig("meeting", "diarization_threshold")).to eq(0.4)
  end

  it "범위를 벗어난 값은 422 로 거부된다(쓰레기 .to_f → 0.0 차단)" do
    meeting = create(:meeting, creator: user)
    patch "/api/v1/meetings/#{meeting.id}", params: { diarization_threshold: "0" }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(meeting.reload.diarization_threshold).to be_nil
  end

  it "빈 문자열을 보내면 diarization_threshold 가 nil 로 해제된다(200)" do
    meeting = create(:meeting, creator: user, diarization_threshold: 0.5)
    patch "/api/v1/meetings/#{meeting.id}", params: { diarization_threshold: "" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(meeting.reload.diarization_threshold).to be_nil
  end
end
