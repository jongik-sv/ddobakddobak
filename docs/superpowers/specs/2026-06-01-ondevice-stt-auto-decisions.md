# 온디바이스 STT 구현 — 자동 결정 로그

> 사용자가 "합리적 선택 자동결정 + 완료까지 진행"을 위임함(2026-06-01). 이 문서는
> 진행 중 자동으로 내린 모든 비자명 결정을 기록해 사용자가 사후 검토할 수 있게 한다.
> 명시적으로 사용자가 답한 결정(Q1=C, 별도커밋, 완전오프라인생성 등)은 설계서
> `2026-06-01-ondevice-stt-local-mode-design.md` §1에 있고, 여기는 그 외 자동결정.

## 환경 / 빌드

| # | 결정 | 근거 | 되돌리려면 |
|---|---|---|---|
| A1 | 에뮬 디스크 10G→**20G** | staging 2.7G + 샌드박스 복사 2.7G + 시스템 3.7G = 9G로 10G 빠듯 → 복사 실패 위험 | `stt_arm64_api34.avd/config.ini` `disk.dataPartition.size` 수정 + `-wipe-data` |
| A2 | 검증 디바이스 = **에뮬 `stt_arm64_api34`(arm64-v8a)** | 실기기 미연결. Apple Silicon은 arm64 게스트 네이티브 → arm64 .so 직접 로드 | 실기기 연결 시 `-s <serial>` |
| A3 | bindgen build-dep **무조건 의존**(target-gate 안 함) | build.rs는 단일 호스트 컴파일 단위라 `cfg(target_os=android)` build-dep는 호스트 컴파일을 깨뜨림. 소스 레포도 동일 | Cargo.toml |
| A4 | `copy_with_verify` **스트리밍**(`io::copy`)으로 변경 | 소스의 `fs::read` 전체적재는 2.6GB .data를 RAM 4.5GB 에뮬서 OOM 위험 | model_path.rs |
| A5 | 데스크톱 `REPO_MODEL_DIR` 폴백 arm **제거** | 또박또박 데스크톱 STT는 sidecar 경로라 로컬 모델 폴백 불필요 | model_path.rs |

## 아키텍처 / 코드

| # | 결정 | 근거 | 영향 |
|---|---|---|---|
| A6 | stt.rs = **Android 전용**(데스크톱 arm 없음) | 또박또박 데스크톱은 ActionCable→sidecar. 소스의 ureq 데스크톱 arm은 ddobak에 불필요(stt_core 의존 없음) | lib.rs `#[cfg(target_os="android")]` |
| A7 | iOS는 STT 핸들러 **제외**, Android만 등록 | generate_handler! 개별 cfg 불가 → 모바일 핸들러를 `all(mobile,not(android))` / `target_os=android` 둘로 분기 | lib.rs |
| A8 | 로컬 transcript `speaker_label=**""**`(빈문자열) | DB/타입이 `speaker_label: string NOT NULL`(null 아님). 로컬 단일/미상 화자 = 빈문자열 | 전 파이프라인 |
| A9 | 백엔드 bulk = `save!(**validate: false**)` | speaker_label presence 검증을 빈문자열이 통과 못함. content/시간은 컨트롤러서 직접 가드 | transcripts_controller |
| A10 | 멱등키 = `(meeting_id, **sequence_number**)` find_or_initialize | 재시도/후동기 중복 방지. 새 unique index 추가 안 함(기존 인덱스 활용, 마이그레이션 회피) | bulk_create |
| A11 | 로컬 회의 ID = `**local-**${crypto.randomUUID()}` | 서버 number ID와 네임스페이스 분리(타입 churn 0). 별도 버킷 표시 | localStore |

## Workflow 사용 (사용자 요구)

| # | 결정 | 근거 |
|---|---|---|
| A12 | T0~T5(엔진 스파인)는 **메인스레드 순차**, Workflow는 T6+(독립 청크) 병렬 | T0~T5는 의존 체인+에뮬 디버그 루프 → 병렬 이득 없음, 중간 수정 필요(A3/A4 실제 발생). advisor 확인 |
| A13 | Workflow `w610n82lg`(6모듈 병렬) **중도 정지 + 메인스레드 복구** | ⚠ **사고**: 리뷰 단계 서브에이전트가 full tool access로 "수정"하며 `localStore.ts`를 삭제함. 정지 후 메인스레드가 고아 테스트 계약대로 재작성. 교훈: Workflow 리뷰 에이전트는 read-only여야 함(다음 Workflow는 리뷰에 파일수정 금지 명시) |

## 검증 현황(이 배치)
- frontend stt 8모듈: vitest **92/92** ✅, `tsc` 신규파일 0 에러 ✅
- backend bulk: RSpec **12/12** ✅
- 엔진(T5): 에뮬 dev_ffi_smoke 한국어 연속전사 GREEN(load 6.5s, 세그먼트 0.7~3.1s)

## 미결(후속 검토 권장)
- A13 사고 방지: Workflow 리뷰 에이전트에 Edit/Write 회수(cavecrew-reviewer류 read-only 사용).
- T11 모델 호스팅(LAN vs CDN) — 플랜 Task 11, 아직 미구현.
- Cohere 상업 라이선스 — 배포 전 법무 확인(플랜 리스크).
