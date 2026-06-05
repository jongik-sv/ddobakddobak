require "rails_helper"

RSpec.describe "Api::V1::MeetingContacts", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user, shared: true) }

  describe "as the owner" do
    before { login_as(user) }

    it "lists contacts" do
      create(:meeting_contact, meeting: meeting, name: "홍길동")
      get "/api/v1/meetings/#{meeting.id}/contacts"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["contacts"].map { |c| c["name"] }).to include("홍길동")
    end

    it "updates a contact (OCR 교정)" do
      c = create(:meeting_contact, meeting: meeting, name: "오타")
      patch "/api/v1/meetings/#{meeting.id}/contacts/#{c.id}", params: { name: "정정" }
      expect(response).to have_http_status(:ok)
      expect(c.reload.name).to eq("정정")
    end

    it "deletes a contact" do
      c = create(:meeting_contact, meeting: meeting)
      delete "/api/v1/meetings/#{meeting.id}/contacts/#{c.id}"
      expect(response).to have_http_status(:no_content)
      expect(MeetingContact.exists?(c.id)).to be(false)
    end

    it "returns 404 for a missing contact id" do
      patch "/api/v1/meetings/#{meeting.id}/contacts/999999", params: { name: "x" }
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "as a non-owner (shared meeting → read ok, control forbidden)" do
    let(:other) { create(:user) }
    before { login_as(other) }

    it "can read but cannot update" do
      c = create(:meeting_contact, meeting: meeting, name: "홍길동")
      get "/api/v1/meetings/#{meeting.id}/contacts"
      expect(response).to have_http_status(:ok)

      patch "/api/v1/meetings/#{meeting.id}/contacts/#{c.id}", params: { name: "해킹" }
      expect(response).to have_http_status(:forbidden)
      expect(c.reload.name).to eq("홍길동")
    end
  end
end
