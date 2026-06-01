# 모바일 무료 LLM 회의록 요약 — 조사 레포트

- 작성일: 2026-05-29
- 대상: 또박또박(ddobakddobak) — 폰에서 회의록을 LLM으로 요약하는 무료 방법
- 범위: ① 클라우드 무료 모델 ② 온디바이스 "Gemini 2B"(=Gemma) 양자화 모델
- 방법: 3개 멀티에이전트 워크플로우(웹 검증 + 어댑테이션) 결과를 종합. 사실값은 2026-05 기준이며 무료티어/모델 사양은 변동이 빠르므로 **커밋 전 재확인** 필요.

> ⚠️ 사실 신뢰도: 사내 코드 사실(파일/라인/아키텍처)은 직접 검증됨. 외부 모델·무료티어·llama.cpp PR 번호 등 2026-01 학습 컷오프 이후 정보는 워크플로우 웹리서치 기반(독립 재검증 권장). 본문에 신뢰도 표기.

---

## 0. TL;DR

| 질문 | 답 |
|---|---|
| **무료 클라우드 최선** | **Groq** (Data Controls에서 **ZDR**=Zero Data Retention 켜기). `openai` provider + `base_url`만 바꾸면 됨 → **코드 0, config만**. 무학습. Cerebras/Cloudflare Workers AI 동일 대안. |
| **피해야 할 클라우드** | Gemini free / Mistral free(opt-out 안하면) / SambaNova — **사용자 데이터로 학습**. 민감 회의록엔 부적합. |
| **"Gemini 2b 모델"의 정체** | Google엔 "Gemini 2B"란 모델 없음. 실제로는 **Gemma 4 E2B**(오픈웨이트, ~2026-04) 또는 **Gemma 3n E2B**. "E2B"=유효 2B지만 raw ~5B, **Q4 GGUF ≈ 3GB**(이름이 용량을 속임). Gemini Nano는 독점·GGUF 없음·Tauri 탑재 불가. |
| **온디바이스 최선** | **Gemma 3 4B-it QAT Q4_0** (8GB+ 폰, ~3.16GB) / **Qwen2.5-1.5B-it Q5_K_M** (6GB 폰, ~1.3GB). 둘 다 상업 라이선스 OK. |
| **양자화 핵심** | **QAT > PTQ**. Gemma 3는 QAT Q4_0 GGUF 제공 → 4bit 크기에 bf16급 품질. PTQ만 있는 모델은 한국어 1~4B에서 **Q5_K_M이 하한**(generic Q4_K_M 기본값 금지, Q3/Q2 금지). |
| **인프라 경로** | 사내 선례 그대로 **llama.cpp + GGUF 직접 Rust FFI**(자매앱 ondevice-stt, build 9380). MediaPipe/LiteRT Kotlin 플러그인 **불필요**. |

---

## 1. 배경 — 현재 또박또박 구조

- 요약은 **100% 서버사이드** (`backend/app/services/llm_service.rb`).
  - 지원 provider: `anthropic`, `openai`(+ `base_url` override → **모든 OpenAI 호환 엔드포인트**), `claude_cli`, `gemini_cli`(=Google Antigravity `agy`), `codex_cli`(데스크톱 Open3 실행).
  - 사용자별 LLM config 컬럼: `provider`, `auth_token`(암호화), `model`, `base_url`. → **새 OpenAI 호환 엔드포인트로 바꾸는 건 config만, 코드 0.** (`resolve_config` llm_service.rb:144, `uri_base` :175)
- 모바일은 **loopback 브릿지 + mDNS**로 데스크톱 백엔드 접속. 폰은 평소 LLM을 직접 안 부르고 서버 요약을 트리거함. → **이 경로는 폰이 데스크톱 LAN을 벗어나면 죽음.**
- 실시간 요약 = 5분 cron, **증분 `refine_notes`**(누적 노트 + 새 청크). → 긴 트랜스크립트도 청킹되므로 **작은 컨텍스트 창 허용**.
- `build_prompt()`(:107): LLM 호출 없이 붙여넣기용 프롬프트만 조립. `export_prompt` 엔드포인트(meetings_controller.rb:362)도 있고 프론트(`meetings.ts:296`)에서 이미 fetch 중.
- 온디바이스 선례: 자매앱 `/Users/jji/project/ondevice-stt`가 이미 **llama.cpp 직접 Rust FFI**(homebrew libmtmd build 9380) 보유. 다음 단계는 cargo-ndk 안드로이드 포팅(BINDING.md에 명시·보류). STT는 Qwen3-ASR-0.6B POC로 이미 해결됨.

---

## 2. 호출 위치 4축 (전체 방법 구조)

요약을 **어디서 호출하느냐**가 핵심 축이다.

1. **서버사이드** (폰→브릿지→Rails→LLM) — 현 경로. **묶임**(데스크톱 LAN 필요).
2. **폰 다이렉트 클라우드** (폰이 클라우드 LLM 직접 호출) — **독립**(폰 인터넷만), off-LAN 생존.
3. **온디바이스** (폰 안에서 LLM 실행) — **완전 오프라인**, 최강 프라이버시.
4. **폰 네이티브 앱/OS** (공유시트로 사용자 앱에 넘김) — $0, 사용자 자기 할당량.

---

## 3. 클라우드 무료 모델

### 3.1 OpenAI 호환 무료 엔드포인트 (서버사이드, config만)

| Provider | 무료 | 데이터 학습 | 컨텍스트 | ddobak 델타 |
|---|---|---|---|---|
| **Groq** | ✅ 카드 불필요 | ❌ 무학습 (ZDR 켜면 임시보존도 제거) | 작음(~6K TPM급) → 증분요약이 흡수 | **config만** |
| **Cerebras** | ✅ | ❌ 무학습(계약상) | 작음(~8K/req) | config만 |
| **Cloudflare Workers AI** | ✅ | ❌ 무학습 | 오픈모델 작음 | config만 |
| Gemini free | ✅ | ⚠️ **학습 + 사람검수 + EU/UK/CH 차단** | **~1M, 한방에**(최고) | config만 |
| Mistral free | ✅ | ⚠️ opt-out 안하면 학습 | 중간 | config만 |
| SambaNova | ✅ | ⚠️ 무학습 보장 없음 | 중간 | config만 |

- **민감 회의록 안전 = Groq(+ZDR) / Cerebras / Cloudflare.**
- Gemini free는 컨텍스트(1M)가 압도적이지만 학습/검수/지역차단으로 민감 회의엔 부적합. 컨텍스트 이득 < 프라이버시 손실.
- 적용 예: `provider=openai`, `base_url=https://api.groq.com/openai/v1`, `auth_token=<무료 Groq키>`, `model=llama-3.3-70b-versatile`.

### 3.2 데스크톱 CLI (기존 구독 재사용, 코드 0)

- `claude_cli`(Claude Pro/Max), `codex_cli`(ChatGPT Plus/Pro), `gemini_cli`=`agy`(맨 무료 구글계정 가능, 프리뷰 주간쿼터 변동).
- "무료" = **이미 구독 보유 시** 한계비용 0. 구독 없으면 무료 아님.
- 함정: ① 2025-09-28부터 소비자 티어 **기본 학습** → 데스크톱 계정에서 opt-out 필요 ② `claude_cli`는 `ANTHROPIC_API_KEY` 떠 있으면 조용히 유료 API 과금 전환 ③ 데스크톱 깨어있고 LAN 도달 가능해야 함.

### 3.3 폰 다이렉트 (off-LAN 폴백)

- 폰(Tauri Rust/reqwest)이 Groq를 직접 호출 → 데스크톱 떠나도 동작.
- 변경: ① `reqwest`에 **`rustls-tls`** 추가 (Cargo.toml:38 현재 `features=["stream"]`=HTTP 전용; native-tls 말고 rustls=안드로이드 안전) ② OpenAI chat POST하는 Tauri 커맨드 ③ Settings 화면 ④ 브릿지 unreachable일 때만 발동.
- **보안: 공유 API 키를 APK에 박지 말 것**(JADX/MobSF로 즉시 추출). 사용자별 키 입력 → **Android keystore에만**.

### 3.4 공유시트 (build_prompt, $0)

- `build_prompt()` 출력을 Android 공유시트(`Intent.ACTION_SEND`, text/plain)로 사용자의 Gemini/ChatGPT/Claude 앱에 넘김 → 사용자 자기 할당량으로 요약. PWA는 `navigator.share`.
- 백엔드 프롬프트 기계는 100% 이미 존재. 모바일 델타 = **버튼 1개 + Tauri 공유 플러그인**.
- 단방향(요약 자동 회수 안 됨). 긴 회의는 앱 붙여넣기 한도 초과 가능 → "최근 청크만" 옵션.

---

## 4. 온디바이스 — "Gemini 2B"의 정체

### 4.1 이름 정리

- **Gemini** = Google 독점 클라우드/API + 온디바이스 **Gemini Nano**.
- **Gemma** = 다운로드 가능한 **오픈웨이트** 패밀리. 폰에서 돌릴 수 있는 "~2B"는 **Gemma**다(Gemini 아님).
- 사용자가 들은 "최신 2B 엣지 모델" = **Gemma 4 E2B**(~2026-04, Apache 2.0) 또는 2025년 전작 **Gemma 3n E2B**.

### 4.2 "E2B" 함정

- **E2B = 유효(active) 2B 파라미터** (Per-Layer Embeddings + MatFormer). **raw 가중치는 ~5B**, Q4 GGUF는 **~2.8~3.2GB on-disk**.
- 즉 "2B" 배지가 용량을 속인다 — 실제로는 **Qwen2.5-3B보다 무겁다**(아래 표). PLE는 연산을 줄이지 토, 로드해야 하는 가중치를 줄이지 않음.

### 4.3 Gemini Nano = 탑재 불가

- 독점, 오픈 웨이트 없음, 독립 GGUF 없음. Android AICore / ML Kit GenAI 안에서만 동작, ~12GB RAM급 특정 플래그십만.
- **Tauri WebView + Rust llama.cpp 사이드카에 탑재 불가** → 스택상 비고려.

---

## 5. 양자화 매트릭스 (용량/RAM/품질)

**핵심: QAT vs PTQ.** "Q4_K_M이 스윗스팟" vs "한국어 1~4B는 Q4에서 붕괴, 하한 Q5_K_M"의 모순은 **PTQ(사후양자화)에서만** 존재. Gemma 3는 **QAT(양자화 인식 학습) Q4_0 GGUF**를 제공 — 4bit로 학습되어 **Q4 크기에 ~bf16 품질**. QAT Q4_0이 작은 사이즈에서 안전한 유일한 Q4.

### 5.1 Q4_K_M (PTQ) 용량/RAM — 2026-05-29 HF API 검증

| 모델 | Q4_K_M 파일 | Q4_K_M 런타임 RAM | 라이선스 |
|---|---|---|---|
| Gemma 3 1B-it | 0.81 GB | ~1.2–1.6 GB | Gemma (상업 OK) |
| Gemma 3 4B-it | 2.49 GB | ~3.0–3.8 GB | Gemma (상업 OK) |
| Gemma 3n E2B-it | **3.03 GB** | ~3.6–4.4 GB (텍스트 전용) | Gemma — **4B보다 큼, MatFormer 이득 0** |
| Qwen2.5-1.5B-it | 1.12 GB (Qwen) / 0.99 GB (bartowski) | ~1.7 GB @8K | **Apache-2.0 (상업 OK)** |
| Qwen2.5-3B-it | 2.10 GB (Qwen) / 1.93 GB (bartowski) | ~2.7 GB @8K | ⚠️ Qwen Research(**비상업 — 차단**) |

> **놀라운 점**: Gemma 3n E2B Q4_K_M(3.03GB) **>** Gemma 3 4B Q4_K_M(2.49GB). 이름이 더 작은 "2B"가 GGUF는 더 크고 RAM도 더 먹는데 텍스트 품질 이득은 없다 — llama.cpp가 full E-superset + PLE 가중치를 저장하고 MatFormer 축소를 못 하기 때문.

### 5.2 권장 QAT Q4_0 (실제 권고가 타는 행)

| 모델 | QAT Q4_0 파일 | QAT Q4_0 런타임 RAM | 대상 |
|---|---|---|---|
| **Gemma 3 4B-it QAT (주력)** | ~3.16 GB | ~4.0–4.8 GB | **8GB+ 폰** |
| Gemma 3 1B-it QAT (저RAM, 품질 약함) | ~1.00 GB | ~1.0–1.6 GB | 6GB+ 폰 |
| **Qwen2.5-1.5B-it Q5_K_M (PTQ 폴백)** | 1.29 GB(Qwen)/1.13 GB(bartowski) | ~1.8 GB @8K | **6GB 폰**, Apache-2.0 |

### 5.3 양자화 하한 규칙

- QAT Q4_0이 있으면 그걸 써라(Gemma 3 1B/4B).
- 없으면(PTQ) 한국어 1~4B 하한 = **Q5_K_M**. generic PTQ Q4_K_M을 한국어 기본값으로 쓰지 말 것. Q3/Q2 금지.
- 일반 품질 사다리: Q8≈무손실, Q6 거의 무손실, Q4_K_M(PTQ)=일반 스윗스팟이지만 소형·한국어엔 위험, Q3 눈에 띄는 손실, Q2 자주 깨짐.

---

## 6. 라이선스 게이트 (의사결정 뒤집은 사실)

- **Qwen2.5-3B = Qwen Research License = 비상업** → 상업 제품 또박또박엔 **차단**(알리바바 별도 상업 라이선스 필요). 품질/RAM은 최고지만 못 씀.
- Qwen2.5 중 Apache-2.0 = **0.5B / 1.5B / 7B / 14B / 32B**. → 폰용 상업 가능은 **1.5B**.
- Gemma 3/3n/4 = Gemma 라이선스(상업 배포 가능).

---

## 7. llama.cpp Gemma 3n 지원 현황 (Kotlin/LiteRT 필요 여부 결정)

- **텍스트 추론: 지원됨** (PR #14400, ~2025-06-26). PLE/AltUp/sparsity가 forward 그래프에 구현됨(PLE는 드롭 안 됨, CPU에 고정). → 요약(텍스트 in/out)엔 충분.
- **MatFormer 탄력 축소: 미지원** → GGUF는 full E2B 가중치 저장(그래서 4B보다 큼).
- **멀티모달(오디오/비전): 미지원**(WIP). 모든 Gemma 3n GGUF는 텍스트 전용.
- **GPU 주의**: Vulkan/CUDA full offload(-ngl 999) 시 깨진 출력 보고 있음. 안드로이드는 CPU/부분 오프로드 → on-device 출력 검증 필요.
- ⚠️ 별개 라인 **Gemma 4 E2B/E4B**는 PLE forward 그래프 미주입 이슈(#22243) 보고 — Gemma 3n과 혼동 금지. PR #14400 텍스트 지원은 **Gemma 3n 한정**.

**결론**: Gemma 3n을 쓸 유일한 이유(MatFormer 축소, 멀티모달)가 정확히 llama.cpp 미지원 항목 → **Gemma 3n 건너뛰고 LiteRT/Kotlin 경로도 같이 건너뜀**. Gemma 3 4B QAT GGUF가 이 용도에선 Gemma 3n E2B GGUF를 완전 압도.

---

## 8. 폰 RAM 티어링

안드로이드 현실: 전체 RAM ≠ 앱당 예산. 6GB 폰 ≈ 포그라운드 앱 3~4GB, 8GB ≈ 5GB. OS 헤드룸 ~2~3GB 차감. 요약은 긴 입력 → KV 캐시 비중 큼(4~8K ctx에서 ~0.3~1.0GB, 16~32K에서 +0.5~1.5GB). KV 캐시 양자화(q8_0 K/V)로 KV 항 약 절반.

| 폰 RAM | 권장 |
|---|---|
| 6GB | **Qwen2.5-1.5B-it Q5_K_M** (~1.8GB, Apache-2.0). Gemma 3 4B QAT은 빠듯/초과. |
| 8GB | **Gemma 3 4B QAT Q4_0** (~4.0~4.8GB, 조심해서 fit). 긴 트랜스크립트엔 KV-quant. |
| 12GB+ | **Gemma 3 4B QAT Q4_0** 무난(긴 컨텍스트 여유). |

사용자 대부분 8GB+면 Gemma 3 4B QAT 단독 주력, 6GB 비중 크면 Qwen-1.5B Q5_K_M 동급 비중.

---

## 9. 다운로드 링크

**주력 (QAT GGUF, Google 공식)**
- Gemma 3 4B QAT Q4_0: https://huggingface.co/google/gemma-3-4b-it-qat-q4_0-gguf
- Gemma 3 1B QAT Q4_0: https://huggingface.co/google/gemma-3-1b-it-qat-q4_0-gguf

**폴백 (Apache-2.0, 상업 OK)**
- Qwen2.5-1.5B-Instruct GGUF: https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF (imatrix alt: bartowski/Qwen2.5-1.5B-Instruct-GGUF)

**PTQ 사다리/비교용**
- Gemma 3 1B: https://huggingface.co/unsloth/gemma-3-1b-it-GGUF (alt: bartowski, lmstudio-community)
- Gemma 3 4B: https://huggingface.co/unsloth/gemma-3-4b-it-GGUF (공식: ggml-org/gemma-3-4b-it-GGUF)
- Gemma 3n E2B(텍스트 전용, 비권장): unsloth/gemma-3n-E2B-it-GGUF

**차단(비상업, 참고용)**
- Qwen2.5-3B-Instruct GGUF: https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF — Qwen Research License.

---

## 10. 권고 & 다음 단계

### 클라우드 (무료, 지금 당장)
1. **Groq + ZDR**을 `openai` provider + `base_url`로 연결 — **코드 0, config만**. 민감 회의 안전. Groq 막히면 Cerebras/Cloudflare.
2. off-LAN 대응이 필요하면: 가장 싼 건 **공유버튼**(build_prompt), 진짜 요약 원하면 **폰 다이렉트 Groq**(reqwest rustls-tls 추가).

### 온디바이스 (작업 필요)
1. **코드 짜기 전 무료 A/B 먼저**: 실제 타깃 폰에 **Google AI Edge Gallery** 설치 → Gemma 3 4B QAT vs Qwen2.5-1.5B에 **실제 한국어 트랜스크립트 청크** 넣고 비교. (영어 perplexity 벤치 신뢰 금지 — 한국어 형태소가 저비트 손실 증폭.)
2. 진짜 비용은 **모델 독립**: llama.cpp의 **cargo-ndk arm64-v8a NDK 크로스빌드**(macOS Homebrew dylib는 포팅 불가, BINDING.md에 보류). 어느 모델이든 이건 지불해야 함.
3. 출시 모델: **8GB+ = Gemma 3 4B QAT Q4_0**, **6GB = Qwen2.5-1.5B Q5_K_M**. 둘 다 상업 OK.
4. **MediaPipe/LiteRT Kotlin 플러그인 채택 금지**(요약 용도엔 불필요). 멀티모달/NPU 필요해질 때만 재검토.

### 묶임 vs 독립 (설계 분기)
- 서버사이드 전부 = 데스크톱 LAN 살아있을 때만. off-LAN 생존 = 폰 다이렉트 / 공유버튼(캐시시) / 온디바이스.
- 설계안: 브릿지 살아있으면 서버 Groq 기본(품질↑, 폰에 키 없음), 죽으면 폰 다이렉트 또는 공유버튼 폴백. 중요 회의는 서버 `LlmService`를 품질 폴백으로 항상 유지.

### 판별자 요약

| 옵션 | 컨텍스트(긴 회의) | 프라이버시 | 독립성 | ddobak 델타 |
|---|---|---|---|---|
| 서버 Groq+ZDR | 작음→청킹(증분이 흡수) | GOOD 무학습 | 묶임 | **config만** |
| 서버 CLI(구독) | 충분 | opt-out해야 안전 | 묶임+데스크톱 awake | config만 |
| 폰 다이렉트 Groq | 작음→청킹 | GOOD(클라우드행, 무학습) | **독립** | new mobile code |
| 공유시트(build_prompt) | 한방은 한도 초과 가능 | 사용자 앱 의존 | 거의 독립 | UI 버튼 1개 |
| 온디바이스 Gemma 3 4B QAT | 작음→청킹 | **최강(폰밖 0)** | **완전 오프라인** | new mobile code(중) |

---

## 부록: 커밋 전 재검증 필요 (post-cutoff)

- llama.cpp Gemma 3n/Gemma 4 PLE forward 그래프 현 상태 (#14400 vs #22243).
- Gemma 4 E2B GGUF 용량·토크나이저/생성 버그 현황.
- 안드로이드 tokens/sec(CPU ~4~8, GPU/NPU 30~80) — 기기 미검증, 신뢰도 낮음.
- 무료티어 RPM/TPM/RPD 정확 수치 — 변동 빠름, 의존 전 재확인.
- 한국어 품질: Gemma vs Qwen 2~4B 권위 있는 head-to-head 없음 → 자체 A/B로 결판.
