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
