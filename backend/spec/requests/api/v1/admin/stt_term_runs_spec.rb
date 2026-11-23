require "rails_helper"

RSpec.describe "Api::V1::Admin::SttTermRuns", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }
  let(:project) { create(:project, creator: admin) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }
  let(:meeting) { create(:meeting, project: project, folder: child, creator: admin) }
  let(:level) { SttTermLearning::Level }

  def json = response.parsed_body

  def final_summary(meeting, ai: "AI 원본\n우판 공정", human: "AI 원본\n후판 공정", edited: nil)
    create(:summary, meeting: meeting, summary_type: "final", ai_notes_markdown: ai, notes_markdown: human,
           ai_generated_at: 2.hours.ago, human_edited_at: edited)
  end

  def run_for(meeting, **attrs)
    create(:stt_term_learning_run, meeting: meeting, status: "done", finished_at: Time.current,
           ai_text: "a\n우판", human_text: "a\n후판", transcript_text: "우판", input_digest: "d1", **attrs)
  end

  # 남의 personal 프로젝트 회의(그 프로젝트 소유자가 만든 것).
  def hidden_meeting
    other = create(:user)
    create(:meeting, project: other.projects.find_by!(personal: true), creator: other)
  end

  def disable_learning!
    allow(AppSettings).to receive(:stt_term_learning)
      .and_return(AppSettings::STT_TERM_LEARNING_DEFAULTS.merge("enabled" => false))
  end

  context "server mode" do
    include_context "server mode"

    it "비관리자 403" do
      login_as(member)
      get "/api/v1/admin/stt_term_learning/runs"
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/admin/stt_term_learning/meetings/#{meeting.id}/analyze"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as admin" do
    before { login_as(admin) }

    describe "GET runs" do
      it "RunSummary 계약 키·집계, 남의 personal 회의는 뺀다" do
        run = run_for(meeting, summary: final_summary(meeting))
        create(:stt_term_learning_item, run: run, verdict: "registered")
        create(:stt_term_learning_item, run: run, verdict: "merged_existing", wrong: "a", wrong_key: "a")
        create(:stt_term_learning_item, run: run, verdict: "skipped_low_confidence", wrong: "b", wrong_key: "b")
        create(:stt_term_learning_item, run: run, verdict: "already_known", wrong: "c", wrong_key: "c")
        empty = run_for(create(:meeting, project: project))
        hidden = run_for(hidden_meeting)

        get "/api/v1/admin/stt_term_learning/runs"

        expect(response).to have_http_status(:ok)
        ids = json["runs"].map { |r| r["id"] }
        expect(ids).to include(run.id, empty.id)
        expect(ids).not_to include(hidden.id)
        r = json["runs"].find { |x| x["id"] == run.id }
        expect(r.keys).to contain_exactly("id", "meeting", "trigger", "status", "registered_count", "skipped_count",
                                          "no_change", "error", "llm_skipped_reason", "created_at", "finished_at")
        expect(r).to include("trigger" => "idle", "status" => "done", "registered_count" => 2, "skipped_count" => 1,
                             "no_change" => false, "error" => nil)
        expect(r["meeting"]).to eq("id" => meeting.id, "title" => meeting.title,
                                   "level" => { "type" => "Folder", "id" => child.id, "name" => child.name,
                                                "path" => [ project.name, parent.name, child.name ] })
        expect(json["runs"].find { |x| x["id"] == empty.id }["no_change"]).to eq(true)
      end

      it "status 필터" do
        done = run_for(meeting)
        failed = run_for(meeting, status: "failed", error: "boom")
        get "/api/v1/admin/stt_term_learning/runs", params: { status: "failed" }
        expect(json["runs"].map { |r| r["id"] }).to eq([ failed.id ])
        expect(json["runs"].first["error"]).to eq("boom")
        expect(done).to be_persisted
      end

      it "pending: 사람 편집 후 run 이 없는 learnable final (eta = 편집 + idle_minutes)" do
        edited = Time.zone.parse("2026-11-23 10:00:00")
        summary = final_summary(meeting, edited: edited)
        done_meeting = create(:meeting, project: project)
        done_summary = final_summary(done_meeting, edited: 1.hour.ago)
        run_for(done_meeting, summary: done_summary) # 편집 뒤 run 있음 → 대기 아님
        final_summary(create(:meeting, project: project), edited: nil) # 편집 없음
        final_summary(hidden_meeting, edited: edited)

        get "/api/v1/admin/stt_term_learning/runs"

        expect(json["pending"].size).to eq(1)
        p = json["pending"].first
        expect(p.keys).to contain_exactly("meeting", "summary_id", "human_edited_at", "eta")
        expect(p["summary_id"]).to eq(summary.id)
        expect(p["meeting"]["id"]).to eq(meeting.id)
        expect(Time.zone.parse(p["human_edited_at"])).to eq(edited)
        expect(Time.zone.parse(p["eta"])).to eq(edited + 30.minutes)
      end
    end

    it "GET runs/:id 는 diff·items·시각을 준다" do
      summary = final_summary(meeting, edited: 1.hour.ago)
      run = run_for(meeting, summary: summary)
      file = SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(child), fallback_creator: admin)
      item = create(:stt_term_learning_item, run: run, domain_file: file, level_owner_type: "Folder", level_owner_id: child.id,
                    reason: nil)
      create(:stt_term_learning_item, run: run, verdict: "merged_existing", level_owner_type: "global", level_owner_id: nil,
             wrong: "x", wrong_key: "x")

      get "/api/v1/admin/stt_term_learning/runs/#{run.id}"

      expect(response).to have_http_status(:ok)
      d = json["run"]
      expect(d).to include("id" => run.id, "registered_count" => 2)
      expect(d.keys).to include("ai_generated_at", "human_edited_at", "diff", "items")
      expect(d["ai_generated_at"]).to be_present
      expect(d["human_edited_at"]).to be_present
      expect(d["diff"]).to eq([ { "op" => "equal", "text" => "a" }, { "op" => "delete", "text" => "우판" },
                                { "op" => "insert", "text" => "후판" } ])
      i = d["items"].find { |x| x["id"] == item.id }
      expect(i.keys).to contain_exactly("id", "wrong", "correct", "source", "verdict", "reason", "domain_file", "level",
                                        "revert_result")
      expect(i["domain_file"]).to eq("id" => file.id, "name" => file.name)
      expect(i["level"]).to eq("type" => "Folder", "id" => child.id, "name" => child.name,
                               "path" => [ project.name, parent.name, child.name ])
      g = d["items"].find { |x| x["id"] != item.id }
      expect(g["level"]).to eq("type" => "global", "id" => nil, "name" => "전역", "path" => [])
      expect(g["domain_file"]).to be_nil
    end

    it "남의 personal 회의의 run 은 404" do
      run = run_for(hidden_meeting)
      get "/api/v1/admin/stt_term_learning/runs/#{run.id}"
      expect(response).to have_http_status(:not_found)
    end

    describe "POST revert" do
      it "done run 을 되돌린다" do
        file = SttTermLearning::AutoDomainFile.find_or_create_for!(level.for(child), fallback_creator: admin)
        line = "- **후판** [STT] (오인식: 우판): 강판"
        file.update!(content: line)
        run = run_for(meeting)
        create(:stt_term_learning_item, run: run, domain_file: file,
               change: { kind: "add_line", domain_file_id: file.id, term_key: "후판", line: line }.to_json)

        post "/api/v1/admin/stt_term_learning/runs/#{run.id}/revert"

        expect(response).to have_http_status(:ok)
        expect(json["run"]).to include("id" => run.id, "status" => "reverted")
        expect(json).to include("reverted" => 1, "skipped_item_ids" => [])
        expect(file.reload.content).to eq("")
      end

      it "done 아닌 run 은 422" do
        run = run_for(meeting, status: "failed")
        post "/api/v1/admin/stt_term_learning/runs/#{run.id}/revert"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json["error"]).to include("failed")
      end
    end

    describe "POST rerun" do
      it "failed run 을 같은 텍스트로 새 queued run 복제 후 enqueue (202)" do
        failed = run_for(meeting, status: "failed", error: "boom", trigger: "pre_overwrite")

        expect {
          post "/api/v1/admin/stt_term_learning/runs/#{failed.id}/rerun"
        }.to change(SttTermLearningRun, :count).by(1)

        expect(response).to have_http_status(:accepted)
        new_run = SttTermLearningRun.order(:id).last
        expect(json["run"]).to include("id" => new_run.id, "status" => "queued", "trigger" => "pre_overwrite")
        expect([ new_run.ai_text, new_run.human_text, new_run.transcript_text, new_run.input_digest, new_run.meeting_id ])
          .to eq([ failed.ai_text, failed.human_text, failed.transcript_text, failed.input_digest, failed.meeting_id ])
        expect(SttTermLearningJob).to have_been_enqueued.with(run_id: new_run.id)
      end

      it "failed 아닌 run 은 422" do
        run = run_for(meeting)
        post "/api/v1/admin/stt_term_learning/runs/#{run.id}/rerun"
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "학습 꺼짐이면 422" do
        disable_learning!
        run = run_for(meeting, status: "failed")
        post "/api/v1/admin/stt_term_learning/runs/#{run.id}/rerun"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json["error"]).to start_with("학습 꺼짐")
      end
    end

    describe "POST meetings/:meeting_id/analyze" do
      it "learnable final 이 있으면 manual run 을 만들고 enqueue (202)" do
        final_summary(meeting)
        post "/api/v1/admin/stt_term_learning/meetings/#{meeting.id}/analyze"
        expect(response).to have_http_status(:accepted)
        run = SttTermLearningRun.order(:id).last
        expect(json["run"]).to include("id" => run.id, "trigger" => "manual", "status" => "queued")
        expect(json["run"]["meeting"]["id"]).to eq(meeting.id)
        expect(SttTermLearningJob).to have_been_enqueued.with(run_id: run.id)
      end

      it "AI 원본이 없으면 422" do
        post "/api/v1/admin/stt_term_learning/meetings/#{meeting.id}/analyze"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json).to eq("error" => "AI 원본이 없는 회의입니다")
      end

      it "학습 꺼짐이면 422" do
        disable_learning!
        final_summary(meeting)
        post "/api/v1/admin/stt_term_learning/meetings/#{meeting.id}/analyze"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json["error"]).to start_with("학습 꺼짐")
      end

      it "남의 personal 회의는 404" do
        hidden = hidden_meeting
        final_summary(hidden)
        post "/api/v1/admin/stt_term_learning/meetings/#{hidden.id}/analyze"
        expect(response).to have_http_status(:not_found)
      end
    end

    describe "POST runs/:run_id/items/:id/register" do
      it "건너뛴 항목을 수동 등록하고 { item } 을 준다" do
        run = run_for(meeting)
        item = create(:stt_term_learning_item, run: run, verdict: "skipped_not_in_transcript", reason: "원래")

        post "/api/v1/admin/stt_term_learning/runs/#{run.id}/items/#{item.id}/register"

        expect(response).to have_http_status(:ok)
        file = SttTermLearning::AutoDomainFile.find_for(level.for(child))
        expect(json["item"]).to include("id" => item.id, "verdict" => "registered",
                                        "reason" => SttTermLearning::ManualRegistration::MANUAL_REASON)
        expect(json["item"]["domain_file"]).to eq("id" => file.id, "name" => file.name)
        expect(json["item"]["level"]).to include("type" => "Folder", "id" => child.id)
      end

      it "등록할 수 없는 항목은 422" do
        run = run_for(meeting)
        item = create(:stt_term_learning_item, run: run, verdict: "registered")
        post "/api/v1/admin/stt_term_learning/runs/#{run.id}/items/#{item.id}/register"
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json["error"]).to include("registered")
      end
    end
  end
end
