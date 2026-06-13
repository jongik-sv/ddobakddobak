# 화자분리 정확도 — 후속 작업 리스트 (2026-06-14)

브랜치 `feat/diarization-accuracy` (11 로컬 커밋, 미푸시). 본 작업서 파생된 후속·추천. 우선순위 P0(즉시)~P2(나중).

---

## P0 — 현재 작업 마무리·검증 (오늘)

| # | 작업 | 이유 | 노력 |
|---|------|------|------|
| 1 | **sidecar 재시작** (`uvicorn`, --reload 없음) | `/diarize-file` 404 → 재시작해야 버튼 작동 | 1분 |
| 2 | **라이브 클릭 검증**: 회의111 "화자분리만 재실행" → 5화자 + 화자목록 채워짐 + 진행률 + 자동갱신 | 코드/통합검증은 됐으나 실제 버튼 클릭 경로 미실행 | 5분 |
| 3 | **화자 5명 이름 재지정**(이석희/홍춘식/조덕현/장종익/장한솔) | re-diarize 후 rename 플로우 정상 확인 + 분리 품질 청취 | 10분 |
| 4 | threshold 0.3/0.5 슬라이더+버튼으로 체감 | 다른 값·다른 회의서 민감도 감각 | 10분 |

## P1 — 리뷰서 드러난 품질/배포 갭 (이번 주)

| # | 작업 | 이유 | 노력 |
|---|------|------|------|
| 5 | **머지+푸시**: `feat/diarization-accuracy` → main | 11커밋 로컬만. PR/리뷰 후 통합 | 30분 |
| 6 | **데스크탑 앱 재빌드·재배포**(Tauri) | 현재 보는 건 dev 서버. 패키지 앱은 구버전(prod DB 컬럼 없음). 실배포엔 마이그레이션+재빌드 필요 | 1~2시간 |
| 7 | 슬라이더 단위테스트(EditMeetingDialog) | 리뷰 소프트갭 — 슬라이더 자체 미테스트 | 30분 |
| 8 | ReDiarizeJob 잡-레벨 통합테스트(zip 매핑 mock) | 컨트롤러 스펙만 있음. 순서매핑 로직 미검증 | 45분 |
| 9 | 28MB `speakrs-cli` 바이너리 저장전략 결정(LFS vs 빌드아티팩트) | git raw 추적 → 교체마다 히스토리 비대(29.4→27.7MB) | 30분 |

## P1.5 — 기존 부채 (이번 작업서 노출, 내 코드 아님)

| # | 작업 | 이유 |
|---|------|------|
| 10 | `npm run build` 깨짐 수정(13 TS 에러, 무관 테스트파일·pdfExporter.ts) | tsc -b가 빨개서 CI/빌드 불가. 내 변경 무관하나 그린빌드 막음 |
| 11 | 스테일 sidecar 테스트 정리(test_speaker_diarization.py 등 13+ 실패) | 제거된 pyannote API 참조. 삭제/재작성 |

## P2 — 자연스러운 확장 (spec "나중 고려")

| # | 작업 | 메모 |
|---|------|------|
| 12 | **Phase 2: 화자별 문장 분리** | 원래 다음 목표. word-timestamp 필요 → 기본 STT=whisper_cpp 경로 먼저 조사. overlap.py를 per-word 화자턴으로 분할 |
| 13 | 임베딩 출력 → "이 둘 같은/다른 사람" 교정 UI | `DiarizationResult.embeddings` 활용. rename/재클러스터 |
| 14 | `expected_speakers`를 speakrs에 실제 힌트로 전달 | 현재 dead(전달만, 미사용). 참석자 수 → 추가 정확도 레버(crate 지원 확인) |
| 15 | 글로벌 기본 threshold를 settings UI서 조절 | 현재 회의별+코드기본 0.4. 매번 슬라이더 싫으면 |
| 16 | 실시간(라이브) diarization 개선 | 현재 품질문제로 OFF |
| 17 | re_diarize 진행률 메시지 STT와 구분 | 현재 기존 진행률 UI 재사용 — "음성 인식" 류 카피면 오해소지, 점검 |
| 18 | ~~ActiveJob :async 스턱 회복불가~~ → **(b) 자가복구 구현됨(2026-06-14)** | dev 코드리로드/서버재시작 시 진행중 ReDiarizeJob 드롭 → 회의 `transcribing` 영구정지 + 버튼 사라져 UI 회복불가(DB수술)였음. **수정**: `meetings.re_diarize_started_at` 타임스탬프 컬럼 추가 → re_diarize가 마킹, 잡 완료/rescue서 클리어. `Meeting#heal_stale_re_diarize!`(5분 초과 stale → completed 자가복구), `show`/`re_diarize` before_action서 호출. 실 STT는 컬럼 안 써서 절대 안 건드림(클로버 방지). 스턱돼도 5분 후 회의 열면 버튼 부활. 스펙 6/0+회귀 125/0. **남은 (a)**: prod 큐 워커(durable)는 여전히 권장 — 자가복구는 안전망일 뿐 드롭 자체는 prod 워커라야 근절 |

### 2026-06-14 실사용 422 사고 — 진짜 원인은 :async 드롭이 아니라 **Zeitwerk autoload staleness**
화면 `completed`인데 "화자분리만 재실행" 클릭 → `422 POST /meetings/111/re_diarize`. 로그 진짜 원인: `NameError (uninitialized constant ReDiarizeJob::PcmConvertible)` (re_diarize_job.rb:5). 러닝 rails 서버가 **`app/jobs/concerns/pcm_convertible.rb` 생성 전에 부팅** → Zeitwerk autoload 루트가 부팅시 고정돼 새 concern 루트 미등록 → ReDiarizeJob 로드 실패 → status는 transcribing으로 바뀐 뒤 perform_later서 크래시 → 영구 정지 → 재클릭 422. `bin/rails runner`(새 프로세스)선 멀쩡해 오진 쉬움(perform_now 테스트가 통과했던 이유). **수정 = rails 서버 재시작**(`SERVER_MODE=true bin/rails server -p 13323 -b 0.0.0.0`, 새 PID) → ReDiarizeJob+PcmConvertible 로드 확인. 회의111 status만 completed 복구(라벨+이름 보존). 교훈 메모=reference_zeitwerk_new_concern_restart. **주의**: 재실행은 speaker_name 초기화하므로, 사용자가 이름 지정한 회의는 재분리 필요할 때만 클릭.

---

## 추천 (우선순위 Top)

1. **P0 전부 오늘** — 재시작→클릭검증→이름지정. 이게 끝나야 "동작 확인" 완료.
2. **#5 머지+푸시** — 작업 보존. 안 하면 로컬 11커밋 휘발 위험.
3. **#12 Phase 2** — 사용자 원래 로드맵의 다음 칸. 화자분리 정확도 다음은 "한 세그먼트에 여러 명 섞인 것" 쪼개기.
4. **#7/#8 테스트** — 슬라이더·잡 커버. 회귀 방어.
5. **#10 빌드 그린화** — 별개 부채지만 CI·배포 전 필수. #6(데스크탑 재배포) 선행조건.

**안 추천(지금)**: #13 임베딩 교정 UI(YAGNI, 수요 확인 전), #16 라이브 diarization(범위 큼·별도 트랙).
