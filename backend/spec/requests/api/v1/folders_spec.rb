require "rails_helper"

RSpec.describe "Api::V1::Folders", type: :request do
  let(:user) { create(:user) }
  let(:other) { create(:user) }
  let(:admin) { create(:user, :admin) }
  let!(:folder) { create(:folder) }

  before do
    create(:meeting, :private_meeting, creator: other, folder_id: folder.id)  # 남의 비공개 회의 (열람 불가)
    create(:meeting, creator: user,  folder_id: folder.id)  # 내 회의
  end

  # 사이드바 폴더 트리/플랫의 meeting_count는 접근 가능한 회의만 세야 한다 (누수 방지).
  describe "GET /api/v1/folders — meeting_count 스코프" do
    def folder_count(parsed)
      parsed["folders"].find { |f| f["id"] == folder.id }["meeting_count"]
    end

    it "non-admin은 본인 소유 회의만 카운트한다 (tree)" do
      login_as(user)
      get "/api/v1/folders"
      expect(response).to have_http_status(:ok)
      expect(folder_count(response.parsed_body)).to eq(1)
    end

    it "admin은 전체를 카운트한다 (tree)" do
      login_as(admin)
      get "/api/v1/folders"
      expect(folder_count(response.parsed_body)).to eq(2)
    end

    it "flat 모드 meeting_count도 스코프된다" do
      login_as(user)
      get "/api/v1/folders", params: { flat: "true" }
      expect(folder_count(response.parsed_body)).to eq(1)
    end
  end

  describe "인가 (IDOR 방지)" do
    let(:stranger) { create(:user) } # 폴더에 회의 없는 무관한 사용자

    it "무관한 사용자는 폴더 수정 불가 (403)" do
      login_as(stranger)
      patch "/api/v1/folders/#{folder.id}", params: { name: "해킹됨" }
      expect(response).to have_http_status(:forbidden)
      expect(folder.reload.name).not_to eq("해킹됨")
    end

    it "무관한 사용자는 폴더 삭제 불가 (403)" do
      login_as(stranger)
      delete "/api/v1/folders/#{folder.id}"
      expect(response).to have_http_status(:forbidden)
      expect(Folder.exists?(folder.id)).to be true
    end

    it "직속 회의 creator는 폴더 수정 가능 (200)" do
      login_as(user) # top-level before 에서 folder 에 회의를 만들어 직속 creator
      patch "/api/v1/folders/#{folder.id}", params: { name: "내폴더" }
      expect(response).to have_http_status(:ok)
      expect(folder.reload.name).to eq("내폴더")
    end

    it "admin은 폴더 수정 가능 (200)" do
      login_as(admin)
      patch "/api/v1/folders/#{folder.id}", params: { name: "관리자수정" }
      expect(response).to have_http_status(:ok)
    end
  end
end
