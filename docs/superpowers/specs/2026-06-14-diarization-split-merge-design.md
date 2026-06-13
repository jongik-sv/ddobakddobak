# 화자분리 "최대 분리 + 이름 통합 + 연속 동일화자 merge" — 설계

> 작성: 2026-06-14 · 브랜치: `feat/diarization-split-merge`
> 선행: `2026-06-13-diarization-accuracy-design.md`, 킥오프 `2026-06-14-diarization-separation-kickoff.md`
> 갱신: word 단위 split(§4)은 엔진 의존으로 폐기, 연속 동일화자 merge(§4')로 대체. §2는 확인 완료로 제외.

## 핵심 철학 (사용자 확정)

화자분리에서 **과분할(over-split) 허용, 과소분할(under-merge) 금지**.
- 한 사람이 화자1·화자5로 쪼개져도 OK → 같은 이름 지정으로 통합.
- 절대 금지 = **두 사람이 한 라벨로 병합**(rename으로 복구 불가, 정보 손실).
- 목표 = 최대한 잘게 나누고 이름으로 합친다. 우선순위 = "절대 안 섞이게".

## 범위 (이번 라운드)

§1 분리 공격성(threshold 0.3) · §3 다운스트림 동일인(요약·내보내기·통계·이름검색) · §4' 연속 동일화자 merge(표시단).
§2(rename 중복이름) = 확인 완료, 제외. §4(word split) = 엔진 의존으로 폐기.

---

## §1. 분리 공격성 (threshold)

- **기본 AHC threshold: `0.4` → `0.3`.**
- **슬라이더 하한: 현행 `0.2` 유지** (변경 없음). 기본값 0.3이 슬라이더 범위 안에 들어오는지만 확인·보정.
- 근거: 실인원(0.4)에서 약간 과분할 쪽으로 기울여 두 화자가 한 라벨로 섞일 위험을 낮춤. 0.3은 가독성·요약 영향 미미, rename 부담 적음.
- 실측 참조(회의111): 0.6→4명, 0.4→5명(실인원), 0.2→8명.
- 더 공격적 필요 시 사용자가 슬라이더로 0.2까지 직접.

**변경 지점(2차 확인)**: 기본 threshold 상수/디폴트 값, EditMeetingDialog 슬라이더 기본 표시.

## §2. rename 중복이름 통합 — ✅ 확인 완료, 범위 제외

- 사용자가 직접 확인: 과분할된 2개 화자에 **동일 이름 할당 → 정상 동작**(표시 OK).
- rename 자체는 클리어. 더 점검할 항목 없음. 빌드 작업 없음.
- 남는 것은 "표시"가 아니라 "다운스트림 동일인 취급"(§3) — 별개 항목.

## §3. 다운스트림 동일인 (speaker_name 기준 통일)

같은 `speaker_name`이면 **요약·내보내기·통계·검색**에서 한 사람으로 취급되게 보정.

- **요약** (LLM payload): 화자 발화 묶음을 `speaker_name` 기준 그룹.
- **내보내기** (Markdown/JSON export): name 기준 그룹.
- **통계** (화자수/distinct): name 기준 집계 → 같은 이름 2라벨 = 1명.
- **검색 (신규 기능, 사용자 요청)**: 화자 **이름으로 조회** 추가. 같은 이름이면 갈린 라벨 모두 매칭. (현재 화자명 검색 부재 가능 — workflow 확인 후 텍스트 검색 위치에 name 필터 추가)
- **폴백 규칙**: `speaker_name`이 nil(미설정)이면 `speaker_label`로 폴백 (`speakerName ?? speakerLabel`과 일치).

**진실원천** = SpeakerDB(sidecar), `transcripts.speaker_name` = 표시용 비정규화 사본.
**각 지점 현재 기준(label vs name)** = `diarization-downstream-map` workflow로 조사 중 → label인 곳만 name으로 교체.

## §4. 세그먼트 split — ❌ 폐기 (엔진 의존, 속도/품질 회귀)

**조사 결과**: 기본 STT 엔진 = `qwen3_asr_8bit` (Apple Silicon auto-select, `factory.py:50`). Qwen3 어댑터(`qwen3_adapter.py:79~89`)는 청크당 **텍스트 한 덩어리**만 반환(`started_at_ms=0`), 내부 시각·단어 타임스탬프 **0**. 공통 스키마 `TranscriptSegment`(`base.py:9`)에 `words` 필드 없음. mlx_whisper 계열은 word_timestamps 지원하나 `False`로 꺼둠(`mlx_whisper_adapter.py:119`).

**결론**: word 단위 split = 단어 타이밍 필요 → qwen3로 불가. whisper 전환은 **STT 속도+한국어(CJK) 품질 회귀**(qwen3가 그 이유로 채택됨). 사용자 결정 = **속도 희생 불가 → split 폐기.**

## §4'. 연속 동일화자 merge (표시단) — split 대체, 채택

split의 안전한 반쪽. 단어 타이밍 불필요(순수 후처리).

- diarization이 세그먼트별 화자 배정 후, 시간순으로 **연속된 같은 화자 세그먼트를 한 블록으로 이어붙임**(텍스트 concat, 시작=첫 세그먼트, 끝=마지막).
- 기준 = `speaker_name ?? speaker_label`. 같은 이름 라벨이 연속이면 합쳐짐.
- **under-merge 안 건드림** — 같은 화자만 합치므로 안전(정보 손실 0).
- **구현 위치 = FE 표시단** (`TranscriptPanel.tsx:81` render 루프). 비파괴적, DB 미변경, rename 시 그룹핑 자동 갱신. (백엔드 영구 병합은 rename 후 재병합 꼬임 → 회피.)
- "연속" = 트랜스크립트 순서상 인접 + 동일 resolved-name. 중간에 다른 화자 끼면 안 합침.

## §5. 검증

- 검증 회의 = **111** (dev DB `backend/storage/development.sqlite3`).
- 확인:
  - 0.3 기본값에서 화자수·분할 양상.
  - §4' 적용 시 연속 동일화자 세그먼트가 한 블록으로 합쳐지는지.
  - 같은 이름 2라벨 → 요약·export·통계가 동일인 1명으로 묶는지, 이름 검색이 양쪽 다 잡는지.
- **함정(실측)**:
  - sidecar는 `--reload` 없음 → 새 엔드포인트/로직 추가 시 sidecar 재시작 필수(tmux `ddobak:1`).
  - 마이그레이션 파일 추가 즉시 migrate(러닝 rails PendingMigration 500).
  - 새 autoload 루트(`app/**/concerns/` 최초 생성)는 러닝 rails NameError → 재시작 필수.
  - DB 직접 write는 ActionCable 미발신 → 화면 새로고침 필요.

---

## 최종 범위 (확정)

- **§1** threshold 0.4→0.3 (`app_settings.rb:10`, `EditMeetingDialog.tsx:150/161`). 슬라이더 하한 0.2 유지.
- **§2** ✅ 확인 완료, 작업 없음.
- **§3** 다운스트림 name 통일: 요약·내보내기·통계 + **이름 검색 신규**. 각 지점 label→name (workflow 조사 결과 반영).
- **§4** ❌ 폐기(엔진 의존).
- **§4'** 연속 동일화자 merge(FE 표시단).

## 미해결 / 조사 의존

- §3 각 지점 현재 기준(label vs name) + 화자명 검색 존재 여부 = `diarization-downstream-map` workflow 결과 대기.
- §4' FE render 루프 정확한 그룹핑 삽입점 = 동 workflow fe_render finder.

## 기술 참조

- 이름 진실원천 = SpeakerDB(sidecar JSON). `transcripts.speaker_name` = 표시용 사본.
- rename: `SpeakersController#update` → sidecar `rename_speaker` + `transcripts.where(speaker_label:).update_all(speaker_name:)`.
- FE 폴백: `SpeakerLabel.tsx`, `TranscriptPanel.tsx` = `speakerName ?? speakerLabel`.
- AHC threshold = 거리 컷오프(speakrs `ahc.rs`), 낮을수록 화자 많음. ExecutionMode=CoreMl 고정.
- speakrs CLI: `sidecar/speakrs-cli/`(`--ahc-threshold`), bin=`sidecar/bin/speakrs-cli`.
