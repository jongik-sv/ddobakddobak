# 온디바이스 STT — 로컬(오프라인) 모드 & 서버 동기 설계

- 날짜: 2026-06-01
- 상태: 설계 (자율 승인 — 사용자가 결정 자동화 + 완료까지 진행 위임)
- 상위 플랜: `docs/superpowers/plans/2026-06-01-ondevice-stt-android-port-plan.md` (Task 0~12 = sherpa+Cohere int8 Android 이식)
- 정렬: `docs/superpowers/specs/2026-05-29-ondevice-stt-design.md`(§5 로컬저장·§9-6 통합), `2026-05-28-stt-meeting-language-mode-design.md`(언어 권위)

## 1. 목표 (이 설계가 상위 플랜에 추가하는 것)

상위 플랜은 "서버 STT ↔ 온디바이스 STT 토글"까지였다. 사용자 추가 요구로 **3가지를 v1 스코프로 끌어올린다**:

1. **로컬(오프라인) 모드** — 서버를 못 찾거나(자동) 사용자가 명시 선택(수동)하면 폰 안에서 완결 동작. 서버 불필요.
2. **로컬 데이터 영속** — transcript·메타·오디오를 기기에 저장. 서버 못 봐도 회의가 남는다.
3. **서버 전송 opt-in** — 사용자가 켜면 transcript + 오디오를 서버로 보낸다(공유 뷰어/검색/백업). 오프라인 시작 → 서버 복귀 시 후동기.

### 결정 사항 (확정)

| 축 | 결정 |
|---|---|
| Q1 언어 권위 | **C** — creator `effective_language_config` 기본 + 회의 시작 시 로컬STT 한정 오버라이드 |
| 로컬 저장 기전 | **tauri-plugin-fs JSON** (기존 fs 플러그인, 새 네이티브 dep 0건) |
| 로컬 진입 | **자동폴백 + 수동토글 둘 다** (probeUrl/mdns 실패+로컬가능 → 자동, 설정 명시 토글) |
| 업로드 범위 | **transcript + 오디오 한 토글** (opt-in ON 시 둘 다) |
| 업로드 타이밍 | **라이브 시도 + 오프라인 큐 후동기** (probeUrl 복귀 시 자동 플러시) |
| 오프라인 생성 | **완전 오프라인 생성** — 로컬 string ID + 단방향 프로모트(업로드 시 createMeeting으로 서버 ID 발급) |

## 2. 핵심 제약 — 오프라인 회의 = 축소 기능 (명시)

`meetings.ts`의 모든 함수가 서버 POST다(`createMeeting`/`startMeeting`/`stopMeeting`/`getMeetingDetail`/summary/refine). **서버를 한 번도 못 본 회의는 이들을 못 쓴다.** 따라서 오프라인 회의는 의도적으로 **축소 기능**이다:

- ✅ 가능: 캡처 + Silero VAD + 온디바이스 전사 + 로컬 저장 + transcript 뷰/편집(로컬) + 오디오 로컬 재생.
- ❌ 불가(업로드 전까지): **AI 요약/refine**(서버 LLM 필요), 실시간 공유 뷰어, 화자분리(pyannote 서버 전용), 다국어 자동감지, 태국어.
- 업로드(프로모트) 후 → 서버 회의로 승격되어 요약/공유/검색 전부 활성.

이 경계를 UI가 정직하게 노출한다(로컬 회의 상세에 "기기 저장 — 서버 동기 시 요약 생성" 안내).

## 3. 아키텍처

```
┌─ WebView (React/TS) ────────────────────────────────────────────────┐
│ useLiveRecording (오케스트레이션)                                     │
│   sttMode 결정 ← sttModeResolver:                                     │
│     manual='local' | (auto && !serverReachable && localCapable)      │
│        → 'local'  else 'server'                                       │
│   ├ 'server' → useTranscription (기존, 무변경)                        │
│   └ 'local'  → useLocalStt (신규)                                     │
│        Silero VAD(wasm) → SegmentAccumulator → invoke('stt_transcribe')│
│        → TranscriptFinalData                                          │
│          ├→ localStore.appendSegment (fs JSON, 진실원천)              │
│          ├→ transcriptStore.pushFinal (BlockNote 렌더 — 기존 seam)    │
│          └→ (opt-in ON) syncQueue.enqueue → 라이브 업로드 시도        │
│                                                                       │
│ localStore (tauri-plugin-fs)                                          │
│   app_local_data_dir/local-meetings/<localId>/                       │
│     meta.json   {localId, title, lang, created_at, serverId?, ...}    │
│     segments.jsonl  append-only TranscriptFinalData 행                │
│     audio/<seq>.wav  세그먼트 PCM(16k mono) — opt-in 업로드/재생용    │
│                                                                       │
│ syncQueue (오프라인 큐)                                               │
│   probeUrl 복귀 || opt-in 토글 ON 시 플러시:                          │
│     1. serverId 없으면 createMeeting() → localId→serverId 매핑 저장   │
│     2. transcripts/bulk (Task 9 엔드포인트)                           │
│     3. (오디오 포함) uploadAudioChunk × N → finalizeAudio             │
│     4. 성공 시 audio/ 정리(보존정책), meta.serverId 기록              │
└──────────────────────────────────────────────────────────────────────┘
              │ invoke (Android SYNC 커맨드)
┌─────────────▼─ Rust (frontend/src-tauri, #[cfg android]) ────────────┐
│ cohere_ffi::CohereRecognizer (sherpa C-API, Mutex 직렬)               │
│ stt_load{model_dir, language} / stt_transcribe{pcm}                  │
│ resolve_model_paths / ensure_cohere_model                            │
└───────────────────────────────────────────────────────────────────────┘
```

## 4. 컴포넌트 (단위·경계)

### 4.1 `localStore.ts` (신규, fs JSON)
- **책임:** 로컬 회의 CRUD. 진실원천.
- **인터페이스:** `createLocal({title, lang})→localId`, `appendSegment(localId, seg)`, `appendAudio(localId, seq, pcm)`(PCM Int16 16k → WAV 헤더 래핑 후 `audio/<seq>.wav` 기록), `listLocal()`, `getLocal(localId)`, `setServerId(localId, serverId)`, `deleteLocal(localId)`.
- **저장:** `app_local_data_dir/local-meetings/<localId>/`. meta.json + segments.jsonl(append-only, 크래시 내성) + audio/.
- **localId:** `local-${crypto.randomUUID()}` (WebView crypto — Date/random 금지는 Workflow 스크립트 한정, 프론트 무관).
- **의존:** `@tauri-apps/plugin-fs`.

### 4.2 `sttModeResolver.ts` (신규)
- **책임:** 활성 STT 모드 결정(순수 함수 + 도달성 1회 probe).
- **입력:** `{manualMode:'server'|'local'|'auto', serverReachable:boolean, localCapable:boolean}` → `'server'|'local'`.
- `localCapable` = 플랫폼 Android && 모델 present && 언어∈Cohere8∩ddobak && single 모드.
- `serverReachable` = `probeUrl(base)` (bridge.ts 기존).

### 4.3 `useLocalStt.ts` (신규 훅)
- **책임:** server `useTranscription`의 온디바이스 대응. 캡처 PCM → VAD/청킹 → invoke → 3-way emit(localStore/transcriptStore/syncQueue).
- **생명주기:** 시작 시 `resolve_model_paths`→`stt_load{dir, lang}`. VAD state 단일 직렬 drain.
- **인터페이스:** server 훅과 동형(`{sendChunk, ...}`) — useLiveRecording이 택일 호출.

### 4.4 `syncQueue.ts` (신규)
- **책임:** 단방향 프로모트 큐. opt-in ON 시만 활성.
- **인터페이스:** `enqueue(localId, item)`, `flush(localId)`(probeUrl 성공/토글 ON 트리거), `flushAll()`.
- **단방향:** 서버 카피는 로컬에서 태어남 → 충돌 없음. 멱등키 `(serverId, sequence)`(Task 9 유니크).
- **큐 영속:** localStore meta.json의 `pendingSync` 플래그 + 미전송 seq 마킹.

### 4.5 로컬 회의 목록 표시 (타입 churn 회피)
- 로컬 회의는 **별도 버킷** "기기 저장(미동기)"로 표시. `Meeting.id:number`에 string ID 섞지 않음.
- 대시보드/목록에 로컬 섹션 분리 → `number→string` blast radius 0.
- 프로모트 후 serverId 생기면 일반 목록으로 이동.

### 4.6 Rust (상위 플랜 Task 0~5와 동일 — 무변경)

## 5. 데이터 흐름

**오프라인 회의 생성·녹음:**
1. 사용자 "로컬 회의 시작"(또는 서버 못 찾아 자동 폴백) → `localStore.createLocal` → localId.
2. 캡처 → VAD 세그먼트 → `stt_transcribe` → final.
3. final → segments.jsonl append + transcriptStore push(렌더) + audio/<seq>.wav 저장.
4. opt-in ON이면 syncQueue.enqueue → 즉시 flush 시도(probe 성공 시).
5. 종료 → 잔여 flush(마지막 발화) + 로컬 meta status='completed'.

**후동기(프로모트):**
1. opt-in ON & probeUrl 성공(앱 재개/네트워크 복귀).
2. serverId 없으면 `createMeeting({title})` → serverId, 매핑 저장.
3. `transcripts/bulk` 미전송 seq 배치. 오디오 포함이면 chunk 업로드→finalize.
4. 성공 → meta.serverId/synced, audio 보존정책에 따라 정리. 서버 회의로 승격(요약/공유 활성).

## 6. 에러 / 폴백

- 모델 없음/언어 미지원/multi/th → localCapable=false → 로컬 비활성, 사유 툴팁("서버 모드 필요").
- 전사 호출 실패 → 해당 세그먼트 스킵 + 로그(체인 오염 금지 — POC 버그).
- 업로드 실패/오프라인 → pendingSync 유지, 다음 기회 재시도(지수 백오프 최소).
- 디스크 부족(폰/에뮬) → 오디오 저장 우선 중단, transcript는 유지. 사전 용량 체크.
- 모델 스테이징(에뮬): `/data/local/tmp`와 앱 샌드박스가 동일 `/data` fs → ensure_cohere_model은 **rename-move**(복사 2배 공간 회피). 5.7G avail에 2.75GB×2 복사는 위험.

## 7. 테스트 전략

- **단위:** `localStore`(append/read/매핑), `sttModeResolver`(분기표), `syncQueue`(멱등/재시도), `cohereLang`/chunker/resample/postprocess, `cut_eos`(Rust).
- **통합:** `useLocalStt` fixture 경로(capture→VAD→invoke mock→localStore+store), syncQueue mock 서버 프로모트.
- **에뮬(stt_arm64_api34, arm64-v8a):** dev_ffi_smoke(20× RAM/EOS), 오프라인 회의 생성→전사→로컬저장→재시작 후 잔존, opt-in ON→프로모트→서버 노출.
- **회귀:** 서버 STT 경로·데스크톱 sidecar·기존 transcript UI·`Meeting.id:number` 소비자 무영향.

## 8. v1 경계 (스코프 고정 — YAGNI)

- ✅ 오프라인 생성/녹음/전사/저장, 단방향 프로모트, transcript+오디오 업로드, 자동폴백+수동토글.
- ❌ 양방향 동기/충돌 해소, 로컬 AI 요약(서버 LLM), 로컬 화자분리, 로컬 FTS(목록/상세로 충분), iOS, 데스크톱 온디바이스.
- 로컬 회의 편집은 transcript 텍스트만(요약/refine은 프로모트 후).

## 9. 상위 플랜에 추가되는 Task (요약 — 플랜 문서에 반영)

- **Task 13: localStore (fs JSON)** — 로컬 회의 영속 + audio 저장.
- **Task 14: sttModeResolver + 자동폴백** — probeUrl/mdns + localCapable 게이트, 설정 토글(server/local/auto).
- **Task 15: syncQueue 단방향 프로모트** — createMeeting 매핑 + bulk + 오디오 업로드, 오프라인 큐.
- **Task 16: 로컬 회의 UI** — 별도 버킷 목록, 오프라인 생성 진입, 축소기능 안내, opt-in 업로드 토글.
- (기존 Task 7/8/9/10은 이 설계에 맞게 조정: useLocalStt가 localStore/syncQueue도 호출, Task 9 v1 "서버 도달 시만"→큐로 확장.)
