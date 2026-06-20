# 폴더/프로젝트 챗 의미검색(임베딩) 설계

- 날짜: 2026-06-19
- 브랜치: `feat/folder-chat-embedding`
- 관련 메모리: `project_folder_chat_embedding_research`, `project_folder_chat_investigation`, `project_summary_chat_citation`, `project_refactor_roadmap`(#12 Postgres)
- 상태: 설계 승인 → spec 검토 대기

## 1. 목적 / 배경

폴더/프로젝트 챗("폴더에게 묻기"·"프로젝트에게 묻기")의 retrieval은 현재 FTS5 키워드 검색뿐이다(`FolderChatContext#excerpts_block`, `transcripts_fts MATCH ... ORDER BY rank LIMIT 40`). 한계:

- 단어가 안 겹치면 누락(동의어·표현차 못 잡음).
- LLM 키워드 추출이 0건이면 발췌가 통째로 빈다.

→ **의미검색(임베딩)을 추가하고 FTS와 하이브리드로 융합**한다. FTS는 버리지 않는다(오탈자·고유명사 안전망).

### 비목표 (v1 제외)

- 리랭커(cross-encoder) — Phase 3 / GPU 서버 이후로 미룸.
- 2~4문장 재청킹 — v1은 전사 행 단위.
- sqlite-vec / pgvector — 현 규모엔 브루트포스. 스케일 시 pgvector(아래 §9).
- fp16 저장·인메모리 캐시 — 최적화로 미룸.

## 2. 확정된 핵심 결정 (브레인스토밍 기록)

| 결정 | 값 | 근거 |
|------|-----|------|
| 임베딩 모델 | **KURE-v1** (`nlpai-lab/KURE-v1`, MIT, 1024dim, 프리픽스 불필요) | 메모리 확정. bge-m3 한국어 자식. |
| 런타임 | **PyTorch + `transformers` AutoModel** (sentence-transformers 미사용) | ✅ 실측: sidecar `.venv`에 **torch 2.11.0 + transformers 5.3.0 + huggingface_hub 1.7.2 이미 공존·동작 중**(mlx와 충돌 없음). ST 미사용으로 `transformers<5` 다운그레이드 리스크도 무관 → AutoModel 직접 로드(CLS pool + L2 norm). ⚠️ torch가 `uv.lock`엔 없음(pip 직접설치 추정) → 재현 배포 위해 pyproject 선언 필요(Nvidia=CUDA 빌드). |
| device | **자동감지(`cuda`>`cpu`)**, 기본 CPU | Mac 현재 CPU(안정), Nvidia 서버 이전 시 CUDA 자동(코드변경 0). MPS는 XLM-R서 불안정 → 옵션. |
| 청킹 | **전사 행 단위**(발화 1개 = 벡터 1개) | FTS와 동일 `source_id` 미러, ts·화자 보유 → 인용 점프와 1:1. |
| 벡터 스토어 | **plain BLOB 테이블 + 브루트포스 exact cosine** | 24k행 규모에선 ANN 불필요. matmul 수십ms, auth 필터 FTS와 동일, load_extension 게이트 제거. |
| 검색 위치 | **Rails 측 `numo-narray`** | auth 경계(`accessible_by`)를 Rails 한 곳에 둠. sidecar는 stateless 임베딩 서비스. |
| 융합 | **RRF**(Reciprocal Rank Fusion, k=60) | 튜닝 불필요, 스케일 무관. FTS랭크 + 벡터랭크 결합. |
| 인가 | **FTS·벡터 동일 `meeting_ids = scope ∩ accessible_by(user)` 필터** | privilege escalation 방지(하드 요구). |

## 3. 아키텍처

```
질문 ─┬─ FTS5 (기존, 키워드)  → 랭크 리스트 A ─┐
      └─ 벡터검색 (신규, 의미) → 랭크 리스트 B ─┴─ RRF 융합 → top-N 발췌 → LLM
                  │
   sidecar POST /embed (KURE-v1, torch, stateless) ←── 질문 1건 임베딩 (쿼리시)
                  ↑                                      └── 전사 배치 임베딩 (색인시)
   transcript_embeddings (plain BLOB 테이블, 확장 없음)
                  ↑ Transcript after_commit → 비동기 EmbedJob (content dirty-check)
```

**불변 코어**(스케일 가도 유지): 임베딩 생성·동기화·BLOB 저장·RRF 융합·auth.
**교체 가능**(스케일 시): 검색 구현(`VectorIndex`) — 브루트포스 → pgvector.

## 4. 컴포넌트

### 4.1 sidecar `POST /embed` (신규 라우터)

- 입력: `{ "texts": ["...", ...] }`
- 출력: `{ "embeddings": [[float×1024], ...], "model": "kure-v1", "dim": 1024 }`
- 모델: KURE-v1을 `transformers` `AutoModel`/`AutoTokenizer`로 로드. **풀링 = CLS 토큰(`last_hidden_state[:, 0]`) + L2 정규화**(BGE-M3 계열). ⚠️ Phase 0에서 모델 `modules.json`/`1_Pooling` 설정으로 CLS 여부 확정.
- device: `cuda` 가용 시 cuda, 아니면 cpu(기본). `test_device.py` 패턴 재사용.
- **lazy load**: 최초 `/embed` 호출 시 로드 후 유지(미사용 시 RAM 0). STT 모델과 별도 ~1.1GB resident.
- 동시성: 추론은 `app.state.gpu_lock`(또는 전용 model lock) 하에서 직렬화 — STT의 Metal/스레드 충돌 방지.
- 배치: `texts` 리스트를 토크나이저 패딩 후 1배치 추론.

### 4.2 `transcript_embeddings` 테이블 (마이그레이션)

```
transcript_id  : integer, NOT NULL, unique, FK→transcripts (인덱스)
meeting_id     : integer, NOT NULL, 인덱스  (auth/스코프 필터용)
model_version  : string,  NOT NULL          (예: "kure-v1")
dim            : integer, NOT NULL          (1024)
embedding      : blob,    NOT NULL          (fp32 little-endian, dim×4 bytes)
created_at / updated_at
```

- `transcript_id` unique → upsert. `meeting_id` 비정규화(전사 join 없이 스코프 필터).
- ⚠️ FK는 `ON DELETE CASCADE` 지정하되 [[reference_sqlite_fk_cascade_migration_wipe]] 함정 주의 — 새 테이블 생성이므로 재생성 위험 없음, 그래도 마이그 검증 시 자식 count 확인.

### 4.3 `SidecarClient#embed(texts)`

- 기존 `SidecarClient`(Net::HTTP, `SIDECAR_PORT` 13324)에 `embed` 메서드 추가. `POST /embed`.
- 타임아웃: 배치 크기 고려, 기본 `TIMEOUT`(30s)보다 길게(예: `SIDECAR_EMBED_TIMEOUT`).

### 4.4 `Embeddable` concern (`FtsIndexable` 미러)

- `after_save_commit`(또는 `after_commit on: [:create, :update]`)에서 **`saved_change_to_content?`일 때만** `EmbedTranscriptJob.perform_later(id)` enqueue.
- FTS는 매 저장 blind upsert(싸니까)지만 임베딩은 비싸므로 **content 변경시만**.
- `Transcript`에 `include Embeddable` + 임베딩 대상 컬럼 = `content`.

### 4.5 `EmbedTranscriptJob(transcript_id)`

- 해당 전사 1건 로드 → content 빈값이면 skip → sidecar `/embed`로 임베딩 → fp32 pack → `transcript_embeddings` upsert(`model_version = MODEL_VERSION`).
- 실패(sidecar 다운/타임아웃) → ActiveJob 재시도. FTS는 fresh라 검색 graceful 저하.
- ⚠️ 라이브 STT는 발화당 행 생성 → 잡 다수. v1 허용. 큐 압박 시 회의 단위 coalesce(최적화).

### 4.6 `EmbedBackfillJob` / rake (`embeddings:backfill`)

- `transcript_embeddings`에 없거나 `model_version != MODEL_VERSION`인 전사를 배치(예 64건)로 임베딩→upsert.
- **재실행 가능(idempotent)** — 1회성 스크립트 금지. 중단 후 재실행하면 남은 것만.
- 기존 24k 전사 초기 적재 + 모델 교체 시 재임베딩 둘 다 이 잡으로.

### 4.7 `TranscriptVectorSearch` (= `VectorIndex` 추상화)

- `search(query_text:, meeting_ids:, limit:)` → `[{transcript_id:, score:}]`(score 내림차순).
- 흐름: 질문 → `SidecarClient#embed([query])` → 질문 벡터 → `SELECT transcript_id, embedding FROM transcript_embeddings WHERE meeting_id IN (meeting_ids) AND model_version = MODEL_VERSION` → BLOB unpack → `Numo::SFloat` 행렬 · 질문벡터 = 코사인(정규화됐으니 dot) → top-`limit` argsort.
- `meeting_ids` 빈배열이면 즉시 `[]`.
- sidecar 실패 시 예외 → 호출측(FolderChatContext)이 빈배열 폴백.
- 인터페이스를 service 객체로 고정 → 추후 pgvector 구현 교체.

### 4.8 `FolderChatContext` 수정 (`excerpts_block` 하이브리드화)

- 현 `excerpts_block`(FTS only)을 다음으로 교체:
  1. **FTS 랭크**: 기존 `transcripts_fts MATCH` → `[transcript_id, ...]` 순위(상위 `TOP_K`).
  2. **벡터 랭크**: `TranscriptVectorSearch.search(query_text:, meeting_ids:, limit: TOP_K)` → `[transcript_id, ...]` 순위.
  3. **RRF 융합**: `score(t) = Σ_lists 1/(60 + rank_list(t))` → 내림차순 상위 `TOP_K`.
  4. 융합 결과 transcript_id들로 발췌 블록 구성(회의ID·ts·화자·텍스트). 텍스트 = FTS snippet 있으면 그것, 없으면 `transcript.content` ~160자 절단.
- **질문 원문**이 필요 → `build`에 `query_text:` 추가 인자(또는 `FolderChatJob`에서 질문 전달). 키워드는 FTS용으로 유지.
- 둘 다 동일 `meeting_ids`(이미 `accessible_by`) 사용 — 인가 누출 불가.
- 벡터/sidecar 실패 → 리스트 B 비고 → 융합 = FTS-only(기존 동작). 챗 안 막힘.

## 5. 데이터 흐름

**색인**: `Transcript#save`(content 변경) → `after_commit` → `EmbedTranscriptJob` → `/embed` → fp32 pack → `transcript_embeddings` upsert.

**쿼리**(`FolderChatJob`): 질문 → 키워드 추출(기존) → `FolderChatContext.build(query_text:, keywords:, ...)` → [FTS 랭크] + [벡터 랭크] → RRF → 발췌 → LLM → 답변.

## 6. 인가 (하드 요구)

`meeting_ids = (scope 후보) ∩ Meeting.accessible_by(user)` — 기존 로직 그대로. **FTS·벡터 두 경로 모두** 이 집합으로 필터(`WHERE meeting_id IN (...)`). 벡터 후보 로드 SQL에도 반드시 포함. 테스트로 타인 비공유 회의 발췌 미노출 검증(privilege escalation 회귀 테스트).

## 7. 에러 처리

| 지점 | 실패 | 처리 |
|------|------|------|
| 색인 | sidecar 다운/타임아웃 | ActiveJob 재시도. FTS fresh → 검색 graceful 저하 |
| 색인 | content 빈값 | skip |
| 쿼리 | sidecar/벡터 실패 | 벡터 랭크 빈배열 → 융합 FTS-only 폴백. 챗 정상 |
| 쿼리 | 키워드 0건 | FTS 빈배열, **벡터가 커버**(현재 대비 개선) |
| 백필 | 중단 | 재실행 시 남은 것만(idempotent) |

## 8. 모델 교체 / 버전 관리

- `MODEL_VERSION` 상수(예: `"kure-v1"`) — 잡·검색·백필이 공유.
- 교체: 상수 갱신 → `embeddings:backfill` 재실행(같은 테이블에 새 버전 덮어씀) → 검색은 `model_version = MODEL_VERSION`만 매칭.
- 백필 중 미변환 행은 검색서 제외 → FTS가 커버 → **다운타임 0**.
- 메모리의 "테이블 스왑"은 과함 — `model_version` 컬럼으로 충분(advisor 동의).

## 9. 스케일 로드맵 (미래, idea.md §8 기록)

- 현 ~24k행: 브루트포스가 더 빠르고·exact·단순.
- 10x(~240k): 여전히 브루트포스. 쿼리 로드 느려지면 벡터 매트릭스 RAM 상주로 한 단계.
- 수십만~수백만 / 상용화(중앙 멀티유저 서버, Nvidia GPU): **PostgreSQL + pgvector(HNSW + `meeting_id` 필터)** 로 `VectorIndex` 구현 교체. 임베딩 BLOB은 모델 동일 시 재임베딩 없이 재인덱싱. PyTorch 런타임은 `device=cuda`로 그대로. `project_refactor_roadmap` #12와 연계.
- **sqlite-vec는 건너뜀**(지금 무겁고 스케일 가선 pgvector한테 밀리는 중간 단계).
- 리랭커(`bge-reranker-v2-m3-ko`)도 GPU 서버 이후 Phase 3.

## 10. 테스트 (TDD)

- **sidecar `/embed`**: 1024-dim 반환, L2 정규화(self-cosine ≈ 1), 배치 길이 일치, 빈 입력 처리.
- **Rails(결정적 stub 임베딩으로 — 테스트서 KURE 미로드)**:
  - `EmbedTranscriptJob`: upsert 동작, content 빈값 skip, dirty-check(content 미변경 시 enqueue 안 됨).
  - `EmbedBackfillJob`: idempotent(2회 실행 동일 결과), `model_version` 불일치만 재처리.
  - `TranscriptVectorSearch`: fixture 벡터로 코사인 순서 정확, `meeting_ids` 필터, 빈 입력.
  - **인가 회귀**: 타인 비공유 회의 전사가 벡터 검색·발췌에 미노출.
  - **RRF 융합**: FTS·벡터 랭크 합성 순서 정확.
  - **폴백**: sidecar 예외 시 FTS-only 발췌 반환(예외 전파 안 함).

## 11. 단계 / PoC 게이트

- **Phase 0 (게이트) — ✅ 2026-06-19 전부 PASS (`/tmp/kure_poc.py`)**:
  1. ✅ torch 2.11.0 + transformers 5.3.0 + mlx 공존 실측(충돌 없음). 남은 작업 = pyproject에 torch 정식 선언(재현 배포·Nvidia CUDA).
  2. ✅ KURE-v1 다운(2.1GB, snapshot `d14c8a9…`) → `AutoModel` 로드. **풀링 = CLS**(`1_Pooling/config.json pooling_mode_cls_token:true`, modules=Transformer→Pooling→Normalize) + L2 norm. dim 1024, self-cosine 1.0.
  3. ✅ 의미검색 sanity: 단어 거의 안 겹치는 유사문장 0.856 vs 무관문장 0.38.
  4. ✅ `numo-narray` 0.9.2.1 Ruby 4.0.2/arm64 네이티브 빌드 + matmul OK. BLOB `e*`(fp32 LE) pack/unpack roundtrip 정확.
  - 결론: 설계 수정 불요. 런타임·풀링·저장·검색 전 가정 실증 완료.
- **Phase 1**: 마이그(`transcript_embeddings`) + sidecar `/embed` + `SidecarClient#embed` + `Embeddable`/`EmbedTranscriptJob` + `EmbedBackfillJob`/rake. 기존 24k 백필.
- **Phase 2**: `TranscriptVectorSearch` + `FolderChatContext` 하이브리드 RRF + 인가·폴백 테스트.
- **Phase 3 (defer/YAGNI)**: 리랭커, fp16 저장, 인메모리 캐시, 회의단위 잡 coalesce.

## 12. 미해결 / 검증 필요

- ✅ KURE 풀링 = CLS 확정(Phase 0 실측).
- ✅ torch×transformers×mlx 공존 — 실측 해소(torch 2.11.0 venv 상주). 단 `uv.lock` 미선언 → pyproject 정식 선언 필요(재현/Nvidia CUDA 빌드).
- ✅ `numo-narray` 0.9.2.1 Mac arm64 빌드 OK. 향후 Linux 서버 빌드는 배포 시 재확인.
- 라이브 STT 고볼륨 시 잡 수 — v1 허용, 압박 시 coalesce.
- 백필 24k 소요 시간 실측(CPU) — 허용 범위 확인.

## 13. 구현 결과(2026-06-19)

### 구현된 컴포넌트

**Sidecar (Python):**
- `sidecar/app/embeddings/__init__.py` — 모듈 패키지
- `sidecar/app/embeddings/encoder.py` — `pool_cls_normalize` + `KureEncoder`(lazy load, encode)
- `sidecar/app/routers/embeddings.py` — `POST /embed` 라우터(asyncio.Lock 직렬화)
- `sidecar/app/schemas.py` — `EmbedRequest`, `EmbedResponse` 스키마 추가
- `sidecar/app/config.py` — `EMBED_MODEL`, `EMBED_MODEL_VERSION`, `EMBED_DEVICE` 설정 추가
- `sidecar/app/main.py` — lifespan에 `app.state.embedder`/`embed_lock` 초기화, 라우터 등록
- `sidecar/pyproject.toml` — `torch>=2.4` 정식 선언 (Task 12)
- Tests: `tests/test_embeddings_pool.py`(2), `tests/test_embeddings_router.py`(4)

**Backend (Rails):**
- `backend/Gemfile` — `gem "numo-narray"` 추가
- `backend/db/migrate/20260619000001_create_transcript_embeddings.rb` — 마이그레이션
- `backend/app/models/transcript_embedding.rb` — BLOB 저장 모델(pack/unpack, vector)
- `backend/app/models/concerns/embeddable.rb` — content dirty-check after_commit 콜백
- `backend/app/models/transcript.rb` — `include Embeddable` 추가
- `backend/app/services/sidecar_client.rb` — `#embed` 메서드 추가
- `backend/app/jobs/embed_transcript_job.rb` — 단건 임베딩 upsert 잡
- `backend/app/jobs/embed_backfill_job.rb` — 배치 백필 잡(idempotent, 구버전 재처리)
- `backend/lib/tasks/embeddings.rake` — `embeddings:backfill` rake
- `backend/app/services/transcript_vector_search.rb` — numo-narray 브루트포스 cosine(인가 필터)
- `backend/app/services/folder_chat_context.rb` — 하이브리드 FTS+벡터 RRF(graceful fallback)
- `backend/app/jobs/folder_chat_job.rb` — `query_text` 전달 추가
- Tests: 7개 스펙 파일(transcript_embedding, transcript_embeddable, sidecar_client_embed, embed_transcript_job, embed_backfill_job, transcript_vector_search, folder_chat_context_hybrid)

### 자동 선택된 설계값

| 항목 | 값 | 결정 근거 |
|------|-----|---------|
| `RRF_K` | 60 | 표준값(Cormack 2009), TREC 검증된 default |
| `EXCERPT_LEN` | 160 | 벡터 전용 히트의 본문 절단 길이(snippet 없을 때) |
| `torch` 핀 | `>=2.4` | uv lock 해소 = 2.12.1, venv 상주 = 2.11.0. transformers 5.3.0 유지 확인 |
| `MODEL_VERSION` | `kure-v1` | Phase 0 확정. 상수 `TranscriptEmbedding::MODEL_VERSION` |
| 풀링 | CLS + L2 normalize | Phase 0 실측: self-cosine 1.0, sim_sim 0.856 > sim_un 0.38 |
| 저장 | fp32 LE BLOB (`e*`) | roundtrip 정확성 검증, 향후 fp16 최적화 가능 |

### mlx 공존 검증

```
coexist OK 5.3.0 2.11.0
```
(mlx_lm + mlx_audio + transformers 5.3.0 + torch 2.11.0 동시 import 성공)

### 전체 테스트 결과

- **Backend (RSpec)**: **1153 passed, 0 failed** (임베딩 신규 스펙 전부 포함, 회귀 0).
- **Sidecar (pytest)**: 131 passed, 24 failed(모두 pre-existing — SpeakerDiarizer import error·MLX Stream GPU error). 임베딩 신규 6 tests 전부 통과.
- 사전존재 sidecar 실패: `test_speaker_diarization`(13), `test_ws_transcribe`(9), `test_speakers_router`(2) — main 동일 버그, 이번 구현과 무관.

### 백필 결과

sidecar 기동 확인됨(health 200) 하지만 `/embed` 라우터가 없는 **구버전**으로 동작 중(404 반환). 백필은 sidecar 재시작 후 `bundle exec rails embeddings:backfill` 재실행 필요.
- sidecar 재시작: tmux에서 sidecar 프로세스 kill 후 `cd sidecar && uv run uvicorn app.main:app --port 13324 ...`
- 또는 `dev.sh` 재실행으로 전체 스택 재시작

### 잔여 작업

- sidecar 재시작 → `bundle exec rails embeddings:backfill` 실행(24k건 백필, CPU 소요 시간 실측)
- 수동 E2E: 폴더 챗에서 동의어 쿼리 → 의미 히트 발췌 확인
- `feat/folder-chat-embedding` → `main` 머지(사용자 명시 후)
