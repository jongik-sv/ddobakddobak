require "rails_helper"

# 계약 문서(dflow-minutes-upload-api-spec.md §3~§7)의 응답 예시를 픽스처로 사용한다.
RSpec.describe DflowClient, type: :service do
  let(:secret) { "super-secret-value-xyz-should-never-leak" }
  let(:client) { described_class.new }
  let(:mock_http) { instance_double(Net::HTTP) }

  before do
    allow(AppSettings).to receive(:load).and_return(
      "dflow" => { "enabled" => true, "base_url" => "https://dflow.example.com", "api_secret" => secret }
    )
    allow(Net::HTTP).to receive(:new).and_return(mock_http)
    allow(mock_http).to receive(:use_ssl=)
    allow(mock_http).to receive(:open_timeout=)
    allow(mock_http).to receive(:read_timeout=)
    allow(mock_http).to receive(:start).and_yield(mock_http)
  end

  def stub_response(body, code:)
    instance_double(Net::HTTPResponse, code: code.to_s, body: body.to_json)
  end

  # ── #upload_minute — 계약 §4.3 응답 예시를 픽스처로 사용 ──

  describe "#upload_minute" do
    let(:payload) do
      {
        user_email: "jjinie73@gmail.com",
        date: "2026-07-16",
        team: "MES",
        title: "물류-물류공정_260716",
        body_markdown: "# 물류공정_260716\n\n본문",
        external_id: "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
        on_conflict: "replace"
      }
    end

    # 계약 §4.3 응답 예시 그대로
    let(:contract_response) do
      {
        "ok" => true,
        "id" => "3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90",
        "action" => "created",
        "title" => "물류-물류공정_260716",
        "date" => "2026-07-16",
        "team" => "MES",
        "meeting_id" => nil,
        "external_id" => "ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77",
        "created_by_name" => "홍길동",
        "url" => "https://wbs-web.vercel.app/minutes/3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90",
        "created_at" => "2026-07-19T10:12:00+09:00",
        "updated_at" => "2026-07-19T10:12:00+09:00"
      }
    end

    it "2xx 응답을 파싱해 Hash로 반환한다 (201 created)" do
      response = stub_response(contract_response, code: 201)
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(response)

      result = client.upload_minute(payload)
      expect(result["ok"]).to eq(true)
      expect(result["action"]).to eq("created")
      expect(result["url"]).to eq("https://wbs-web.vercel.app/minutes/3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90")
    end

    it "Authorization: Bearer <api_secret> 헤더와 JSON Content-Type을 보낸다" do
      captured = nil
      allow(mock_http).to receive(:request) do |req|
        captured = req
        stub_response(contract_response, code: 200)
      end

      client.upload_minute(payload)
      expect(captured["Authorization"]).to eq("Bearer #{secret}")
      expect(captured["Content-Type"]).to eq("application/json")
      expect(JSON.parse(captured.body)["user_email"]).to eq("jjinie73@gmail.com")
    end

    it "200 (replace) 도 정상 파싱된다" do
      response = stub_response(contract_response.merge("action" => "replaced"), code: 200)
      allow(mock_http).to receive(:request).and_return(response)

      result = client.upload_minute(payload)
      expect(result["action"]).to eq("replaced")
    end

    it "401 → AuthError (시크릿 불일치)" do
      response = stub_response({ "error" => "인증이 필요합니다." }, code: 401)
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.upload_minute(payload) }.to raise_error(DflowClient::AuthError)
    end

    it "404(JSON 바디 없음=env 미개통) → AuthError" do
      response = instance_double(Net::HTTPResponse, code: "404", body: "<html>Not Found</html>")
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.upload_minute(payload) }.to raise_error(DflowClient::AuthError, /미개통|URL/)
    end

    it "403 code=unknown_user → UnknownUserError (계약 §3.4)" do
      response = stub_response(
        { "error" => "해당 이메일의 D'Flow 사용자가 없습니다.", "code" => "unknown_user" },
        code: 403
      )
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.upload_minute(payload) }.to raise_error(DflowClient::UnknownUserError, /사용자가 없습니다/)
    end

    it "409 code=conflict(그 외 code) → ApiError (code·status 보존)" do
      response = stub_response({ "error" => "이미 존재", "code" => "conflict" }, code: 409)
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.upload_minute(payload) }.to raise_error(DflowClient::ApiError) do |e|
        expect(e.code).to eq("conflict")
        expect(e.status).to eq(409)
      end
    end

    it "400 validation_failed → ApiError" do
      response = stub_response({ "error" => "team은 PMO, ERP, MES, 가공, MDM 중 하나여야 합니다.", "code" => "validation_failed" }, code: 400)
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.upload_minute(payload) }.to raise_error(DflowClient::ApiError) do |e|
        expect(e.code).to eq("validation_failed")
        expect(e.status).to eq(400)
      end
    end

    it "500 internal_error → ApiError" do
      response = stub_response({ "error" => "서버 오류", "code" => "internal_error" }, code: 500)
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.upload_minute(payload) }.to raise_error(DflowClient::ApiError)
    end

    it "Net::ReadTimeout → TimeoutError" do
      allow(mock_http).to receive(:start).and_raise(Net::ReadTimeout)
      expect { client.upload_minute(payload) }.to raise_error(DflowClient::TimeoutError)
    end

    it "Net::OpenTimeout → TimeoutError" do
      allow(mock_http).to receive(:start).and_raise(Net::OpenTimeout)
      expect { client.upload_minute(payload) }.to raise_error(DflowClient::TimeoutError)
    end

    it "ECONNREFUSED → ConnectionError" do
      allow(mock_http).to receive(:start).and_raise(Errno::ECONNREFUSED)
      expect { client.upload_minute(payload) }.to raise_error(DflowClient::ConnectionError)
    end

    it "SocketError → ConnectionError" do
      allow(mock_http).to receive(:start).and_raise(SocketError.new("getaddrinfo failed"))
      expect { client.upload_minute(payload) }.to raise_error(DflowClient::ConnectionError)
    end

    it "어떤 에러 메시지에도 api_secret 값이 노출되지 않는다" do
      responses = [
        stub_response({ "error" => "인증이 필요합니다." }, code: 401),
        stub_response({ "error" => "없음", "code" => "unknown_user" }, code: 403),
        stub_response({ "error" => "충돌", "code" => "link_conflict" }, code: 409),
        stub_response({ "error" => "오류", "code" => "internal_error" }, code: 500)
      ]

      responses.each do |response|
        allow(mock_http).to receive(:request).and_return(response)
        begin
          client.upload_minute(payload)
        rescue DflowClient::Error => e
          expect(e.message).not_to include(secret)
        end
      end
    end
  end

  # ── #link_minute — 계약 §4b ──

  describe "#link_minute" do
    it "200 action=linked 를 그대로 반환한다 (계약 §4b 성공 응답)" do
      response = stub_response(
        { "ok" => true, "id" => "minute-uuid", "action" => "linked", "external_id" => "ddobak:uid" },
        code: 200
      )
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(response)

      result = client.link_minute(minute_id: "minute-uuid", external_id: "ddobak:uid", user_email: "a@b.com")
      expect(result["action"]).to eq("linked")
    end

    it "409 code=link_conflict → LinkConflictError" do
      response = stub_response({ "error" => "이미 다른 external_id로 연결됨", "code" => "link_conflict" }, code: 409)
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.link_minute(minute_id: "x", external_id: "ddobak:uid", user_email: "a@b.com") }
        .to raise_error(DflowClient::LinkConflictError)
    end

    it "404 (JSON 바디 code=not_found — minute_id 불존재, env 미개통 404와 구분) → ApiError code=not_found" do
      response = stub_response({ "error" => "회의록을 찾을 수 없습니다.", "code" => "not_found" }, code: 404)
      allow(mock_http).to receive(:request).and_return(response)

      expect { client.link_minute(minute_id: "x", external_id: "ddobak:uid", user_email: "a@b.com") }
        .to raise_error(DflowClient::ApiError) { |e| expect(e.code).to eq("not_found") }
    end
  end

  # ── #list_minutes — 계약 §5.1 ──

  describe "#list_minutes" do
    it "items/total/page/per_page 를 파싱한다 (계약 §5.1)" do
      response = stub_response(
        { "items" => [ { "id" => "1", "title" => "t", "external_id" => "ddobak:uid" } ], "total" => 1, "page" => 1, "per_page" => 20 },
        code: 200
      )
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Get)).and_return(response)

      result = client.list_minutes(external_id: "ddobak:uid")
      expect(result["items"].first["external_id"]).to eq("ddobak:uid")
      expect(result["total"]).to eq(1)
    end
  end

  # ── #meta — 계약 §5.2 ──

  describe "#meta" do
    it "teams/projects/limits 를 파싱한다 (계약 §5.2)" do
      response = stub_response(
        {
          "teams" => %w[PMO ERP MES 가공 MDM],
          "projects" => [ { "id" => "uuid", "name" => "D-CUBE 프로젝트" } ],
          "limits" => { "max_body_chars" => 100_000, "max_request_bytes" => 4_194_304, "max_attachments" => 10, "max_attachment_bytes" => 20_971_520 }
        },
        code: 200
      )
      allow(mock_http).to receive(:request).with(instance_of(Net::HTTP::Get)).and_return(response)

      result = client.meta
      expect(result["teams"]).to eq(%w[PMO ERP MES 가공 MDM])
      expect(result["limits"]["max_body_chars"]).to eq(100_000)
    end

    it "project_id 를 쿼리로 전달한다" do
      captured_uri = nil
      allow(mock_http).to receive(:request) do |req|
        captured_uri = req.path
        stub_response({ "teams" => [], "projects" => [], "limits" => {} }, code: 200)
      end

      client.meta(project_id: "proj-uuid")
      expect(captured_uri).to include("project_id=proj-uuid")
    end
  end
end
