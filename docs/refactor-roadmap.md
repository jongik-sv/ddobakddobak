# 전체 시스템 리팩토링 로드맵

> 출처: 6영역 병렬 감사(2026-06-15). 79 발견, high 20건 전부 적대적 검증 통과(과장·오류 0).
> **철칙: 기능 변경 0** — 모든 항목은 동작·출력 동일, 성능·유지보수만 개선.
> 진행 방식: 영역 1개=1브랜치=1PR. 가로 테마(설정·스키마)는 별도 트랙.

## 진행 상태

| 단계 | 항목 | 상태 | 브랜치 |
|------|------|:---:|------|
| 0 | applied_to_minutes 복합 인덱스 | ✅ done | refactor/stage0-perf-safe |
| 0 | meeting_serializable show full 3쿼리→1쿼리 | ✅ done | refactor/stage0-perf-safe |
| 0 | ffprobe→컬럼 | ⏸ 연기→단계1 | 녹음중 회의 stale 위험, 종료조건 필요 |
| 0 | Sidecar refine_locks cleanup | ⏸ 연기→단계1 | 제거 타이밍 잘못=직렬화 깨짐, 설계+테스트 필요 |
| 0 | pdfExporter ID/scale | ❌ 폐기 | ID는 거짓양성(mermaid d접두 정상), scale↓=품질변경 |
| 1 | #3 store_transcripts 트랜잭션 래핑(N커밋→1) | ✅ done | refactor/stage0-perf-safe. FTS콜백 유지·결과동일. job+search 26P |
| 1 | #3 insert_all/delete_all 전환 | ❌ 폐기 | Transcript/Summary=FtsIndexable 콜백, Block=dependent:destroy → 스킵시 FTS깨짐/orphan=동작변경 |
| 1 | #3 correct_records!/feedback/destroy 트랜잭션 | ⏸ 보류 | update!=FTS 필요. 표면 넓어 검토 패스 |

> **미커밋**: `refactor/stage0-perf-safe` 브랜치에 단계0 2건. 커밋은 사용자 명시 요청 시.
> **별건 stale 테스트**: `default_user_lookup_spec.rb:18` `사용자`→`관리자` 기대 불일치(commit 69df3a1 rename 후 미갱신). 내 변경 무관. 수정은 별도.

## Top 12 우선순위 (impact×effort)

| # | 항목 | 영역 | 차원 | 임팩트 | 노력 | 근거 |
|---|------|------|------|:---:|:---:|------|
| 1 | 동기 ffprobe + 중복 aggregate 제거 | Rails | perf | 高 | S | meeting_serializable.rb:50-52,114-122 |
| 2 | 인덱스(status·applied_to_minutes·speaker) | DB | perf | 高 | S | schema.rb:164,244,251 |
| 3 | 전사·피드백·삭제 N쿼리→bulk | Rails | perf | 高 | M | file_transcription_job.rb:155-164; meetings_controller.rb:314-316,540-552 |
| 4 | 설정 트리플 단일화+중앙로더 | 설정 | maint | 高 | M | config.yaml vs settings.yaml vs ddobak.env; load_env/app_settings/settings_controller 3중 |
| 5 | Sidecar gpu_lock 직렬화 완화+락/어댑터 누수 | Sidecar | perf | 高 | M | routers/stt.py:109,157-169; routers/llm.py:68-70 |
| 6 | Rust lock().unwrap() 39개 panic 제거 | Tauri | reli | 高 | M | lib.rs/bridge.rs/audio/* |
| 7 | useLiveRecording(727)/MeetingPage(688) 분해+store 단일화 | Front | maint | 高 | M | useLiveRecording.ts:64-97,235-436; MeetingPage.tsx:127-140 |
| 8 | meetings#index 이중 스코프 통합 | Rails | perf | 中 | M | meetings_controller.rb:16-37 |
| 9 | lib.rs(967) god분해+커맨드 레지스트리 | Tauri | maint | 中 | L | lib.rs:863-883 |
| 10 | blocknote·mermaid·html2pdf lazy load+청크 | Front | perf | 中 | L | package.json:19-21; AiSummaryPanel.tsx |
| 11 | 누락 FK·체크제약 | DB | reli | 中 | M | schema.rb:175-176,278-286 |
| 12 | 멀티서버 SQLite→PostgreSQL | 데이터 | maint | 中 | L | **사용자 보류 — 지금 안 함** |

## 가로 테마 (영역 가로지름)

1. **설정 진실원천 산재** — Rails 3중 파싱 + 프론트 localStorage 반복 + Sidecar ENV 분산. 우선순위 불명확·캐싱 없음.
2. **God 파일/함수** — lib.rs·useLiveRecording·MeetingPage·api/meetings.ts·summarizer. 테스트·리렌더 추적 불가.
3. **DB 핫패스 N쿼리** — insert/update/delete 루프 + 다중 aggregate. bulk+인덱스로 일괄.
4. **동시성 락** — gpu_lock 직렬화·refine_locks 누수·39 unwrap panic·audio race.
5. **에러 silent fallback** — broad rescue·`.ok()` 무시·설정 silent fallback.
6. **스키마 무결성 갭** — 인덱스·FK 부재·redundant 인덱스.

## 권장 진행 순서

- **단계 0** (1~2일, 회귀위험 낮음): 인덱스·serializer in-memory·누수정리·pdf. → *재평가: 무변경 보장 2건만 채택, 나머지 단계1로*
- **단계 1** (1~2주): bulk(#3) → Sidecar 세마포어(#5) → Rust lock_state(#6) → index#통합(#8). 인덱스 선행 후 측정.
- **단계 2** (2~4주): 설정 중앙로더(#4, 이후 모든 설정작업 기반) → FK·체크제약(#11) → transcriptStore 단일화(#7 1단계).
- **단계 3** (별도 트랙, L): lib.rs 분해(#9) → 프론트 god 분해(#7) → 에디터 lazy(#10) → 멀티서버 DB(#12, 보류).

## Quick Wins (S, 즉시 가치) — 무변경 보장 여부 개별 검증 필수

- meeting_serializable max/min in-memory ✅완료
- applied_to_minutes 인덱스 ✅완료
- summary_options last-meeting 쿼리 → User 컬럼 비정규화 (meetings_controller.rb:482)
- MeetingLookup host_participant 캐시+includes (meeting_lookup.rb:30)
- ActionCable broadcast 4~6개→단일 복합 (meeting_summarization_job.rb:79-91)
- Sidecar refine_locks/_FILE_PROGRESS cleanup (검증 후)
- diarization enabled/enable 키 통일 (app_settings.rb:28)
- config.ts getMode() 1회 캐시 (config.ts:68-75)
- Rust mDNS multicast lock OnceLock화 (mdns.rs:100-101)

## Big Bets (L, 별도 트랙)

- 멀티서버 DB(설계문서 합의 먼저, **현재 보류**)
- lib.rs 도메인 분해+레지스트리
- 프론트 god 컴포넌트 체계 분해+store 단일화
- 에디터 lazy load+번들 청크(~300KB↓)
- cohere_ffi SAFETY 강화+StreamGuard
- vendored lw_whisper 의존성 제거/고정
