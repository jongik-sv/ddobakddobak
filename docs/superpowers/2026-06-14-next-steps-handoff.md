# 다음 작업 핸드오프 (2026-06-14)

컨텍스트 클리어 후 새 세션에서 이 파일 읽고 시작. 아래 "붙여넣기 프롬프트" 그대로 사용 가능.

## 현재 상태
- repo `/Users/jji/project/ddobakddobak`, 브랜치 `feat/prev-meeting-reference`.
- **완료(이번 세션)**: 이전 회의 참고(시드+이어쓰기).
  - 1차 커밋 `830ccfa`. 2차(EditMeetingDialog 셀렉터 + same-folder 필터) **미커밋**.
  - 메모리 `project_previous_meeting_reference`. spec `docs/superpowers/specs/2026-06-14-previous-meeting-reference-design.md`.
- ⚠️ **작업트리 무관 미커밋(건드리지·커밋하지 말 것)**: `frontend/src/components/meeting/SpeakerLabel.tsx`, `TranscriptPanel.tsx`(이전 세션 화자분리 split-merge 잔존), `idea.md`.
- 먼저 §9.1(2차) 보존하려면 내 파일만 커밋 후 진행 권장.

## 제약
- 변경 전 brainstorming. 커밋은 명시 요청 시만. 서브에이전트 OK. caveman 모드. TDD.
- 검증: backend `cd backend && bundle exec rspec <대상>`, frontend `cd frontend && npx vite build`(tsc -b는 기존 테스트파일 에러로 실패—내 파일만 무에러 확인). pending migration 트랩: 마이그 추가 시 즉시 `bin/rails db:migrate` + `db:test:prepare`.
- 무관 기존 실패 1건(`DefaultUserLookup`, 테스트DB desktop@local 유저 "관리자" 잔존)은 내 작업 아님.

## TASK 1 — STT 재실행 진행율 재조정 (설계 확정, 폴링 방식)
증상: 10%서 멈췄다 70→80→95 점프. `/transcribe-file`이 동기 단일 HTTP라 STT 구간 진행 미표시.
- sidecar `_chunked_transcribe`(`sidecar/app/routers/stt.py:273~328`)가 청크마다 `offset_ms/total_ms` 이미 계산(로그 line 324, **meeting_id 없음**).
- **방식(추천=폴링, Rails→sidecar 기존 방향)**:
  - sidecar: 메모리 레지스트리 `{meeting_id: {processed_ms, total_ms}}`. `_chunked_transcribe`에 meeting_id 인자 추가(호출부 stt.py:138)·청크마다 갱신, 종료 시 정리. 신규 `GET /transcribe-file/progress/{meeting_id}` 반환.
  - Rails `FileTranscriptionJob`(`backend/app/jobs/file_transcription_job.rb`): `transcribe_file`(블로킹) 직전 폴러 스레드 기동 → 2~3s마다 `SidecarClient#get_transcribe_progress` → `5 + processed/total*85`% broadcast("음성 인식 중… N초/M초") → 반환 시 스레드 종료(90% 스냅). 스레드는 HTTP+broadcast만(AR 안 씀, 안전).
  - `SidecarClient`(`backend/app/services/sidecar_client.rb`): `get_transcribe_progress(meeting_id)` GET(짧은 timeout, rescue→nil).
- **재조정 표**: 5(ffmpeg)/5~90(STT폴러)/93(transcript 저장)/99(화자분리·회의록)/100. `file_transcription_job.rb` broadcast_progress 5곳(line 13,32,37,41,45) %값 수정.
- 범위: 파일 업로드 + STT 재실행(regenerate_stt) 경로만. 실시간/오프라인 아님.
- 대안(비추): sidecar가 매 청크 Rails로 POST push — 인증·URL 신규 필요.

## TASK 2 — STT 오타 수정 안 됨 (조사부터)
증상: STT 오타가 회의록에 그대로 남음. brainstorming 전 원인 조사.
- 회의록 오타교정 규칙 존재: `backend/app/services/llm_prompts.rb` `REFINE_NOTES_SYSTEM_PROMPT` 규칙1(오타 교정).
- 확인 포인트: (a) 증분(append) 모드는 `APPEND_NOTES_SYSTEM_PROMPT` 규칙5만 있어 교정 약한지, (b) 어느 경로(realtime/final/파일전사)에서 안 되는지, (c) 실측 재현(특정 오타 샘플), (d) 사용자 용어교정(`feedback`/term-correction)과 별개. 원인 확정 후 프롬프트/경로 수정.

## TASK 3 — 회의 미리보기 북마크 기본 이름 = 트랜스크립트 내용
- 현: `handleOpenBookmark`(`frontend/src/pages/MeetingPage.tsx:306`)가 label `''` 로 염.
- 변경: bookmarkTs(=currentTimeMs)를 덮는 transcript(`started_at_ms ≤ ts ≤ ended_at_ms`, 없으면 직전) 찾아 그 `content`를 기본 label로(truncate). `transcripts` 배열은 페이지에 있음. `BookmarkPopover`(`frontend/src/components/meeting/BookmarkPopover.tsx`) 기본값 전달. 백엔드 무변경(label optional). 라이브 페이지도 동일 북마크면 함께.
