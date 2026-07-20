require "rails_helper"

# D'Flow 전송/연결/조회 프록시 HTTP 경계 테스트.
# - upload/link/claim  → editable_by? 게이트(소유자/admin)
# - status              → accessible_by 읽기 게이트만(공유 멤버도 조회 가능)
# - dflow/minutes, dflow/meta → 로그인 사용자면 허용(프록시, 시크릿 비노출)
RSpec.describe "Api::V1::MeetingDflow", type: :request do
  let!(:editor)   { create(:user) }        # 회의 소유자 = editable_by? 통과
  let!(:member)   { create(:user) }        # 프로젝트 멤버, 비소유자 = editable_by? 실패(읽기는 가능)
  let!(:outsider) { create(:user) }        # 비멤버 = accessible_by 실패

  let!(:project) { create(:project, creator: editor) }
  let!(:meeting) do
    create(:meeting, creator: editor, project: project, shared: true, status: "completed", title: "D'Flow 테스트 회의")
  end

  let(:dflow_client) { instance_double(DflowClient) }

  before do
    ProjectMembership.find_or_create_by!(project_id: project.id, user_id: member.id) { |pm| pm.role = "member" }
    allow(DflowClient).to receive(:new).and_return(dflow_client)
  end

  # ── POST /dflow/upload ─────────────────────────────────────────────────

  describe "POST /api/v1/meetings/:id/dflow/upload" do
    context "소유자(editable_by? 통과)" do
      before { login_as(editor) }

      it "DflowUploadService 를 team/title override와 함께 호출하고 최신 dflow 상태를 반환한다" do
        allow(DflowUploadService).to receive(:call) do |m, user, **_kwargs|
          expect(m).to eq(meeting)
          expect(user).to eq(editor)
          m.update!(public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
                    dflow_synced_at: Time.current,
                    dflow_url: "https://dflow.example.com/minutes/abc")
          { "ok" => true }
        end

        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: { team: "MES", title: "커스텀" }, as: :json

        expect(response).to have_http_status(:ok)
        body = response.parsed_body
        expect(body["public_uid"]).to eq("0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
        expect(body["dflow_url"]).to eq("https://dflow.example.com/minutes/abc")
        expect(DflowUploadService).to have_received(:call)
          .with(meeting, editor, team_override: "MES", title_override: "커스텀")
      end

      it "TeamRequiredError → 422 code=team_required" do
        allow(DflowUploadService).to receive(:call).and_raise(DflowUploadService::TeamRequiredError, "판정 불가")
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["code"]).to eq("team_required")
      end

      it "BodyTooLongError → 422 code=body_too_long" do
        allow(DflowUploadService).to receive(:call).and_raise(DflowUploadService::BodyTooLongError, "초과")
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["code"]).to eq("body_too_long")
      end

      it "DflowClient::UnknownUserError → 422 code=dflow_unknown_user (호출자 이메일 포함)" do
        allow(DflowUploadService).to receive(:call).and_raise(DflowClient::UnknownUserError, "사용자 없음")
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        body = response.parsed_body
        expect(body["code"]).to eq("dflow_unknown_user")
        expect(body["error"]).to include(editor.email)
      end

      it "DflowClient::AuthError → 502" do
        allow(DflowUploadService).to receive(:call).and_raise(DflowClient::AuthError, "인증 실패")
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:bad_gateway)
        expect(response.parsed_body["code"]).to eq("dflow_auth_error")
      end

      it "DflowClient::ConnectionError → 502" do
        allow(DflowUploadService).to receive(:call).and_raise(DflowClient::ConnectionError, "연결 실패")
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:bad_gateway)
        expect(response.parsed_body["code"]).to eq("dflow_connection_error")
      end

      it "DflowClient::TimeoutError → 502" do
        allow(DflowUploadService).to receive(:call).and_raise(DflowClient::TimeoutError, "타임아웃")
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:bad_gateway)
        expect(response.parsed_body["code"]).to eq("dflow_connection_error")
      end

      it "DflowClient::ApiError → 502 (원 code 보존)" do
        allow(DflowUploadService).to receive(:call)
          .and_raise(DflowClient::ApiError.new("검증 실패", code: "validation_failed", status: 400))
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:bad_gateway)
        expect(response.parsed_body["code"]).to eq("validation_failed")
      end
    end

    context "프로젝트 멤버(비소유자, editable_by? 실패)" do
      before { login_as(member) }

      it "403" do
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "비멤버(accessible_by 실패)" do
      before { login_as(outsider) }

      it "404" do
        post "/api/v1/meetings/#{meeting.id}/dflow/upload", params: {}, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ── GET /dflow/status ──────────────────────────────────────────────────

  describe "GET /api/v1/meetings/:id/dflow/status" do
    before { login_as(editor) }

    it "public_uid 없으면 exists_on_dflow 를 포함하지 않는다(D'Flow 조회 자체를 안 함)" do
      expect(dflow_client).not_to receive(:list_minutes)
      get "/api/v1/meetings/#{meeting.id}/dflow/status"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["public_uid"]).to be_nil
      expect(body).not_to have_key("exists_on_dflow")
    end

    it "public_uid 있으면 list_minutes 로 실존재를 확인해 exists_on_dflow=true 를 포함한다" do
      meeting.update!(public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77", dflow_synced_at: 1.day.ago,
                      dflow_url: "https://x/minutes/1")
      allow(dflow_client).to receive(:list_minutes)
        .with(external_id: "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
        .and_return({ "items" => [ { "id" => "1" } ], "total" => 1 })

      get "/api/v1/meetings/#{meeting.id}/dflow/status"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["exists_on_dflow"]).to eq(true)
    end

    it "D'Flow에 레코드가 없으면 exists_on_dflow=false" do
      meeting.update!(public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
      allow(dflow_client).to receive(:list_minutes).and_return({ "items" => [], "total" => 0 })

      get "/api/v1/meetings/#{meeting.id}/dflow/status"
      expect(response.parsed_body["exists_on_dflow"]).to eq(false)
    end

    it "공유된 회의는 프로젝트 멤버(비소유자)도 조회 가능하다(읽기는 accessible_by)" do
      login_as(member)
      get "/api/v1/meetings/#{meeting.id}/dflow/status"
      expect(response).to have_http_status(:ok)
    end
  end

  # ── PUT /dflow/link ────────────────────────────────────────────────────

  describe "PUT /api/v1/meetings/:id/dflow/link" do
    before { login_as(editor) }

    it "유효한 UUID면 public_uid 를 갱신한다" do
      put "/api/v1/meetings/#{meeting.id}/dflow/link",
          params: { public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.public_uid).to eq("0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
    end

    it "UUID 형식이 아니면 422 code=invalid_uuid" do
      put "/api/v1/meetings/#{meeting.id}/dflow/link", params: { public_uid: "not-a-uuid" }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["code"]).to eq("invalid_uuid")
    end

    it "다른 회의가 이미 사용 중이면 422 code=public_uid_conflict" do
      other = create(:meeting, creator: editor, project: project, public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77")
      put "/api/v1/meetings/#{meeting.id}/dflow/link", params: { public_uid: other.public_uid }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["code"]).to eq("public_uid_conflict")
    end

    it "null(빈 값)이면 해제한다(+dflow_synced_at·dflow_url 도 null)" do
      meeting.update!(public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77", dflow_synced_at: Time.current,
                      dflow_url: "https://x/minutes/1")
      put "/api/v1/meetings/#{meeting.id}/dflow/link", params: { public_uid: "" }, as: :json
      expect(response).to have_http_status(:ok)
      meeting.reload
      expect(meeting.public_uid).to be_nil
      expect(meeting.dflow_synced_at).to be_nil
      expect(meeting.dflow_url).to be_nil
    end

    it "비소유자는 403" do
      login_as(member)
      put "/api/v1/meetings/#{meeting.id}/dflow/link",
          params: { public_uid: "0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  # ── POST /dflow/claim ──────────────────────────────────────────────────

  describe "POST /api/v1/meetings/:id/dflow/claim" do
    before { login_as(editor) }

    it "public_uid 없으면 발급 후 link_minute 호출, 성공 시 dflow_url 갱신" do
      allow(dflow_client).to receive(:base_url).and_return("https://dflow.example.com")
      allow(dflow_client).to receive(:link_minute)
        .with(minute_id: "minute-uuid", external_id: kind_of(String), user_email: editor.email)
        .and_return({ "ok" => true, "id" => "minute-uuid", "action" => "linked" })

      post "/api/v1/meetings/#{meeting.id}/dflow/claim", params: { minute_id: "minute-uuid" }, as: :json

      expect(response).to have_http_status(:ok)
      meeting.reload
      expect(meeting.public_uid).to be_present
      expect(meeting.dflow_url).to eq("https://dflow.example.com/minutes/minute-uuid")
    end

    it "이미 public_uid 가 있으면 재발급하지 않는다" do
      meeting.update!(public_uid: "existing-uid")
      allow(dflow_client).to receive(:base_url).and_return("https://dflow.example.com")
      allow(dflow_client).to receive(:link_minute)
        .with(minute_id: "minute-uuid", external_id: "ddobak:existing-uid", user_email: editor.email)
        .and_return({ "ok" => true, "id" => "minute-uuid" })

      post "/api/v1/meetings/#{meeting.id}/dflow/claim", params: { minute_id: "minute-uuid" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.public_uid).to eq("existing-uid")
    end

    it "minute_id 없으면 422" do
      post "/api/v1/meetings/#{meeting.id}/dflow/claim", params: {}, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["code"]).to eq("validation_failed")
    end

    it "DflowClient::LinkConflictError(409) 를 그대로 전파한다" do
      allow(dflow_client).to receive(:link_minute).and_raise(DflowClient::LinkConflictError, "이미 연결됨")
      post "/api/v1/meetings/#{meeting.id}/dflow/claim", params: { minute_id: "minute-uuid" }, as: :json
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("dflow_link_conflict")
    end

    it "비소유자는 403" do
      login_as(member)
      post "/api/v1/meetings/#{meeting.id}/dflow/claim", params: { minute_id: "minute-uuid" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  # ── 프록시: GET /dflow/minutes, GET /dflow/meta ───────────────────────

  describe "GET /api/v1/dflow/minutes" do
    before { login_as(editor) }

    it "로그인 사용자면 조회 가능하고 파라미터를 passthrough 한다" do
      allow(dflow_client).to receive(:list_minutes)
        .with(hash_including("team" => "MES", "date_from" => "2026-07-01"))
        .and_return({ "items" => [], "total" => 0, "page" => 1, "per_page" => 20 })

      get "/api/v1/dflow/minutes", params: { team: "MES", date_from: "2026-07-01" }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["total"]).to eq(0)
    end

    it "프로젝트 멤버(비소유자)도 조회 가능하다(인증만 필요)" do
      login_as(member)
      allow(dflow_client).to receive(:list_minutes).and_return({ "items" => [], "total" => 0 })
      get "/api/v1/dflow/minutes"
      expect(response).to have_http_status(:ok)
    end
  end

  describe "GET /api/v1/dflow/meta" do
    before { login_as(editor) }

    it "meta 를 그대로 반환한다" do
      allow(dflow_client).to receive(:meta).with(project_id: nil)
        .and_return({ "teams" => %w[MES], "projects" => [], "limits" => {} })

      get "/api/v1/dflow/meta"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["teams"]).to eq(%w[MES])
    end

    it "project_id 쿼리를 client.meta 로 전달한다" do
      allow(dflow_client).to receive(:meta).with(project_id: "proj-uuid")
        .and_return({ "teams" => [], "projects" => [], "limits" => {} })

      get "/api/v1/dflow/meta", params: { project_id: "proj-uuid" }
      expect(response).to have_http_status(:ok)
    end
  end
end
