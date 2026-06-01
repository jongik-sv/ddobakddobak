require "rails_helper"

RSpec.describe "Api::V1::Transcripts bulk", type: :request do
  let(:user)        { create(:user) }
  let(:other_user)  { create(:user) }
  let(:team)        { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "admin") }
  let(:meeting)     { create(:meeting, team: team, creator: user) }

  def item(seq:, content: "로컬 전사 #{seq}", speaker_label: "", started_at_ms: seq * 1000, ended_at_ms: seq * 1000 + 800, audio_source: "mic")
    {
      content: content,
      speaker_label: speaker_label,
      started_at_ms: started_at_ms,
      ended_at_ms: ended_at_ms,
      sequence_number: seq,
      audio_source: audio_source
    }
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/v1/meetings/:meeting_id/transcripts/bulk
  # ─────────────────────────────────────────────────────────
  describe "POST /api/v1/meetings/:meeting_id/transcripts/bulk" do
    context "인증된 정상 요청" do
      before { login_as(user) }

      it "200 OK, 여러 건을 생성하고 created 카운트를 반환" do
        expect {
          post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
               params: { transcripts: [ item(seq: 1), item(seq: 2) ] }
        }.to change { meeting.transcripts.count }.by(2)

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["created"]).to eq(2)
        expect(json["transcripts"].length).to eq(2)
        expect(json["transcripts"].map { |t| t["sequence_number"] }).to contain_exactly(1, 2)
      end

      it "speaker_label 빈 문자열('')을 그대로 저장한다 (로컬 단일/미상 화자)" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1, speaker_label: "") ] }

        expect(response).to have_http_status(:ok)
        t = meeting.transcripts.find_by(sequence_number: 1)
        expect(t.speaker_label).to eq("")
        expect(t.content).to eq("로컬 전사 1")
        expect(t.audio_source).to eq("mic")
        expect(t.applied_to_minutes).to eq(false)
      end

      it "각 건을 transcription_stream으로 broadcast 한다" do
        allow(ActionCable.server).to receive(:broadcast)

        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1) ] }

        expect(ActionCable.server).to have_received(:broadcast).with(
          meeting.transcription_stream,
          hash_including(
            type: "final",
            text: "로컬 전사 1",
            speaker: "",
            seq: 1,
            audio_source: "mic"
          )
        )
      end

      it "잘못된 audio_source는 'mic'으로 보정한다" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1, audio_source: "bogus") ] }

        expect(meeting.transcripts.find_by(sequence_number: 1).audio_source).to eq("mic")
      end

      it "content 공백 건은 건너뛴다" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1, content: "   "), item(seq: 2, content: "유효") ] }

        json = response.parsed_body
        expect(json["created"]).to eq(1)
        expect(meeting.transcripts.pluck(:sequence_number)).to eq([ 2 ])
      end

      it "content 5000자 초과 건은 건너뛴다" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1, content: "x" * 5001), item(seq: 2, content: "ok") ] }

        json = response.parsed_body
        expect(json["created"]).to eq(1)
        expect(meeting.transcripts.pluck(:sequence_number)).to eq([ 2 ])
      end

      it "transcripts가 배열이 아니면 422" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: "nope" }

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    context "멱등성 (같은 sequence_number 재전송)" do
      before { login_as(user) }

      it "중복 행을 만들지 않고 갱신만 한다" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1, content: "최초") ] }
        expect(meeting.transcripts.count).to eq(1)

        # 같은 sequence_number 재전송 (네트워크 재시도 시나리오) → 갱신
        expect {
          post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
               params: { transcripts: [ item(seq: 1, content: "갱신됨") ] }
        }.not_to change { meeting.transcripts.count }

        expect(response).to have_http_status(:ok)
        expect(meeting.transcripts.find_by(sequence_number: 1).content).to eq("갱신됨")
      end

      it "한 배치 안에서도 기존 seq는 업데이트, 신규 seq는 추가" do
        create(:transcript, meeting: meeting, sequence_number: 1, content: "기존",
               speaker_label: "SPEAKER_00", started_at_ms: 0, ended_at_ms: 1000)

        expect {
          post "/api/v1/meetings/#{meeting.id}/transcripts/bulk",
               params: { transcripts: [ item(seq: 1, content: "덮어씀"), item(seq: 2, content: "신규") ] }
        }.to change { meeting.transcripts.count }.by(1)

        expect(meeting.transcripts.find_by(sequence_number: 1).content).to eq("덮어씀")
        expect(meeting.transcripts.find_by(sequence_number: 2).content).to eq("신규")
      end
    end

    context "인증/인가" do
      it "인증을 강제한다 (authenticate_user! before_action 등록)" do
        # 하이브리드 인증: 테스트 환경(비 server_mode)에서는 모든 요청이 local_default_user로
        # 폴백되므로 raw 401을 재현할 수 없다. 대신 인증 강제가 컨트롤러 계약임을 검증한다.
        # (server_mode + 원격 + JWT 없음 → 401 경계는 application_controller 인증 스펙에서 다룸)
        callbacks = Api::V1::TranscriptsController._process_action_callbacks
                      .select { |c| c.kind == :before }
                      .map(&:filter)
        expect(callbacks).to include(:authenticate_user!)
      end

      it "비참여자는 남의 회의에 bulk 생성할 수 없다(403)" do
        login_as(other_user)
        foreign = create(:meeting, creator: user)

        post "/api/v1/meetings/#{foreign.id}/transcripts/bulk",
             params: { transcripts: [ item(seq: 1) ] }

        expect(response).to have_http_status(:forbidden)
        expect(foreign.transcripts.count).to eq(0)
      end

      it "존재하지 않는 meeting은 404" do
        login_as(user)
        post "/api/v1/meetings/999999/transcripts/bulk",
             params: { transcripts: [ item(seq: 1) ] }

        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
