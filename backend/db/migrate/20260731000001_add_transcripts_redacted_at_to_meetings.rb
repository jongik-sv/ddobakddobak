class AddTranscriptsRedactedAtToMeetings < ActiveRecord::Migration[8.1]
  # 기밀 구간 절단(transcripts#redact)이 회의에 남기는 **영속 표식**.
  #
  # 절단은 전사 행과 오디오를 실제로 파기하지만 지금까지 회의에 아무 흔적도 남기지 않았다.
  # 그래서 절단 뒤에도 (a) 온디바이스 STT 동기 큐(frontend/src/stt/syncQueue.ts)가 IndexedDB
  # 에 영속한 **전체 세그먼트**를 매 flush 마다 재전송하고(부분전송 watermark 없음),
  # (b) MeetingsAudioController#create/#chunk/#finalize 가 절단 여부와 무관하게 오디오를
  # 계속 받아 <id>.webm 을 재구성한다 → **파기한 기밀이 되돌아온다**.
  #
  # 이 컬럼이 그 세 writer 의 차단 근거이자 UI 상태 표시(meeting_json)의 출처다.
  # 단순 add_column(테이블 재생성 없음)이라 disable_ddl_transaction! 불필요.
  def change
    # 인덱스 미추가 — 이 컬럼은 표시·가드용 per-row 조회이지 목록 필터/정렬 키가 아니다.
    # 필터가 생기면 그때 부분 인덱스(where: "transcripts_redacted_at IS NOT NULL")로 추가한다.
    add_column :meetings, :transcripts_redacted_at, :datetime, null: true
  end
end
