require "rails_helper"

RSpec.describe "Api::V1::Transcripts", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:project)       { create(:project, creator: user) }
  let!(:membership) { create(:project_membership, user: user, project: project, role: "admin") }
  let(:meeting)    { create(:meeting, project: project, creator: user) }

  before { login_as(user) }

  # ─────────────────────────────────────────────────────────
  # GET /api/v1/meetings/:id/transcripts
  # ─────────────────────────────────────────────────────────
  describe "GET /api/v1/meetings/:id/transcripts" do
    context "트랜스크립트가 있는 경우" do
      before do
        create(:transcript, meeting: meeting, sequence_number: 1, content: "첫 번째", speaker_label: "SPEAKER_00", started_at_ms: 0, ended_at_ms: 3000)
        create(:transcript, meeting: meeting, sequence_number: 2, content: "두 번째", speaker_label: "SPEAKER_01", started_at_ms: 3000, ended_at_ms: 6000)
      end

      it "200 OK, transcripts 배열 반환" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcripts"]).to be_an(Array)
        expect(json["transcripts"].length).to eq(2)
      end

      it "sequence_number 순서로 정렬" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        json = response.parsed_body
        contents = json["transcripts"].map { |t| t["content"] }
        expect(contents).to eq([ "첫 번째", "두 번째" ])
      end

      it "각 트랜스크립트에 필수 필드 포함" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        json = response.parsed_body
        transcript = json["transcripts"].first
        expect(transcript).to include(
          "id", "speaker_label", "content", "started_at_ms", "ended_at_ms", "sequence_number"
        )
        expect(transcript["started_at_ms"]).to eq(0)
        expect(transcript["ended_at_ms"]).to eq(3000)
        expect(transcript["speaker_label"]).to eq("SPEAKER_00")
      end

      it "speaker_name 필드를 포함한다 (미설정 시 null)" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        json = response.parsed_body
        transcript = json["transcripts"].first
        expect(transcript).to have_key("speaker_name")
        expect(transcript["speaker_name"]).to be_nil
      end
    end

    context "트랜스크립트가 없는 경우" do
      it "빈 배열 반환" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcripts"]).to eq([])
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/999999/transcripts"

        expect(response).to have_http_status(:not_found)
      end
    end

    context "접근 권한" do
      let(:foreign) { create(:meeting, :private_meeting, creator: other_user) }

      it "비참여자는 남의 회의 transcripts에 접근할 수 없다(403)" do
        get "/api/v1/meetings/#{foreign.id}/transcripts"
        expect(response).to have_http_status(:forbidden)
      end

      it "읽기 가시성 멤버(비소유자)는 transcripts 조회 가능(200)" do
        foreign.update!(shared: true)
        create(:project_membership, project: foreign.project, user: user)
        get "/api/v1/meetings/#{foreign.id}/transcripts"
        expect(response).to have_http_status(:ok)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # PATCH /api/v1/meetings/:meeting_id/transcripts/:id/update_content
  # ─────────────────────────────────────────────────────────
  describe "PATCH /api/v1/meetings/:meeting_id/transcripts/:id/update_content" do
    include ActiveJob::TestHelper

    let!(:transcript) do
      create(:transcript, meeting: meeting, sequence_number: 1,
             content: "원본 텍스트", speaker_label: "SPEAKER_00",
             started_at_ms: 0, ended_at_ms: 3000)
    end

    context "정상 요청" do
      it "200 OK, content 갱신" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "수정된 텍스트", client_id: "abc-123" }

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcript"]["content"]).to eq("수정된 텍스트")
        expect(transcript.reload.content).to eq("수정된 텍스트")
      end

      it "meeting.last_user_edit_at 갱신" do
        freeze_time = Time.zone.parse("2026-05-18 10:00:00")
        travel_to(freeze_time) do
          patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
                params: { content: "수정", client_id: "c1" }
        end
        expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze_time)
      end

      it "ActionCable broadcast 발행" do
        expect(ActionCable.server).to receive(:broadcast).with(
          meeting.transcription_stream,
          hash_including(
            type: "transcript_updated",
            id: transcript.id,
            content: "수정",
            client_id: "c1"
          )
        )
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "수정", client_id: "c1" }
      end

      it "content 수정 시 EmbedBackfillJob을 meeting_id로 enqueue한다" do
        expect {
          patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
                params: { content: "수정된 텍스트", client_id: "abc-123" }
        }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: transcript.meeting_id)
      end
    end

    context "공백만 들어온 경우" do
      it "422 반환, content 그대로" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "   " }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(transcript.reload.content).to eq("원본 텍스트")
      end
    end

    context "길이 상한(5000자) 초과" do
      it "422 반환" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "x" * 5001 }

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    context "다른 회의의 transcript id" do
      let(:other_meeting) { create(:meeting, project: project, creator: user) }
      let!(:other_transcript) do
        create(:transcript, meeting: other_meeting, sequence_number: 1,
               content: "다른 회의", speaker_label: "SPEAKER_00",
               started_at_ms: 0, ended_at_ms: 1000)
      end

      it "404 Not Found" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{other_transcript.id}/update_content",
              params: { content: "해킹 시도" }

        expect(response).to have_http_status(:not_found)
      end
    end

    context "존재하지 않는 transcript" do
      it "404 Not Found" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/999999/update_content",
              params: { content: "x" }

        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/v1/meetings/:meeting_id/transcripts/:id/split
  # 설계: docs/superpowers/specs/2026-07-30-transcript-split-design.md
  # ─────────────────────────────────────────────────────────
  describe "POST /api/v1/meetings/:meeting_id/transcripts/:id/split" do
    include ActiveJob::TestHelper

    let!(:transcript) do
      create(:transcript, meeting: meeting, sequence_number: 1,
             content: "안녕하세요 반갑습니다", speaker_label: "SPEAKER_00", speaker_name: "김철수",
             started_at_ms: 1000, ended_at_ms: 5000, audio_source: "mic",
             applied_to_minutes: true)
    end
    let!(:next_transcript) do
      create(:transcript, meeting: meeting, sequence_number: 2,
             content: "다음 발언", speaker_label: "SPEAKER_01",
             started_at_ms: 5000, ended_at_ms: 8000)
    end

    let(:valid_params) do
      {
        split_ms: 3000,
        split_index: 5,
        expected_content: "안녕하세요 반갑습니다",
        first: { speaker_label: "SPEAKER_00", speaker_name: "김철수" },
        second: { speaker_label: "SPEAKER_01", speaker_name: nil },
        client_id: "c1"
      }
    end

    def do_split(params, as: nil)
      opts = { params: params }
      opts[:as] = as if as
      post "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/split", **opts
    end

    context "정상 분할" do
      it "200 OK, 원행이 조각1로 갱신되고 조각2가 새로 생성된다" do
        do_split(valid_params)

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["updated"]["id"]).to eq(transcript.id)
        expect(json["updated"]["content"]).to eq("안녕하세요")
        expect(json["updated"]["started_at_ms"]).to eq(1000)
        expect(json["updated"]["ended_at_ms"]).to eq(3000)
        expect(json["inserted"]["content"]).to eq("반갑습니다")
        expect(json["inserted"]["started_at_ms"]).to eq(3000)
        expect(json["inserted"]["ended_at_ms"]).to eq(5000)
        expect(Transcript.where(meeting: meeting).count).to eq(3)
      end

      it "지정한 화자를 각 조각에 반영한다(second는 speaker_name null 명시로 비움)" do
        # as: :json 필수 — form 인코딩에서는 nil이 빈 문자열("")로 직렬화돼 "null 명시로 비움"과
        # "빈 문자열 지정"을 구분하지 못한다. JSON이어야 실제 프론트가 보낼 null이 재현된다.
        do_split(valid_params, as: :json)

        json = response.parsed_body
        expect(json["updated"]["speaker_label"]).to eq("SPEAKER_00")
        expect(json["updated"]["speaker_name"]).to eq("김철수")
        expect(json["inserted"]["speaker_label"]).to eq("SPEAKER_01")
        expect(json["inserted"]["speaker_name"]).to be_nil
      end

      it "first/second 키를 생략하면 원행 화자를 양쪽에 그대로 승계한다" do
        params = valid_params.except(:first, :second)
        do_split(params, as: :json)

        json = response.parsed_body
        expect(json["updated"]["speaker_label"]).to eq("SPEAKER_00")
        expect(json["updated"]["speaker_name"]).to eq("김철수")
        expect(json["inserted"]["speaker_label"]).to eq("SPEAKER_00")
        expect(json["inserted"]["speaker_name"]).to eq("김철수")
      end

      it "원행 speaker_label이 온디바이스 빈 값(\"\")이면 화자 생략 승계여도 422(모델 presence 검증)이고 아무 행도 안 바뀐다" do
        # bulk_create는 로컬 단일/미상 화자 행을 save!(validate: false)로 speaker_label: ""
        # 그대로 저장할 수 있다. 컨트롤러의 사전 체크는 "명시적으로 지정한" 빈 값만 막고
        # 승계된 빈 값은 막지 않지만(explicit_blank_speaker_label?), 실제 update!/create!는
        # 검증을 통과해야 하므로 Transcript의 validates :speaker_label, presence: true에 걸려
        # ActiveRecord::RecordInvalid가 나고, 컨트롤러가 이를 422로 변환한다(500 방지, 트랜잭션 롤백).
        # 즉 이 화자 미지정 조합은 애초에 split 대상이 될 수 없다 — 화자를 명시해서 다시 요청해야 한다.
        blank_label_source = create(:transcript, meeting: meeting, sequence_number: 3, content: "빈화자 발언")
        blank_label_source.update_column(:speaker_label, "")

        post "/api/v1/meetings/#{meeting.id}/transcripts/#{blank_label_source.id}/split",
             params: { split_ms: 1500, split_index: 3, expected_content: "빈화자 발언" },
             as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(3)
        expect(blank_label_source.reload.content).to eq("빈화자 발언")
      end

      it "applied_to_minutes를 원값 그대로 두 조각에 복사한다" do
        do_split(valid_params)

        json = response.parsed_body
        expect(json["updated"]["applied_to_minutes"]).to eq(true)
        expect(json["inserted"]["applied_to_minutes"]).to eq(true)
      end

      it "audio_source를 승계한다" do
        do_split(valid_params)

        expect(transcript.reload.audio_source).to eq("mic")
        inserted_id = response.parsed_body["inserted"]["id"]
        expect(Transcript.find(inserted_id).audio_source).to eq("mic")
      end

      it "sequence_number: 조각1은 원값 유지, 조각2는 원값+1, 뒤 행은 +1" do
        do_split(valid_params)

        json = response.parsed_body
        expect(json["updated"]["sequence_number"]).to eq(1)
        expect(json["inserted"]["sequence_number"]).to eq(2)
        expect(next_transcript.reload.sequence_number).to eq(3)
      end

      it "index 조회 시 전체 순서가 조각1 → 조각2 → 뒤 행 순으로 유지된다" do
        do_split(valid_params)

        get "/api/v1/meetings/#{meeting.id}/transcripts"
        contents = response.parsed_body["transcripts"].map { |t| t["content"] }
        expect(contents).to eq([ "안녕하세요", "반갑습니다", "다음 발언" ])
      end

      it "meeting.last_user_edit_at을 갱신한다" do
        freeze_time = Time.zone.parse("2026-07-30 11:00:00")
        travel_to(freeze_time) { do_split(valid_params) }

        expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze_time)
      end

      it "transcript_split ActionCable 이벤트를 브로드캐스트한다" do
        expect(ActionCable.server).to receive(:broadcast).with(
          meeting.transcription_stream,
          hash_including(type: "transcript_split", client_id: "c1")
        )
        do_split(valid_params)
      end

      it "EmbedBackfillJob을 meeting_id로 enqueue한다(reconcile_embeddings!)" do
        expect { do_split(valid_params) }
          .to have_enqueued_job(EmbedBackfillJob).with(meeting_id: meeting.id)
      end
    end

    context "검증" do
      it "split_ms가 started_at_ms와 같으면(경계) 422" do
        do_split(valid_params.merge(split_ms: transcript.started_at_ms))
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "split_ms가 ended_at_ms와 같으면(경계) 422" do
        do_split(valid_params.merge(split_ms: transcript.ended_at_ms))
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "split_ms가 범위를 벗어나면 422" do
        do_split(valid_params.merge(split_ms: 99_999))
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "split_ms가 Hash로 오면 422(500 아님), 어떤 행도 바뀌지 않는다" do
        do_split(valid_params.merge(split_ms: { foo: "bar" }), as: :json)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(2)
        expect(transcript.reload.content).to eq("안녕하세요 반갑습니다")
        expect(transcript.reload.sequence_number).to eq(1)
        expect(next_transcript.reload.sequence_number).to eq(2)
      end

      it "split_index가 Array로 오면 422(500 아님), 어떤 행도 바뀌지 않는다" do
        do_split(valid_params.merge(split_index: [ 1, 2, 3 ]), as: :json)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(2)
        expect(transcript.reload.content).to eq("안녕하세요 반갑습니다")
        expect(transcript.reload.sequence_number).to eq(1)
        expect(next_transcript.reload.sequence_number).to eq(2)
      end

      it "split_index가 0이면(경계) 422" do
        do_split(valid_params.merge(split_index: 0))
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "split_index가 content.length와 같으면(경계) 422" do
        do_split(valid_params.merge(split_index: transcript.content.length))
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "분할 결과 한쪽이 공백만 남으면 422이고 아무 행도 바뀌지 않는다" do
        blank_source = create(:transcript, meeting: meeting, sequence_number: 3,
                               content: "안녕   ", started_at_ms: 8000, ended_at_ms: 9000)

        post "/api/v1/meetings/#{meeting.id}/transcripts/#{blank_source.id}/split",
             params: {
               split_ms: 8500, split_index: 2,
               expected_content: "안녕   "
             }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(3)
        expect(blank_source.reload.content).to eq("안녕   ")
      end

      it "speaker_label을 빈 문자열로 지정하면 422" do
        do_split(valid_params.merge(first: { speaker_label: "" }))
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "expected_content가 현재 content와 다르면 409이고 어떤 행도 변경되지 않는다" do
        do_split(valid_params.merge(expected_content: "다른 곳에서 수정된 내용"))

        expect(response).to have_http_status(:conflict)
        expect(transcript.reload.content).to eq("안녕하세요 반갑습니다")
        expect(next_transcript.reload.sequence_number).to eq(2)
        expect(Transcript.where(meeting: meeting).count).to eq(2)
      end
    end

    context "진행 상태 가드" do
      it "recording 중이면 409" do
        meeting.update!(status: "recording")
        do_split(valid_params)
        expect(response).to have_http_status(:conflict)
      end

      it "transcribing 중이면 409" do
        meeting.update!(status: "transcribing")
        do_split(valid_params)
        expect(response).to have_http_status(:conflict)
      end

      it "summarizing 중이면 409" do
        meeting.update!(summarizing: true)
        do_split(valid_params)
        expect(response).to have_http_status(:conflict)
      end
    end

    context "잠금" do
      it "잠긴 회의는 403" do
        meeting.update!(locked_at: Time.current)
        do_split(valid_params)
        expect(response).to have_http_status(:forbidden)
        expect(Transcript.where(meeting: meeting).count).to eq(2)
      end
    end

    context "권한" do
      it "공유 가시성 멤버(비협업자·비소유자)는 403" do
        meeting.update!(shared: true)
        create(:project_membership, project: project, user: other_user)
        login_as(other_user)

        do_split(valid_params)

        expect(response).to have_http_status(:forbidden)
        expect(transcript.reload.content).to eq("안녕하세요 반갑습니다")
      end
    end

    context "FTS 정합성" do
      let!(:fts_transcript) do
        create(:transcript, meeting: meeting, sequence_number: 4,
               content: "고유토큰123 고유토큰456", started_at_ms: 10_000, ended_at_ms: 14_000)
      end

      def fts_content_for(source_id)
        conn = ActiveRecord::Base.connection
        rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
          [ "SELECT content FROM transcripts_fts WHERE source_id = ?", source_id ]
        ))
        row = rows.to_a.first
        row.is_a?(Hash) ? row["content"] : row&.first
      end

      it "분할 후 원행 텍스트는 사라지고 조각 2개가 새로 색인된다" do
        expect(fts_content_for(fts_transcript.id)).to eq("고유토큰123 고유토큰456")

        post "/api/v1/meetings/#{meeting.id}/transcripts/#{fts_transcript.id}/split",
             params: {
               split_ms: 12_000, split_index: 7,
               expected_content: "고유토큰123 고유토큰456"
             }
        expect(response).to have_http_status(:ok)
        inserted_id = response.parsed_body["inserted"]["id"]

        # 원행(id 유지)은 이제 조각1 텍스트만 담고 있어야 한다 — 원문 전체가 남아있으면
        # update! 콜백(fts_upsert)이 아니라 delete_all류 우회가 있었다는 뜻.
        expect(fts_content_for(fts_transcript.id)).to eq("고유토큰123")
        expect(fts_content_for(inserted_id)).to eq("고유토큰456")
      end
    end

    context "applied_to_minutes 반증 — 요약 잡의 append 대상과의 결합" do
      include ActiveJob::TestHelper

      around do |example|
        prev = ENV["LLM_PROVIDER"]
        ENV["LLM_PROVIDER"] = "anthropic"
        example.run
      ensure
        prev.nil? ? ENV.delete("LLM_PROVIDER") : ENV["LLM_PROVIDER"] = prev
      end

      it "두 조각을 false로 되돌리면 realtime 요약 잡이 그 내용을 다시 append한다" do
        do_split(valid_params)
        json = response.parsed_body
        updated_id = json["updated"]["id"]
        inserted_id = json["inserted"]["id"]

        # split 직후엔 원값(true) 그대로 승계돼 있어야 한다.
        expect(Transcript.find(updated_id).applied_to_minutes).to eq(true)
        expect(Transcript.find(inserted_id).applied_to_minutes).to eq(true)

        # 반증: 만약 이 필드가 false로 새로 만들어졌다면(버그), 이미 요약에 반영된 내용이
        # realtime 요약 잡에 의해 notes_markdown에 다시 append된다.
        Transcript.where(id: [ updated_id, inserted_id ]).update_all(applied_to_minutes: false)
        # generate_minutes_realtime은 pending/completed 회의를 건너뛴다 — split 자체는
        # pending/completed 상태에서만 허용되므로, 잡 재현을 위해 여기서만 recording으로 전환한다.
        meeting.update!(status: "recording")

        allow_any_instance_of(LlmService).to receive(:refine_notes)
          .and_return({ "notes_markdown" => "## 회의록\n- 안녕하세요\n- 반갑습니다", "ok" => true })

        MeetingSummarizationJob.perform_now(meeting.id, type: "realtime")

        expect(meeting.summaries.find_by(summary_type: "realtime").notes_markdown).to include("반갑습니다")
        expect(Transcript.where(id: [ updated_id, inserted_id ], applied_to_minutes: true).count).to eq(2)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/v1/meetings/:meeting_id/transcripts/redact
  # 기밀 구간 절단 — 전사 행 + 오디오를 실제로 파기(비가역)
  # ─────────────────────────────────────────────────────────
  describe "POST /api/v1/meetings/:meeting_id/transcripts/redact" do
    include ActiveJob::TestHelper

    let(:audio_dir) { Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s }

    around do |example|
      prev = ENV["AUDIO_DIR"]
      ENV["AUDIO_DIR"] = audio_dir
      FileUtils.mkdir_p(audio_dir)
      example.run
    ensure
      prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
      FileUtils.rm_rf(audio_dir)
    end

    def write_wav(path, seconds: 10.0, rate: 16_000)
      samples = (rate * seconds).to_i
      data = ("\x00\x00".b * samples)
      File.open(path, "wb") do |f|
        f.write("RIFF"); f.write([ 36 + data.bytesize ].pack("V")); f.write("WAVE")
        f.write("fmt "); f.write([ 16 ].pack("V")); f.write([ 1 ].pack("v")); f.write([ 1 ].pack("v"))
        f.write([ rate ].pack("V")); f.write([ rate * 2 ].pack("V"))
        f.write([ 2 ].pack("v")); f.write([ 16 ].pack("v"))
        f.write("data"); f.write([ data.bytesize ].pack("V")); f.write(data)
      end
    end

    # 1: [0,2000]  2: [3000,4000]  3: [5000,6000]  4: [7000,9000]
    let!(:t1) { create(:transcript, meeting: meeting, sequence_number: 1, content: "앞부분 발언", started_at_ms: 0, ended_at_ms: 2_000) }
    let!(:t2) { create(:transcript, meeting: meeting, sequence_number: 2, content: "기밀토큰AAA", started_at_ms: 3_000, ended_at_ms: 4_000) }
    let!(:t3) { create(:transcript, meeting: meeting, sequence_number: 3, content: "중간 발언", started_at_ms: 5_000, ended_at_ms: 6_000) }
    let!(:t4) { create(:transcript, meeting: meeting, sequence_number: 4, content: "기밀토큰BBB", started_at_ms: 7_000, ended_at_ms: 9_000) }

    before do
      wav = File.join(audio_dir, "#{meeting.id}.wav")
      write_wav(wav)
      meeting.update!(audio_file_path: wav)
    end

    # expected_bounds 는 required 다. 기본은 "화면과 서버가 일치하는 정상 상태" — DB 현재값을
    # 그대로 실어 보낸다. 불일치·누락 케이스는 각 테스트가 명시적으로 다르게 보낸다.
    def bounds_for(ids)
      Transcript.where(id: ids).each_with_object({}) do |t, h|
        h[t.id.to_s] = { started_at_ms: t.started_at_ms, ended_at_ms: t.ended_at_ms }
      end
    end

    def do_redact(ids, client_id: "c1", expected_bounds: nil)
      post "/api/v1/meetings/#{meeting.id}/transcripts/redact",
           params: { transcript_ids: ids, client_id: client_id,
                     expected_bounds: expected_bounds || bounds_for(ids) },
           as: :json
    end

    context "가드" do
      it "transcript_ids 가 비면 422" do
        do_redact([])
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "이 회의에 없는 id 가 섞이면 422 이고 아무 행도 지워지지 않는다" do
        do_redact([ t2.id, 999_999 ])
        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "recording 중이면 409" do
        meeting.update!(status: "recording")
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "transcribing 중이면 409" do
        meeting.update!(status: "transcribing")
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
      end

      it "summarizing 중이면 409" do
        meeting.update!(summarizing: true)
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
      end

      it "AudioUploadJob 이 인플라이트면 409 이고 아무것도 변하지 않는다 (조기 UX 가드)" do
        allow(AudioUploadJob).to receive(:in_flight_for?).with(meeting.id).and_return(true)
        do_redact([ t2.id ])
        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(t2.reload.content).to eq("기밀토큰AAA")
      end

      it "잠긴 회의는 403" do
        meeting.update!(locked_at: Time.current)
        do_redact([ t2.id ])
        expect(response).to have_http_status(:forbidden)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end
    end

    context "권한" do
      it "협업자는 403 이다 (split 과 다른 티어)" do
        # :meeting_collaborator 팩토리는 이 저장소에 없다 — 기존 스펙과 같이 모델을 직접 만든다
        # (spec/requests/api/v1/meeting_collaborators_spec.rb:32).
        MeetingCollaborator.create!(meeting: meeting, user: other_user)
        create(:project_membership, project: project, user: other_user)
        login_as(other_user)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:forbidden)
        expect(t2.reload.content).to eq("기밀토큰AAA")
      end

      it "소유자는 통과한다" do
        do_redact([ t2.id ])
        expect(response).to have_http_status(:ok)
      end

      it "admin 은 통과한다" do
        admin = create(:user, role: "admin")
        login_as(admin)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
      end
    end

    context "정상 절단" do
      it "선택 행이 사라지고 응답에 구간·총 절단 길이가 담긴다" do
        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["deleted_ids"]).to eq([ t2.id ])
        # t1 끝 2000, t2 [3000,4000], t3 시작 5000 → gap 중간점 [2500, 4500]
        expect(json["ranges"]).to eq([ { "start_ms" => 2_500, "end_ms" => 4_500 } ])
        expect(json["total_cut_ms"]).to eq(2_000)
        expect(Transcript.where(id: t2.id)).not_to exist
        expect(Transcript.where(meeting: meeting).count).to eq(3)
      end

      it "구간 2개면 마지막 구간 뒤 행의 ms 가 두 구간 길이의 합만큼 당겨진다 (누적 delta)" do
        do_redact([ t2.id, t4.id ])

        # 구간1 [2500,4500] = 2000ms, 구간2 [6500, 10000(오디오 끝)] — t4 가 마지막 행이라 끝까지.
        json = response.parsed_body
        expect(json["ranges"].length).to eq(2)
        expect(t3.reload.started_at_ms).to eq(5_000 - 2_000)
        expect(t3.reload.ended_at_ms).to eq(6_000 - 2_000)
      end

      # ⭐ 위 케이스는 t3 가 두 구간 **사이**에 있어 delta 가 구간1 길이와 같다 — 그래서
      # delta_for(ms) 를 `ranges.first.length_ms` 로 바꿔도 통과한다(누적을 실제로 검증하지 못한다).
      # t4 처럼 **마지막 구간보다 뒤에 남는 행**이 있어야 누적이 드러난다. t1·t3 를 고르면
      # 구간 A[0,2500](2500ms) · B[4500,6500](2000ms) 가 되고 t4 는 둘 다 통과해 4500ms 당겨진다.
      it "마지막 구간보다 뒤에 남는 행은 앞선 모든 구간 길이의 합만큼 당겨진다 (누적 delta 본 검증)" do
        do_redact([ t1.id, t3.id ])

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["ranges"])
          .to eq([ { "start_ms" => 0, "end_ms" => 2_500 }, { "start_ms" => 4_500, "end_ms" => 6_500 } ])
        expect(t4.reload.started_at_ms).to eq(7_000 - 4_500)
        expect(t4.reload.ended_at_ms).to eq(9_000 - 4_500)
        # 구간 A 만 지난 t2 는 2500 만 당겨진다 — 행마다 delta 가 다르다는 것이 누적의 요체다.
        expect(t2.reload.started_at_ms).to eq(3_000 - 2_500)
      end

      it "경계는 행 ms 가 아니라 이웃과의 gap 중간점이다" do
        do_redact([ t2.id ])
        expect(response.parsed_body["ranges"].first["start_ms"]).to eq(2_500) # 3000(행 ms)이 아니다
      end

      it "sequence_number 가 1..N 으로 재번호된다" do
        do_redact([ t2.id ])
        expect(Transcript.where(meeting: meeting).order(:sequence_number).pluck(:sequence_number)).to eq([ 1, 2, 3 ])
      end

      it "last_user_edit_at 을 갱신한다 (D'Flow 재전송 신호)" do
        freeze = Time.zone.parse("2026-07-31 09:00:00")
        travel_to(freeze) { do_redact([ t2.id ]) }
        expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze)
      end

      it "transcript_redacted 를 브로드캐스트한다" do
        # allow 를 먼저 깔아 다른 브로드캐스트를 통과시킨다 — 스텁이 broadcast 자체를 대체하므로
        # 엄격 매칭만 걸면 무관한 브로드캐스트 하나에 원인 모를 실패가 난다.
        allow(ActionCable.server).to receive(:broadcast).and_call_original
        expect(ActionCable.server).to receive(:broadcast).with(
          meeting.transcription_stream, hash_including(type: "transcript_redacted", client_id: "c1")
        ).at_least(:once)
        do_redact([ t2.id ])
      end
    end

    context "FTS 정합성" do
      def fts_content_for(source_id)
        conn = ActiveRecord::Base.connection
        rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
          [ "SELECT content FROM transcripts_fts WHERE source_id = ?", source_id ]
        ))
        row = rows.to_a.first
        row.is_a?(Hash) ? row["content"] : row&.first
      end

      it "절단한 행의 텍스트가 transcripts_fts 에서 사라진다" do
        expect(fts_content_for(t2.id)).to eq("기밀토큰AAA")

        do_redact([ t2.id ])

        expect(fts_content_for(t2.id)).to be_nil
      end
    end

    context "동시 split 가드 (expected_bounds)" do
      it "expected_bounds 를 빼면 422 이고 아무 행도 변하지 않는다 (조용히 가드 없이 진행 금지)" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/redact",
             params: { transcript_ids: [ t2.id ], client_id: "c1" }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to eq("expected_bounds required")
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(t2.reload.content).to eq("기밀토큰AAA")
      end

      it "선택 행 중 하나의 항목이 빠지면 409 가 아니라 422 다 (새로고침해도 안 낫는 클라이언트 결함)" do
        do_redact([ t2.id, t4.id ], expected_bounds: bounds_for([ t2.id ]))

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to include("expected_bounds missing")
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "started_at_ms 가 0 인 첫 행에서도 값 누락을 잡는다 (nil.to_i == 0 함정)" do
        # `.to_i` 로 비교하면 키가 없어도 0 이 되어 t1(started_at_ms: 0)에서 가드가 통과한다.
        # 항목 자체는 존재하고 **필드 하나만** 빠진 형태라 422(항목 누락)가 아니라 값 비교 경로로
        # 들어간다 — bounds_entry 는 항목 유무만 보고, 필드 유무는 bounds_stale? 가 판정한다.
        # 그래서 status 는 409 다. 지켜야 할 성질은 "아무것도 절단되지 않는다"이고,
        # `Integer(..., exception: false)` 를 `.to_i` 로 되돌리면 이 요청이 200 으로 통과하며
        # t1 이 실제로 절단된다(= 아래 두 단언이 함께 깨진다).
        do_redact([ t1.id ], expected_bounds: { t1.id.to_s => { ended_at_ms: 2_000 } })

        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(id: t1.id)).to exist
      end

      it "transcript_ids 에 정수가 아닌 원소가 섞이면 422 다 (조용한 부분 절단 금지)" do
        post "/api/v1/meetings/#{meeting.id}/transcripts/redact",
             params: { transcript_ids: [ t2.id, { evil: 1 } ], client_id: "c1",
                       expected_bounds: bounds_for([ t2.id ]) },
             as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "선택 행을 split 한 뒤 옛 경계로 요청하면 409 이고 아무 행도 변하지 않는다 ⭐" do
        # 클라이언트가 목록을 읽은 시점의 경계를 스냅샷.
        stale_bounds = bounds_for([ t2.id ])

        # 그 사이 다른 클라이언트가 t2 를 split — 원행 ended_at_ms 가 3500 으로 줄고
        # 새 조각 [3500, 4000] 이 생긴다. 기밀 텍스트가 두 행에 나뉘어 남는다.
        post "/api/v1/meetings/#{meeting.id}/transcripts/#{t2.id}/split",
             params: { split_ms: 3_500, split_index: 2, expected_content: "기밀토큰AAA" }, as: :json
        expect(response).to have_http_status(:ok)
        inserted_id = response.parsed_body["inserted"]["id"]

        do_redact([ t2.id ], expected_bounds: stale_bounds)

        expect(response).to have_http_status(:conflict)
        expect(response.parsed_body["error"]).to include("새로고침")
        # 아무 행도 변하지 않는다 — split 이 만든 5개 행이 그대로다.
        expect(Transcript.where(meeting: meeting).count).to eq(5)
        expect(Transcript.where(id: t2.id)).to exist
        expect(Transcript.where(id: inserted_id)).to exist
        expect(t3.reload.started_at_ms).to eq(5_000) # ms 시프트도 일어나지 않았다
      end

      it "겹침 완전성만으로는 위 케이스가 통과한다 — 그래서 expected_bounds 가 따로 필요하다 (반증 고정)" do
        # 같은 시나리오를 "현재 경계"로 요청하면(=expected_bounds 가드가 무력화된 상황과 동일)
        # 겹침 완전성은 통과해 절반만 잘린다. 이 사실을 테스트로 못 박아, 나중에 누군가
        # expected_bounds 를 지우고 "겹침 완전성이 있으니 괜찮다"고 판단하지 못하게 한다.
        post "/api/v1/meetings/#{meeting.id}/transcripts/#{t2.id}/split",
             params: { split_ms: 3_500, split_index: 2, expected_content: "기밀토큰AAA" }, as: :json
        inserted_id = response.parsed_body["inserted"]["id"]

        do_redact([ t2.id ]) # 현재 경계 사용 → expected_bounds 통과

        expect(response).to have_http_status(:ok)
        # 조각2가 그대로 살아남는다 = 기밀 텍스트 잔존. expected_bounds 가 유일한 방어선이다.
        expect(Transcript.where(id: inserted_id)).to exist
      end
    end

    context "ffmpeg 실행 창 동안의 동시 변경 (트랜잭션 내 재검증)" do
      it "ffmpeg 도중 선택 행이 split 되면 409 이고 아무 행도 변하지 않는다 ⭐" do
        # cut_to_temp 는 -c copy 불가라 실제로 수십 초 걸린다. redact 는 상태 플래그를 세우지
        # 않으므로 그 창에 split 이 그대로 들어온다. 진입 시점 검증만 있으면 destroy_all 이
        # 스냅샷 ids 만 지워 새 조각이 기밀 텍스트를 안고 살아남는다.
        inserted_id = nil
        allow_any_instance_of(AudioRedactor).to receive(:cut_to_temp).and_wrap_original do |orig, *args|
          result = orig.call(*args)
          post "/api/v1/meetings/#{meeting.id}/transcripts/#{t2.id}/split",
               params: { split_ms: 3_500, split_index: 2, expected_content: "기밀토큰AAA" }, as: :json
          inserted_id = response.parsed_body["inserted"]["id"]
          result
        end

        do_redact([ t2.id ])

        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(id: t2.id)).to exist
        expect(Transcript.where(id: inserted_id)).to exist
        expect(t3.reload.started_at_ms).to eq(5_000)
        expect(Dir.glob(File.join(audio_dir, "*.redact-tmp*"))).to be_empty
      end

      it "ffmpeg 도중 구간 안으로 행이 삽입되면 409 다 (expected_bounds 만으로는 못 잡는 경로)" do
        allow_any_instance_of(AudioRedactor).to receive(:cut_to_temp).and_wrap_original do |orig, *args|
          result = orig.call(*args)
          # 선택 행 자체는 안 바뀌므로 expected_bounds 는 통과한다 — complete? 재검증이 잡아야 한다.
          create(:transcript, meeting: meeting, sequence_number: 5,
                 content: "창 안에 들어온 행", started_at_ms: 3_200, ended_at_ms: 3_800)
          result
        end

        do_redact([ t2.id ])

        expect(response).to have_http_status(:conflict)
        expect(Transcript.where(id: t2.id)).to exist
      end
    end

    context "FTS 삭제 실패 시 롤백 (fts_delete 가 예외를 삼키는 것에 대한 방어)" do
      it "transcripts_fts 에 행이 남으면 롤백하고 오디오도 원본 그대로다" do
        # fts_indexable.rb:46-49 가 rescue + logger.warn 이라 SQLITE_BUSY 로 실패해도 커밋된다.
        # 그러면 전사 행은 사라진 채 기밀 평문이 FTS 에 영구히 남고 200 이 나간다.
        allow_any_instance_of(Transcript).to receive(:fts_delete) # no-op = 삭제 실패 재현
        original = File.binread(meeting.audio_file_path)

        expect { do_redact([ t2.id ]) }.to raise_error(/FTS 인덱스/)

        expect(Transcript.where(id: t2.id)).to exist
        expect(t2.reload.content).to eq("기밀토큰AAA")
        expect(File.binread(meeting.reload.audio_file_path)).to eq(original)
      end
    end

    context "겹침 완전성" do
      it "구간에 걸치는 행을 id 목록에서 빼면 409 이고 아무 행도 변하지 않는다" do
        # t2 구간 [2500,4500] 안으로 새 행이 들어온 상황(이어녹음·원격 bulk_create).
        intruder = create(:transcript, meeting: meeting, sequence_number: 5,
                          content: "나중에 들어온 행", started_at_ms: 3_500, ended_at_ms: 3_900)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:conflict)
        expect(response.parsed_body["error"]).to include("새로고침")
        expect(Transcript.where(meeting: meeting).count).to eq(5)
        expect(t2.reload.content).to eq("기밀토큰AAA")
        expect(intruder.reload.started_at_ms).to eq(3_500)
      end
    end

    context "요약·brief_summary·AI 산출물" do
      it "요약 행을 삭제하고 brief_summary 를 명시적으로 nil 로 만든다" do
        meeting.summaries.create!(summary_type: "final", notes_markdown: "## 회의록\n- 기밀토큰AAA", generated_at: Time.current)
        meeting.update_column(:brief_summary, "옛 발췌 기밀토큰AAA")

        do_redact([ t2.id ])

        expect(meeting.reload.summaries.count).to eq(0)
        expect(meeting.reload.brief_summary).to be_nil
        expect(response.parsed_body["summaries_destroyed"]).to be true
      end

      it "ai_generated 액션아이템·결정만 삭제하고 사람이 쓴 것은 남긴다" do
        ai_item    = meeting.action_items.create!(content: "AI 추출", ai_generated: true)
        human_item = meeting.action_items.create!(content: "사람 입력", ai_generated: false)
        ai_dec     = meeting.decisions.create!(content: "AI 결정", ai_generated: true)
        human_dec  = meeting.decisions.create!(content: "사람 결정", ai_generated: false)

        do_redact([ t2.id ])

        expect(ActionItem.where(id: ai_item.id)).not_to exist
        expect(ActionItem.where(id: human_item.id)).to exist
        expect(Decision.where(id: ai_dec.id)).not_to exist
        expect(Decision.where(id: human_dec.id)).to exist
      end
    end

    context "북마크" do
      it "구간 내부 북마크는 사라지고 이후 북마크는 시프트된다" do
        inside = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 3_500, label: "안쪽")
        after  = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 8_000, label: "뒤쪽")
        before = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 1_000, label: "앞쪽")

        do_redact([ t2.id ])

        expect(MeetingBookmark.where(id: inside.id)).not_to exist
        expect(after.reload.timestamp_ms).to eq(8_000 - 2_000)
        expect(before.reload.timestamp_ms).to eq(1_000)
        expect(response.parsed_body["bookmarks_removed"]).to eq(1)
      end
    end

    # 아래 챗 스펙 2개 주의:
    # - 회의 스코프 행은 meeting: 를 채워야 한다. 컨트롤러가 @meeting.chat_messages(=meeting_id)로
    #   훑기 때문이며, scope_type/scope_id 만으로는 걸리지 않는다.
    # - 폴더 스코프 행은 meeting_id 가 nil 이다(belongs_to :meeting, optional: true 라 유효).
    #   이쪽은 LIKE 1차 필터 + 정규식으로만 걸린다 — 의도한 경로다.
    context "챗 마커 보정" do
      it "구간 이후 마커는 당겨지고 구간 내부 마커는 제거된다" do
        msg = ChatMessage.create!(meeting: meeting, user: user, role: "assistant",
                                  scope_type: "meeting", scope_id: meeting.id,
                                  content: "뒤 근거 ⟦t:8000/s:화자 1⟧ 안쪽 근거 ⟦t:3500/s:화자 2⟧ 끝")

        do_redact([ t2.id ])

        expect(msg.reload.content).to eq("뒤 근거 ⟦t:6000/s:화자 1⟧ 안쪽 근거  끝")
        expect(response.parsed_body["chat_markers_updated"]).to eq(2)
      end

      it "콜론 형태 마커는 같은 형태로 파싱·시프트·재직렬화된다" do
        msg = ChatMessage.create!(meeting: meeting, user: user, role: "assistant",
                                  scope_type: "meeting", scope_id: meeting.id,
                                  content: "근거 ⟦t:0:08/s:화자 1⟧")

        do_redact([ t2.id ])

        expect(msg.reload.content).to eq("근거 ⟦t:0:06/s:화자 1⟧")
      end

      it "폴더 스코프 마커(| 구분자 포함)도 같은 회의 인용분만 보정한다" do
        mine = ChatMessage.create!(user: user, role: "assistant", scope_type: "folder", scope_id: 7,
                                   content: "A ⟦m:#{meeting.id}/t:8000|s:화자 1⟧ B ⟦m:#{meeting.id + 9999}/t:8000/s:화자 3⟧")

        do_redact([ t2.id ])

        expect(mine.reload.content)
          .to eq("A ⟦m:#{meeting.id}/t:6000/s:화자 1⟧ B ⟦m:#{meeting.id + 9999}/t:8000/s:화자 3⟧")
      end
    end

    context "오디오 절단" do
      def probe_ms(path)
        out = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
        (out.to_f * 1000).to_i
      end

      it "오디오가 총 절단 길이만큼 짧아지고 audio_duration_ms 가 실측으로 갱신된다" do
        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        expect(probe_ms(meeting.reload.audio_file_path)).to be_within(1_000).of(8_000)
        expect(response.parsed_body["audio_duration_ms"]).to be_within(1_000).of(8_000)
      end

      it "peaks 캐시가 무효화된다 (안 지우면 절단 전 파형이 영구히 서빙된다)" do
        peaks = "#{meeting.audio_file_path}.peaks.json"
        File.write(peaks, "{}")

        do_redact([ t2.id ])

        expect(File.exist?(peaks)).to be false
      end

      it "길이가 다른 고아 오디오(<id>.webm)는 절단이 아니라 삭제된다" do
        # ⚠️ 픽스처는 반드시 **길이가 다른** 파일이어야 한다. 같은 소스에서 트랜스코딩하면
        # 길이가 같아, 하나의 kept_segments 를 전 파일에 적용하는 잘못된 구현도 통과해버린다.
        # 실제 V3 시나리오(재녹음 병합)에서 <id>.webm 과 <id>.mp3 는 길이가 다르다.
        short = File.join(audio_dir, "#{meeting.id}_short.wav")
        write_wav(short, seconds: 4.0)
        webm = File.join(audio_dir, "#{meeting.id}.webm")
        system("ffmpeg", "-y", "-loglevel", "error", "-i", short,
               "-c:a", "libopus", webm, out: File::NULL, err: File::NULL)
        FileUtils.rm_f(short)
        expect(probe_ms(webm)).to be_within(1_000).of(4_000) # primary(10초)보다 짧다
        File.binwrite("#{webm}.peaks.json", "{}")

        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        # 고아는 audio_file_path 가 가리키지 않는 절단 전 기밀 오디오다 — 자르지 않고 지운다.
        # (자르려 하면 짧은 쪽에서 뒤쪽 세그먼트가 통째로 잘려 길이 검증 실패 → 영구 절단 불가)
        expect(File.exist?(webm)).to be false
        expect(File.exist?("#{webm}.peaks.json")).to be false
        # primary 는 정상 절단된다.
        expect(probe_ms(File.join(audio_dir, "#{meeting.id}.wav"))).to be_within(1_000).of(8_000)
      end

      it "_parts/ 와 stt_chunks/ 가 파기되고, 그 상태에서 finalize 는 오디오를 재구성하지 못한다" do
        parts = File.join(audio_dir, "#{meeting.id}_parts")
        FileUtils.mkdir_p(parts)
        File.binwrite(File.join(parts, "0.part"), "\x1A\x45\xDF\xA3" + ("x" * 100))
        chunks = SttChunkStorage::ROOT.join(meeting.id.to_s)
        FileUtils.mkdir_p(chunks)
        File.binwrite(chunks.join("0-abc.pcm"), "x" * 100)
        merged = File.join(audio_dir, "#{meeting.id}.webm.merged.webm")
        File.binwrite(merged, "x")

        do_redact([ t2.id ])

        expect(Dir.exist?(parts)).to be false
        expect(Dir.exist?(chunks)).to be false
        expect(File.exist?(merged)).to be false

        # 선삭제를 커밋 후로 미루면 이 사이에 finalize 가 잘리지 않은 청크로 오디오를 재구성한다.
        post "/api/v1/meetings/#{meeting.id}/audio_finalize"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to eq("No audio chunks")
      end

      it "이전 절단이 남긴 .redact-backup 을 파기한다 (절단 전 원음이 영구 잔존하지 않도록)" do
        # 커밋 후 drop_backups! 가 실패하면 남는 파일. 절단 전 오디오 **전체**라 기밀 원음이고,
        # audio_paths 글롭에서 제외되므로 이후 절단에서도 잘리지 않는다 — 지우는 코드가
        # purge_stale_backups! 말고는 없다.
        #
        # ⚠️ 스테일 백업의 basename 은 현재 primary(<id>.wav)와 **달라야** 한다. 계획 초안대로
        # <id>.wav.redact-backup 을 쓰면 이번 실행의 swap_in! 이 만드는 백업 경로와 완전히 같아져
        # FileUtils.mv 가 덮어쓰고 커밋 후 drop_backups! 가 지운다 → purge_stale_backups! 를
        # 통째로 지워도 통과하는 무의미한 테스트가 된다(반증 실증으로 확인함).
        # 실제 위험 케이스도 이쪽이다: 이전 절단 당시 audio_file_path 가 <id>.mp3 였다면 그
        # 백업은 확장자가 달라 swap 사이클에 걸리지 않고 영원히 남는다.
        stale = File.join(audio_dir, "#{meeting.id}.mp3.redact-backup")
        File.binwrite(stale, "절단 전 원음 전체")

        do_redact([ t2.id ])

        expect(response).to have_http_status(:ok)
        expect(File.exist?(stale)).to be false
        # 이번 실행의 백업은 커밋 후 정상 파기되므로 어느 쪽도 남지 않는다.
        expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
      end

      it "ffmpeg 이 실패하면 DB 무변경 + 422 이고 오디오도 원본 그대로다" do
        File.binwrite(meeting.audio_file_path, "not audio at all")
        original = File.binread(meeting.audio_file_path)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(t2.reload.content).to eq("기밀토큰AAA")
        expect(File.binread(meeting.reload.audio_file_path)).to eq(original)
      end

      it "지원하지 않는 오디오 형식이면 422 이고 DB 무변경이다" do
        # ⚠️ 미지원 확장자는 **primary(audio_file_path)** 여야 한다. cut_to_temp 는
        # Array(primary_audio_path) 하나만 자르므로(M2), 형제로 둔 <id>.flac 은 고아가 되어
        # purge_duplicate_sources! 가 먼저 지워버리고 UnsupportedFormat 에 도달하지 못한다.
        # 내용은 wav 지만 ffprobe 는 내용으로 재므로 길이 측정은 정상(10초)이고,
        # CODECS[".flac"] 이 nil 이라 절단 루프 첫머리에서 422 로 거부된다.
        flac = File.join(audio_dir, "#{meeting.id}.flac")
        write_wav(flac)
        meeting.update!(audio_file_path: flac)

        do_redact([ t2.id ])

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end

      it "파일 교체 도중 실패하면 DB 가 롤백되고 오디오가 원본 그대로 복구된다 (롤백 원자성)" do
        wav_original = File.binread(meeting.audio_file_path)

        # ⚠️ 실패 지점은 반드시 **트랜잭션 안**, swap_in! 이 백업을 만든 **뒤**여야 한다.
        # drop_backups! 는 커밋 뒤라 거기서 깨면 "전사는 지워졌는데 오디오는 복구됨" — 설계가
        # 금지한 방향이 되어 이 단언이 성립하지 않는다.
        allow_any_instance_of(AudioRedactor).to receive(:swap_in!).and_wrap_original do |orig, mapping|
          orig.call(mapping) # 백업 생성 + 교체까지 실제로 수행한 뒤
          raise StandardError, "boom" # 그 상태에서 터뜨려 restore 경로를 태운다
        end

        expect { do_redact([ t2.id ]) }.to raise_error(StandardError, "boom")

        expect(Transcript.where(id: t2.id)).to exist
        expect(Transcript.where(meeting: meeting).count).to eq(4)
        expect(File.binread(File.join(audio_dir, "#{meeting.id}.wav"))).to eq(wav_original)
        expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
        expect(Dir.glob(File.join(audio_dir, "*.redact-tmp*"))).to be_empty
      end

      it "purge 를 swap 뒤로 옮기면 요청이 실패한다 (순서 계약 회귀 가드)" do
        # M3: 유닛 테스트만으로는 컨트롤러 호출 순서를 뒤집어도 잡히지 않았다. AudioRedactor 가
        # @swapped 로 순서를 강제하므로, 순서가 뒤집히면 여기서 PurgeFailed 로 드러난다.
        allow_any_instance_of(AudioRedactor).to receive(:purge_duplicate_sources!).and_wrap_original do |orig, *args|
          orig.receiver.send(:instance_variable_set, :@swapped, true) # swap 이 먼저 돈 상태 재현
          orig.call(*args)
        end

        do_redact([ t2.id ])

        expect(response).to have_http_status(:unprocessable_entity)
        expect(Transcript.where(id: t2.id)).to exist
      end

      it "전사를 전부 고르면 오디오 파일이 사라지고 audio_file_path 가 비워진다" do
        path = meeting.audio_file_path

        do_redact([ t1.id, t2.id, t3.id, t4.id ])

        expect(response).to have_http_status(:ok)
        expect(Transcript.where(meeting: meeting).count).to eq(0)
        expect(File.exist?(path)).to be false
        expect(meeting.reload.audio_file_path).to be_nil
        # 백업 경유로 치웠지만 커밋 후 파기되므로 아무것도 남지 않는다.
        expect(Dir.glob(File.join(audio_dir, "*.redact-backup"))).to be_empty
      end

      it "전체 선택 경로에서 커밋이 실패하면 오디오가 되살아난다 (rm 이 아니라 백업 규율)" do
        path = meeting.audio_file_path
        original = File.binread(path)
        # ⚠️ 무조건 raise 하면 트랜잭션 **밖**의 refresh_audio_duration!
        # (update_column → update_columns, 컨트롤러 :308)에서 먼저 터져 백업·복구 경로가
        # 한 줄도 실행되지 않는다 — 단언은 전부 통과하지만 아무것도 검증하지 못한다.
        # audio_file_path 를 비우는 그 호출(move_all_audio_to_backup! **직후**)만 골라 터뜨린다.
        allow_any_instance_of(Meeting).to receive(:update_columns).and_wrap_original do |orig, *args|
          attrs = args.first
          raise StandardError, "boom" if attrs.respond_to?(:key?) && attrs.key?(:audio_file_path)

          orig.call(*args)
        end

        expect { do_redact([ t1.id, t2.id, t3.id, t4.id ]) }.to raise_error(StandardError, "boom")

        expect(File.binread(path)).to eq(original)
        expect(Transcript.where(meeting: meeting).count).to eq(4)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # DELETE /api/v1/meetings/:meeting_id/transcripts/destroy_batch
  # 동봉 수정 회귀: delete_all → destroy_all, last_user_edit_at 갱신 추가
  # ─────────────────────────────────────────────────────────
  describe "DELETE /api/v1/meetings/:meeting_id/transcripts/destroy_batch" do
    let!(:transcript) do
      create(:transcript, meeting: meeting, sequence_number: 1, content: "지울발언고유토큰9876")
    end

    it "FTS 인덱스에서도 삭제된다(delete_all→destroy_all 전환 회귀 가드)" do
      conn = ActiveRecord::Base.connection
      before_rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
        [ "SELECT source_id FROM transcripts_fts WHERE source_id = ?", transcript.id ]
      ))
      expect(before_rows.to_a.length).to eq(1)

      delete "/api/v1/meetings/#{meeting.id}/transcripts/destroy_batch",
             params: { ids: [ transcript.id ] }
      expect(response).to have_http_status(:ok)

      after_rows = conn.execute(ActiveRecord::Base.sanitize_sql_array(
        [ "SELECT source_id FROM transcripts_fts WHERE source_id = ?", transcript.id ]
      ))
      expect(after_rows.to_a.length).to eq(0)
    end

    it "실제로 삭제된 경우 meeting.last_user_edit_at을 갱신한다" do
      freeze_time = Time.zone.parse("2026-07-30 12:00:00")
      travel_to(freeze_time) do
        delete "/api/v1/meetings/#{meeting.id}/transcripts/destroy_batch",
               params: { ids: [ transcript.id ] }
      end

      expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze_time)
    end

    it "존재하지 않는 id만 보내면 deleted: 0이고 last_user_edit_at이 갱신되지 않는다" do
      # 아무것도 안 지워졌는데 last_user_edit_at을 건드리면 D'Flow가 재전송 필요로
      # 오판(dflow_needs_resync?)한다. apply_glossary_entry(meetings_controller.rb:661-664)와
      # 같은 원칙 — 실제로 바뀐 경우에만 갱신.
      meeting.update!(last_user_edit_at: nil)

      delete "/api/v1/meetings/#{meeting.id}/transcripts/destroy_batch",
             params: { ids: [ 999_999 ] }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["deleted"]).to eq(0)
      expect(meeting.reload.last_user_edit_at).to be_nil
    end
  end
end
