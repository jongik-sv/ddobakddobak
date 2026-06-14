class AddAppliedToMinutesIndexToTranscripts < ActiveRecord::Migration[8.1]
  # 요약 잡 hot path: meeting.transcripts.where(applied_to_minutes: false)
  # (meeting_summarization_job.rb:101,222,258) → 매 실시간 요약 사이클마다 실행.
  # [meeting_id, applied_to_minutes] 복합 인덱스로 full table scan 제거.
  def change
    add_index :transcripts, [:meeting_id, :applied_to_minutes],
              name: "index_transcripts_on_meeting_id_and_applied",
              if_not_exists: true
  end
end
