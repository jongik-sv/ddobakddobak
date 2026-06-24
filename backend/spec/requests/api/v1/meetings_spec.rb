require "rails_helper"

RSpec.describe "Api::V1::Meetings", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }
  let(:meeting) { create(:meeting, project: project, creator: user) }

  before { login_as(user) }

  # ============================================================
  # GET /api/v1/meetings
  # ============================================================
  describe "GET /api/v1/meetings" do
    context "when authenticated" do
      it "returns meetings created by the user" do
        meeting = create(:meeting, project: project, creator: user)

        get "/api/v1/meetings"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meetings"].length).to eq(1)
        expect(json["meetings"].first["id"]).to eq(meeting.id)
      end

      it "returns pagination meta" do
        get "/api/v1/meetings"

        json = response.parsed_body
        expect(json["meta"]).to include("total", "page", "per")
      end

      it "returns status_counts breakdown for the dashboard" do
        # 활성 녹음은 항상 최신 하트비트를 가진다(start 도장·채널 bump). 부재면 index lazy heal 이 종결.
        create(:meeting, project: project, creator: user, status: "recording", recorder_heartbeat_at: Time.current)
        create_list(:meeting, 2, project: project, creator: user, status: "pending")
        create(:meeting, project: project, creator: user, status: "completed")

        get "/api/v1/meetings"

        counts = response.parsed_body["meta"]["status_counts"]
        expect(counts["recording"]).to eq(1)
        expect(counts["pending"]).to eq(2)
        expect(counts["completed"]).to eq(1)
      end

      it "status_counts gives the full breakdown even when filtered by status" do
        create(:meeting, project: project, creator: user, status: "recording", recorder_heartbeat_at: Time.current)
        create_list(:meeting, 2, project: project, creator: user, status: "pending")

        get "/api/v1/meetings", params: { status: "recording" }

        json = response.parsed_body
        expect(json["meetings"].length).to eq(1)
        expect(json["meta"]["total"]).to eq(1)
        expect(json["meta"]["status_counts"]["recording"]).to eq(1)
        expect(json["meta"]["status_counts"]["pending"]).to eq(2)
      end

      it "scheduled_count counts pending meetings with a scheduled_start_time" do
        create_list(:meeting, 2, project: project, creator: user,
                                 status: "pending", scheduled_start_time: 1.hour.from_now)

        get "/api/v1/meetings"

        expect(response.parsed_body["meta"]["scheduled_count"]).to eq(2)
      end

      it "scheduled_count excludes pending meetings without a scheduled_start_time" do
        create_list(:meeting, 3, project: project, creator: user,
                                 status: "pending", scheduled_start_time: nil)

        get "/api/v1/meetings"

        expect(response.parsed_body["meta"]["scheduled_count"]).to eq(0)
      end

      it "scheduled_count excludes non-pending meetings even with a scheduled_start_time" do
        # stray: 이미 완료된 회의에 예약 시각이 남아 있어도 .pending 게이트로 제외된다.
        create(:meeting, project: project, creator: user,
                         status: "completed", scheduled_start_time: 1.hour.from_now)
        create(:meeting, project: project, creator: user,
                         status: "pending", scheduled_start_time: 1.hour.from_now)

        get "/api/v1/meetings"

        meta = response.parsed_body["meta"]
        expect(meta["scheduled_count"]).to eq(1)
        # status_counts 는 scheduled_count 와 무관하게 그대로다 (오염 없음).
        expect(meta["status_counts"]["completed"]).to eq(1)
        expect(meta["status_counts"]["pending"]).to eq(1)
        # total 도 status_counts.values.sum 파생이 유지된다.
        expect(meta["total"]).to eq(2)
      end

      it "supports page and per params" do
        create_list(:meeting, 3, project: project, creator: user)

        get "/api/v1/meetings", params: { page: 1, per: 2 }

        json = response.parsed_body
        expect(json["meetings"].length).to eq(2)
        expect(json["meta"]["total"]).to eq(3)
        expect(json["meta"]["page"]).to eq(1)
        expect(json["meta"]["per"]).to eq(2)
      end

      it "supports search by title with q param" do
        create(:meeting, project: project, creator: user, title: "Design Review")
        create(:meeting, project: project, creator: user, title: "Sprint Planning")

        get "/api/v1/meetings", params: { q: "design" }

        json = response.parsed_body
        expect(json["meetings"].length).to eq(1)
        expect(json["meetings"].first["title"]).to eq("Design Review")
      end

      it "q param matches transcript content even when title/summary do not" do
        hit  = create(:meeting, project: project, creator: user, title: "주간 회의", brief_summary: "일정 공유")
        miss = create(:meeting, project: project, creator: user, title: "월간 회의", brief_summary: "예산 논의")
        create(:transcript, meeting: hit, content: "발사대 점검 결과를 공유했습니다")
        create(:transcript, meeting: miss, content: "다른 주제의 발언입니다")

        get "/api/v1/meetings", params: { q: "발사대" }

        json = response.parsed_body
        expect(json["meetings"].map { |m| m["id"] }).to eq([ hit.id ])
      end

      it "q에 LIKE 와일드카드(%, _)가 있어도 리터럴로 검색된다" do
        pct = create(:meeting, project: project, creator: user, title: "진행률 100% 보고")
        create(:meeting, project: project, creator: user, title: "진행률 100점 보고")
        snake = create(:meeting, project: project, creator: user, title: "회의록")
        create(:transcript, meeting: snake, content: "snake_case 네이밍 논의")
        other = create(:meeting, project: project, creator: user, title: "잡담")
        create(:transcript, meeting: other, content: "snakeXcase 이야기")

        get "/api/v1/meetings", params: { q: "100%" }
        expect(response.parsed_body["meetings"].map { |m| m["id"] }).to eq([ pct.id ])

        get "/api/v1/meetings", params: { q: "snake_case" }
        expect(response.parsed_body["meetings"].map { |m| m["id"] }).to eq([ snake.id ])
      end

      it "q param의 전사 매치도 accessible_by 범위를 벗어나지 않는다" do
        mine = create(:meeting, project: project, creator: user, title: "내 회의")
        create(:transcript, meeting: mine, content: "발사대 일정")
        others = create(:meeting, :private_meeting, project: project, creator: other_user, title: "남의 회의")
        create(:transcript, meeting: others, content: "발사대 기밀")

        get "/api/v1/meetings", params: { q: "발사대" }

        ids = response.parsed_body["meetings"].map { |m| m["id"] }
        expect(ids).to include(mine.id)
        expect(ids).not_to include(others.id)
      end

      it "returns empty meetings when no meetings" do
        get "/api/v1/meetings"

        json = response.parsed_body
        expect(json["meetings"]).to eq([])
        expect(json["meta"]["total"]).to eq(0)
      end

      it "다른 사용자가 만든 회의는 목록에 포함되지 않는다" do
        create(:meeting, project: project, creator: user, title: "내 회의")
        create(:meeting, :private_meeting, project: project, creator: other_user, title: "남의 회의")

        get "/api/v1/meetings"

        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).to include("내 회의")
        expect(titles).not_to include("남의 회의")
      end

      it "admin은 모든 사용자의 회의를 본다" do
        admin = create(:user, role: "admin")
        create(:meeting, project: project, creator: other_user, title: "남의 회의")
        login_as(admin)

        get "/api/v1/meetings"

        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).to include("남의 회의")
      end

      # 기본 목록(show_all 없음)의 중요 필터는 완료 회의에만 적용된다.
      # 예약(pending)·진행중(recording/transcribing)은 important=false 라도 항상 노출되어야 한다
      # (방금 만든 회의/예약 회의가 기본 목록에서 사라지는 혼동 방지).
      context "기본 목록의 중요 필터는 완료 회의에만 적용된다 (show_all 없음)" do
        it "important=false 인 pending(예약) 회의도 노출된다" do
          pending_unimportant = create(:meeting, project: project, creator: user, status: "pending", important: false)

          get "/api/v1/meetings"

          ids = response.parsed_body["meetings"].map { |m| m["id"] }
          expect(ids).to include(pending_unimportant.id)
        end

        it "important=false 인 recording(진행중) 회의도 노출된다" do
          recording_unimportant = create(:meeting, project: project, creator: user, status: "recording", important: false, recorder_heartbeat_at: Time.current)

          get "/api/v1/meetings"

          ids = response.parsed_body["meetings"].map { |m| m["id"] }
          expect(ids).to include(recording_unimportant.id)
        end

        it "important=false 인 completed(완료) 회의는 제외된다" do
          completed_unimportant = create(:meeting, project: project, creator: user, status: "completed", important: false)

          get "/api/v1/meetings"

          ids = response.parsed_body["meetings"].map { |m| m["id"] }
          expect(ids).not_to include(completed_unimportant.id)
        end

        it "important=true 인 completed(완료) 회의는 노출된다" do
          completed_important = create(:meeting, project: project, creator: user, status: "completed", important: true)

          get "/api/v1/meetings"

          ids = response.parsed_body["meetings"].map { |m| m["id"] }
          expect(ids).to include(completed_important.id)
        end

        it "show_all=true 이면 important=false 인 completed 회의도 노출된다 (기존 동작 유지)" do
          completed_unimportant = create(:meeting, project: project, creator: user, status: "completed", important: false)

          get "/api/v1/meetings", params: { show_all: true }

          ids = response.parsed_body["meetings"].map { |m| m["id"] }
          expect(ids).to include(completed_unimportant.id)
        end
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings
  # ============================================================
  describe "POST /api/v1/meetings" do
    context "when authenticated as project member" do
      it "creates a meeting" do
        expect {
          post "/api/v1/meetings",
               params: { title: "New Meeting", project_id: project.id },
               as: :json
        }.to change(Meeting, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["meeting"]["title"]).to eq("New Meeting")
        expect(json["meeting"]["status"]).to eq("pending")
      end

      it "sets created_by_id to current_user" do
        post "/api/v1/meetings",
             params: { title: "My Meeting", project_id: project.id },
             as: :json

        meeting = Meeting.last
        expect(meeting.created_by_id).to eq(user.id)
      end

      it "returns 422 when title is blank" do
        post "/api/v1/meetings",
             params: { title: "", project_id: project.id },
             as: :json

        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "requires project_id (400 when missing — Phase 5 멤버십 강제)" do
        expect {
          post "/api/v1/meetings",
               params: { title: "New Meeting" },
               as: :json
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:bad_request)
      end

      it "비멤버 프로젝트에는 회의를 만들 수 없다 (403, IDOR 방어)" do
        foreign = create(:project, creator: other_user)
        expect {
          post "/api/v1/meetings",
               params: { title: "침입", project_id: foreign.id },
               as: :json
        }.not_to change(Meeting, :count)

        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  # ============================================================
  # GET /api/v1/meetings/:id
  # ============================================================
  describe "GET /api/v1/meetings/:id" do
    context "when authenticated as project member" do
      it "returns meeting with transcripts, summary, and action_items" do
        transcript = create(:transcript, meeting: meeting, sequence_number: 1)
        summary = create(:summary, meeting: meeting, summary_type: "final")
        action_item = create(:action_item, meeting: meeting)

        get "/api/v1/meetings/#{meeting.id}"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["id"]).to eq(meeting.id)
        expect(json["meeting"]["transcripts"].length).to eq(1)
        expect(json["meeting"]["transcripts"].first["id"]).to eq(transcript.id)
        expect(json["meeting"]["summary"]).to include("key_points")
        expect(json["meeting"]["action_items"].length).to eq(1)
        expect(json["meeting"]["action_items"].first["id"]).to eq(action_item.id)
      end

      it "returns transcripts ordered by sequence_number" do
        create(:transcript, meeting: meeting, sequence_number: 3, content: "Third")
        create(:transcript, meeting: meeting, sequence_number: 1, content: "First")
        create(:transcript, meeting: meeting, sequence_number: 2, content: "Second")

        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        contents = json["meeting"]["transcripts"].map { |t| t["content"] }
        expect(contents).to eq(%w[First Second Third])
      end

      it "prefers final summary over realtime" do
        create(:summary, meeting: meeting, summary_type: "realtime")
        final_summary = create(:summary, meeting: meeting, summary_type: "final")

        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        expect(json["meeting"]["summary"]["id"]).to eq(final_summary.id)
      end

      it "returns null summary when none exists" do
        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        expect(json["meeting"]["summary"]).to be_nil
      end

      it "returns 404 when meeting not found" do
        get "/api/v1/meetings/99999"
        expect(response).to have_http_status(:not_found)
      end

      it "200 OK 및 회의 데이터 반환" do
        get "/api/v1/meetings/#{meeting.id}"
        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["id"]).to eq(meeting.id)
        expect(json["meeting"]["title"]).to eq(meeting.title)
        expect(json["meeting"]["status"]).to eq(meeting.status)
        expect(json["meeting"]["created_by_id"]).to eq(meeting.created_by_id)
      end

      it "응답에 필요한 필드 포함" do
        get "/api/v1/meetings/#{meeting.id}"
        json = response.parsed_body
        expect(json["meeting"].keys).to include(
          "id", "title", "status",
          "started_at", "ended_at",
          "created_by_id",
          "created_at", "updated_at"
        )
      end

      it "transcripts에 speaker_name을 포함한다" do
        create(:transcript, meeting: meeting, sequence_number: 1, speaker_name: "앨리스")

        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        expect(json["meeting"]["transcripts"].first["speaker_name"]).to eq("앨리스")
      end
    end

    context "존재하지 않는 회의 ID" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/99999"
        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body["error"]).to eq("Meeting not found")
      end
    end

    context "접근 권한" do
      it "소유자가 아니고 참여자도 아니면 403 (비공개 회의)" do
        foreign = create(:meeting, :private_meeting, project: project, creator: other_user)
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:forbidden)
      end

      it "공유코드로 참여한 viewer는 조회 가능(200)" do
        foreign = create(:meeting, project: project, creator: other_user)
        create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:ok)
      end

      it "admin은 남의 회의도 조회 가능(200)" do
        foreign = create(:meeting, project: project, creator: other_user)
        login_as(create(:user, role: "admin"))
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:ok)
      end

      it "회의를 떠난(left_at 설정) 참여자는 더 이상 접근할 수 없다(403)" do
        foreign = create(:meeting, :private_meeting, project: project, creator: other_user)
        create(:meeting_participant, meeting: foreign, user: user, role: "viewer", left_at: Time.current)
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:forbidden)
      end

      it "소유자는 자신의 회의에 접근 가능(200)" do
        mine = create(:meeting, project: project, creator: user)
        get "/api/v1/meetings/#{mine.id}"
        expect(response).to have_http_status(:ok)
      end
    end
  end

  # ============================================================
  # PATCH /api/v1/meetings/:id
  # ============================================================
  describe "PATCH /api/v1/meetings/:id" do
    let(:meeting) { create(:meeting, project: project, creator: user, title: "Old Title") }

    context "as meeting creator" do
      it "updates the meeting title" do
        patch "/api/v1/meetings/#{meeting.id}",
              params: { title: "New Title" },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["title"]).to eq("New Title")
        expect(meeting.reload.title).to eq("New Title")
      end

      it "returns 422 when title is blank" do
        patch "/api/v1/meetings/#{meeting.id}",
              params: { title: "" },
              as: :json

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    describe "expected_participants" do
      it "update로 참여 인원수를 설정/해제할 수 있다" do
        patch "/api/v1/meetings/#{meeting.id}", params: { expected_participants: 5 }
        expect(response).to have_http_status(:ok)
        expect(meeting.reload.expected_participants).to eq(5)
        expect(JSON.parse(response.body).dig("meeting", "expected_participants")).to eq(5)

        patch "/api/v1/meetings/#{meeting.id}", params: { expected_participants: "" }
        expect(meeting.reload.expected_participants).to be_nil
      end

      it "범위 밖 값은 422" do
        patch "/api/v1/meetings/#{meeting.id}", params: { expected_participants: 0 }
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    describe "예약 필드(scheduling)" do
      let(:scheduled_at) { 1.hour.from_now.change(usec: 0) }

      it "pending 회의는 예약 시각·모드·반복 규칙을 설정하고 직렬화한다" do
        rule = { freq: "weekly", days: [ 2 ], time: "14:00", tz: "Asia/Seoul" }
        patch "/api/v1/meetings/#{meeting.id}",
              params: {
                scheduled_start_time: scheduled_at.iso8601,
                auto_start_mode: "manual",
                recurrence_rule: rule.to_json
              },
              as: :json

        expect(response).to have_http_status(:ok)
        meeting.reload
        expect(meeting.scheduled_start_time).to be_within(1.second).of(scheduled_at)
        expect(meeting.auto_start_mode).to eq("manual")
        expect(JSON.parse(meeting.recurrence_rule)).to include("freq" => "weekly", "days" => [ 2 ])

        json = response.parsed_body["meeting"]
        expect(json["scheduled_start_time"]).to be_present
        expect(json["auto_start_mode"]).to eq("manual")
        expect(json["recurrence_rule"]).to include("freq" => "weekly")
      end

      it "예약 시각을 빈 값으로 PATCH 하면 모드·반복 규칙까지 모두 해제(nil)된다" do
        scheduled = create(:meeting, project: project, creator: user, status: "pending",
                                     scheduled_start_time: scheduled_at,
                                     auto_start_mode: "auto",
                                     recurrence_rule: { freq: "weekly", days: [ 5 ], time: "09:00", tz: "Asia/Seoul" }.to_json)

        patch "/api/v1/meetings/#{scheduled.id}",
              params: { scheduled_start_time: "" },
              as: :json

        expect(response).to have_http_status(:ok)
        scheduled.reload
        expect(scheduled.scheduled_start_time).to be_nil
        expect(scheduled.auto_start_mode).to be_nil
        expect(scheduled.recurrence_rule).to be_nil
      end

      it "예약 시각 변경 시 schedule_dismissed_at 을 nil 로 리셋한다" do
        dismissed = create(:meeting, project: project, creator: user, status: "pending",
                                     scheduled_start_time: 10.minutes.ago,
                                     schedule_dismissed_at: Time.current)

        patch "/api/v1/meetings/#{dismissed.id}",
              params: { scheduled_start_time: scheduled_at.iso8601 },
              as: :json

        expect(response).to have_http_status(:ok)
        dismissed.reload
        expect(dismissed.scheduled_start_time).to be_within(1.second).of(scheduled_at)
        expect(dismissed.schedule_dismissed_at).to be_nil
      end

      it "비pending(completed) 회의의 예약 파라미터는 조용히 무시된다" do
        completed = create(:meeting, project: project, creator: user, status: "completed")

        patch "/api/v1/meetings/#{completed.id}",
              params: {
                scheduled_start_time: scheduled_at.iso8601,
                auto_start_mode: "auto",
                recurrence_rule: { freq: "daily", time: "08:00", tz: "Asia/Seoul" }.to_json
              },
              as: :json

        expect(response).to have_http_status(:ok)
        completed.reload
        expect(completed.scheduled_start_time).to be_nil
        expect(completed.auto_start_mode).to be_nil
        expect(completed.recurrence_rule).to be_nil
      end
    end
  end

  # ============================================================
  # DELETE /api/v1/meetings/:id
  # ============================================================
  describe "DELETE /api/v1/meetings/:id" do
    let!(:meeting) { create(:meeting, project: project, creator: user) }

    context "as meeting creator" do
      it "soft-deletes the meeting (moves to trash)" do
        delete "/api/v1/meetings/#{meeting.id}"

        expect(response).to have_http_status(:no_content)
        expect(Meeting.exists?(meeting.id)).to be true
        expect(meeting.reload.trashed?).to be true
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/start
  # ============================================================
  describe "POST /api/v1/meetings/:id/start" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "pending") }

    context "when meeting is pending" do
      it "transitions to recording and sets started_at" do
        post "/api/v1/meetings/#{meeting.id}/start"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["status"]).to eq("recording")
        expect(meeting.reload.status).to eq("recording")
        expect(meeting.reload.started_at).not_to be_nil
      end
    end

    context "when meeting is not pending" do
      let(:recording_meeting) { create(:meeting, project: project, creator: user, status: "recording") }

      it "returns 422" do
        post "/api/v1/meetings/#{recording_meeting.id}/start"
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    context "when meeting is recurring" do
      let(:recurring) do
        create(:meeting, project: project, creator: user, status: "pending",
               recurrence_rule: '{"freq":"weekly","days":[1],"time":"10:00","tz":"Asia/Seoul"}',
               scheduled_start_time: 1.day.ago)
      end

      it "시작하면 미래 pending successor 를 정확히 1개 생성한다(시리즈 연속)" do
        recurring
        expect {
          post "/api/v1/meetings/#{recurring.id}/start"
        }.to change { Meeting.where(previous_meeting_id: recurring.id).count }.by(1)

        expect(response).to have_http_status(:ok)
        successor = Meeting.find_by(previous_meeting_id: recurring.id)
        expect(successor.status).to eq("pending")
        expect(successor.scheduled_start_time).to be > Time.current
      end
    end

    context "when meeting is not recurring" do
      it "successor 를 만들지 않는다" do
        expect {
          post "/api/v1/meetings/#{meeting.id}/start"
        }.not_to change { Meeting.where(previous_meeting_id: meeting.id).count }
        expect(response).to have_http_status(:ok)
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/stop
  # ============================================================
  describe "POST /api/v1/meetings/:id/stop" do
    include ActiveJob::TestHelper

    let(:meeting) { create(:meeting, project: project, creator: user, status: "recording") }

    context "when meeting is recording" do
      it "transitions to completed and sets ended_at" do
        post "/api/v1/meetings/#{meeting.id}/stop"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["status"]).to eq("completed")
        expect(meeting.reload.status).to eq("completed")
        expect(meeting.reload.ended_at).not_to be_nil
      end

      it "enqueues finalizer + final summary when transcripts exist" do
        create(:transcript, meeting: meeting)
        expect(MeetingFinalizerJob).to receive(:perform_later).with(meeting.id)
        expect(MeetingSummarizationJob).to receive(:perform_later).with(meeting.id, type: "final")

        post "/api/v1/meetings/#{meeting.id}/stop"
      end

      it "does NOT enqueue jobs when no transcripts exist" do
        expect(MeetingFinalizerJob).not_to receive(:perform_later)
        expect(MeetingSummarizationJob).not_to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop"
        expect(response).to have_http_status(:ok)
      end

      it "does NOT enqueue jobs when skip_summary=true even with transcripts" do
        create(:transcript, meeting: meeting)
        expect(MeetingFinalizerJob).not_to receive(:perform_later)
        expect(MeetingSummarizationJob).not_to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop", params: { skip_summary: "true" }
        expect(response).to have_http_status(:ok)
        expect(meeting.reload.status).to eq("completed")
      end

      it "clears paused_at on stop" do
        meeting.update!(paused_at: Time.current)
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop"
        expect(meeting.reload.paused_at).to be_nil
      end

      it "broadcasts recording_stopped to the meeting transcription stream" do
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        expect(ActionCable.server).to receive(:broadcast).with(
          "meeting_#{meeting.id}_transcription",
          hash_including(
            type: "recording_stopped",
            meeting_id: meeting.id
          )
        )

        post "/api/v1/meetings/#{meeting.id}/stop"
      end

      it "clears the recording lock for the meeting" do
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)
        RecordingLock.acquire(meeting.id, "device-token")

        post "/api/v1/meetings/#{meeting.id}/stop"

        expect(RecordingLock.holder(meeting.id)).to be_nil
      end

      it "전사가 있으면 EmbedBackfillJob을 meeting_id로 enqueue한다" do
        create(:transcript, meeting: meeting)
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        expect {
          post "/api/v1/meetings/#{meeting.id}/stop"
        }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: meeting.id)
      end
    end

    context "when meeting is not recording" do
      let(:pending_meeting) { create(:meeting, project: project, creator: user, status: "pending") }

      it "returns 422" do
        post "/api/v1/meetings/#{pending_meeting.id}/stop"
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/pause · resume
  # ============================================================
  describe "POST /api/v1/meetings/:id/pause" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "recording") }

    it "sets paused_at and broadcasts recording_paused" do
      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_transcription",
        hash_including(type: "recording_paused", meeting_id: meeting.id)
      )
      post "/api/v1/meetings/#{meeting.id}/pause"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.paused_at).not_to be_nil
    end

    it "returns 422 when not recording" do
      pending_meeting = create(:meeting, project: project, creator: user, status: "pending")
      post "/api/v1/meetings/#{pending_meeting.id}/pause"
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "forbids viewer participants" do
      foreign = create(:meeting, project: project, creator: other_user, status: "recording")
      create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
      post "/api/v1/meetings/#{foreign.id}/pause"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/v1/meetings/:id/resume" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "recording", paused_at: Time.current) }

    it "clears paused_at and broadcasts recording_resumed" do
      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_transcription",
        hash_including(type: "recording_resumed", meeting_id: meeting.id)
      )
      post "/api/v1/meetings/#{meeting.id}/resume"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.paused_at).to be_nil
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/summarize
  # ============================================================
  describe "POST /api/v1/meetings/:id/summarize" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "recording") }

    it "enqueues realtime summary when transcripts exist" do
      create(:transcript, meeting: meeting)
      expect(MeetingSummarizationJob).to receive(:perform_later).with(meeting.id, type: "realtime")
      post "/api/v1/meetings/#{meeting.id}/summarize"
      expect(response).to have_http_status(:ok)
    end

    it "does NOT enqueue and returns skipped when no transcripts" do
      expect(MeetingSummarizationJob).not_to receive(:perform_later)
      post "/api/v1/meetings/#{meeting.id}/summarize"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["skipped"]).to eq("no_transcripts")
    end

    it "returns 422 when meeting is pending" do
      pending_meeting = create(:meeting, project: project, creator: user, status: "pending")
      post "/api/v1/meetings/#{pending_meeting.id}/summarize"
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  # ============================================================
  # 제어 액션 인가
  # ============================================================
  describe "제어 액션 인가" do
    let(:foreign) { create(:meeting, project: project, creator: other_user, status: "pending") }

    it "viewer 참여자는 회의를 제어(start)할 수 없다(403)" do
      create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
      post "/api/v1/meetings/#{foreign.id}/start"
      expect(response).to have_http_status(:forbidden)
    end

    it "viewer 참여자는 update할 수 없다(403)" do
      create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
      patch "/api/v1/meetings/#{foreign.id}", params: { title: "해킹" }
      expect(response).to have_http_status(:forbidden)
      expect(foreign.reload.title).not_to eq("해킹")
    end
  end

  # ============================================================
  # POST /api/v1/meetings/move_to_folder
  # ============================================================
  describe "POST /api/v1/meetings/move_to_folder" do
    let(:folder) { create(:folder, project: project) }

    it "남의 회의는 폴더 이동되지 않는다" do
      foreign = create(:meeting, :private_meeting, project: project, creator: other_user, folder_id: nil)
      post "/api/v1/meetings/move_to_folder", params: { meeting_ids: [ foreign.id ], folder_id: folder.id }
      expect(foreign.reload.folder_id).to be_nil
    end

    it "내 회의는 폴더 이동된다" do
      mine = create(:meeting, project: project, creator: user, folder_id: nil)
      post "/api/v1/meetings/move_to_folder", params: { meeting_ids: [ mine.id ], folder_id: folder.id }
      expect(mine.reload.folder_id).to eq(folder.id)
    end
  end

  # ============================================================
  # GET /api/v1/meetings/:id/audio
  # ============================================================
  describe "GET /api/v1/meetings/:id/audio" do
    let(:meeting) { create(:meeting, project: project, creator: user) }

    context "when audio file exists" do
      let(:audio_path) { Rails.root.join("tmp", "test_audio.webm").to_s }

      before do
        File.write(audio_path, "fake audio content")
        meeting.update!(audio_file_path: audio_path)
      end

      after do
        File.delete(audio_path) if File.exist?(audio_path)
      end

      it "streams the audio file" do
        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:ok)
      end
    end

    context "when audio file does not exist" do
      it "returns 404" do
        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:not_found)
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/regenerate_stt
  # ============================================================
  describe "POST /api/v1/meetings/:id/regenerate_stt" do
    let(:audio_path) do
      path = Rails.root.join("tmp", "regen_stt_test_#{SecureRandom.hex(4)}.mp3").to_s
      File.write(path, "x")
      path
    end

    after { FileUtils.rm_f(audio_path) }

    it "전사 실패로 pending이 된 회의(트랜스크립트 0건)도 재생성할 수 있다" do
      meeting = create(:meeting, project: project, creator: user, status: "pending", audio_file_path: audio_path)
      expect(FileTranscriptionJob).to receive(:perform_later).with(meeting.id)

      post "/api/v1/meetings/#{meeting.id}/regenerate_stt"

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.status).to eq("transcribing")
    end

    it "녹음 중에는 422" do
      meeting = create(:meeting, project: project, creator: user, status: "recording", audio_file_path: audio_path)

      post "/api/v1/meetings/#{meeting.id}/regenerate_stt"

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/regenerate_notes
  # ============================================================
  describe "POST /api/v1/meetings/:id/regenerate_notes" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

    context "when meeting is completed with transcripts" do
      before do
        create(:transcript, meeting: meeting, sequence_number: 1, content: "test transcript")
      end

      it "MeetingFinalizerJob도 enqueue한다" do
        expect(MeetingFinalizerJob).to receive(:perform_later).with(meeting.id)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/regenerate_notes"
      end
    end
  end
end

RSpec.describe "Api::V1::Meetings summary options", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before { login_as(user) }

  describe "POST /api/v1/meetings (요약 옵션)" do
    it "uses defaults (standard / restructure ON) for the first meeting" do
      post "/api/v1/meetings", params: { title: "첫 회의", project_id: project.id }

      json = response.parsed_body["meeting"]
      expect(json["summary_verbosity"]).to eq("standard")
      expect(json["summary_restructure"]).to be true
    end

    it "accepts explicit summary options" do
      post "/api/v1/meetings",
           params: { title: "옵션 회의", project_id: project.id, summary_verbosity: "very_concise", summary_restructure: false }

      json = response.parsed_body["meeting"]
      expect(json["summary_verbosity"]).to eq("very_concise")
      expect(json["summary_restructure"]).to be false
    end

    it "inherits options from the creator's last meeting when params absent" do
      create(:meeting, project: project, creator: user,
             summary_verbosity: "detailed", summary_restructure: false, created_at: 1.hour.ago)

      post "/api/v1/meetings", params: { title: "승계 회의", project_id: project.id }

      json = response.parsed_body["meeting"]
      expect(json["summary_verbosity"]).to eq("detailed")
      expect(json["summary_restructure"]).to be false
    end

    it "rejects invalid verbosity" do
      post "/api/v1/meetings", params: { title: "x", project_id: project.id, summary_verbosity: "ultra" }

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "PATCH /api/v1/meetings/:id (요약 옵션)" do
    let(:meeting) { create(:meeting, project: project, creator: user) }

    it "updates summary options mid-meeting" do
      patch "/api/v1/meetings/#{meeting.id}",
            params: { summary_verbosity: "concise", summary_restructure: false }

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.summary_verbosity).to eq("concise")
      expect(meeting.summary_restructure).to be false
    end

    it "leaves options untouched when params absent" do
      meeting.update!(summary_verbosity: "detailed", summary_restructure: false)

      patch "/api/v1/meetings/#{meeting.id}", params: { title: "이름만 변경" }

      expect(meeting.reload.summary_verbosity).to eq("detailed")
      expect(meeting.summary_restructure).to be false
    end

    it "ignores blank summary_restructure (NOT NULL 컬럼 500 방지)" do
      patch "/api/v1/meetings/#{meeting.id}", params: { summary_restructure: "" }

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.summary_restructure).to be true
    end
  end

  # ============================================================
  # 예약 회의 자동 시작 (scheduling)
  # ============================================================
  describe "POST /api/v1/meetings (예약 파라미터)" do
    let(:scheduled_at) { 1.hour.from_now.change(usec: 0) }

    it "예약 파라미터를 저장한다" do
      rule = { freq: "weekly", days: [ 1, 3 ], time: "10:00", tz: "Asia/Seoul" }
      post "/api/v1/meetings",
           params: {
             title: "예약 회의", project_id: project.id,
             scheduled_start_time: scheduled_at.iso8601,
             auto_start_mode: "manual",
             recurrence_rule: rule.to_json
           },
           as: :json

      expect(response).to have_http_status(:created)
      m = Meeting.last
      expect(m.scheduled_start_time).to be_within(1.second).of(scheduled_at)
      expect(m.auto_start_mode).to eq("manual")
      expect(JSON.parse(m.recurrence_rule)).to eq("freq" => "weekly", "days" => [ 1, 3 ], "time" => "10:00", "tz" => "Asia/Seoul")
    end

    it "recurrence_rule 을 해시로 받아도 저장한다" do
      post "/api/v1/meetings",
           params: {
             title: "예약 회의", project_id: project.id,
             scheduled_start_time: scheduled_at.iso8601,
             auto_start_mode: "auto",
             recurrence_rule: { freq: "weekly", days: [ 5 ], time: "09:00", tz: "Asia/Seoul" }
           },
           as: :json

      expect(response).to have_http_status(:created)
      expect(JSON.parse(Meeting.last.recurrence_rule)).to include("freq" => "weekly")
    end

    it "예약 파라미터 없는 생성은 기존과 동일(필드 모두 nil, 422 안 남)" do
      post "/api/v1/meetings",
           params: { title: "일반 회의", project_id: project.id },
           as: :json

      expect(response).to have_http_status(:created)
      m = Meeting.last
      expect(m.scheduled_start_time).to be_nil
      expect(m.auto_start_mode).to be_nil
      expect(m.recurrence_rule).to be_nil
    end

    it "빈 문자열 auto_start_mode 는 nil 로 정규화(422 방지)" do
      post "/api/v1/meetings",
           params: { title: "회의", project_id: project.id, auto_start_mode: "", scheduled_start_time: "" },
           as: :json

      expect(response).to have_http_status(:created)
      m = Meeting.last
      expect(m.auto_start_mode).to be_nil
      expect(m.scheduled_start_time).to be_nil
    end
  end

  describe "GET /api/v1/meetings/scheduled" do
    it "본인 접근가능·예약·pending·미dismiss 회의만 missed 플래그와 함께 반환한다" do
      freeze_time do
        upcoming = create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 30.minutes.from_now)
        missed   = create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 10.minutes.ago)
        far      = create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 5.hours.from_now)
        # 제외 대상
        create(:meeting, project: project, creator: user, status: "pending") # 예약 아님
        create(:meeting, project: project, creator: user, status: "recording", scheduled_start_time: 10.minutes.from_now) # 시작됨
        create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 10.minutes.from_now, schedule_dismissed_at: Time.current) # dismiss

        get "/api/v1/meetings/scheduled"

        expect(response).to have_http_status(:ok)
        meetings = response.parsed_body["meetings"]
        by_id = meetings.index_by { |m| m["id"] }

        # 시간창 없이 모든 예약·pending·미dismiss 반환(먼 미래 포함)
        expect(by_id.keys).to contain_exactly(upcoming.id, missed.id, far.id)
        expect(by_id[missed.id]["missed"]).to be true
        expect(by_id[upcoming.id]["missed"]).to be false
        expect(by_id[far.id]["missed"]).to be false
      end
    end

    it "missed 플래그는 트리거 유예(60s)를 지나야 true 가 된다" do
      freeze_time do
        # 30초 전: 아직 자동시작 트리거 유예 안 — missed=false
        in_grace = create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 30.seconds.ago)
        # 90초 전: 유예가 지남 — missed=true
        passed   = create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 90.seconds.ago)

        get "/api/v1/meetings/scheduled"

        by_id = response.parsed_body["meetings"].index_by { |m| m["id"] }
        # 둘 다 목록에는 포함된다(하한선 없음 — 워처가 둘 다 받아 처리)
        expect(by_id.keys).to include(in_grace.id, passed.id)
        expect(by_id[in_grace.id]["missed"]).to be false
        expect(by_id[passed.id]["missed"]).to be true
      end
    end

    it "타인의 비공유 예약 회의는 반환하지 않는다(인가)" do
      foreign = create(:meeting, :private_meeting, project: project, creator: other_user, status: "pending", scheduled_start_time: 30.minutes.from_now)

      get "/api/v1/meetings/scheduled"

      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).not_to include(foreign.id)
    end
  end

  describe "POST /api/v1/meetings/:id/dismiss_schedule" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "pending", scheduled_start_time: 10.minutes.ago) }

    it "schedule_dismissed_at 을 채우고 meeting_json 을 반환한다" do
      freeze_time do
        post "/api/v1/meetings/#{meeting.id}/dismiss_schedule"

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["meeting"]["id"]).to eq(meeting.id)
        expect(meeting.reload.schedule_dismissed_at).to be_within(1.second).of(Time.current)
      end
    end

    it "이후 scheduled 목록에서 사라진다" do
      post "/api/v1/meetings/#{meeting.id}/dismiss_schedule"
      get "/api/v1/meetings/scheduled"
      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).not_to include(meeting.id)
    end

    it "제어 권한 없는 타인은 403" do
      foreign = create(:meeting, :private_meeting, project: project, creator: other_user, status: "pending", scheduled_start_time: 10.minutes.ago)
      post "/api/v1/meetings/#{foreign.id}/dismiss_schedule"
      expect(response).to have_http_status(:forbidden)
    end

    it "잠긴 회의는 403 + '잠긴 회의'" do
      meeting.update_column(:locked_at, Time.current)
      post "/api/v1/meetings/#{meeting.id}/dismiss_schedule"
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"].to_s).to include("잠긴 회의")
    end
  end

  describe "meeting_json 예약 필드(detail)" do
    it "show 응답에 예약 필드를 포함하고 recurrence_rule 은 파싱된 객체다" do
      rule = { "freq" => "weekly", "days" => [ 1 ], "time" => "10:00", "tz" => "Asia/Seoul" }
      m = create(:meeting, project: project, creator: user,
                 scheduled_start_time: 1.hour.from_now, auto_start_mode: "auto",
                 recurrence_rule: rule.to_json, schedule_dismissed_at: nil)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body["meeting"]
      expect(json).to have_key("scheduled_start_time")
      expect(json["auto_start_mode"]).to eq("auto")
      expect(json["recurrence_rule"]).to eq(rule)
      expect(json).to have_key("schedule_dismissed_at")
    end
  end
end
