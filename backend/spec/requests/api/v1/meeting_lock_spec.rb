require "rails_helper"

# 회의 잠금(완전 읽기전용) 가드 전수 검증.
# 잠긴 회의(locked_at 있음)에 대한 모든 변조(mutate) 엔드포인트가 403 + "잠긴 회의" 를 내야 한다.
# 허용 목록(읽기·chat·unlock)은 통과해야 한다.
RSpec.describe "Api::V1::MeetingLock", type: :request do
  let(:owner) { create(:user) }
  let!(:meeting) { create(:meeting, creator: owner, locked_at: Time.current) }

  # 자식 픽스처(잠긴 회의에 매달린 레코드들)
  let!(:transcript) { create(:transcript, meeting: meeting) }
  let!(:bookmark)   { create(:meeting_bookmark, meeting: meeting) }
  let!(:contact)    { create(:meeting_contact, meeting: meeting) }
  let!(:attachment) { create(:meeting_attachment, meeting: meeting) }
  let!(:action_item) { create(:action_item, meeting: meeting) }
  let!(:decision)   { create(:decision, meeting: meeting) }
  let!(:block)      { create(:block, meeting: meeting) }
  let!(:glossary) do
    meeting.glossary_entries.create!(from_text: "a", to_text: "b", match_type: "literal", created_by_id: owner.id)
  end

  before { login_as(owner) }

  # ── 변조 엔드포인트 전수 차단 (table-driven) ──
  # [HTTP메서드, 경로, body]
  def blocked_endpoints
    m = meeting.id
    [
      [:patch,  "/api/v1/meetings/#{m}",                                { title: "X" }],
      [:delete, "/api/v1/meetings/#{m}",                                {}],
      [:post,   "/api/v1/meetings/#{m}/start",                          {}],
      [:post,   "/api/v1/meetings/#{m}/stop",                           {}],
      [:post,   "/api/v1/meetings/#{m}/reopen",                         {}],
      [:post,   "/api/v1/meetings/#{m}/pause",                          {}],
      [:post,   "/api/v1/meetings/#{m}/resume",                         {}],
      [:post,   "/api/v1/meetings/#{m}/reset_content",                  {}],
      [:post,   "/api/v1/meetings/#{m}/summarize",                      {}],
      [:post,   "/api/v1/meetings/#{m}/regenerate_stt",                 {}],
      [:post,   "/api/v1/meetings/#{m}/re_diarize",                     {}],
      [:post,   "/api/v1/meetings/#{m}/regenerate_notes",              {}],
      [:patch,  "/api/v1/meetings/#{m}/update_notes",                  { notes: "x" }],
      [:post,   "/api/v1/meetings/#{m}/feedback",                       { feedback: "x" }],
      [:post,   "/api/v1/meetings/#{m}/reapply_glossary",              {}],
      [:post,   "/api/v1/meetings/#{m}/apply_glossary_entry",          {}],
      [:post,   "/api/v1/meetings/#{m}/dismiss_schedule",              {}],
      [:post,   "/api/v1/meetings/move_to_folder",                      { meeting_ids: [m] }],

      # transcripts
      [:post,   "/api/v1/meetings/#{m}/transcripts/bulk",               { transcripts: [] }],
      [:patch,  "/api/v1/meetings/#{m}/transcripts/#{transcript.id}/update_content", { content: "hi" }],
      [:delete, "/api/v1/meetings/#{m}/transcripts/destroy_batch",      { ids: [transcript.id] }],

      # bookmarks
      [:post,   "/api/v1/meetings/#{m}/bookmarks",                      { timestamp_ms: 1000, label: "x" }],
      [:patch,  "/api/v1/meetings/#{m}/bookmarks/#{bookmark.id}",       { label: "y" }],
      [:delete, "/api/v1/meetings/#{m}/bookmarks/#{bookmark.id}",       {}],

      # contacts
      [:patch,  "/api/v1/meetings/#{m}/contacts/#{contact.id}",         { name: "z" }],
      [:delete, "/api/v1/meetings/#{m}/contacts/#{contact.id}",         {}],

      # attachments
      [:post,   "/api/v1/meetings/#{m}/attachments",                    { kind: "link", url: "http://e.com" }],
      [:patch,  "/api/v1/meetings/#{m}/attachments/#{attachment.id}",   { display_name: "n" }],
      [:delete, "/api/v1/meetings/#{m}/attachments/#{attachment.id}",   {}],
      [:patch,  "/api/v1/meetings/#{m}/attachments/#{attachment.id}/reorder", {}],

      # action_items (nested create + top-level update/destroy)
      [:post,   "/api/v1/meetings/#{m}/action_items",                   { action_item: { content: "c" } }],
      [:patch,  "/api/v1/action_items/#{action_item.id}",              { action_item: { content: "c2" } }],
      [:delete, "/api/v1/action_items/#{action_item.id}",              {}],

      # decisions (nested create + top-level update/destroy)
      [:post,   "/api/v1/meetings/#{m}/decisions",                      { decision: { content: "d" } }],
      [:patch,  "/api/v1/decisions/#{decision.id}",                    { decision: { content: "d2" } }],
      [:delete, "/api/v1/decisions/#{decision.id}",                    {}],

      # blocks
      [:post,   "/api/v1/meetings/#{m}/blocks",                         { block: { content: "b" } }],
      [:patch,  "/api/v1/meetings/#{m}/blocks/#{block.id}",             { block: { content: "b2" } }],
      [:delete, "/api/v1/meetings/#{m}/blocks/#{block.id}",             {}],
      [:patch,  "/api/v1/meetings/#{m}/blocks/#{block.id}/reorder",     {}],

      # audio
      [:post,   "/api/v1/meetings/#{m}/audio",                          {}],
      [:post,   "/api/v1/meetings/#{m}/audio_chunk",                    {}],
      [:post,   "/api/v1/meetings/#{m}/audio_finalize",                 {}],

      # glossary (nested create + top-level update/destroy)
      [:post,   "/api/v1/meetings/#{m}/glossary_entries",               { from_text: "c", to_text: "d", match_type: "literal" }],
      [:patch,  "/api/v1/glossary_entries/#{glossary.id}",             { to_text: "z" }],
      [:delete, "/api/v1/glossary_entries/#{glossary.id}",             {}],

      # speakers (가드가 sidecar 호출보다 먼저 → stub 없이도 403)
      [:patch,  "/api/v1/speakers/SPEAKER_00",                          { meeting_id: m, name: "철수" }],
      [:delete, "/api/v1/speakers/destroy_all?meeting_id=#{m}",         {}],
    ]
  end

  it "잠긴 회의의 모든 변조 엔드포인트를 403 + '잠긴 회의' 로 차단한다" do
    blocked_endpoints.each do |verb, path, body|
      send(verb, path, params: body, as: :json)
      expect(response).to have_http_status(:forbidden),
        "#{verb.upcase} #{path} 기대=403 실제=#{response.status} body=#{response.body}"
      expect(response.parsed_body["error"].to_s).to include("잠긴 회의"),
        "#{verb.upcase} #{path} error 메시지에 '잠긴 회의' 없음: #{response.body}"
    end
  end

  it "차단 검증 엔드포인트 개수가 충분하다(회귀 안전망)" do
    expect(blocked_endpoints.size).to be >= 45
  end

  # ── 허용 목록(잠겨도 통과) ──
  describe "허용 엔드포인트" do
    it "chat_messages create 는 잠긴 회의에서도 201" do
      post "/api/v1/meetings/#{meeting.id}/chat_messages", params: { content: "이 회의 요약?" }, as: :json
      expect(response).to have_http_status(:created)
    end

    it "show(읽기) 는 200" do
      get "/api/v1/meetings/#{meeting.id}", as: :json
      expect(response).to have_http_status(:ok)
    end

    it "unlock 은 200 이고 잠금이 풀린다" do
      delete "/api/v1/meetings/#{meeting.id}/lock", as: :json
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.locked?).to be false
    end
  end

  # ── unlock 후 재통과 ──
  describe "unlock 후 변조 재허용" do
    before { delete "/api/v1/meetings/#{meeting.id}/lock", as: :json }

    it "update(title) 200" do
      patch "/api/v1/meetings/#{meeting.id}", params: { title: "새 제목" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.title).to eq("새 제목")
    end

    it "bookmark create 201" do
      post "/api/v1/meetings/#{meeting.id}/bookmarks", params: { timestamp_ms: 2000, label: "ok" }, as: :json
      expect(response).to have_http_status(:created)
    end
  end

  # ── 권한 (잠금/해제는 소유자·admin 만) ──
  describe "lock/unlock 권한" do
    let(:other) { create(:user) }
    let!(:unlocked) { create(:meeting, creator: owner) }

    it "타인은 lock 403" do
      login_as(other)
      post "/api/v1/meetings/#{unlocked.id}/lock", as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"].to_s).to include("권한")
    end

    it "타인은 unlock 403" do
      login_as(other)
      delete "/api/v1/meetings/#{meeting.id}/lock", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "소유자는 lock 200 이고 잠긴다" do
      post "/api/v1/meetings/#{unlocked.id}/lock", as: :json
      expect(response).to have_http_status(:ok)
      expect(unlocked.reload.locked?).to be true
    end

    it "admin 은 lock/unlock 200" do
      admin = create(:user, :admin)
      login_as(admin)
      post "/api/v1/meetings/#{unlocked.id}/lock", as: :json
      expect(response).to have_http_status(:ok)
      delete "/api/v1/meetings/#{unlocked.id}/lock", as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  # ── 회귀 안전망: 잠그지 않은 회의는 기존 동작 100% 보존 ──
  describe "잠그지 않은 회의는 가드가 막지 않는다" do
    let!(:free) { create(:meeting, creator: owner) }

    it "update(title) 200" do
      patch "/api/v1/meetings/#{free.id}", params: { title: "수정" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "bookmark create 201" do
      post "/api/v1/meetings/#{free.id}/bookmarks", params: { timestamp_ms: 3000, label: "x" }, as: :json
      expect(response).to have_http_status(:created)
    end
  end
end
