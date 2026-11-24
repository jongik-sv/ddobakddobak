module SttTermLearning
  # 학습 실행(run)의 입력 스냅샷(스펙 §5.1·5.2). AI 원본·사람 최종본·그 시점 전사를 run 에 복사해 둔다.
  # 행을 지우거나 AI 가 덮어쓰기 직전(pre_overwrite), 무편집 대기 후(idle), 관리자 수동(manual) 에서 만든다.
  class Snapshot
    # 같은 회의의 같은 입력(digest)으로 다음 run 이 있으면 자동 실행을 새로 만들지 않는다.
    #   - reverted: 항상 — 관리자가 되돌린 용어를 같은 텍스트로 다시 등록하지 않게.
    #   - done: 항상, 단 llm_skipped_reason "llm_failed" 는 제외(일시적 LLM 실패로 학습을 잃지 않게).
    #   - queued/running: 생성 후 IN_FLIGHT_WINDOW 안일 때만(멈춘 run 이 영구히 막지 않게).
    # failed 는 막지 않는다(재시도 허용).
    IN_FLIGHT_WINDOW = 1.hour
    LLM_FAILED = "llm_failed".freeze

    class << self
      # -> SttTermLearningRun | nil
      def capture!(summary, trigger:, force: false)
        return nil unless enabled?
        return nil unless summary&.learnable?

        ai = summary.ai_notes_markdown.to_s
        human = summary.notes_markdown.to_s
        return nil if trigger.to_s == "pre_overwrite" && human == ai

        meeting = summary.meeting
        digest = Digest::SHA256.hexdigest("#{ai}\u0000#{human}")
        return nil if !force && blocking_run?(meeting, digest)

        meeting.stt_term_learning_runs.create!(
          summary: summary,
          trigger: trigger.to_s,
          status: "queued",
          ai_text: ai,
          human_text: human,
          transcript_text: meeting.transcripts.order(:started_at_ms).pluck(:content).join("\n"),
          input_digest: digest
        )
      end

      # 요약 행을 지우거나 AI 가 덮어쓰기 직전에 호출. 어떤 실패도 원래 동작을 막지 않는다.
      def before_overwrite!(meeting)
        run = capture!(active_final(meeting), trigger: "pre_overwrite")
        SttTermLearningJob.perform_later(run_id: run.id) if run
        run
      rescue => e
        Rails.logger.error "[SttTermLearning::Snapshot] before_overwrite! meeting=#{meeting&.id} 실패: #{e.class}: #{e.message}"
        nil
      end

      # 관리자 "지금 다시 분석" — digest 중복 검사를 건너뛴다.
      def manual!(meeting)
        run = capture!(active_final(meeting), trigger: "manual", force: true)
        SttTermLearningJob.perform_later(run_id: run.id) if run
        run
      end

      private

      def blocking_run?(meeting, digest)
        runs = meeting.stt_term_learning_runs.where(input_digest: digest)
        runs.where(status: "reverted")
            .or(runs.where(status: "done").where("llm_skipped_reason IS NULL OR llm_skipped_reason <> ?", LLM_FAILED))
            .or(runs.where(status: %w[queued running]).where(created_at: IN_FLIGHT_WINDOW.ago..))
            .exists?
      end

      def active_final(meeting)
        meeting&.summaries&.find_by(summary_type: "final")
      end

      def enabled?
        AppSettings.stt_term_learning["enabled"] == true
      end
    end
  end
end
