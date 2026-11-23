module SttTermLearning
  # 사람 편집 후 무편집 대기(디바운스) 학습 잡 예약(스펙 §5.2).
  # 모든 예외는 삼키고 로그만 남긴다(nil 반환).
  # 잡은 실행 시 summary.human_edited_at 이 edited_at_iso 와 같을 때만 진행한다(재편집 시 이전 잡은 스킵).
  class Scheduler
    def self.schedule_idle!(summary, edited_at_iso)
      settings = AppSettings.stt_term_learning
      return unless settings["enabled"] == true && summary&.learnable?

      SttTermLearningJob.set(wait: settings["idle_minutes"].to_i.minutes)
                        .perform_later(summary_id: summary.id, edited_at: edited_at_iso)
      nil
    rescue => e
      # 예약 실패가 원래 동작(회의록 저장·feedback)을 막지 않는다.
      Rails.logger.error "[SttTermLearning::Scheduler] schedule_idle! summary=#{summary&.id} 실패: #{e.class}: #{e.message}"
      nil
    end
  end
end
