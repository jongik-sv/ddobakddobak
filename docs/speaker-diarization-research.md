# 화자 분리(Speaker Diarization) 개선 리서치

> 조사일: 2026-03-31

## 현재 구현 분석

- **사용 모델**: `pyannote/speaker-diarization-3.1`
- **처리 방식**: 2~5초 짧은 청크 단위 → multi-vector 매칭 + 사후 병합
- **핵심 파일**: `sidecar/app/diarization/speaker.py`

### 현재 방식의 문제점

1. **짧은 청크 → embedding 품질 저하**: 2~5초에서는 화자 embedding이 불안정 (similarity 0.05~0.25)
2. **similarity_threshold=0.10**으로 매우 낮게 설정 → 다른 화자도 같은 사람으로 오매칭
3. **force_match 로직**: 단일 화자 청크면 무조건 기존 화자에 매칭 → 새 화자 등장을 놓침
4. pyannote 3.1은 한국어에 특화 최적화 없음 (DER ~18%+)

---

## 벤치마크 비교

### 전체 모델 비교 (arxiv 2509.26177, 196.6시간 다국어 오디오)

| 모델 | 전체 DER | 영어 | 중국어 | 5명+ 화자 | 속도(RTF) |
|------|---------|------|--------|----------|----------|
| PyannoteAI (상용) | **11.2%** | 6.6% | -- | 6.6% | -- |
| DiariZen (오픈소스) | 13.3% | -- | -- | **7.1%** | 20.2x |
| Sortformer v2 (NVIDIA) | ~16-17% | -- | **9.2%** | 성능 저하 | **214.3x** |
| Pyannote 3.1 (현재) | ~18.1% | -- | -- | -- | 45.0x |

### 한국어 벤치마크 (VoicePing, 2025-12, RTX 4090)

| 모델 | 한국어 DER | 영어 DER | 비고 |
|------|-----------|---------|------|
| **NeMo Neural (MSDD)** | **4.6%** | 1.9% | 한국어 최강 |
| NeMo Clustering | ~10% | ~5% | 양호 |
| Pyannote 3.1 (현재) | ~18%+ | ~18% | 한국어 최적화 없음 |

한국어는 영어 대비 약 2.4배 어려움. NeMo Neural은 현재 pyannote 대비 약 4배 정확.

---

## 개선 후보 모델

### 1. diart (실시간 스트리밍 - 가장 추천)

- **GitHub**: https://github.com/juanmc2005/diart
- **방식**: pyannote 기반 공식 스트리밍 화자 분리 프레임워크
- **처리**: 500ms 단위 rolling buffer로 점진적 클러스터링 → 청크가 쌓일수록 정확도 향상
- **레이턴시**: 평균 57ms
- **장점**: 현재 pyannote 모델 그대로 활용 가능 (추가 모델 다운로드 불필요)
- **설치**: `pip install diart`
- **하드웨어**: GPU 권장, CPU 가능

### 2. NVIDIA Streaming Sortformer

- **HuggingFace**: https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2
- **블로그**: https://developer.nvidia.com/blog/identify-speakers-in-meetings-calls-and-voice-apps-in-real-time-with-nvidia-streaming-sortformer/
- **방식**: End-to-end Transformer 기반, Arrival-Order Speaker Cache (AOSC)
- **성능**: DER 9.2% (중국어), 12.7% (일본어) → CJK 언어에 강점
- **속도**: RTF 214.3x (매우 빠름), 0.32초 청크에서도 성능 유지
- **제한**: 최대 4명 화자, NVIDIA GPU(CUDA) 필요, macOS Metal 미지원

### 3. NVIDIA NeMo Neural (MSDD)

- **문서**: https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/intro.html
- **방식**: Multi-Scale Diarization Decoder — 다양한 길이의 segment에서 embedding 추출
- **성능**: 한국어 DER 4.6% (측정된 최고 성능)
- **장점**: 짧은 발화에도 강함 (multi-scale)
- **제한**: NVIDIA GPU 필요

### 4. WhisperX (STT + 화자 분리 통합)

- **GitHub**: https://github.com/m-bain/whisperX
- **방식**: Whisper large-v3 + pyannote + forced alignment (word-level 타임스탬프)
- **성능**: pyannote 단독 대비 60% DER 감소
- **장점**: STT + 화자 분리를 한 번에 처리, 한국어 지원
- **제한**: 배치 처리만 가능 (실시간 스트리밍 부적합)

### 5. DiariZen (오픈소스)

- **GitHub**: https://github.com/BUTSpeechFIT/DiariZen
- **성능**: DER 13.3%, 5명+ 화자에서 7.1% (다화자에 특히 강함)
- **장점**: 오픈소스, 참석자 많은 회의에 적합

### 6. diarize (경량 CPU 특화)

- **방식**: ONNX Runtime 기반, scikit-learn 클러스터링
- **성능**: pyannote 대비 CPU에서 7배 빠름 (10분 회의 → ~75초)
- **장점**: GPU 없이도 빠름
- **제한**: 비교적 새로운 라이브러리, 실전 검증 부족

### 7. Picovoice Falcon (온디바이스)

- **사이트**: https://picovoice.ai/platform/falcon/
- **성능**: Google STT 대비 5배 정확 (자체 주장)
- **장점**: CPU, 모바일, 라즈베리파이에서 동작. 100배 빠름
- **제한**: 상용 라이선스

---

## 추천 전략

### 시나리오별 추천

| 시나리오 | 추천 | 이유 |
|---------|------|------|
| 실시간 녹음 중 화자 분리 | **diart** | 현재 pyannote 모델 재활용, 스트리밍 특화 |
| 녹음 완료 후 정리 | **WhisperX** | 배치 처리로 최고 정확도 |
| NVIDIA GPU 환경 | **NeMo MSDD** 또는 **Streaming Sortformer** | 한국어 DER 4.6% |
| 최소 변경으로 개선 | 청크 길이 늘리기 + threshold 조정 | 코드 변경 최소 |

### 하이브리드 전략 (최종 추천)

1. **실시간**: diart로 rolling buffer 기반 스트리밍 화자 분리
2. **후처리**: 녹음 완료 시 WhisperX로 전체 오디오 재처리 → 더 정확한 화자 분리 결과로 교체
3. **장기**: NVIDIA GPU 확보 시 NeMo MSDD로 전환 (한국어 최강)

### 현재 코드 즉시 개선 가능한 항목

1. 청크 길이를 **10~15초**로 늘리기 (embedding 안정성 대폭 향상)
2. `similarity_threshold`를 0.3~0.4로 상향
3. `force_match` 로직 제거 또는 조건 강화
4. speaker embedding 모델을 `wespeaker-voxceleb-resnet34` 등으로 교체 검토

---

## 참고 자료

- [Benchmarking Diarization Models (arXiv 2509.26177)](https://arxiv.org/html/2509.26177v1)
- [VoicePing Diarization Evaluation 2025](https://voiceping.net/en/blog/research-diarization-2025/)
- [Best Speaker Diarization Models Compared 2026](https://brasstranscripts.com/blog/speaker-diarization-models-comparison)
- [Top 8 Speaker Diarization Libraries 2026 (AssemblyAI)](https://www.assemblyai.com/blog/top-speaker-diarization-libraries-and-apis)
- [NVIDIA Streaming Sortformer Blog](https://developer.nvidia.com/blog/identify-speakers-in-meetings-calls-and-voice-apps-in-real-time-with-nvidia-streaming-sortformer/)
- [Streaming Sortformer Paper (Interspeech 2025)](https://www.isca-archive.org/interspeech_2025/medennikov25_interspeech.pdf)
- [SDBench: Speaker Diarization Benchmark (Interspeech 2025)](https://www.isca-archive.org/interspeech_2025/durmus25_interspeech.pdf)
- [diart GitHub](https://github.com/juanmc2005/diart)
- [WhisperX GitHub](https://github.com/m-bain/whisperX)
- [DiariZen GitHub](https://github.com/BUTSpeechFIT/DiariZen)
