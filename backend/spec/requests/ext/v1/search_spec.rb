require "rails_helper"

RSpec.describe "GET /api/ext/v1/search", type: :request do
  let(:project)       { create(:project) }
  let(:owner)         { project.creator }
  let(:other_project) { create(:project) }

  def issue_token(user:, scopes: %w[search:read], **attrs)
    ApiToken.issue!(user: user, name: "테스트", scopes: scopes, expires_at: 1.day.from_now, **attrs)
  end

  def auth_header(plaintext)
    { "Authorization" => "Bearer #{plaintext}" }
  end

  before do
    create(:project_membership, user: owner, project: project, role: "member")
  end

  let!(:meeting)    { create(:meeting, project: project, creator: owner) }
  let!(:transcript) { create(:transcript, meeting: meeting, content: "예산안 검토 회의", speaker_label: "화자1") }
  let!(:summary)    { create(:summary, meeting: meeting, notes_markdown: "예산안 요약 초안") }

  describe "인증/스코프" do
    it "q 누락이면 422 query_required" do
      _t, plaintext = issue_token(user: owner)
      get "/api/ext/v1/search", headers: auth_header(plaintext)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]["code"]).to eq("query_required")
    end

    it "search:read 스코프 없는 토큰이면 403" do
      _t, plaintext = issue_token(user: owner, scopes: %w[meetings:read])
      get "/api/ext/v1/search", params: { q: "예산" }, headers: auth_header(plaintext)
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]["code"]).to eq("insufficient_scope")
    end

    it "q가 공백만이면 422 query_required" do
      _t, plaintext = issue_token(user: owner)
      get "/api/ext/v1/search", params: { q: "   " }, headers: auth_header(plaintext)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]["code"]).to eq("query_required")
    end
  end

  describe "정상 검색" do
    it "FTS 히트를 전사·요약 결과에 반환하고 감사 로그를 남긴다" do
      _t, plaintext = issue_token(user: owner)
      allow(TranscriptVectorSearch).to receive(:search_multi).and_return([ [] ])

      expect {
        get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)
      }.to change(ApiTokenAuditLog, :count).by(1)

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["results"]["transcripts"].first["transcript_id"]).to eq(transcript.id)
      expect(body["results"]["transcripts"].first["meeting_title"]).to eq(meeting.title)
      expect(body["results"]["summaries"].first["summary_id"]).to eq(summary.id)
      expect(body["meta"]["vector_used"]).to eq(true)

      log = ApiTokenAuditLog.last
      expect(log.action).to eq("search.index")
    end
  end

  describe "벡터 폴백" do
    it "TranscriptVectorSearch가 예외를 던지면 200 + vector_used false + FTS 결과는 정상" do
      _t, plaintext = issue_token(user: owner)
      allow(TranscriptVectorSearch).to receive(:search_multi).and_raise(StandardError, "sidecar down")

      get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["meta"]["vector_used"]).to eq(false)
      expect(body["results"]["transcripts"].first["transcript_id"]).to eq(transcript.id)
    end
  end

  describe "하이브리드 융합" do
    it "FTS 순위와 벡터 순위(stub)를 RRF로 융합한다" do
      other = create(:transcript, meeting: meeting, content: "일정 조율 미팅", speaker_label: "화자2")

      _t, plaintext = issue_token(user: owner)
      # FTS: "예산안"은 transcript만 매칭. 벡터: other가 1순위, transcript가 2순위로 온다고 stub.
      allow(TranscriptVectorSearch).to receive(:search_multi).and_return(
        [ [ { transcript_id: other.id, score: 0.9 }, { transcript_id: transcript.id, score: 0.5 } ] ]
      )

      get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)

      ids = response.parsed_body["results"]["transcripts"].map { |r| r["transcript_id"] }
      expect(ids).to include(transcript.id, other.id)
      # transcript: FTS 1위 + 벡터 2위 → RRF 스코어가 벡터 1위뿐인 other보다 높다.
      expect(ids.first).to eq(transcript.id)
    end
  end

  describe "스코프 격리" do
    it "벡터 검색에 스코프 회의 id만 전달된다 (meeting_ids가 인가 경계)" do
      stranger = create(:user)
      secret_meeting = create(:meeting, project: other_project, creator: stranger, shared: false)
      create(:transcript, meeting: secret_meeting, content: "예산안 비밀", speaker_label: "화자1")

      _t, plaintext = issue_token(user: owner)
      expect(TranscriptVectorSearch).to receive(:search_multi)
        .with(hash_including(meeting_ids: [ meeting.id ])).and_return([ [] ])

      get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)
      expect(response).to have_http_status(:ok)
    end

    it "벡터 검색이 스코프 밖 transcript id를 반환해도 응답에 노출되지 않는다 (방어선)" do
      stranger = create(:user)
      secret_meeting = create(:meeting, project: other_project, creator: stranger, shared: false)
      secret_transcript = create(:transcript, meeting: secret_meeting, content: "무관 내용", speaker_label: "화자1")

      _t, plaintext = issue_token(user: owner)
      allow(TranscriptVectorSearch).to receive(:search_multi)
        .and_return([ [ { transcript_id: secret_transcript.id, score: 0.99 } ] ])

      get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)

      ids = response.parsed_body["results"]["transcripts"].map { |r| r["transcript_id"] }
      expect(ids).not_to include(secret_transcript.id)
    end

    it "타 사용자 소유·비공유 회의는 검색어 일치에도 노출되지 않는다" do
      stranger = create(:user)
      secret_meeting = create(:meeting, project: other_project, creator: stranger, shared: false)
      create(:transcript, meeting: secret_meeting, content: "예산안 극비 문서", speaker_label: "화자1")
      create(:summary, meeting: secret_meeting, notes_markdown: "예산안 극비 요약")

      _t, plaintext = issue_token(user: owner)
      allow(TranscriptVectorSearch).to receive(:search_multi).and_return([ [] ])

      get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)

      body = response.parsed_body
      titles = body["results"]["transcripts"].map { |r| r["meeting_title"] }
      snippets = (body["results"]["transcripts"] + body["results"]["summaries"]).map { |r| r["snippet"] }
      expect(titles).not_to include(secret_meeting.title)
      expect(snippets.join).not_to include("극비")
    end

    it "토큰 project_ids 제한 밖 회의는 (본인 소유라도) 노출되지 않는다" do
      create(:project_membership, user: owner, project: other_project, role: "member")
      other_meeting = create(:meeting, project: other_project, creator: owner, shared: true)
      create(:transcript, meeting: other_meeting, content: "예산안 다른 프로젝트", speaker_label: "화자1")

      _t, plaintext = issue_token(user: owner, project_ids: [ project.id ])
      allow(TranscriptVectorSearch).to receive(:search_multi).and_return([ [] ])

      get "/api/ext/v1/search", params: { q: "예산안" }, headers: auth_header(plaintext)

      titles = response.parsed_body["results"]["transcripts"].map { |r| r["meeting_title"] }
      expect(titles).not_to include(other_meeting.title)
      expect(titles).to include(meeting.title)
    end
  end
end
