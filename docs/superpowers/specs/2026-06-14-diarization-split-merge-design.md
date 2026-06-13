# 화자분리 "최대 분리 + 이름 통합 + word 단위 split" — 설계

> 작성: 2026-06-14 · 브랜치: `feat/diarization-split-merge`
> 선행: `2026-06-13-diarization-accuracy-design.md`, 킥오프 `2026-06-14-diarization-separation-kickoff.md`

## 핵심 철학 (사용자 확정)

화자분리에서 **과분할(over-split) 허용, 과소분할(under-merge) 금지**.
- 한 사람이 화자1·화자5로 쪼개져도 OK → 같은 이름 지정으로 통합.
- 절대 금지 = **두 사람이 한 라벨로 병합**(rename으로 복구 불가, 정보 손실).
- 목표 = 최대한 잘게 나누고 이름으로 합친다. 우선순위 = "절대 안 섞이게".

## 범위 (이번 라운드, 전부 포함)

§1 분리 공격성 · §2 rename 통합 검증 · §3 다운스트림 동일인 · §4 word 단위 split.
§1~3은 코드와 무관하게 방향 확정. §4는 STT word timestamp 유무가 가능 여부를 가름(2차 코드 확인).

---

## §1. 분리 공격성 (threshold)

- **기본 AHC threshold: `0.4` → `0.3`.**
- **슬라이더 하한: 현행 `0.2` 유지** (변경 없음). 기본값 0.3이 슬라이더 범위 안에 들어오는지만 확인·보정.
- 근거: 실인원(0.4)에서 약간 과분할 쪽으로 기울여 두 화자가 한 라벨로 섞일 위험을 낮춤. 0.3은 가독성·요약 영향 미미, rename 부담 적음.
- 실측 참조(회의111): 0.6→4명, 0.4→5명(실인원), 0.2→8명.
- 더 공격적 필요 시 사용자가 슬라이더로 0.2까지 직접.

**변경 지점(2차 확인)**: 기본 threshold 상수/디폴트 값, EditMeetingDialog 슬라이더 기본 표시.

## §2. rename 중복이름 통합 (현행 유지 + 검증)

- **새 머지 UI 없음.** 같은 이름을 2개 이상 라벨에 중복 입력 = 통합, 현행 방식 그대로 유지.
- 자동완성·패널 그룹핑·명시 머지 버튼은 이번 범위 밖(YAGNI).
- **검증 항목**:
  - 2개 라벨 → 동일 이름 rename 시 `SpeakersController#update`가 거부/오류 없이 허용하는가.
  - sidecar SpeakerDB(`rename_speaker`)와 `transcripts.speaker_name` 동기화 정상.
  - 패널(`SpeakerLabel.tsx`)·트랜스크립트(`TranscriptPanel.tsx`) 표시 정상(같은 이름 2라벨이 깨짐 없이).
  - `name == id`(미설정=nil) 폴백 정상.

## §3. 다운스트림 동일인 (speaker_name 기준 통일)

같은 `speaker_name`이면 요약·내보내기·검색·통계에서 **한 사람**으로 취급되게 보정.

- **요약** (LlmService payload): 화자 발화 묶음을 `speaker_label` → `speaker_name` 기준 그룹.
- **내보내기** (Markdown/JSON export): name 기준 그룹.
- **검색·통계**: name 기준 집계.
- **폴백 규칙**: `speaker_name`이 nil(미설정)이면 `speaker_label`로 폴백. (FE 표시 폴백 `speakerName ?? speakerLabel`과 일치)

**2차 코드 확인**: 위 각 지점이 현재 label 기준인지 name 기준인지 파악 → label 기준인 곳만 name으로 교체. 진실원천 = SpeakerDB, `transcripts.speaker_name`은 표시용 비정규화 사본.

## §4. word 단위 화자 정렬 + 경계 split (STT 길이 불변) — 핵심 신규

**문제**: 정렬이 세그먼트당 화자 1개(다수결)면, 화자 전환을 가로지르는 STT 세그먼트는 두 사람이 한 라벨로 붕괴 = under-merge가 **정렬 단계에서** 발생. threshold를 낮춰도 안 잡힘(diarization은 잘 나눠도 정렬이 다시 합침).

**해법 (STT 입력 불변, 출력 후처리)**:
- STT 세그먼트 길이·전사 품질 **안 건드림**. 짧은 세그먼트를 STT에 먹이지 않는다(품질 저하 거부됨).
- 전사된 각 단어를 그 단어 시각이 속한 diarization 화자에 매핑.
- 한 세그먼트 안에서 화자가 바뀌는 **단어 경계에서 텍스트만 split** → 세그먼트가 화자별로 쪼개짐.
- 결과: STT 품질 그대로 + 정렬 단계 under-merge 해소.

**전제 (2차 코드 확인)**:
1. STT 출력에 **word-level timestamp** 존재하는가? (whisper 계열이면 보통 有)
2. 현재 정렬 로직 = 세그먼트당 화자 다수결인가, word 단위인가?
3. diarization(speakrs) 타임라인 해상도(granularity).

**분기**:
- word timestamp **있음** → §4 구현(word→화자 매핑 + 경계 split).
- word timestamp **없음** → §4 보류. 세그먼트 단위가 한계임을 인정(단 STT 세그먼트는 안 짧게). 별도 과제로 기록.

## §5. 검증

- 검증 회의 = **111** (dev DB `backend/storage/development.sqlite3`).
- 확인:
  - 0.3 기본값에서 화자수·분할 양상.
  - §4 적용 시 word-split 전후 트랜스크립트 비교(혼합 세그먼트가 쪼개지는지).
  - 같은 이름 2라벨 rename → 요약·export가 동일인으로 묶는지.
- **함정(실측)**:
  - sidecar는 `--reload` 없음 → 새 엔드포인트/로직 추가 시 sidecar 재시작 필수(tmux `ddobak:1`).
  - 마이그레이션 파일 추가 즉시 migrate(러닝 rails PendingMigration 500).
  - 새 autoload 루트(`app/**/concerns/` 최초 생성)는 러닝 rails NameError → 재시작 필수.
  - DB 직접 write는 ActionCable 미발신 → 화면 새로고침 필요.

---

## 미해결 / 2차 의존

- §4 운명 = STT word timestamp 유무(가장 큰 미지수).
- §3 각 다운스트림 지점의 현재 기준(label vs name).
- §1 기본 threshold 상수 위치.

## 기술 참조

- 이름 진실원천 = SpeakerDB(sidecar JSON). `transcripts.speaker_name` = 표시용 사본.
- rename: `SpeakersController#update` → sidecar `rename_speaker` + `transcripts.where(speaker_label:).update_all(speaker_name:)`.
- FE 폴백: `SpeakerLabel.tsx`, `TranscriptPanel.tsx` = `speakerName ?? speakerLabel`.
- AHC threshold = 거리 컷오프(speakrs `ahc.rs`), 낮을수록 화자 많음. ExecutionMode=CoreMl 고정.
- speakrs CLI: `sidecar/speakrs-cli/`(`--ahc-threshold`), bin=`sidecar/bin/speakrs-cli`.
