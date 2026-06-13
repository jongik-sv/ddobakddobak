# 킥오프 프롬프트 — 화자분리 "최대 분리 + 이름으로 통합"

> /clear 후 이 파일 내용을 첫 메시지로 붙여넣거나, "docs/superpowers/2026-06-14-diarization-separation-kickoff.md 읽고 시작하자"로 시작.

---

## 핵심 철학 (사용자 확정, 2026-06-14)

화자분리에서 **과분할(over-split)은 허용, 과소분할(under-merge)은 금지**.
- 한 사람이 화자1·화자5로 쪼개져도 괜찮다 → 둘 다 같은 이름("홍춘식")으로 지정하면 통합됨.
- 절대 피할 것 = **두 사람이 한 라벨로 병합** — 이건 rename으로 되돌릴 수 없다(정보 손실).
- 따라서 목표 = **최대한 사람별로 잘게 나누고, 이름 지정으로 합친다.** 정확도 우선순위 = "절대 안 섞이게".

## 이번에 할 일 (브레인스토밍부터)

1. **분리를 더 공격적으로**: 기본 threshold를 낮은 쪽으로(예 0.4→0.2 수준) + 슬라이더 하한 확장(0.2→0.1 검토). 트레이드오프(과분할 시 한 발화 중간이 갈려 가독성↓, 요약 영향) 같이 검토.
2. **rename 통합 UX**: 여러 라벨 → 한 사람(같은 이름) 지정을 매끄럽게. 현재 라벨당 이름 지정은 됨. 검토 = 중복 이름 허용 표시, 같은 이름끼리 패널 그룹핑, "이 화자를 ○○에 합치기" 같은 명시적 머지, 자동완성(기존 이름 재선택).
3. **다운스트림 동일성**: 같은 speaker_name이면 요약/내보내기/통계/검색에서 **한 사람으로 취급**되는지 확인·보정(현재 speaker_label 기준이면 speaker_name 기준으로).

## 먼저 검증할 현 동작 (코드 확인 후 설계)

- rename(PUT /api/v1/speakers/:id)이 **중복 이름**(2개 라벨 → 같은 이름)을 허용하나? 패널/트랜스크립트 표시 정상인가?
- 요약(LlmService payload)·export(MarkdownExporter/JSON)가 speaker_name 기준인가 speaker_label 기준인가? → 같은 이름 통합 여부 결정.
- 슬라이더 더 낮은 값(0.1) 빌드/런타임 동작(speakrs AHC가 0.1 수용하나, 화자 폭증/노이즈).

## 현재까지 완료 (브랜치 `feat/diarization-accuracy`)

**커밋됨 11개(미푸시).** **이번 세션 미커밋 변경**(working tree):
- heal 안전망: `meetings.re_diarize_started_at`(migration) + `Meeting#heal_stale_re_diarize!` + show/re_diarize before_action
- 이름 유지: `ReDiarizeJob#fetch_speaker_names`(재실행해도 SpeakerDB 이름 새 라벨에 재적용)
- 슬라이더 라벨 좌우 수정 + 도움말 문구(EditMeetingDialog.tsx)
- 스펙: `spec/jobs/re_diarize_job_spec.rb`(신규), `meetings_re_diarize_spec.rb`(heal 케이스)
- → **첫 작업 전 이 미커밋분을 커밋할지 사용자에게 확인.**

기능 요약: 회의별 민감도 슬라이더(AHC threshold) · "화자분리만 재실행"(STT 없이 sidecar `/diarize-file`+`ReDiarizeJob`, ~1분) · 이름 유지 · 스턱 자가복구. 측정: 회의111서 0.6→4명, 0.4→5명(실인원), 0.2→8명.

## 핵심 기술 참조

- **이름 진실원천 = SpeakerDB(sidecar JSON)**. `transcripts.speaker_name`은 표시용 비정규화 사본. 둘 동기화 주의.
- rename: `SpeakersController#update` → sidecar `rename_speaker` + `transcripts.where(speaker_label:).update_all(speaker_name:)`. `name == id`면 "미설정"(nil).
- FE 표시: `SpeakerLabel.tsx` = `speakerName ?? speakerLabel`. `TranscriptPanel.tsx:99` 동일 폴백.
- AHC threshold = 거리 컷오프(speakrs `ahc.rs:102` `heights<=threshold`면 병합), **낮을수록 화자 많음**. speakrs 라벨 = 첫 등장 시각 순 1-based. ExecutionMode=CoreMl 고정(mode 전환 무의미).
- speakrs CLI: `sidecar/speakrs-cli/`(`--ahc-threshold`), bin=`sidecar/bin/speakrs-cli`.

## 함정 (실측)

- **sidecar는 uvicorn `--reload` 없이 구동** → 새 엔드포인트 추가 시 **sidecar 재시작 필수**(tmux ddobak:1, C-c→`uv run uvicorn app.main:app --host 0.0.0.0 --port 13324`).
- **rails 새 autoload 루트**(`app/**/concerns/`가 **처음** 생기는 경우)는 러닝 dev 서버가 못 잡아 `NameError` → **서버 재시작 필수**. `rails runner`(새 프로세스)는 통과해 오진 쉬움. (memory: `reference_zeitwerk_new_concern_restart`)
- 마이그레이션 파일 추가만 해도 러닝 rails 전 요청 500(PendingMigration) → 추가 즉시 migrate.
- 직접 DB write는 ActionCable 안 쏨 → 화면 새로고침 필요.

## 환경 / 제약

- tmux `ddobak`: win0=rails(`SERVER_MODE=true bin/rails server -p 13323 -b 0.0.0.0`), win1=sidecar(:13324), win2=caddy. FE = `npm run tauri:dev`(vite :13325, HMR). 기존 창 재사용(중복 생성 금지).
- 검증 회의 = **111**(dev DB `backend/storage/development.sqlite3`). 현재 0.2→8명 상태(화자1-5 이름有, 6-8 無).
- **푸시 금지**(로컬 커밋만). **서브에이전트 방식**. 변경 전 **brainstorming** 먼저. 명시 요청 없이 커밋 금지.

## 관련 문서 / 메모

- `docs/superpowers/specs/2026-06-13-diarization-accuracy-design.md`, `plans/2026-06-13-diarization-accuracy.md`
- `docs/superpowers/2026-06-13-diarization-accuracy-decisions.md`(결정 #1~16), `2026-06-13-diarization-followups.md`(#1~18 + 사고기록)
- memory: `project_diarization_accuracy`, `project_diarization_followups`, `reference_zeitwerk_new_concern_restart`
