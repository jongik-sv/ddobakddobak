require "rails_helper"

RSpec.describe "Ext::V1::MeetingWrites", type: :request do
  let(:owner)    { create(:user) }
  let(:outsider) { create(:user) } # 프로젝트 멤버도 아닌 무관 사용자
  let(:member)   { create(:user) } # 프로젝트 멤버(협업자 아님) — "공유로만 보이는" 티어
  let(:project)  { create(:project, creator: owner) }

  before do
    create(:project_membership, user: owner, project: project, role: "member")
    create(:project_membership, user: member, project: project, role: "member")
  end

  def issue_token(user, scopes: %w[meetings:write], **attrs)
    ApiToken.issue!(user: user, name: "테스트", scopes: scopes, expires_at: 1.day.from_now, **attrs)
  end

  def auth(plaintext)
    { "Authorization" => "Bearer #{plaintext}" }
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/ext/v1/meetings (create)
  # ─────────────────────────────────────────────────────────
  describe "POST /api/ext/v1/meetings" do
    include ActiveJob::TestHelper

    def create_params(overrides = {})
      {
        title: "회의록 임포트",
        project_id: project.id,
        transcripts: [
          { speaker_name: "철수", content: "안건 하나입니다" },
          { speaker_name: "영희", content: "동의합니다", started_at_ms: 5_000, ended_at_ms: 6_000 }
        ]
      }.merge(overrides)
    end

    it "happy path: 201 + 회의·전사 생성 + FTS 색인 + 임베딩 백필 enqueue" do
      _token, plaintext = issue_token(owner)

      expect {
        post "/api/ext/v1/meetings", params: create_params(folder_id: nil), headers: auth(plaintext), as: :json
      }.to have_enqueued_job(EmbedBackfillJob)

      expect(response).to have_http_status(:created)
      body = response.parsed_body["meeting"]
      expect(body["title"]).to eq("회의록 임포트")
      expect(body["status"]).to eq("completed")
      expect(body["project_id"]).to eq(project.id)

      meeting = Meeting.find(body["id"])
      expect(meeting.transcripts.count).to eq(2)
      expect(meeting.transcripts.order(:sequence_number).pluck(:speaker_name)).to eq(%w[철수 영희])

      first = meeting.transcripts.order(:sequence_number).first
      row = ActiveRecord::Base.connection.select_one(
        "SELECT content FROM transcripts_fts WHERE source_id = #{first.id}"
      )
      expect(row["content"]).to eq("안건 하나입니다")
    end

    it "빈 transcripts 배열도 허용한다" do
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings", params: create_params(transcripts: []), headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:created)
      expect(Meeting.find(response.parsed_body["meeting"]["id"]).transcripts.count).to eq(0)
    end

    it "프로젝트 멤버가 아니면 403" do
      _token, plaintext = issue_token(outsider)
      post "/api/ext/v1/meetings", params: create_params, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "토큰의 project_ids 제한 밖이면 403" do
      other_project = create(:project, creator: owner)
      create(:project_membership, user: owner, project: other_project, role: "member")
      _token, plaintext = issue_token(owner, project_ids: [ other_project.id ])

      post "/api/ext/v1/meetings", params: create_params, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "다른 프로젝트의 folder_id면 422" do
      other_project = create(:project)
      foreign_folder = create(:folder, project: other_project)
      _token, plaintext = issue_token(owner)

      post "/api/ext/v1/meetings", params: create_params(folder_id: foreign_folder.id), headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end

    # Important #1(리뷰): 존재하지 않는 folder_id가 조용히 폐기되어 폴더 없이 201이 나가면 안 된다.
    it "존재하지 않는 folder_id면 422이고 회의가 생성되지 않는다" do
      _token, plaintext = issue_token(owner)

      expect {
        post "/api/ext/v1/meetings", params: create_params(folder_id: 999_999), headers: auth(plaintext), as: :json
      }.not_to change(Meeting, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]["code"]).to eq("invalid_folder")
    end

    it "meetings:write 스코프가 없으면 403" do
      _token, plaintext = issue_token(owner, scopes: %w[meetings:read])
      post "/api/ext/v1/meetings", params: create_params, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    # Important #2(리뷰): 토큰 folder_ids 서브트리 제한의 create 403 분기가 무검증이었다.
    context "토큰 folder_ids 제한" do
      let(:root)  { create(:folder, project: project) }
      let(:leaf)  { create(:folder, project: project, parent: root) }
      let(:other) { create(:folder, project: project) }

      it "제한 서브트리 안의 폴더로는 생성에 성공한다" do
        _token, plaintext = issue_token(owner, folder_ids: [ root.id ])

        post "/api/ext/v1/meetings", params: create_params(folder_id: leaf.id), headers: auth(plaintext), as: :json

        expect(response).to have_http_status(:created)
        expect(response.parsed_body["meeting"]["folder_id"]).to eq(leaf.id)
      end

      it "제한 서브트리 밖의 폴더로는 403이고 회의가 생성되지 않는다" do
        _token, plaintext = issue_token(owner, folder_ids: [ root.id ])

        expect {
          post "/api/ext/v1/meetings", params: create_params(folder_id: other.id), headers: auth(plaintext), as: :json
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # 공통 인가·가드 (audio/summarize 대표로 검증 — set_writable_meeting!/guard concern 공유 코드)
  # ─────────────────────────────────────────────────────────
  describe "쓰기 인가" do
    include ActiveJob::TestHelper

    let!(:meeting) { create(:meeting, project: project, creator: owner, status: "completed") }

    it "직접 협업자는 summarize를 실행할 수 있다" do
      create(:transcript, meeting: meeting)
      MeetingCollaborator.create!(meeting: meeting, user: outsider)
      _token, plaintext = issue_token(outsider)

      expect {
        post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      }.to have_enqueued_job(MeetingSummarizationJob)
      expect(response).to have_http_status(:accepted)
    end

    it "폴더 상속 협업자(조상 폴더의 FolderCollaborator)도 summarize를 실행할 수 있다" do
      root = create(:folder, project: project)
      leaf = create(:folder, project: project, parent: root)
      folder_meeting = create(:meeting, project: project, creator: owner, folder: leaf, shared: false, status: "completed")
      create(:transcript, meeting: folder_meeting)
      FolderCollaborator.create!(folder: root, user: outsider)
      _token, plaintext = issue_token(outsider)

      expect {
        post "/api/ext/v1/meetings/#{folder_meeting.id}/summarize", headers: auth(plaintext)
      }.to have_enqueued_job(MeetingSummarizationJob)
      expect(response).to have_http_status(:accepted)
    end

    it "공유로만 보이는 프로젝트 멤버(협업자 아님)는 403" do
      meeting.update!(shared: true)
      _token, plaintext = issue_token(member)
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:forbidden)
    end

    it "무관한 사용자에게는 404 (존재 은폐)" do
      _token, plaintext = issue_token(outsider)
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:not_found)
    end

    it "meetings:write 스코프가 없는 토큰은 403" do
      _token, plaintext = issue_token(owner, scopes: %w[meetings:read])
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "잠금·절단 가드" do
    let!(:meeting) { create(:meeting, project: project, creator: owner, status: "completed") }

    it "잠긴 회의의 summarize는 409 (code: meeting_locked)" do
      meeting.update!(locked_at: Time.current)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("meeting_locked")
    end

    it "절단된 회의의 summarize는 409 (code: meeting_redacted)" do
      meeting.update!(transcripts_redacted_at: Time.current)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("meeting_redacted")
    end

    it "잠긴 회의의 audio 업로드는 409 (code: meeting_locked)" do
      meeting.update!(locked_at: Time.current)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/audio",
           params: { file: uploaded_audio_file }, headers: auth(plaintext)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("meeting_locked")
    end

    it "절단된 회의의 audio 업로드는 409 (code: meeting_redacted)" do
      meeting.update!(transcripts_redacted_at: Time.current)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/audio",
           params: { file: uploaded_audio_file }, headers: auth(plaintext)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("meeting_redacted")
    end
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/ext/v1/meetings/:id/summarize
  # ─────────────────────────────────────────────────────────
  describe "POST /api/ext/v1/meetings/:id/summarize" do
    include ActiveJob::TestHelper

    let!(:meeting) { create(:meeting, project: project, creator: owner, status: "completed") }

    it "실행 중이면 409 (code: summary_in_progress)" do
      meeting.update!(summarizing: true)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("summary_in_progress")
    end

    it "전사가 있으면 MeetingSummarizationJob을 enqueue하고 202" do
      create(:transcript, meeting: meeting)
      _token, plaintext = issue_token(owner)
      expect {
        post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      }.to have_enqueued_job(MeetingSummarizationJob).with(meeting.id, type: "final")
      expect(response).to have_http_status(:accepted)
    end

    it "전사가 없으면 skip 응답(202)" do
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/summarize", headers: auth(plaintext)
      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body["skipped"]).to eq("no_transcripts")
    end
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/ext/v1/meetings/:id/audio
  # ─────────────────────────────────────────────────────────
  describe "POST /api/ext/v1/meetings/:id/audio" do
    include ActiveJob::TestHelper

    let(:audio_dir) { Rails.root.join("tmp", "ext_test_audio_#{SecureRandom.hex(4)}").to_s }

    around do |example|
      prev = ENV["AUDIO_DIR"]
      ENV["AUDIO_DIR"] = audio_dir
      FileUtils.mkdir_p(audio_dir)
      example.run
    ensure
      prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
      FileUtils.rm_rf(audio_dir)
    end

    let!(:meeting) { create(:meeting, project: project, creator: owner, status: "pending") }

    it "저장 후 FileTranscriptionJob을 enqueue하고 202" do
      _token, plaintext = issue_token(owner)

      expect {
        post "/api/ext/v1/meetings/#{meeting.id}/audio",
             params: { file: uploaded_audio_file }, headers: auth(plaintext)
      }.to have_enqueued_job(FileTranscriptionJob).with(meeting.id)

      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body["meeting"]["status"]).to eq("transcribing")
      expect(meeting.reload.status).to eq("transcribing")
      expect(meeting.audio_file_path).to be_present
      expect(File.exist?(meeting.audio_file_path)).to be true
    end

    it "file이 없으면 422" do
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/audio", headers: auth(plaintext)
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "녹음/전사 진행 중이면 422" do
      meeting.update!(status: "recording")
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/audio",
           params: { file: uploaded_audio_file }, headers: auth(plaintext)
      expect(response).to have_http_status(:unprocessable_entity)
    end

    # FileTranscriptionJob#store_transcripts가 sequence_number를 항상 1부터 새로 매기므로
    # (file_transcription_job.rb:164), 이미 전사가 있는 회의에 오디오를 올리면 중복
    # sequence_number가 생긴다 — 거부해야 한다(purge는 이 엔드포인트 범위 밖).
    it "이미 전사가 있는 회의는 422" do
      meeting.update!(status: "completed")
      create(:transcript, meeting: meeting, sequence_number: 1)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/audio",
           params: { file: uploaded_audio_file }, headers: auth(plaintext)
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  def uploaded_audio_file
    Rack::Test::UploadedFile.new(
      StringIO.new("\x1A\x45\xDF\xA3" + ("x" * 100)),
      "audio/webm",
      true,
      original_filename: "test.webm"
    )
  end
end
