# 또박또박 화자 분리(Speaker Diarization) 리서치 종합 보고서
*(2026-06 기준, 리서치 6개 각도 + 적대적 검증 결과 반영)*

---

## 1. 현재 구현 요약

현재 sidecar에는 **완성됐지만 꺼져 있는**(`diarization.enabled: false`) 3단 구조의 화자 분리가 존재한다.

| 경로 | 구현 | 상태 |
|---|---|---|
| 실시간 (chunk 단위) | `sidecar/app/diarization/speaker.py` — `pyannote/speaker-diarization-3.1`을 chunk(2~8s)마다 실행, centroid embedding을 회의별 JSON DB(`speaker_dbs/meeting_<id>.json`)에 multi-vector cosine 매칭(코드 기본 threshold **0.35**, settings.yaml에 0.45 튜닝값), '화자 N' 라벨 + 사후 병합(0.50) | 동작 실적 있음(meeting_61.json), 현재 OFF |
| 배치 (파일 재전사) | `whisperx_processor.py` — WhisperX로 **Whisper large-v3-turbo 재전사** + forced alignment + pyannote 3.1 + `assign_word_speakers`. 실패 시 `batch_processor.py`의 전체 파일 pyannote fallback | qwen3 전사를 버리고 Whisper로 다시 전사하는 구조적 문제 |
| WebSocket `/ws/transcribe` | 화자 분리 없음 (speaker 항상 null) | 공백 |

**꺼져 있는 이유(증거 기반 추정)**: ① pyannote가 CPU 고정(`speaker.py:114`)인 채 STT와 같은 `gpu_lock` 안에서 직렬 실행 → 모든 실시간 chunk 지연에 가산. ② 코드 자체 docstring(2~5초 chunk embedding 불안정)과 threshold 버그 이력 — `max_chunk_sec: 8` 환경에서는 모든 chunk가 이 약점 구간에 들어감. settings.yaml의 비기본 튜닝값(0.45/0.6/17)은 사용자가 품질을 실험한 뒤 끈 흔적이며, HF 토큰은 있으므로 자격 증명 문제가 아님.

**리서치로 확인된 핵심 결함**: 배치 경로의 '화자 N' 라벨이 SpeakerDB에 등록되지 않아 rename/reset API와 분리됨, `/transcribe-file`은 WhisperX 성공 시 ASR을 두 번 돌림, `offset_ms` 파라미터 미사용, 실시간/배치 fallback 라벨 불일치(`SPEAKER_00` vs `화자 1`). 또한 **현재 speaker DB는 회의 단위(per-meeting)이며 회의 간(cross-meeting) 화자 동일성 기능은 존재하지 않는다** (검증에서 정정된 사실).

---

## 2. 리서치 결과 vs 현재 구현 비교표

DER은 데이터셋·채점 기준(collar, overlap 포함 여부)이 달라 **방향성 지표**로만 볼 것. RTF는 Apple Silicon 실측치.

| 방식 | 정확도 (DER) | 속도 (Apple Silicon) | 실시간 가능 | 통합 난이도 | 라이선스/비용 |
|---|---|---|---|---|---|
| **현재 구현** — pyannote 3.1, chunk 단위, CPU | AMI-SDM 22.7% (배치 기준; 2~8s chunk 단위 실행이라 실제론 더 나쁨) | CPU 전용, gpu_lock 직렬 → chunk마다 지연 가산 | △ (품질·지연 문제로 사실상 OFF) | — (이미 있음) | MIT / 무료 |
| **pyannote.audio 4.0.4 + community-1** (MPS) | AMI-SDM 19.9%, DIHARD3 20.2%, AISHELL-4 11.7% — 3.1 대비 11/12 벤치마크 개선 ([HF model card](https://huggingface.co/pyannote/speaker-diarization-community-1)) | MPS **~24-40x RT** (M2 Max/M4 Pro 실측; clustering은 CPU-bound) ([PR #1992](https://github.com/pyannote/pyannote-audio/pull/1992)) | ✗ (OSS는 배치 전용) | **낮음** — 기존 모듈의 모델 문자열+마이그레이션 수준 | CC-BY-4.0 (HF gated 다운로드, 이후 완전 오프라인) / 무료 |
| **FluidAudio offline** (CoreML/ANE, community-1 포팅) | AMI-SDM 10.6% (collar 0.25·overlap 제외 채점; 엄격 채점 시 ~19.9% 상당) ([Benchmarks.md](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Benchmarks.md)) | **~65-122x RT**, ANE라 GPU/MPS 미사용 → gpu_lock 무경합 | ✗ (offline 모드) | 중간 — Swift; Python에선 CLI subprocess, Tauri에선 fluidaudio-rs(배치만) | Apache-2.0 / 무료 |
| **FluidAudio streaming** (LS-EEND / Sortformer) | AMI-SDM: LS-EEND 20.7%, Sortformer 31.7%, chunk방식 26-50% | LS-EEND ~74x, Sortformer ~5.7-125x (M4 Max) | **✓** (100ms 업데이트, 10화자/4화자) | 중간~높음 — 실시간은 Swift API 전용(헬퍼 필요) | Apache-2.0 (Sortformer 가중치는 NVIDIA OML) / 무료 |
| **Senko** (CoreML, CAM++ 파이프라인) | VoxConverse 13.5%는 좋으나 **AMI-SDM 29.7-32.8% (엄격 채점)** — 회의 도메인에서 pyannote 대비 ~10pt 열세 | **~467x RT** (M3, 1h→7.7s), ANE+CPU | ✗ | 낮음 — 순수 Python, numpy 입력, 192-d centroid API | MIT / 무료 |
| **speakrs** (Rust, community-1 CoreML 포팅) | VoxConverse-dev 7.1% (pyannote 7.2%와 동급) | ~312-912x RT (M4 Pro) | ✗ | 중간 — Rust 라이브러리, Python 바인딩 없음 | Apache-2.0 / 무료 |
| **sherpa-onnx** (ONNX, CPU) | "상용 API 동급" 수준 (3rd-party) | ~90x RT (M1 CPU, 3rd-party 실측) | ✗ | 낮음 — pip Python API | Apache-2.0 / 무료 |
| **NVIDIA Streaming Sortformer v2.1** (NeMo) | DIHARD3 1-4화자 15.09% (1.04s 지연) — 단, **4화자 하드캡**, 영어 중심 | CUDA 전용 (공식 ONNX export 고장) | ✓ (CUDA에서만) | 높음 — Mac 부적합 | NVIDIA OML / 무료 |
| **pyannoteAI Precision-2** (클라우드 배치) | DIHARD3 **14.7%**, AMI-SDM 15.6% — OSS 대비 최고 | 클라우드 (오디오 업로드) | ✗ (배치) | **매우 낮음** — `Pipeline.from_pretrained` 모델명+토큰 한 줄 교체 | **€0.112/h** (community-1 호스팅은 €0.035/h) ([pricing](https://www.pyannote.ai/pricing)) |
| **pyannoteAI Streaming beta** (클라우드) | Precision-2급 | WebSocket 16kHz mono 100ms chunk, **~300ms 지연**, ≤8화자 ([changelog](https://www.pyannote.ai/changelog), 2026-05-04) | **✓** | 낮음 (단, 오디오가 외부로 나감) | 베타 기간 무료, GA 가격 미정 |
| **클라우드 STT+화자분리 일체형** (Voxtral Mini Transcribe V2 / Soniox / Scribe v2) | 자체 벤치마크상 우수, 한국어 지원 | 클라우드 | ✓/✗ | 낮으나 **qwen3 STT를 대체**해버림 | $0.10-0.22/h |

---

## 3. 추천

### 결론: **교체가 아니라 업그레이드.** 기존 모듈의 골격(SpeakerDB, overlap merge, HTTP API, Rails/UI 배선)은 그대로 살리고, 모델·아키텍처만 바꾼다.

### 주 추천 — pyannote.audio 4.0.4 + `speaker-diarization-community-1`, **회의 후 배치 중심 재설계**

- **모델/버전**: `pyannote-audio==4.0.4` (2026-02-07, 현재 최신) + `pyannote/speaker-diarization-community-1` (CC-BY-4.0), `pipeline.to(torch.device("mps"))`.
- **타임스탬프**: 배치 재전사에서 `mlx-qwen3-asr`(v0.3.5)의 **Qwen3-ForcedAligner-0.6B**(8bit: `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`)로 단어 단위 timestamp 확보 — 한국어/영어 지원(한국어는 `[aligner]` extra의 soynlp 필요), **베트남어 미지원 → segment 단위 fallback**. 라이브러리가 내부적으로 ~30s chunk 분할+offset 재기준을 처리하므로 앱 쪽 chunk 로직 불필요.
- **병합**: community-1의 `exclusive_speaker_diarization` 출력(STT timestamp 정합 전용 설계, [model card](https://huggingface.co/pyannote/speaker-diarization-community-1)) + 기존 `overlap.py`를 WhisperX `assign_word_speakers` 방식(화자별 intersection 합산 argmax + fill_nearest)으로 보강. WhisperX 패키지 의존 자체는 제거 가능 — 알고리즘은 ~50줄이고 13줄짜리 근사 구현이 이미 있음.

**왜 이것인가 (현재 구현 대비)**:
1. **정확도**: 3.1 → community-1은 11/12 벤치마크 개선(AMI-SDM 22.7→19.9%). 회의 도메인에서 OSS 최고 정확도. Senko류 초고속 파이프라인은 회의 오디오(AMI)에서 ~10pt 열세로 검증에서 탈락.
2. **속도**: MPS에서 24-40x RT → 1시간 회의 약 1.5~2.5분. 회의 후 배치로는 충분하고, 실시간 chunk 지연 문제(현재 OFF의 원인 1번)가 아예 사라짐.
3. **통합 비용 최소**: 같은 Python/PyTorch 스택, 기존 `speaker.py`/`speaker_db.py`/`speakers.py` API 재사용. 단 4.0은 breaking change(`use_auth_token`→`token`, torchcodec/ffmpeg IO, Python ≥3.10) 마이그레이션 필요 — 그리고 `whisperx_processor.py`의 monkey-patch는 폐기 대상(최신 whisperx는 네이티브로 `token=` 지원).
4. **현재 OFF의 원인 2번(짧은 chunk embedding 불안정)**: chunk 단위 실시간 분리를 1차 출력에서 제외하고, **연속 raw 녹음 전체 파일**에 대해 회의 후 1회 diarization하는 구조로 전환하면 근본 회피. 검증 결과도 일관됨 — 스트리밍 DER 20-50% vs 오프라인 10-20%.

**실시간 라벨이 꼭 필요해지면**: 1순위 pyannoteAI Streaming beta(클라우드, ~300ms, ≤8화자, 16kHz mono 100ms chunk — 현 파이프라인과 포맷 일치, 단 오디오 외부 전송이므로 opt-in), 2순위 FluidAudio LS-EEND(온디바이스 ANE, AMI 20.7%, Swift 헬퍼 필요).

### 대안 — FluidAudio offline (CoreML/ANE) + pyannoteAI Precision-2 클라우드 escape hatch

- **FluidAudio v0.15.2** (Apache-2.0): 같은 community-1 파이프라인을 ANE에서 ~65-122x RT로 실행, **GPU/MPS를 전혀 안 써서 MLX qwen3와 메모리/GPU 경합 제로**. pyannote 4.0.x의 미해결 메모리 회귀(아래 리스크 참고)가 unified memory에서 문제를 일으키면 이쪽으로 전환. Python sidecar에서는 macOS CLI(`fluidaudiocli process file.wav --output out.json`) subprocess로 호출.
- **클라우드 fallback**: 저사양 호스트나 초장시간 녹음용으로 pyannoteAI Precision-2 (€0.112/h, DIHARD3 14.7%) — 모델명+토큰 한 줄 교체로 동일 코드 경로. STT는 로컬 유지, 오디오만 외부로 나가는 가장 프라이버시 친화적인 클라우드 옵션.

---

## 4. 통합 스케치

기존 sidecar 파이프라인 기준, 작업 순서대로:

1. **의존성 마이그레이션**: `pyannote-audio` 4.0.4 유지하되 코드의 `use_auth_token`→`token` 정리, `whisperx_processor.py`의 pyannote 4.x monkey-patch 제거. `whisperx` 의존 자체를 배치 경로에서 제거(아래 3번). ffmpeg는 mp3 저장으로 이미 존재.
2. **모델 교체**: `speaker.py:31`의 `_PIPELINE_MODEL`을 `pyannote/speaker-diarization-community-1`로 변경, `deps.py`의 lazy-load에서 `pipeline.to(torch.device("mps"))` 적용(실패 시 CPU fallback). HF gated 모델이므로 최초 1회 토큰 다운로드 후 로컬 캐시로 오프라인 운용.
3. **배치 경로 재구성** (`/transcribe-file`): WhisperX 재전사를 폐기하고 ① 기존 qwen3 STT 결과 유지 → ② `mlx-qwen3-asr` ForcedAligner로 단어 timestamp(ko/en; vi는 segment 단위) → ③ community-1 전체 파일 diarization(`exclusive_speaker_diarization` 사용) → ④ 화자별 intersection 합산 argmax + fill_nearest 병합(기존 `overlap.py` 확장). ASR 이중 실행 낭비도 함께 해소됨.
4. **gpu_lock 배치**: diarization(MPS)을 기존 `gpu_lock` 안에서 실행해 MLX STT와 Metal 동시 접근 방지 — 회의 후 배치라 지연 가산이 사용자 체감에 안 잡힘. FluidAudio 대안 채택 시엔 ANE라 lock 밖 실행 가능.
5. **SpeakerDB 통합(기존 gap 수정)**: 배치 diarization 결과의 화자별 embedding(community-1 `return_embeddings`)을 회의별 SpeakerDB에 **등록**해 rename/reset API(`routers/speakers.py`)와 SpeakerPanel이 배치 결과에도 동작하게 함. 실시간/배치 라벨 번호 충돌 해소.
6. **threshold 재보정**: community-1은 embedding 스택이 3.1과 달라 기존 0.45 보정이 무효. 기존 `speaker_dbs/*.json`은 리셋하고, 자체 한국어 회의 녹음으로 similarity/merge threshold 재튜닝(4.0의 Calibration 클래스 활용 가능).
7. **실시간 경로 정책**: 1단계에서는 실시간 라벨 없이(또는 "화자 분석 중" 표시) 진행하고, **회의 종료 → 전체 재전사(file_chunk_sec 30) + 전체 파일 diarization → 기존 transcript들의 `speaker_label` 일괄 갱신 + ActionCable re-broadcast**. Rails 쪽은 `FileTranscriptionJob` 경로에 라벨 업데이트 단계 추가.
8. **fallback 라벨 통일**: `transcription_job.rb`의 `'SPEAKER_00'`과 `file_transcription_job.rb`의 `'화자 1'`을 한 가지로 통일.
9. **테스트**: 현재 무테스트인 배치 경로(병합 알고리즘, SpeakerDB 등록, vi segment-fallback)에 단위 테스트 추가. 기존 `test_speaker_*` 테스트는 threshold/모델 변경 반영.
10. **(선택) 2단계**: 실시간 라벨 욕구가 확인되면 pyannoteAI Streaming beta opt-in 또는 FluidAudio LS-EEND Swift 헬퍼 추가 — 단 실시간 라벨은 "잠정", 회의 후 배치 결과가 항상 최종본이 되도록.

---

## 5. 리스크 / 함정

- **타임스탬프 드리프트 (가장 중요)**: 실시간 2~8s chunk의 timestamp(VAD 게이팅, 200ms overlap trim, preroll)는 연속 raw 파일의 시계와 어긋나고 mp3 인코더 딜레이도 더해진다. **전체 파일 diarization을 실시간 chunk timestamp에 정렬하지 말 것** — 반드시 같은 오디오 파일의 전체 재전사 결과와 같은 timebase에서 병합. pyannote도 chunk 경계 화자 문제를 공식 이슈로 인정([#1006](https://github.com/pyannote/pyannote-audio/issues/1006)).
- **pyannote 4.0.x 메모리 회귀**: [#1963](https://github.com/pyannote/pyannote-audio/issues/1963) — 72분 오디오에서 peak >9.5GB(3.3.x는 2.6GB), 4.0.4에서도 재현, 미해결. 증거는 CUDA 기준이지만 unified memory Mac에서는 GPU 스파이크가 곧 시스템 RAM 잠식 → MLX qwen3와 경합. 장시간 파일 CPU-RAM 스파이크 수정([PR #1992](https://github.com/pyannote/pyannote-audio/pull/1992), 4.7h 파일 58.8GB→39MB)은 **아직 unmerged** — 패치 적용 또는 4.0.5 대기, 장시간 회의로 사전 부하 테스트 필수. 문제가 되면 FluidAudio(ANE) 대안으로 전환.
- **MPS 부분 가속·이력 버그**: clustering은 CPU-bound라 긴 파일에서 가속 효과 감소, M1에서 timestamp 오류 이력([#1337](https://github.com/pyannote/pyannote-audio/issues/1337)). 도입 시 CPU 결과와 diff 검증 1회 권장.
- **겹침 발화(overlapping speech)**: argmax 병합은 동시 발화에서 한 화자만 남긴다. `exclusive_speaker_diarization`은 "전사될 가능성이 높은 한 명"을 고르는 것이지 두 화자를 복원하는 게 아님 — UI에서 겹침 구간을 저신뢰로 표시하는 정도가 현실적.
- **Embedding 비호환**: 3.1(wespeaker 256-d) 기반 기존 SpeakerDB·threshold 0.45는 community-1 전환 시 무효. 마이그레이션 없이 섞으면 조용한 오매칭 발생(기존 `_fallback_speaker`의 'last speaker' fallback이 이를 증폭). DB 리셋 + 재보정 필수.
- **한국어 무벤치마크**: community-1/Sortformer/CAM++ 모두 한국어 DER 공표치가 없다(중국어 AISHELL-4/AliMeeting이 최선의 CJK proxy). 어떤 엔진이든 **자체 한국어 회의 녹음 파일럿으로 threshold·정확도 검증 후 채택**.
- **베트남어 단어 정렬 불가**: Qwen3-ForcedAligner는 11개 언어(ko 포함)만 지원, vi 제외 → 베트남어 회의는 segment 단위 화자 할당(경계 오귀속 증가) 또는 별도 CTC aligner 필요.
- **화자 수 상한**: 배치 community-1은 상한 없음(21화자 4.7h 검증), 그러나 실시간 옵션은 제한적 — pyannoteAI streaming ≤8, Sortformer ≤4(영어 중심, "non-English에서 성능 저하" 명시). 한국어 다인 회의에 Sortformer 계열은 비추천.
- **chunk 단위 실시간 분리의 근본 한계**: 어떤 엔진이든 스트리밍 DER(20-50%)은 오프라인(10-20%)보다 명확히 나쁘다. 실시간 라벨을 다시 켜더라도 "잠정 라벨 + 회의 후 확정"의 2단 구조를 유지할 것 — 현재 구현이 실패한 지점을 같은 방식으로 반복하지 않는 것이 이번 재설계의 핵심.
- **클라우드 베타 의존 주의**: pyannoteAI Streaming은 베타 무료지만 GA 가격·존속이 미정 — 핵심 경로가 아닌 opt-in 부가 기능으로만 배치.