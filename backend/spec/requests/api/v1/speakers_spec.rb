require "rails_helper"

RSpec.describe "Api::V1::Speakers", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:foreign)    { create(:meeting, :private_meeting, creator: other_user) }

  before { login_as(user) }

  it "비참여자는 남의 회의 화자 목록에 접근할 수 없다(403)" do
    get "/api/v1/speakers", params: { meeting_id: foreign.id }
    expect(response).to have_http_status(:forbidden)
  end

  it "viewer 참여자는 화자 이름을 수정할 수 없다(403)" do
    create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
    patch "/api/v1/speakers/spk1", params: { meeting_id: foreign.id, name: "변경" }
    expect(response).to have_http_status(:forbidden)
  end

  describe "speaker_name 비정규화" do
    let(:meeting) { create(:meeting, creator: user) }
    let(:sidecar) { instance_double(SidecarClient) }

    before do
      allow(SidecarClient).to receive(:new).and_return(sidecar)
    end

    describe "PATCH /api/v1/speakers/:id (rename)" do
      let!(:t1) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_00", sequence_number: 1) }
      let!(:t2) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_01", sequence_number: 2) }

      it "sidecar 성공 시 해당 라벨 트랜스크립트만 speaker_name 갱신" do
        allow(sidecar).to receive(:rename_speaker)
          .with("SPEAKER_00", "앨리스", meeting.id)
          .and_return({ "id" => "SPEAKER_00", "name" => "앨리스" })

        patch "/api/v1/speakers/SPEAKER_00", params: { meeting_id: meeting.id, name: "앨리스" }

        expect(response).to have_http_status(:ok)
        expect(t1.reload.speaker_name).to eq("앨리스")
        expect(t2.reload.speaker_name).to be_nil
      end

      it "이름을 라벨과 동일하게 지정하면 speaker_name은 null (이름 해제)" do
        t1.update!(speaker_name: "앨리스")
        allow(sidecar).to receive(:rename_speaker)
          .with("SPEAKER_00", "SPEAKER_00", meeting.id)
          .and_return({ "id" => "SPEAKER_00", "name" => "SPEAKER_00" })

        patch "/api/v1/speakers/SPEAKER_00", params: { meeting_id: meeting.id, name: "SPEAKER_00" }

        expect(response).to have_http_status(:ok)
        expect(t1.reload.speaker_name).to be_nil
      end

      it "sidecar 실패(SidecarError) 시 speaker_name을 갱신하지 않는다" do
        allow(sidecar).to receive(:rename_speaker)
          .and_raise(SidecarClient::SidecarError, "404 not found")

        patch "/api/v1/speakers/SPEAKER_00", params: { meeting_id: meeting.id, name: "앨리스" }

        expect(response).to have_http_status(:not_found)
        expect(t1.reload.speaker_name).to be_nil
      end
    end

    describe "DELETE /api/v1/speakers/destroy_all (reset)" do
      let!(:t1) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_00", speaker_name: "앨리스", sequence_number: 1) }
      let!(:t2) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_01", speaker_name: "밥", sequence_number: 2) }

      it "sidecar 성공 시 모든 speaker_name을 null로 초기화" do
        allow(sidecar).to receive(:reset_speakers).with(meeting.id).and_return({ "ok" => true })

        delete "/api/v1/speakers/destroy_all", params: { meeting_id: meeting.id }

        expect(response).to have_http_status(:ok)
        expect(t1.reload.speaker_name).to be_nil
        expect(t2.reload.speaker_name).to be_nil
      end

      it "sidecar 연결 실패 시 speaker_name을 유지한다 (sidecar DB가 리셋되지 않았으므로)" do
        allow(sidecar).to receive(:reset_speakers)
          .and_raise(SidecarClient::ConnectionError, "down")

        delete "/api/v1/speakers/destroy_all", params: { meeting_id: meeting.id }

        expect(response).to have_http_status(:ok)
        expect(t1.reload.speaker_name).to eq("앨리스")
      end
    end
  end
end
