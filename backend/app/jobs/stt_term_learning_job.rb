# STT 용어 자동 학습 잡. run_id(스냅샷 완료분) 또는 summary_id+edited_at(디바운스) 로 enqueue 된다.
class SttTermLearningJob < ApplicationJob
  queue_as :default

  # 도메인 파일 쓰기 경합을 줄이려 전역 직렬화한다(SolidQueue). :async/test 어댑터에서는 무시된다.
  if respond_to?(:limits_concurrency)
    limits_concurrency to: 1, key: ->(*) { "stt_term_learning" }, duration: 15.minutes
  end

  def perform(run_id: nil, summary_id: nil, edited_at: nil)
    unless AppSettings.stt_term_learning["enabled"] == true
      # 꺼진 동안 대기하던 run 은 failed 로 닫는다(failed 는 digest 중복 검사에서 막지 않음 → 다시 켜면 재학습 가능).
      disable_queued_run!(run_id) if run_id
      return
    end

    run = if run_id
      SttTermLearningRun.find_by(id: run_id)
    else
      summary = Summary.find_by(id: summary_id)
      # 문자열 iso8601(6) 끼리 비교 — Time 직렬화·DB 정밀도 차이로 영구 불일치하는 함정 차단
      fresh = summary && summary.human_edited_at&.iso8601(6) == edited_at
      fresh ? SttTermLearning::Snapshot.capture!(summary, trigger: "idle") : nil
    end
    SttTermLearning::Processor.new(run).call if run
  end

  private

  def disable_queued_run!(run_id)
    now = Time.current
    SttTermLearningRun.where(id: run_id, status: "queued")
                      .update_all(status: "failed", error: "learning_disabled", finished_at: now, updated_at: now)
  end
end
