# TSK-03-01: Web Audio API 오디오 캡처 - 설계

## 구현 방향
AudioWorklet을 통해 마이크 입력을 16kHz mono PCM(Int16)으로 변환하고 3초 청크 단위로 콜백한다.
MediaRecorder로 원본 WebM/Opus 오디오를 병렬 녹음하여 회의 종료 시 Blob으로 반환한다.
useAudioRecorder 훅이 상태·생명주기를 관리하고, AudioRecorder 컴포넌트가 UI를 담당한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| frontend/public/audio-processor.js | AudioWorklet 프로세서 (Float32→Int16, 3초 청크) | 신규 |
| frontend/src/hooks/useAudioRecorder.ts | 마이크 캡처 훅 | 신규 |
| frontend/src/hooks/useAudioRecorder.test.ts | 훅 단위 테스트 | 신규 |
| frontend/src/components/meeting/AudioRecorder.tsx | 녹음 UI 컴포넌트 | 신규 |
| frontend/src/components/meeting/AudioRecorder.test.tsx | 컴포넌트 단위 테스트 | 신규 |

## 주요 구조
- `useAudioRecorder(callbacks)` – 마이크 권한 요청, AudioContext(16kHz) 생성, AudioWorklet 등록, MediaRecorder 시작
- `audio-processor.js` – AudioWorkletProcessor: 입력 샘플을 버퍼링 → 3초분 누적 시 Float32→Int16 변환 후 port.postMessage
- `AudioRecorder` – isRecording 상태에 따라 시작/중지 버튼 및 녹음 표시등 렌더
- 콜백 Ref 패턴 – start/stop 사이에 callbacks가 변경되어도 최신 참조 유지

## 데이터 흐름
마이크 → getUserMedia → AudioContext(16kHz) → AudioWorkletNode → port.postMessage(Int16Array) → onChunk 콜백
마이크 → MediaRecorder → ondataavailable(Blob chunks) → stop → onStop(Blob)

## 선행 조건
- TSK-00-02 완료 (React SPA 환경)
- 브라우저 Web Audio API 지원
- /audio-processor.js 파일이 public/ 폴더에 배치
