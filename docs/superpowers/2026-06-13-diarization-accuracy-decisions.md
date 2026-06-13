# 화자분리 정확도 — 결정 이력 (decision log)

세션 2026-06-13. `/loop`로 "최선의 선택해서 끝까지 진행" 위임받아 실행. 각 결정·근거·대안 기록.

관련 문서: 설계 `specs/2026-06-13-diarization-accuracy-design.md`, 플랜 `plans/2026-06-13-diarization-accuracy.md`.

| # | 결정 | 누가 | 근거 / 대안 |
|---|------|------|------------|
| 1 | 작업 순서 = **Phase 1(정확도) 먼저 → 측정 → Phase 2(문장분리)** | 사용자 | Phase 2는 STT엔진 의존(whisper_cpp)이라 리스크 큼. 분리 진행. |
| 2 | 정확도 제어 = **회의별 슬라이더 풀 배선** | 사용자 | 글로벌 고정/플래그만 대비, 회의별이 권위(expected_participants 선례). |
| 3 | 임베딩 출력/rename·재클러스터 = **Phase 1 제외(YAGNI)** | 위임→나 | 정확도와 직교. 필요 시 별도 과제. `DiarizationResult.embeddings`로 추후 가능. |
| 4 | `--mode` 플래그 **폐기, ExecutionMode=CoreMl 고정** | 적대검토+실측 | `for_mode`는 step size 제어 안 함. 회의111 경계 66.7%@1000ms → 현 바이너리 이미 ~full. mode 전환 이득 0. |
| 5 | 모델 구성 API = `from_pretrained(CoreMl)` (+ `SPEAKRS_MODELS_DIR` 폴백) | 나 | `DiarizationPipeline::new(pre-built)` 예제는 mode 못 박음. from_pretrained가 HF캐시 자동 + env 없이 동작(현 바이너리 추정 방식). |
| 6 | **측정 게이트 먼저 실행**(빌드 전 falsify) | 사용자 | 적대검토 최강 결론="빌드 전 측정". 레버 죽음/mode 헛것 둘 다 미검증이었음. |
| 7 | (게이트 결과) **threshold가 유일 실측 레버, 0.4 최적** | 실측 | 회의111: 0.6→4명, 0.4→5명(실참석자), 0.2→8명(과분할). VBx 안 먹음 입증. |
| 8 | 기본값 **0.4**, UI 슬라이더 **0.1 단위(0.2~0.8)** | 사용자 | 0.4=5명 고원 중앙(과분할 절벽 0.2서 두 칸). 0.3도 동등하나 마진 위해 0.4. |
| 9 | 입력 포맷 = **s16le(Int16)** 읽기 | 나 | sidecar가 넘기는 PCM은 Int16(schemas.py). 게이트 도구는 f32le였음 — 실 래퍼는 s16le. |
| 10 | 실행 방식 = ~~Inline~~ → **Subagent-driven** (사용자 오버라이드), 태스크별 **로컬 커밋(푸시X)** | 사용자 | 사용자가 "서브에이전트 방식으로 진행" 지시. 태스크당 fresh 서브에이전트 + 2단계 리뷰. "끝까지 진행"=커밋 인가, 푸시 금지 유지. |

## 실행 로그 (태스크 진행)

리뷰 정책(나): mechanical 태스크(1·2·4)=spec+품질 통합 리뷰 1회, 로직 태스크(3·5·6)=2단계 분리. 효율 위함, 이슈 발견 시 격상.

- **Task 1 (Rust 래퍼)** ✅ DONE. 빌드 성공(26.5M arm64, 6m40s). 통합 리뷰 accept(spec 전항 일치, API 심볼 전수 실재 확인). 커밋 a28b098 + Cargo.lock f7be4ee. 미니이슈=미지 플래그 무시(허용).
- **Task 2 (골든+교체)** ✅ DONE. 골든게이트 통과: old=4명/1920턴, new@0.5=4명/1920턴(정확일치=충실 drop-in), new@0.4=5명/1951턴(목표). 계약·runner파싱 all-pass. bin 스왑 cmp IDENTICAL. 커밋 c708f76.
- **Task 3 (sidecar passthrough)** ✅ DONE+APPROVE. TDD fail→pass(2). router→batch→runner→subprocess `--ahc-threshold` end-to-end 추적 일치(Rust consumer까지 교차확인). 회귀 0(스테일은 1a7ee57 유래). 통합리뷰 통과. 커밋 ad14df6. 정책주: Task 3 스레딩 mechanical 판단해 통합리뷰 1회 적용.
- **Tasks 4+5 (Rails)** ✅ DONE+APPROVE. 마이그레이션 schema:148, controller permit(expected_participants 패턴), AppSettings/job 배선, 글로벌 기본 app_settings.rb에 0.4(settings.yaml은 gitignore라 미커밋이나 코드 폴백 존재). end-to-end 회의값>글로벌 오버라이드 확인, authorize 가드 동일. 테스트 163/0(app_settings_spec 1줄 기대값 갱신=정당). 커밋 07e706d, af70025.
- **Task 6 (Frontend 슬라이더)** ✅ DONE+APPROVE. Meeting/UpdateMeetingParams 타입, EditMeetingDialog 슬라이더(0.2~0.8 step0.1, 리셋→null), MeetingsPage:164 data wholesale→PATCH 도달 확인. tsc clean, vitest 8/0. build실패=pre-existing 13건(무관). 커밋 f5f4e36. 소프트갭=슬라이더 전용 테스트 없음(후속).
- **Task 7 (E2E)** ✅ DONE. sidecar 실경로 통합검증: `run_speakrs(0.4)`(실 신규 바이너리)→5 라벨, 961 STT행 `assign_speaker_summed`→**5 distinct**(화자1~5: 246/187/218/172/138, None 0). 과소분할(4명)→정확히 5명(실참석자) 해소 입증. **남은 1단계=라이브 앱서 회의111 슬라이더 0.4→STT 재실행→DB 5라벨 확인**(사용자 환경).
- **최종 전체리뷰** ✅ READY. end-to-end 추적(TS`diarization_threshold`→job 번역→sidecar`ahc_threshold`→CLI`--ahc-threshold`) 일치, 계약보존, 기본/오버라이드/널 안전, 마이그 가역, authorize 동일, 위생 클린. **IMPORTANT 1건 발견·수정**: `meeting_json`에 필드 누락→슬라이더 저장값 재오픈시 미표시. serializer 추가 + 범위검증(0.1~1.0, 쓰레기 0.0 차단) + spec 3/0. 커밋 1955de4.

## 후속: 화자분리만 재실행 (사용자 "둘 다" 선택, 2026-06-14)
| # | 결정 | 근거 |
|---|------|------|
| 11 | 현재 화자분리-only 경로 **없음**(regenerate_stt=STT통째). whisper 69분 재실행 회피 위해 신규 | 슬라이더 반복튜닝의 짝 |
| 12 | Part B=회의111 일회성 스크립트로 0.4 적용(검증) | run_speakrs(0.4)→5명, 961행→5 distinct. DB 직접 UPDATE(speaker_label 5개, speaker_name NULL, meeting.diarization_threshold=0.4). whisper 없이 ~1분 |
| 13 | Part A=정식 기능: sidecar `/diarize-file` + Rails `ReDiarizeJob`+`re_diarize` 액션 + UI 버튼 | content **purge 안 함**(텍스트 유지가 핵심 차이). speaker_name 초기화(라벨 매핑 변경). 서브에이전트 빌드 |

- **Part B (회의111 적용)** ✅ DONE. before=4명(화자1=홍춘식,조덕현 병합) → after=5명(246/187/218/172/138, name 초기화), threshold=0.4 영속.
- **환경 발견**: 데스크탑 앱 = dev 서버(rails PID82027 → `backend/storage/development.sqlite3`, WAL). 옛 prod DB(`~/Library/Application Support/com.ddobakddobak.app/db/production.sqlite3`)는 구스키마·회의 2개뿐(미사용). 직접 SQL write는 ActionCable 안 쏨 → 화면 새로고침 필요.
- **SpeakerDB 갭**: Part B 스크립트가 `run_speakrs+assign`만 직접 호출 → `_register_speakers` 누락 → 화자목록(SpeakerDB) 빔. 수동 등록(`sidecar/speaker_dbs/meeting_111.json` 화자1-5)으로 해결. **정식 기능은 /diarize-file가 batch_diarize_speakrs 경유라 자동 등록됨**(이 갭 없음).
- **R1 (sidecar /diarize-file)** ✅ DONE. STT 없이 기존 세그먼트 화자분리만. 테스트 3/0. 커밋 259f201.
- **R2 (Rails ReDiarizeJob+re_diarize)** ✅ DONE. SidecarClient.diarize_file, PcmConvertible 추출(FileTranscriptionJob 회귀 5/5), content purge 안 함, zip 순서매핑(R1 순서보존 의존-확인), 브로드캐스트. 스펙 7/0. 커밋 2c4d222.
- **R3 (FE 버튼)** ✅ DONE. MeetingActions "화자분리만 재실행" 버튼+확인다이얼로그(텍스트 유지), 기존 진행률 UI 재사용. tsc clean, vitest 19/0. 커밋 54a131b.
- **계약 확인**: R1 응답 {started_at_ms,ended_at_ms,speaker_label} = R2 파싱 일치, 순서보존 ✓.
- **배포 갭**: 실행중 sidecar는 `uvicorn`(--reload 없음)이라 /diarize-file 미로드(404) → **재시작 필요**. rails는 라우트 리로드됨(/re_diarize 500=인증없는 curl, 버그 아님).
- **사고+복구**: 진단용 `curl POST /re_diarize`가 loopback=로컬admin 인증으로 **실제 실행**→회의111 transcribing 멈춤(sidecar 404 + :async 잡 dev리로드 유실). DB status 직접 completed 복구(데이터 무손실). 교훈=loopback curl은 부작용 있음.
- **sidecar 재시작 완료**: tmux ddobak:sidecar서 C-c→`uv run uvicorn` 재기동. /diarize-file 422(로드됨). 라이브 테스트: 961세그→5화자(246/187/218/172/138).
- **전체 E2E 검증**(동기): `ReDiarizeJob.perform_now(111)` → status completed, 5라벨, speaker_name 0 non-null. re_diarize 전 경로 작동 확정. 회의111 깨끗한 완료 상태.
- **남은 미검증**: 버튼의 :async 비동기 실행(perform_later). 로직은 동기로 전부 입증. :async는 dev 코드리로드 시 잡 드롭 가능(드묾, 데이터 무손실) — followups에 기록.

## 실사용 사고 2건 + 동작변경 (2026-06-14)
| # | 결정/사고 | 근거 |
|---|------|------|
| 14 | 실 422 원인 = ~~:async 드롭~~ → **Zeitwerk autoload staleness** | 러닝 서버가 `app/jobs/concerns/pcm_convertible.rb` 생성 전 부팅 → 새 autoload 루트 미등록 → `NameError: ReDiarizeJob::PcmConvertible` → 잡 크래시 → 회의 transcribing 정지 → 재클릭 422. `rails runner`(새 프로세스)는 멀쩡해 오진. **해결=서버 재시작**(PID 2476). 메모=reference_zeitwerk_new_concern_restart |
| 15 | 스턱 자가복구 안전망 추가 | `meetings.re_diarize_started_at` 컬럼 + `Meeting#heal_stale_re_diarize!`(5분 stale→completed) + show/re_diarize before_action. 실 STT는 컬럼 안 써 불간섭. 스펙 6/0+회귀 125/0 |
| 16 | **재실행 시 화자 이름 = 유지**(초기화 폐기) | 사용자 선택. 이름 진실원천=SpeakerDB(sidecar, 재실행해도 보존). 기존 코드가 `transcripts.speaker_name`만 nil 리셋→패널(SpeakerDB)과 어긋남(위=화자N/아래=홍춘식). **수정**: ReDiarizeJob이 nil 대신 `get_speakers` 맵으로 speaker_name 재적용(name==id→nil 폴백, sidecar 불통→빈맵). 회의111 961행 즉시 재적용. 잡스펙 신규 2/0(이름유지+폴백). 파일=re_diarize_job.rb(`fetch_speaker_names`) |

## 최종 상태
브랜치 `feat/diarization-accuracy`, 8커밋(a28b098..1955de4), **푸시 안 함**(규칙). 빌드/테스트 green(sidecar threshold 2/0, rails 3/0+회귀 163/0, FE tsc clean+vitest 8/0). 라이브 앱 재전사 1단계만 사용자 몫. 머지/PR은 미실행(푸시 금지) — 사용자 판단.
