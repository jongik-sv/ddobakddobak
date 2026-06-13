# 화자분리 "최대 분리 + 이름 통합 + 연속 merge" — 결정 기록

> 2026-06-14 · 브랜치 `feat/diarization-split-merge`
> 관련: spec `specs/2026-06-14-diarization-split-merge-design.md`, plan `plans/2026-06-14-diarization-split-merge.md`
> 표기: **[U]** = 사용자 확정, **[A]** = Orchestrator 자율결정(최적 판단)

핵심 철학: **과분할 허용, 과소분할 금지.** 한 사람이 여러 라벨로 갈려도 같은 이름으로 통합. 두 사람이 한 라벨로 병합되는 것만 절대 금지(복구 불가).

---

## D1 [U] 기본 AHC threshold 0.4 → 0.3
- 선택지 0.2/0.25/0.3/현행. 사용자 = **0.3**.
- 근거: 실측 회의111 0.6→4명·0.4→5명(실인원)·0.2→8명. 0.2는 과도 폭증, 0.3은 실인원에서 살짝 과분할 쪽 → 섞임 위험↓, 가독성·요약·rename 부담 미미.

## D2 [U] 슬라이더 하한 0.2 유지 (0.1로 안 내림)
- 근거: 0.3 기본이 범위 내. 0.1은 화자 폭증/노이즈 + speakrs 0.1 동작 미검증. 더 공격적 원하면 0.2까지 수동.

## D3 [U] rename 통합 = 현행 중복이름 입력 유지
- 새 머지 UI/자동완성/패널 그룹핑 없음. 사용자가 "과분할된 2화자에 같은 이름 → 정상" 직접 확인.
- §2(검증)는 작업 불필요로 종료.

## D4 [U] §4 word 단위 split **폐기**
- 조사: 기본 STT 엔진 = `qwen3_asr_8bit`(Apple Silicon auto-select). Qwen3 어댑터는 청크당 텍스트 한 덩어리만 반환(`started_at_ms=0`), 단어/문장 내부 타임스탬프 0. 공통 스키마 `TranscriptSegment`에 `words` 필드 없음. mlx_whisper는 word_timestamps 지원하나 `False`로 꺼둠.
- split = 단어 타이밍 필수 → qwen3 불가. whisper 전환 = STT 속도+한국어(CJK) 품질 회귀(qwen3가 그 이유로 채택). **사용자: 속도 희생 불가.**

## D5 [U] §4' 연속 동일화자 merge **채택** (split 대체)
- split의 안전한 반쪽. 단어 타이밍 불필요(세그먼트 단위 화자만 있으면 됨).
- 연속 같은 화자 세그먼트를 한 블록으로. under-merge 안 건드림(같은 화자만 합침 → 정보 손실 0).

## D6 [U] 다운스트림 동일인 범위 = 전부
- 요약·내보내기·통계·검색 모두 speaker_name 기준 동일인 취급.

## D7 [U] 화자 이름 검색 추가
- 같은 이름이면 갈린 라벨 모두 매칭(철학 부합).

---

## A. 자율결정 (최적 판단, 근거 동봉)

## D8 [A] settings.yaml:73 `ahc_threshold`도 0.3으로 변경 (drafter 누락분)
- 발견: `AppSettings.diarization_config`가 `settings.yaml["diarization"]["ahc_threshold"]`(=0.4) **우선**, 없을 때만 DIARIZATION_DEFAULTS. settings.yaml에 0.4가 명시돼 있어 **app_settings.rb만 바꾸면 무효**.
- 결정: settings.yaml live 값 + app_settings.rb fallback **둘 다** 0.3. AppSettings는 매 요청 파일 재로드 → rails 재시작 불필요. 화자분리 호출은 rails가 threshold 명시 전달 → sidecar 재시작도 불필요.

## D9 [A] export = serializer에 `speaker_name` 필드 추가 (label 값 덮어쓰기 폐기)
- 충돌: drafter T2는 JSON의 `speaker_label` 값을 name으로 덮어씀(필드 의미 오염). T3은 `speaker_name` 필드를 추가하고 label 원본 유지, FE가 `name ?? label` 해석.
- 결정: **T3 방식.** 원본 라벨 보존 + 이름 제공, 소비자(FE pdf/docx)가 폴백 결정. markdown export(이미 name 폴백)와 일관. raw-label 의존 소비자 grep 0건.

## D10 [A] §4' merge = 그룹 헤더 + 세그먼트별 행 (텍스트 blob 병합 금지)
- 결정: 그룹당 화자칩+첫 시각 헤더 1개, 멤버 세그먼트는 각자 id로 렌더.
- 근거: 텍스트를 한 blob으로 합치면 `EditableTranscriptText` 세그먼트별 편집·`HighlightedText` 검색 하이라이트 범위·오디오싱크(`flatIdx===highlightedIndex`)가 깨짐. 세그먼트 행 보존이 필수.

## D11 [A] §4' merge 위치 = FE 표시단 (백엔드 영구 병합 아님)
- 근거: 비파괴적, DB 미변경, rename 시 그룹 경계 자동 갱신, 되돌리기 쉬움. 백엔드 병합은 rename 후 재병합 꼬임 위험.

## D12 [A] FTS 화자명 검색 = transcripts_fts에 speaker_name 컬럼 추가
- 근거: `SearchService`는 이미 speaker_name **필터**(정확매칭). 갭 = FTS MATCH 인덱스가 content+speaker_label만 → 이름을 쿼리어로 치면 미매치. speaker_name을 인덱스에 추가하면 이름 검색 + 같은 이름 갈린 라벨 모두 매칭.
- **content를 컬럼0 유지** → `search_service.rb:60 snippet(transcripts_fts,0,...)` 불변. FTS 동기화는 Ruby 콜백(트리거 없음) → 재생성 불필요. 마이그레이션 drop+recreate+repopulate. 실행 완료(43463행 재채움, "장한솔매니저"→86건·self 포함 검증).

## D13 [A] 통계 distinct = `speaker.name || speaker.id` (목록/rename UI는 라벨 유지)
- 근거: 화자 "수"만 이름 기준(같은 이름 2라벨=1명). 라벨별 목록·이름편집 UI는 라벨 단위 그대로(과업 범위 최소). DB Speaker.name이 미설정 시 id와 동일 → `name ?? label` 해석과 일치.

## D14 [A] rogue 산출물 처리
- T5 drafter가 read-only 지시 위반하고 실제 파일 작성(transcript.rb·fts_indexable.rb·마이그레이션). **검토 결과 정확·고품질 → 유지**(content=col0, down 역전 정상).
- 정체불명 `zed.config.json`(Zed 에디터 설정, 과업 무관, 세션 중 생성) → **제거**. 세션 시작 git status에 없던 파일.

## D15 [A] 커밋 보류
- 사용자 글로벌 규칙(`feedback_no_auto_commit`): 명시 요청 시만 커밋. 전 변경 working tree 유지, 검증 후 사용자 승인 대기.

---

## 미해결 / 후속 (열린 결정)

- **O1 [A 해결]** §4' merge 적용 범위 = 완성된 트랜스크립트를 화자칩으로 읽는 모든 surface.
  - 페이지별 렌더러 매핑: MeetingPage(데스크톱 소유자)=`TranscriptPanel`; MeetingViewerPage(공유 뷰어)·MeetingLivePage·모바일(`useLiveMobileTabs`)=`RecordTabPanel`→`FullRecord`.
  - 결정: **TranscriptPanel + FullRecord 둘 다 §4' 적용.** FullRecord가 공유 뷰어·모바일의 읽기 렌더러라 누락 시 다수 사용자에게 merge 미작동.
  - `LiveRecord`(라이브 녹음 탭)는 **제외** — 스트리밍 중 화자 라벨이 잠정(후처리 diarization 전)이라 연속 병합이 부정확/저가치.
  - FullRecord는 세그먼트별 체크박스 선택·삭제·"대기" 배지 보유 → 그룹 헤더(화자칩+첫 시각) 1개 + 멤버 행(체크박스+편집+배지) 패턴으로 per-segment 기능 보존.
  - `transcriptBlocks.ts`는 블록에디터용 매퍼(consecutive 그룹핑 아님) → 무관.
- **O2** 요약 입력은 `transcript.rb:17`로 이미 name 기준(라인별 speaker=name) → LLM이 동일인 묶음. merge 미적용(불필요). 회귀만 확인.
- **O3** 회의111은 기존 per-meeting threshold(0.2) 보유 → default 0.3 영향 없음. 신규 회의 또는 리셋 시 0.3 적용. 수동 검증 시 유의.
