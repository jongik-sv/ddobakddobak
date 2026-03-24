# VAD 기반 오디오 청킹 설계 — 문장 중간 끊김 수정

## 문제

`audio-processor.js`가 16kHz에서 정확히 6초(96,000 샘플)마다 고정으로 청크를 자른다.
문장이 6초 경계에 걸치면 중간에 끊겨 두 개의 독립 청크로 STT 처리되어 인식 품질이 저하된다.
또한 `stop()` 시 worklet 버퍼에 남아 있는 음성이 `disconnect()` 전에 flush되지 않아 마지막 발화가 유실된다.

## 해결책

AudioWorklet에 RMS 에너지 기반 VAD(Voice Activity Detection) 상태 머신을 추가해
자연스러운 무음 구간에서 청크를 분리한다. 백엔드/사이드카/ActionCable은 수정 불필요
(이미 가변 길이 PCM Int16 청크를 받으므로).

## 수정 파일

### 1. `frontend/public/audio-processor.js` — 전체 재작성

**상수**
```
SAMPLE_RATE        = 16000
SILENCE_THRESHOLD  = 0.01    // RMS 에너지 임계값
SILENCE_SAMPLES    = 8000    // 500ms 무음 지속 시 청크 전송
MAX_CHUNK_SAMPLES  = 240000  // 15초 강제 전송 (연속 발화 대비)
MIN_CHUNK_SAMPLES  = 16000   // 1초 미만이면 무시
PREROLL_SAMPLES    = 4800    // 300ms 프리롤 (문장 시작 포착)
```

**상태 머신** (`_state`: `'SILENCE'` | `'SPEECH'` | `'TRAILING_SILENCE'`)

| 상태 | 조건 | 동작 |
|------|------|------|
| SILENCE | frame RMS > threshold | pre-roll 복사 → SPEECH |
| SPEECH | buffer >= MAX | 강제 전송 → SILENCE |
| SPEECH | frame RMS ≤ threshold | → TRAILING_SILENCE, silenceCount 초기화 |
| TRAILING_SILENCE | frame RMS > threshold | → SPEECH |
| TRAILING_SILENCE | silenceCount ≥ SILENCE_SAMPLES AND len ≥ MIN | 청크 전송 → SILENCE |
| TRAILING_SILENCE | buffer >= MAX | 강제 전송 → SILENCE |

**RMS 계산**: 128샘플 frame 단위로 1회만 계산
```js
const rms = Math.sqrt(channel.reduce((sum, x) => sum + x * x, 0) / channel.length)
```

**flush 메시지**: 외부에서 `{type: 'flush'}` 수신 시 남은 버퍼 즉시 전송

### 2. `frontend/src/hooks/useAudioRecorder.ts` — `stop()` 수정

- `stop()` 시 worklet에 `{type: 'flush'}` 전송
- 200ms setTimeout 후 disconnect/close (worklet flush 응답 대기)

### 3. `frontend/src/hooks/useAudioRecorder.test.ts` — 테스트 수정

- `mockPort`에 `postMessage: vi.fn()` 추가
- `stop() 시 스트림 트랙 중지` 테스트에 fake timers 적용
- flush 메시지 전송 확인 테스트 추가

## 검증

1. `cd frontend && npx vitest run src/hooks/useAudioRecorder.test.ts`
2. 수동: 6초 이상 문장 발화 → STT 결과가 단일 청크로 처리되는지 확인
3. 15초+ 연속 발화 → MAX_CHUNK_SAMPLES 강제 전송 확인
