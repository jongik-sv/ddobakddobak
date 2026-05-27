require "rails_helper"

RSpec.describe "Api::V1::Speakers", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:foreign)    { create(:meeting, creator: other_user) }

  before { login_as(user) }

  it "비참여자는 남의 회의 화자 목록에 접근할 수 없다(403)" do
    get "/api/v1/speakers", params: { meeting_id: foreign.id }
    expect(response).to have_http_status(:forbidden)
  end
end
