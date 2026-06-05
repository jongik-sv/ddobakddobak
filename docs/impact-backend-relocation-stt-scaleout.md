# 영향도 분석 — 백엔드 서버 이전 + STT 서버 다중 운영

> 대상 변경
> - **A축 (백엔드 이전)**: Rails 백엔드를 맥 본체(loopback=로컬 admin)에서 별도/원격 서버로 이전
> - **B축 (STT 스케일아웃)**: 여러 개의 Python STT sidecar 서버 운영. 각 STT 서버가 **부팅 시 백엔드에 자기 등록(self-register)** → 이후 **회의가 STT 서버를 선택**
>
> 분석 방식: 9개 서브시스템 병렬 분석(코드 직접 독해), 55개 발견사항. 본 문서는 이를 종합.

---

## 0. 핵심 결론 (TL;DR)

- **블로커 16건.** 둘 다 "설정만 바꾸면 되는" 변경이 아니라, **스키마 신설 + Rails↔sidecar 통신 계약 변경 + 인증 모델 변경**이 필요한 구조 변경이다.
- **가장 단단한 결합점 = `transcribe_file`**: 파일 STT가 sidecar에 **백엔드 로컬 디스크 경로 문자열**을 넘긴다. A·B 두 축 모두 이걸 깨뜨린다. (실시간 STT는 base64 인라인 전송이라 안전 — 이게 고칠 때 베껴야 할 템플릿.)
- **diarization(화자분리) 상태는 sidecar 메모리에만 존재** (Rails에 Speaker 모델 없음). → 회의↔STT서버 **고정(affinity)은 필수**, 서버 죽으면 그 회의 화자상태는 **복구 불가**. 화자 **이름(rename)** 도 sidecar에만 있어 완료된 회의에서도 **소리 없이 사라질 수 있음**(데이터 손실).
- **인증**: `SERVER_MODE`가 안 켜지면 **모든 요청이 admin**. 원격/공유 호스트에서 loopback-admin은 **권한상승 구멍**이 된다.
- **모바일**: Android 앱의 loopback 브릿지(reqwest)가 **TLS 미컴파일** → 원격 https 백엔드에 **연결 자체가 안 됨**. 모바일 축 최대 블로커.
- **DB**: SQLite 로컬 파일 4개. 원격 앱서버가 네트워크로 공유 불가 → "통째로 이전" 또는 Postgres 전환 결정 필요.
- **기존 잠복 버그 발견**: `file_transcription` 큐에 **워커가 없음** → 오프라인 파일 STT 잡이 production에서 영영 처리 안 됨.

심각도 표기: 🔴 블로커 · 🟠 높음 · 🟡 중간 · ⚪ 낮음

---

## 1. 현재 아키텍처 (확정 사실)

```
[클라이언트: 웹 / 맥 데스크톱앱(Tauri) / 안드로이드(Tauri+loopback브릿지)]
        │  (웹=same-origin / 데스크톱·모바일=server_url 직접·브릿지)
        ▼
[Rails 백엔드]  ── 인증(하이브리드: loopback=admin / 원격=JWT, SERVER_MODE)
   │  ├ 요약 LLM: LlmService (Anthropic/OpenAI API 또는 claude/agy/codex CLI)
   │  ├ 저장: SQLite 4개 파일 + 오디오/첨부 = 로컬 디스크 절대경로(DB에 문자열)
   │  └ SidecarClient ──HTTP(단일 ENV SIDECAR_HOST:PORT, 기본 localhost:13324)──┐
   ▼                                                                            ▼
[SolidQueue 잡: real_time(5스레드) / summarization / default]      [Python STT sidecar]
                                                                    ├ STT(whisper/qwen/cohere)
                                                                    ├ 화자분리 상태(메모리, meeting_id 키)
                                                                    └ 전역설정(engine, HF토큰)
```

핵심: **STT는 이미 분리된 서비스**(sidecar). 단 **단일 대상**으로 하드코딩(`SIDECAR_HOST`), 그리고 **회의 단위 stateful**.

---

## 2. A축 — 백엔드 이전 영향

### 🔴 블로커

| # | 항목 | 무엇이 깨지나 | 필요 조치 |
|---|---|---|---|
| A1 | **`SERVER_MODE` 미설정 시 전원 admin** | `!server_mode?` → 모든 호출이 `desktop@local`(role=admin). 잘못된 systemd/Docker/직접실행이면 **무인증 admin 전면 개방**. `application_controller.rb:37-41`, `default_user_lookup.rb:8-10` | 프로세스 매니저 레벨에서 `SERVER_MODE=true` 강제. production에서 미설정이면 **부팅 거부**하는 이니셜라이저 추가(fail-closed). |
| A2 | **loopback-admin이 리버스프록시(127.0.0.1)에서 누설** | 프록시가 XFF를 안 넘기거나 토폴로지 붕괴 시 `request.remote_ip`=loopback → 원격 사용자가 admin. (헤더 스푸핑은 actionpack TRUSTED_PROXIES가 막아 *불가능*하나, **프록시 토폴로지 붕괴 위험**은 실재) `default_user_lookup.rb:15-17` | loopback→admin 폴백을 **명시적 플래그(`ALLOW_LOOPBACK_ADMIN`, 기본 OFF)** 뒤로. 맥 데스크톱에만 ON. `SERVER_MODE`와 분리. |
| A3 | **공유/멀티테넌트 호스트면 동거 프로세스가 admin** | loopback은 IP를 신뢰할 뿐 신원이 아님 → 같은 박스의 다른 컨테이너/프로세스/STT sidecar가 무자격 admin 획득 | A2와 동일 플래그. 백엔드와 **신뢰 안 되는 워크로드(STT sidecar 포함) 동거 금지**, 동거 시 플래그 OFF + STT는 서비스토큰 인증. |
| A4 | **모바일 loopback 브릿지가 TLS 불가** | `reqwest`가 `default-features=false`로 **TLS 피처 미컴파일**("평문 HTTP 전용"), `tokio-tungstenite`도 TLS 없음. https/wss 타깃 지정 시 전 요청 BAD_GATEWAY → **안드로이드 앱 전면 불통**(로그인·회의·실시간). `frontend/src-tauri/Cargo.toml:39-42`, `bridge.rs:159-189` | reqwest `features=["stream","rustls-tls"]`, WS도 rustls TLS 추가. APK 재빌드·재서명·기기검증. 사설 CA면 루트 동봉. 이후 `usesCleartextTraffic=false`. |
| A5 | **DB = SQLite 로컬파일 4개** | 원격 앱서버가 네트워크로 SQLite 파일 공유 불가(NFS+WAL 위험). `DATABASE_URL` 없음. `database.yml:29-44` | 결정: **통째 이전**(SQLite 유지, `DB_PATH`+`-wal/-shm` 포함 4파일 복사) **또는 Postgres 전환**(pg gem, primary/cache/queue/cable URL, 데이터 이관). 멀티 인스턴스/잡 분리 원하면 Postgres 필수. |
| A6 | **요약 기본 LLM = `claude_cli`** | 서버 기본 preset이 로컬 `claude` 바이너리 exec. 원격 Linux엔 바이너리 없음 → 기본설정 사용자 **전원 요약 실패**(`ensure_cli!` raise). `settings.yaml:7`, `llm_service.rb:234-268` | 신호스트 요약 경로 결정: 서버 기본을 **직접 API(anthropic/openai)+토큰**으로 전환 권장. CLI 유지 시 바이너리+인증(HOME 파일)+라이선스 확인. |
| A7 | **CLI 실패가 조용히 삼켜짐 → 요약 영구 정지** | 바이너리 없으면 `refine_notes`가 기존 노트 그대로 반환하고 transcript를 `applied_to_minutes=true`로 마킹 → 그 transcript 영구 제외. UI는 `ok=true`. 진단 어려움. `llm_service.rb:50-53`, `meeting_summarization_job.rb:125-130` | A6를 배포 전 해결(이 경로 안 타게). 추가로 provider-unavailable과 content-failure 구분, LLM 미실행 시 applied 마킹/ok=true 금지. |

### 🟠 높음

| # | 항목 | 요지 | 조치 |
|---|---|---|---|
| A8 | 오디오·첨부가 **DB에 절대경로 문자열** | `meeting.audio_file_path`/`file_path`가 로컬 절대경로. 이전 시 전 행이 깨진 경로 → 재생·다운로드·peaks·duration·regenerate 전부 404. `audio_storage.rb:7-9`, `audio_upload_job.rb:18` | **상대 키 저장**(읽을 때 `AUDIO_DIR`/`ATTACHMENTS_DIR`로 해석) 또는 이전 시 경로 prefix 일괄 rewrite + rsync. `ATTACHMENTS_DIR`은 현재 런처에서 **미주입**(기본폴백) — 명시 필요. |
| A9 | JWT **평문 전송** | `force_ssl`/`assume_ssl` 주석처리 + 모바일 cleartext. 원격이면 토큰·오디오가 WAN 평문. `production.rb:25,28` | 프록시 TLS 종단 + `assume_ssl`/`force_ssl` ON + HSTS. WS 토큰 쿼리스트링 로그 주의. |
| A10 | **CORS**에 원격 origin 없음 | 동일오리진 Caddy면 무탈, **분리배포(SPA≠API)면 전 브라우저 호출 CORS 실패**. `cors.rb:11-23` | 분리배포 시 `CORS_ORIGIN`에 SPA https origin. `*` 금지(Authorization 노출). |
| A11 | **ActionCable origin이 LAN-IP 형태** | DNS 호스트(`https://app.example.com`)는 매칭 안 됨 → **웹 실시간 WS 거부**. 모바일/데스크톱은 tauri.localhost라 무탈. `production.rb:92-100` | `ALLOWED_CABLE_ORIGINS`에 공개 origin 추가. tauri 항목 유지. |
| A12 | **Caddyfile LAN 전용** | 하드코딩 맥IP+mkcert 인증서+로컬 모델경로+`auto_https off`. 원격에서 동작 안 함. | 공개 도메인 블록(Let's Encrypt), 업스트림 교체, `@backend`에 **`/auth/*`·`/cable*` 유지**(빠지면 로그인/WS 404 — 알려진 함정), cohere 모델 4파일 재배치, XFP=https 전달. |
| A13 | **백엔드 base-URL 발견: mDNS 사망** | mDNS 광고자는 **맥 데스크톱 앱**이라 백엔드 이전 시 사라짐 → 모바일/데스크톱앱 "서버 찾기" 무응답. `default_server_url`=하드코딩 LAN IP가 오답 prefill. `lib.rs:938-948` | `config.yaml` `default_server_url`=원격 https로 + 번들 재빌드. 네이티브앱 발견 전략 결정(저장서버 의존 또는 이름기반 레지스트리). |
| A14 | **`settings.yaml` 평문 토큰 이전** | repo 루트 파일에 anthropic/openai 토큰 평문, 런타임 rewrite. 미반입 시 기본 anthropic+nil키 → 401. `settings_controller.rb:11` | 파일 반입(영속 볼륨) 또는 ENV로 대체. 토큰은 비밀로 취급, 이미지에 굽지 말 것. |
| A15 | **per-user `llm_api_key` AR 암호화 → master.key 필요** | production 경로(`app-server.sh:95`)는 `RAILS_MASTER_KEY` 필요. 키 불일치 시 저장된 개인키 **복호화 불가**. `user.rb:19` | 동일 `master.key`/`RAILS_MASTER_KEY` 이전. 컷오버 후 개인키 사용자 복호화 검증. |
| A16 | **신호스트 필수 ENV 세트** | `SERVER_MODE`, `RAILS_MASTER_KEY`, `DB_PATH`/`DATABASE_URL`, `AUDIO_DIR`+`ATTACHMENTS_DIR`, `SIDECAR_*`, `CORS_ORIGIN`, `ALLOWED_CABLE_ORIGINS`, `JOB_CONCURRENCY`, `../settings.yaml` | 프로세스 매니저에 전부 고정(인라인 tmux 금지). |

### 🟡 중간 / ⚪ 낮음
- 🟡 **ffmpeg/ffprobe가 백엔드 호스트 의존**(PCM변환·mp3·peaks·duration) — 신호스트 이미지에 동봉 필요. 또는 미디어 처리를 sidecar로 이관.
- 🟡 `ServerSetup` URL 정규화 **기본 http://+13323** → 원격에 평문 유도(footgun). 비공인 호스트는 https 기본으로.
- 🟡 `config.yaml` base_url/default_server_url 평문 LAN값 → 빌드 전 교체(번들에 구워짐).
- 🟡 ops 함정: 재기동 시 `SERVER_MODE=true` 재공급 필수, **pending 마이그레이션 파일만 추가해도 가동 서버 전 요청 500**. stop→migrate→start 런북.
- ⚪ `config.hosts`(Host 허용) 비활성 → 공개 도메인은 DNS-rebinding 노출. 도메인 allowlist 설정.
- ⚪ ActionCable IP-origin 와일드카드는 공개호스트에서 무의미 → 호스트명 고정(JWT가 실질 게이트).
- ⚪ `apiClient.prefixUrl`은 모듈로드시 고정 → 서버 변경은 기존 reload 경로로(STT선택은 base URL 바꾸지 말 것).

---

## 3. B축 — STT 서버 다중 운영 (자기등록 + 회의 선택)

### 🔴 블로커

| # | 항목 | 무엇이 깨지나 | 필요 조치 |
|---|---|---|---|
| B1 | **`SidecarClient`가 단일 ENV 호스트 하드코딩** | 모든 호출이 `SidecarClient.new`(무인자) → 한 박스로만. 라우팅/풀/레지스트리 전무. `sidecar_client.rb:13-16` | `SidecarClient.for(meeting)`/`.new(stt_server)` 팩토리. 호스트/포트를 회의 바인딩에서 해석. `stt_server_id` nil이면 ENV 폴백. |
| B2 | **stateful diarization → 모든 stateful 호출의 회의 단위 서버 고정 필수** | 화자상태가 sidecar 메모리(meeting_id 키). 실시간 transcribe·파일 transcribe·get/rename/reset speakers가 **서로 다른 서버로 가면** 라벨 분기/소실. Rails에 재구성할 상태 없음 | `meetings.stt_server_id` 도입, **5개 호출지점 전부** 같은 바인딩 경유. 바인딩은 회의 생애 **불변**(리셋 지점 제외). `transcription_job.rb:11`, `file_transcription_job.rb:20`, `speakers_controller.rb:11/20/29` |
| B3 | **`stt_servers` 레지스트리 테이블 없음 + 등록/하트비트/목록 API 없음 + 머신인증 없음** | 사용자 설계(자기등록→회의선택)의 저장소·API·인증이 전무. 원격 sidecar는 loopback도 JWT사용자도 아님. `schema.rb`, `routes.rb` | 마이그레이션+모델 `SttServer`(url/name/engine/status/last_heartbeat_at, 유니크인덱스). `meetings.stt_server_id` FK `ON DELETE SET NULL`. 라우트 `POST register`/`POST :id/heartbeat`/`DELETE :id`/`GET stt_servers`. **서비스 토큰(`STT_REGISTRY_TOKEN`)** 인증(loopback-admin 절대 재사용 금지). stale 서버 reaper 잡. |
| B4 | **`transcribe_file`가 서버-로컬 경로 전달 → 원격 sidecar에서 100% 실패** | Rails가 `_pcm.raw`를 자기 디스크에 쓰고 경로 문자열만 POST. sidecar가 **자기 디스크**에서 `open()`. 단일 동거라서만 동작. 원격/다중이면 파일 없음 → 400 → 잡 리셋. upload_audio·regenerate_stt 전부. `file_transcription_job.rb:70-89`, `sidecar_client.rb:41-49`, `sidecar/app/routers/stt.py:101-106` | **경로 전달 폐기 → 바이트 전송**. 최저비용: 실시간이 쓰는 **base64 계약 재사용**(Ruby에서 PCM 읽어 base64 POST, sidecar는 `/transcribe`처럼 메모리 디코드). 1시간≈115MB raw→~153MB base64 → 본문 한계 상향/청크/gzip. 대안: 공유 객체스토리지(S3) URL. |
| B5 | **화자 클러스터(임베딩 신원)가 sidecar에만, meeting_id 키, Rails 미영속** | transcript엔 `speaker_label` 문자열 스냅샷뿐. 라운드로빈/부하분산하면 서버마다 SPEAKER_00이 다른 사람 → 라벨 무의미·충돌. `transcription_job.rb:28-33`, `schema.rb:212-223` | B2 바인딩으로 동일서버 고정. 또는 화자맵을 Rails에 영속(임베딩/클러스터ID를 sidecar가 노출해야 — 큰 변경). |
| B6 | **화자 이름(rename)도 sidecar에만 → 완료 회의에서 소실(데이터 손실)** | `rename_speaker`는 sidecar로 직행, transcript DB는 영원히 `SPEAKER_00`. 서버 재시작/재배치/다른서버 조회 시 사용자가 붙인 이름 **전부 사라짐**(완료된 회의도). `speakers_controller.rb:17-26`, `SpeakerPanel.tsx:19-30` | `meeting_speakers`(meeting_id, raw_label, display_name) 테이블에 **write-through**. 완료 회의는 Rails에서 이름 읽기. |
| B7 | **STT engine/HF 토큰 쓰기가 한 sidecar로만, fan-out 없음** | 설정 변경이 한 서버만 갱신 → 나머지 N-1은 이전 engine/토큰. 다른 서버로 라우팅된 회의는 다른 모델/HF누락(화자분리 소실). UI는 200이라 성공으로 보임. `settings_controller.rb:36,149` | 레지스트리 기반 **fan-out**(전 서버 PUT, 부분실패 보고) 또는 등록 핸드셰이크 시 중앙설정 push. engine/HF는 **서버별 설정**으로. |
| B8 | **`available_engines`가 호스트별(패키지+캐시모델+CUDA) → 전역 engine 선택 무효** | 맥(MLX)·Linux(CUDA) sidecar의 engine 카탈로그 다름. 전역값이 한쪽에서 422. 같은 id라도 양자화/런타임 상이 → 결과 품질 다름. `sidecar/app/engines.py:31-67`, `health.py:47-51` | engine **서버별 저장**(등록 시 캡처). 선택은 회의/서버그룹 단위, 가능한 engine 교집합으로 제약. 422를 "이 호스트 미지원"으로 1급 처리. |

### 🟠 높음

| # | 항목 | 요지 | 조치 |
|---|---|---|---|
| B9 | **중간 사망 시 페일오버 불가(설계상)** | 바인딩 서버가 회의 중 죽으면 다른 서버는 화자상태 0 → diarization 영구 깨짐. `TranscriptionJob`은 SidecarError를 **조용히 로그만**. `transcription_job.rb:55-57` | **명시적 한계로 문서화**. 헬스체크로 (1)바인딩 시 offline 제외 (2)반복실패 시 degraded를 ActionCable로 통지. 수동 재실행=새서버 재바인딩(이전 연속성 포기). |
| B10 | **실시간↔파일 재전사 일관성 + transcribe_file 재클러스터링** | `regenerate_stt`는 처음부터 재diarize → 실시간 라벨/이름과 불일치, 원서버 보장도 없음. `meetings_controller.rb:221-235` | 파일잡도 바인딩 서버로. regenerate=명시적 relabel 작업으로 정의(이름은 Rails 영속이 근본해결). |
| B11 | **설정 타깃과 전사 타깃이 조용히 달라짐** | 설정은 ENV기본 호스트로 PUT, 회의는 선택 호스트로 전사 → 관리자가 엉뚱한 sidecar를 튜닝. `transcription_job.rb:11-17` | 선택 서버를 잡→SidecarClient까지 전달. 설정 표시를 서버 스코프로. |
| B12 | **engine/HF가 sidecar 프로세스 메모리 + 모델리로드, 중앙상태 없음** | 재시작/스케일 이벤트마다 drift, fleet 일괄변경=N회 순차 리로드. `health.py:56-82` | 등록 핸드셰이크가 중앙 engine/HF/diarization 설정을 idempotent push. 권위설정을 DB로(이전 후 settings.yaml은 sidecar와 비동거). |
| B13 | **클라이언트에 회의별 STT 서버 선택 상태가 전무**(신규 기능면) | Meeting 타입·생성/수정 다이얼로그·스토어에 stt_server 없음. 레지스트리가 UI에서 도달 불가. `api/meetings.ts:38-65` | `GET stt_servers` API + Meeting에 `stt_server_id` + **CreateMeetingModal**에 선택 UI(생성시 1회 고정), EditMeetingDialog는 미시작만 변경 가능(transcript 있으면 disable), 녹음중 read-only 표시. |
| B14 | **`file_transcription` 큐에 워커 없음(기존 잠복 버그)** | `queue.yml`은 real_time/summarization/default만. 오프라인 파일 STT 잡이 **영영 미처리**. `file_transcription_job.rb:2`, `queue.yml` | `file_transcription` 워커 추가(또는 기존 큐 사용). 스케일아웃 시 워커수=STT서버수에 맞춤. |
| B15 | **Rails 잡/웹 풀이 새 병목** | real_time=5스레드×`JOB_CONCURRENCY`(기본1)=동시 5. `SOLID_QUEUE_IN_PUMA`로 웹과 경합. N>5면 STT N대 깔아도 5로 캡. `queue.yml:7-10` | `real_time` 스레드/`JOB_CONCURRENCY` 상향(동시≥서버수), DB 풀 동반 상향. 잡을 전용 워커 호스트로 분리. SQLite 단일writer 경합 → Postgres 논거. |

### 🟡 중간
- 🟡 `SidecarClient` 생성자 변경이 **모든 테스트 스텁 파손**(settings/transcription/file specs) → 팩토리로 갱신 + SttServer/등록/reaper 신규 spec.
- 🟡 **선택 시맨틱 미정**: 사용자 명시 선택 vs 자동 부하분산? create/upload에 `stt_server_id` 파라미터 없음 → 결정 필요(아래 §6).
- 🟡 `reset_speakers`/`reset_content`/`RecordingLock`이 단일-sidecar 전제 → 풀에서 정확한 서버로 정리·재바인딩.
- 🟡 `stt_server_id` FK는 **nullable + ON DELETE SET NULL** + ENV 폴백(등록해제·legacy 안전).
- 🟡 STT 선택을 **on-device ModelManager/UserSttSettings와 혼동 금지**(다른 축·플랫폼·영속성). 회의 스코프 유지, per-device localStorage/전역패널에 넣지 말 것.

---

## 4. 교차 블로커 (양 축 공통)

**`transcribe_file` 공유디스크 가정** 이 단연 1순위. A축(백엔드가 sidecar와 비동거)·B축(원격/다중 sidecar) **둘 다** 이걸 깬다. 실시간 경로(base64 인라인)는 안전 → **이 계약을 파일 경로에도 이식**하면 두 축 동시 해소. (B4 = A 다수 발견 = db-deploy 발견이 모두 같은 지점을 가리킴.)

---

## 5. 권장 구현 순서

1. **인증 안전화 (A1·A2·A3)** — `SERVER_MODE` fail-closed, loopback-admin을 명시 플래그(기본 OFF)로. *원격 이전 전 최우선, 보안.*
2. **오디오 바이트 전송 (B4/교차)** — `transcribe_file`를 base64/멀티파트로. 실시간 base64 계약 재사용. → A·B 동시 해소·sidecar 디스크 의존 제거.
3. **저장/DB 이전 결정 (A5·A8)** — SQLite 통째 이전 vs Postgres / 경로를 상대키화. `master.key`·`settings.yaml`(A14·A15) 동반.
4. **STT 레지스트리 (B1·B2·B3)** — `stt_servers` + `meetings.stt_server_id` + 등록/하트비트/목록 + 서비스토큰. `SidecarClient.for(meeting)`.
5. **화자상태 영속 (B5·B6)** — 최소 이름 write-through, 가능하면 화자맵. affinity·페일오버 한계 문서화(B9).
6. **fleet 설정 (B7·B8·B12)** — engine/HF 서버별 + 등록 시 중앙설정 push.
7. **요약 LLM 포팅 (A6·A7)** — 서버 기본을 직접 API로.
8. **TLS/네트워크 (A4·A9·A12·A13)** — 모바일 브릿지 TLS, Caddy 공개도메인, force_ssl, 발견 경로. *모바일 쓰면 A4는 사실상 블로커.*
9. **큐/동시성 (B14·B15)** — file_transcription 워커, real_time 동시성·잡 분리.
10. **클라이언트 선택 UI (B13)** — 마지막(백엔드 API 선행 필요).

---

## 6. 제품/설계 결정 필요 (사용자 확인)

- **STT 서버 선택 = 사용자 명시 선택인가, 서버 자동 배정인가?** (둘 다 `meetings.stt_server_id`에 저장하지만 기본동작/UI가 달라짐. 미지정 시 자동 first-online/least-loaded 폴백 권장.)
- **이기종 fleet 정책**: 회의를 필요한 engine 보유 서버에 핀(affinity) vs engine id 정규화(어디서나 같은 모델).
- **DB**: 통째 이전(SQLite) vs Postgres 전환. (멀티 인스턴스/잡호스트 분리 의향이면 Postgres.)
- **모바일 지원 유지 여부** → 유지면 브릿지 TLS(A4)는 필수 선행.
- **공인 CA vs 사설 CA** (사설이면 앱에 루트 동봉).

---

## 7. 발견된 기존 버그 (이전과 무관, 지금도 영향)

- 🟠 **`file_transcription` 큐 워커 부재** → 오프라인 파일 STT 잡 production 미처리(B14).
- 🟠 **CLI 미존재 시 요약 실패가 삼켜지며 transcript를 applied로 마킹** → 요약 조용히 정지(A7).
- 🟡 `ATTACHMENTS_DIR`가 런처에서 미주입 → 기본폴백 경로로 조용히 저장(A8).

---

*근거: 9개 서브시스템 병렬 코드분석 55건. 각 항목 file:line은 분석 원본(task `wav6p9fmv` 출력)에 보존.*
