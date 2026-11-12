# result: impl (요약)
- FileTranscriptionJob#perform(meeting_id, force_summary=false), 화자분리 ON && !force_summary 일 때만 스킵, 요약 직전 95% "AI 회의록(요약) 생성 중…"(파일 업로드 경로에도 표시됨 — 동작 무변경, 수용)
- regenerate_stt → perform_later(id, true)
- 문구: MeetingPage 확인 다이얼로그, AudioAppendFlowDialog ask/retranscribing
- 관련 rspec 153/0, vitest 53, tsc 0
