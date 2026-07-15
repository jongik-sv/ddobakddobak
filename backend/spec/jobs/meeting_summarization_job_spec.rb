require "rails_helper"

RSpec.describe MeetingSummarizationJob do
  let(:user)    { create(:user) }
  let(:project)    { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "recording") }

  before do
    create(:transcript, meeting: meeting, sequence_number: 1, content: "첫 발화", applied_to_minutes: false)
    create(:transcript, meeting: meeting, sequence_number: 2, content: "둘째 발화", applied_to_minutes: false)
  end

  describe "realtime path" do
    it "saves the realtime summary and consumes transcripts" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 통짜 회의록\n- 내용", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.summaries.find_by(summary_type: "realtime").notes_markdown).to include("통짜")
      expect(meeting.transcripts.where(applied_to_minutes: true).count).to eq(2)
    end

    it "does NOT consume transcripts when refine_notes returns ok:false (D8 anchor-C1)" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(2)
    end

    it "broadcasts summarization_finished with ok:false and the error reason on transient failure" do
      allow(ActionCable.server).to receive(:broadcast)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false, "error" => "LLM 폭발" })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "realtime",
                       ok: false, error: a_string_including("LLM 폭발"))
      )
    end

    it "does NOT persist summary_error on realtime transient failure (매분 재시도라 노이즈 방지)" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false, "error" => "LLM 폭발" })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.reload.summary_error_message).to be_nil
      expect(meeting.summary_error_at).to be_nil
    end

    it "broadcasts summarization_finished with ok:true on success (스피너 해제 + 오류 아님)" do
      allow(ActionCable.server).to receive(:broadcast)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 회의록", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "realtime", ok: true, error: nil)
      )
    end

    # 회귀(의도된 스킵): LLM 도중 회의가 종료(completed)되면 실패가 아니다 —
    # ok:true·error:nil 로 broadcast 하고 이번 결과는 저장·소비하지 않는다.
    it "broadcasts ok:true and saves nothing when the meeting completes during LLM (의도된 스킵)" do
      allow(ActionCable.server).to receive(:broadcast)
      allow_any_instance_of(LlmService).to receive(:refine_notes) do
        meeting.update_columns(status: "completed")
        { "notes_markdown" => "## LLM 결과", "ok" => true }
      end

      described_class.perform_now(meeting.id, type: "realtime")

      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "realtime", ok: true, error: nil)
      )
      expect(meeting.summaries.find_by(summary_type: "realtime")).to be_nil
      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(2)
    end

    it "clears a previous summary_error when a realtime summary is saved" do
      meeting.update_columns(summary_error_message: "이전 실패", summary_error_at: Time.current)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 회의록", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.reload.summary_error_message).to be_nil
      expect(meeting.summary_error_at).to be_nil
    end
  end

  describe "final path — ok:false 가드" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

    # R3 final ok 가드: transient LLM 실패(ok:false) 시 final summary 미생성·transcripts 미소비
    # 상위 before 블록이 이 meeting 에도 transcript 2건을 추가하므로 별도 생성 불필요.
    it "does NOT save final summary or consume transcripts when refine_notes returns ok:false" do
      total_unapplied = meeting.transcripts.where(applied_to_minutes: false).count

      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false })

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.summaries.find_by(summary_type: "final")).to be_nil
      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(total_unapplied)
    end

    it "records summary_error on the meeting and broadcasts ok:false with the reason" do
      allow(ActionCable.server).to receive(:broadcast)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "기존 내용", "ok" => false, "error" => "토큰 초과" })

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.reload.summary_error_message).to include("토큰 초과")
      expect(meeting.summary_error_at).to be_present
      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "final",
                       ok: false, error: a_string_including("토큰 초과"))
      )
    end

    it "records a sanitized summary_error when an internal error raises during final (rescue 경로 — 원문 비노출)" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_raise(StandardError, 'Connection refused - connect(2) for "10.0.0.5" port 8443')

      described_class.perform_now(meeting.id, type: "final")

      # 내부 호스트:포트는 새지 않고 일반 문구로 치환돼 기록된다
      expect(meeting.reload.summary_error_message).to eq(LlmService::GENERIC_USER_ERROR)
      expect(meeting.summary_error_message).not_to include("10.0.0.5")
      expect(meeting.summary_error_at).to be_present
    end

    it "passes through our own LlmError message in the rescue path (한국어 안내문 allowlist)" do
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_raise(LlmService::LlmError, "CLI 응답 시간이 초과되었습니다 (600초): claude")

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.reload.summary_error_message).to include("초과되었습니다")
      expect(meeting.summary_error_at).to be_present
    end

    # 회귀(기록 전 재확인): 실패 영속 기록보다 reset 판정을 먼저 수행 — LLM 도중
    # 초기화된 회의에 실패 배지를 남기지 않고 의도된 스킵(ok:true)으로 마감한다.
    it "does NOT record summary_error and broadcasts ok:true when the meeting was reset during LLM" do
      allow(ActionCable.server).to receive(:broadcast)
      allow_any_instance_of(LlmService).to receive(:refine_notes) do
        meeting.update_columns(status: "pending", last_reset_at: Time.current)
        { "notes_markdown" => "기존", "ok" => false, "error" => "LLM 폭발" }
      end

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.reload.summary_error_message).to be_nil
      expect(meeting.summary_error_at).to be_nil
      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "final", ok: true, error: nil)
      )
    end

    # ok:true 인데 notes 가 빈 하드 실패 — final 은 재시도가 없으므로 broadcast 만으로는
    # 새로고침 시 소실된다. 영속 기록으로 배지 레포트를 보장한다.
    it "records summary_error when the LLM returns ok:true with blank notes (하드 실패 영속 기록)" do
      allow(ActionCable.server).to receive(:broadcast)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "", "ok" => true })

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.reload.summary_error_message).to include("비어 있습니다")
      expect(meeting.summary_error_at).to be_present
      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "final",
                       ok: false, error: a_string_including("비어 있습니다"))
      )
    end

    it "clears a previous summary_error when the final summary is saved" do
      meeting.update_columns(summary_error_message: "이전 실패", summary_error_at: Time.current)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 정상 회의록", "ok" => true })

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.reload.summary_error_message).to be_nil
      expect(meeting.summary_error_at).to be_nil
      expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to eq("## 정상 회의록")
    end
  end

  # 증분(append-only) 모드: summary_restructure=false → 앞 내용 불변, 시간대별 블록만 추가
  describe "incremental mode (summary_restructure: false)" do
    let(:meeting) do
      create(:meeting, project: project, creator: user, status: "recording", summary_restructure: false)
    end

    it "appends a time-block to existing notes without rewriting them" do
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 기존 회의록\n\n- 앞선 결정", generated_at: 5.minutes.ago)
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 새 논의 내용", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      notes = meeting.summaries.find_by(summary_type: "realtime").reload.notes_markdown
      expect(notes).to start_with("## 기존 회의록\n\n- 앞선 결정")
      expect(notes).to include("### ⏱ ")
      expect(notes).to end_with("- 새 논의 내용")
      expect(meeting.transcripts.where(applied_to_minutes: true).count).to eq(2)
    end

    it "does NOT consume transcripts when append_notes returns ok:false" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "", "ok" => false })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(2)
      expect(meeting.summaries.find_by(summary_type: "realtime")).to be_nil
    end

    it "final promotes current notes append-only (no full rewrite)" do
      meeting.update_column(:status, "completed")
      meeting.transcripts.update_all(applied_to_minutes: true)
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 시간대별 기록\n\n- 그대로 보존", generated_at: 1.minute.ago)

      expect_any_instance_of(LlmService).not_to receive(:refine_notes)
      expect_any_instance_of(LlmService).not_to receive(:append_notes) # 남은 자막 없음

      described_class.perform_now(meeting.id, type: "final")

      final = meeting.summaries.find_by(summary_type: "final")
      expect(final.notes_markdown).to eq("## 시간대별 기록\n\n- 그대로 보존")
    end

    it "consumes transcripts when block is empty and no notes exist yet (재요약 루프 방지)" do
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "", "ok" => true })

      described_class.perform_now(meeting.id, type: "realtime")

      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(0)
      expect(meeting.summaries.find_by(summary_type: "realtime")).to be_nil
    end

    it "final rebuilds from scratch (whole-pass fallback) when notes were wiped (회의록 재생성)" do
      meeting.update_column(:status, "completed")
      meeting.transcripts.update_all(applied_to_minutes: true) # 전부 소비됨 + 요약 0건 (regenerate_notes 직후)
      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 재생성된 회의록", "ok" => true })
      expect_any_instance_of(LlmService).not_to receive(:append_notes)

      described_class.perform_now(meeting.id, type: "final")

      expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to eq("## 재생성된 회의록")
    end

    it "final uses the latest summary as base, not the stale final (reopen 후 stop)" do
      meeting.update_column(:status, "completed")
      meeting.transcripts.update_all(applied_to_minutes: true)
      create(:summary, meeting: meeting, summary_type: "final",
             notes_markdown: "## 옛 최종", generated_at: 30.minutes.ago)
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 옛 최종\n\n### ⏱ 10:00–11:00\n\n- 재개 세션 블록",
             generated_at: 1.minute.ago)

      described_class.perform_now(meeting.id, type: "final")

      final = meeting.summaries.find_by(summary_type: "final")
      expect(final.notes_markdown).to include("재개 세션 블록")
    end

    it "final appends remaining unapplied transcripts as a last block" do
      meeting.update_column(:status, "completed")
      create(:summary, meeting: meeting, summary_type: "realtime",
             notes_markdown: "## 기존", generated_at: 1.minute.ago)
      allow_any_instance_of(LlmService).to receive(:append_notes)
        .and_return({ "block_markdown" => "- 마지막 발화 정리", "ok" => true })

      described_class.perform_now(meeting.id, type: "final")

      final = meeting.summaries.find_by(summary_type: "final")
      expect(final.notes_markdown).to start_with("## 기존")
      expect(final.notes_markdown).to end_with("- 마지막 발화 정리")
      expect(meeting.transcripts.where(applied_to_minutes: false).count).to eq(0)
    end
  end

  # 실전 재현 버그: stop 직후 realtime 틱이 락 점유 → final try_lock 실패 → 무음 드랍.
  # 수정: final은 재enqueue (realtime은 cron이 다시 오므로 드랍 유지).
  describe "final lock contention (dev :async)" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

    it "re-enqueues final instead of dropping when the in-process lock is busy" do
      mutex = described_class::MEETING_LOCKS.compute_if_absent(meeting.id) { Mutex.new }
      mutex.lock
      begin
        expect {
          described_class.perform_now(meeting.id, type: "final")
        }.to have_enqueued_job(described_class).with(meeting.id, type: "final", attempt: 0)
      ensure
        mutex.unlock
        described_class::MEETING_LOCKS.delete(meeting.id)
      end
    end

    it "still drops realtime quietly on lock contention (cron retries next minute)" do
      mutex = described_class::MEETING_LOCKS.compute_if_absent(meeting.id) { Mutex.new }
      mutex.lock
      begin
        expect {
          described_class.perform_now(meeting.id, type: "realtime")
        }.not_to have_enqueued_job(described_class)
      ensure
        mutex.unlock
        described_class::MEETING_LOCKS.delete(meeting.id)
      end
    end
  end

  describe "paused guard (realtime)" do
    # 상위 before가 이 meeting(paused)에 transcript를 생성하므로, 가드가 없으면 LLM이 호출된다.
    let(:meeting) { create(:meeting, project: project, creator: user, status: "recording", paused_at: Time.current) }

    it "does not call LLM when meeting is paused" do
      expect(LlmService).not_to receive(:new)
      described_class.new.perform(meeting.id, type: "realtime")
    end
  end

  # 실전 재현(meeting 68 = 0 summaries): stop이 final을 1회만 enqueue → LLM(~3분) 중 사용자가
  # 전사 편집 → post-LLM stale 가드가 결과를 드랍 → 정본이 영영 안 생김.
  # 수정: stale인데 정본(final summary)이 아직 없으면 최신 전사로 재생성하도록 재enqueue.
  describe "final stale re-enqueue (LLM 중 사용자 편집)" do
    let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

    # job 인스턴스에 enqueued_at 을 과거로 박아, LLM 도중 갱신된 last_user_edit_at 이
    # enqueued_at 보다 뒤가 되도록(=stale) 만든다. refine_notes 통짜 경로를 쓰려고
    # latest_notes 가 비도록(요약 0건) 둔다.
    def run_final_with_user_edit_during_llm(attempt: 0, enqueued_at: 10.minutes.ago)
      job = described_class.new(meeting.id, type: "final", attempt: attempt)
      job.enqueued_at = enqueued_at.iso8601

      allow_any_instance_of(LlmService).to receive(:refine_notes) do
        # 사용자가 LLM 호출 도중 전사를 편집 → last_user_edit_at 이 enqueued_at 보다 뒤로 점프
        meeting.update!(last_user_edit_at: enqueued_at + 5.minutes)
        { "notes_markdown" => "## LLM이 만든 회의록", "ok" => true }
      end

      job.perform(meeting.id, type: "final", attempt: attempt)
    end

    # T1: stale + 정본 없음 → 저장 안 함 AND type:"final", attempt:1 로 재enqueue
    it "re-enqueues final (attempt:1) and saves no summary when stale and no minutes yet" do
      expect {
        run_final_with_user_edit_during_llm(attempt: 0)
      }.to have_enqueued_job(described_class).with(meeting.id, type: "final", attempt: 1)

      expect(meeting.summaries.find_by(summary_type: "final")).to be_nil
    end

    # T2: stale + 정본 이미 존재 → 드랍(재enqueue 안 함), 기존 요약 불변(덮어쓰기 금지)
    it "drops (no re-enqueue) and leaves the existing final summary untouched when minutes exist" do
      existing = create(:summary, meeting: meeting, summary_type: "final",
                        notes_markdown: "## 사용자가 직접 쓴 정본", generated_at: 1.hour.ago)

      expect {
        run_final_with_user_edit_during_llm(attempt: 0)
      }.not_to have_enqueued_job(described_class)

      expect(meeting.summaries.where(summary_type: "final").count).to eq(1)
      expect(existing.reload.notes_markdown).to eq("## 사용자가 직접 쓴 정본")
    end

    # T3: attempt >= CAP + stale + 정본 없음 → 포기(드랍, 재enqueue 안 함) + 실패 영속 기록
    it "gives up (no re-enqueue) when attempt reaches FINAL_REENQUEUE_CAP" do
      cap = described_class::FINAL_REENQUEUE_CAP

      expect {
        run_final_with_user_edit_during_llm(attempt: cap)
      }.not_to have_enqueued_job(described_class)

      expect(meeting.summaries.find_by(summary_type: "final")).to be_nil
      # 포기 = 정본이 영영 안 생김 — 사용자 레포트용으로 영속 기록돼야 한다
      expect(meeting.reload.summary_error_message).to include("포기")
      expect(meeting.summary_error_at).to be_present
    end

    # T3-b 회귀: 포기는 성공처럼 보이면 안 됨 — ok:true 대신 ok:false + 사유로 broadcast
    it "broadcasts ok:false with the give-up reason when retries are exhausted (성공 위장 금지)" do
      allow(ActionCable.server).to receive(:broadcast)

      run_final_with_user_edit_during_llm(attempt: described_class::FINAL_REENQUEUE_CAP)

      expect(ActionCable.server).to have_received(:broadcast).with(
        meeting.transcription_stream,
        hash_including(type: "summarization_finished", summary_type: "final",
                       ok: false, error: a_string_including("포기"))
      )
    end

    # T4 회귀: stale 아님 → 정상 저장(재enqueue 없음)
    it "saves the final summary normally when not stale" do
      job = described_class.new(meeting.id, type: "final", attempt: 0)
      job.enqueued_at = Time.current.iso8601

      allow_any_instance_of(LlmService).to receive(:refine_notes)
        .and_return({ "notes_markdown" => "## 정상 종료 회의록", "ok" => true })

      expect {
        job.perform(meeting.id, type: "final", attempt: 0)
      }.not_to have_enqueued_job(described_class)

      expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to eq("## 정상 종료 회의록")
    end
  end
end
