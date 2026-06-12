# 화자분리 후속 3건 설계 (2026-06-12)

브랜치: `feat/speaker-diarization` (main `ca5a76e` 머지 후 증분). 사용자 승인 완료.

## 배경 (검증된 사실)

- pyannote.audio **4.0.4**, `pyannote/speaker-diarization-community-1`, clustering = **VBxClustering**.
- `SpeakerDiarization.apply()`는 call-time `num_speakers` / `min_speakers` / `max_speakers` 지원 (site-packages `speaker_diarization.py:530-538`). VBx 자동 감지 결과가 범위를 벗어날 때만 KMeans 재클러스터 — "가드레일 달린 자동".
- `pipeline.instantiate({'clustering': {'threshold': t, 'Fa': ..., 'Fb': ...}})` 동작. 기본값 threshold **0.6** (탐색범위 0.5~0.8), Fa 0.07, Fb 0.8. threshold 낮을수록 화자를 잘게 분리.
- 현 sidecar 배치 경로는 `pipeline(audio_input)` 인자 없이 호출 (`sidecar/app/diarization/batch_processor.py:76`). 기존 설정 슬라이더 3개(similarity/merge/max_embeddings)는 실시간 경로 전용 — 배치에 무효.
- **버그**: `Transcript.to_sidecar_payload`(`backend/app/models/transcript.rb:15-19`)가 `speaker_label`만 사용 → 화자 rename 후 회의록을 재생성해도 이름 미반영.
- 화자분리 토글은 전역 앱 설정(`settings.yaml` → `AppSettings.diarization_config`), per-meeting 아님.
- 수동 회의록 생성은 기존 `POST /api/v1/meetings/:id/regenerate_notes` + 프론트 "회의록 재생성" 버튼(`MeetingActions.tsx:51-68`) 존재.

## 요구 1 — SpeakerPanel 접기

- `SpeakerPanel`에 `collapsible?: boolean` prop 추가 (기본 false → 기존 동작 불변).
- collapsible일 때: 화자 0명이면 접힘, 화자가 로드/감지되면 자동 펼침. 이후 사용자 수동 토글이 우선. 상태 영속화 없음.
- 적용처(데스크톱 3곳): `MeetingPage.tsx:481`, `MeetingViewerPage.tsx:77`(데스크톱 분기), `MeetingLivePage.tsx:284`.
- 모바일(`meetingDetailTabs.tsx:65-73`, `MeetingViewerPage` 모바일 분기 — 기존 `<details>` 아코디언)은 변경 없음.

## 요구 2 — 화자분리 세밀화

### 데이터

- 마이그레이션: `meetings.expected_participants` (integer, nullable). 빈칸(null) = 자동 감지.
- 회의 정보 편집 UI에 "참여 인원" 숫자 입력 필드 추가 (회의 수정 폼/모달 — 구현 시 위치 확인).
- 직렬화(`meeting_serializable.rb`)에 노출, 프론트 Meeting 타입/매퍼에 추가.

### 전달 경로

```
meetings.expected_participants ──┐
settings.yaml diarization.clustering_threshold ──┤
                                 ▼
FileTranscriptionJob → SidecarClient.transcribe_file(diarization_config: {
  enable, clustering_threshold, expected_speakers,   # 신규 2키
  similarity_threshold, merge_threshold, max_embeddings_per_speaker  # 구키 유지(실시간 경로용)
})
                                 ▼
sidecar /transcribe-file → batch_diarize(..., expected_speakers=N, clustering_threshold=t)
  - min_speakers = max(1, N-2), max_speakers = N+2  (N null이면 둘 다 None)
  - 호출 전 pipeline.instantiate({'clustering': {'threshold': t, 'Fa': 0.07, 'Fb': 0.8},
                                   'segmentation': {'min_duration_off': 0.0}})
    (gpu_lock 내부라 싱글턴 파이프라인 안전. t는 매 호출 명시 설정 — 이전 호출 잔류값 방지)
  - pipeline(audio_input, min_speakers=, max_speakers=)
```

### 설정 UI 교체

- `DiarizationPanel.tsx`: 슬라이더 3개 제거 → "화자 구분 세밀도" 슬라이더 1개 (`clustering_threshold`, 0.5~0.8, step 0.05, 기본 0.6, 설명: "낮을수록 화자를 더 잘게 분리").
- `appSettingsStore`: diarizationOverrides 키를 `clustering_threshold`로 교체. 구 키 3개 UI/저장 제거.
- `settings_controller.rb`: `diarization_clustering_threshold` 파라미터 수용+검증(0.5~0.8), 구 3개 파라미터 수용 제거.
- `app_settings.rb`: `DIARIZATION_DEFAULTS`에 `clustering_threshold: 0.6` 추가. 구 키 3개는 기본값으로 계속 직렬화(실시간 경로 코드 보존 — UI만 제거).

## 요구 3 — 파이프라인 분기

- `FileTranscriptionJob#perform`: `AppSettings.diarization_config["enable"]`이 true면 `generate_summary(meeting)` + `MeetingFinalizerService` 호출 스킵. status는 현행대로 completed. 기존 요약(Summary 레코드)은 건드리지 않음.
- OFF면 현행 그대로 (STT → 요약 → finalizer).
- **`Transcript.to_sidecar_payload`: `speaker: t.speaker_name.presence || t.speaker_label`** — rename 반영의 전제. 모든 요약 경로 공통 적용(실시간 경로는 speaker_name null이라 무해).
- 수동 생성: 기존 regenerate_notes 흐름 그대로. 단 regenerate 경로가 액션아이템/결정사항도 재생성하는지 구현 시 확인 — 안 하면 `MeetingSummarizationJob`(final) 뒤에 finalizer 보강.
- 프론트 안내: 회의 상세에서 요약이 비어 있고 전사가 존재하며 요약 진행 중이 아닐 때 힌트 표시 ("화자 이름 지정 후 '회의록 재생성'을 누르세요" — AiSummaryPanel 빈 상태).
- 범위: 분기는 **배치 경로(파일 업로드/STT 재생성)만**. 라이브 녹음 종료 자동요약은 현행 유지(라이브엔 화자분리 없음).

## 테스트 전략

- backend rspec: file_transcription_job(분기 ON/OFF), app_settings(clustering_threshold), settings_controller(신규 파라미터 검증), transcript(to_sidecar_payload 이름 우선), meetings(expected_participants).
- sidecar pytest: batch_diarize에 min/max 전달, instantiate 호출, N±2 계산(클램프 min≥1), N null 시 None.
- frontend vitest: SpeakerPanel collapsible 동작, DiarizationPanel 신규 슬라이더, 안내 힌트 렌더.
- 통과 기준: `bundle exec rspec`(pre-existing 실패 1건 default_user_lookup_spec 무시), `npx vitest run`, `npx vite build` (tsc -b 기존 에러 9개 무시).

## 제약

- `git add` 변경 파일 명시(`-A` 금지).
- sidecar 핫리로드 없음 — 수정 후 uvicorn 재시작 (tmux ddobak:1).
- `db/migrate`에 마이그레이션 추가 시 러닝 Rails dev 서버 전 요청 500 (PendingMigrationError) — 추가 직후 `bin/rails db:migrate` 실행.

## 범위 외

- Fa/Fb 노출, 실시간 화자분리 재활성, 교차회의 화자 식별, "수정도 추가하자"(사용자 확인으로 삭제).
