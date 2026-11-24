module SttTermLearning
  # 기밀 구간 절단(TranscriptRedactionService) 시 그 회의의 학습 데이터 정리(2026-11-23 사용자 결정).
  # run 은 ai_text·human_text·transcript_text 에 절단 전 원문을 복사해 두므로 item 과 함께 지운다.
  # 오인식 기록은 회의 출처(first/last_meeting_id)만 끊고 행 자체와 도메인 파일에 등록된 줄은 유지한다.
  # 절단 트랜잭션 안에서 부르며 예외를 삼키지 않는다 — 정리 실패면 절단 전체가 롤백돼야 한다(fail-closed).
  class RedactionCleanup
    def self.call(meeting)
      run_ids = meeting.stt_term_learning_runs.select(:id)
      SttTermLearningItem.where(run_id: run_ids).delete_all
      meeting.stt_term_learning_runs.delete_all
      SttMisrecognition.where(first_meeting_id: meeting.id).update_all(first_meeting_id: nil)
      SttMisrecognition.where(last_meeting_id: meeting.id).update_all(last_meeting_id: nil)
      nil
    end
  end
end
