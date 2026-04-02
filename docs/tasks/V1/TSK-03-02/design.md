# TSK-03-02: ActionCable 실시간 연결 클라이언트 - 설계

## 구현 방향
@rails/actioncable로 TranscriptionChannel을 구독하고 오디오 청크를 전송한다.
서버에서 수신하는 partial/final/speaker_change/summary_update 이벤트를 Zustand 스토어에 저장한다.
useTranscription 훅이 채널 생명주기(연결→구독→해제)를 관리하고 transcriptStore가 상태를 보유한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| frontend/src/channels/transcription.ts | ActionCable 채널 구현 (기존 타입 정의 파일 확장) | 수정 |
| frontend/src/stores/transcriptStore.ts | 전사 상태 Zustand 스토어 | 신규 |
| frontend/src/stores/transcriptStore.test.ts | 스토어 단위 테스트 | 신규 |
| frontend/src/hooks/useTranscription.ts | ActionCable 구독 훅 | 신규 |
| frontend/src/hooks/useTranscription.test.ts | 훅 단위 테스트 | 신규 |

## 주요 구조
- `transcriptStore` – partial(현재 발화), finals(확정 발화 배열), summary(AI 요약), currentSpeaker 상태
- `createTranscriptionChannel(meetingId, consumer)` – ActionCable 채널 생성 함수, received() 콜백으로 이벤트 분기
- `useTranscription(meetingId)` – 마운트 시 consumer/channel 생성, 언마운트 시 구독 해제
- `sendAudioChunk(channel, pcm)` – Int16Array를 Base64로 인코딩하여 channel.perform('receive_audio', {...}) 호출

## 데이터 흐름
onChunk(Int16Array) → sendAudioChunk → channel.perform('receive_audio') → WebSocket
서버 이벤트 → received(data) → 이벤트 타입 분기 → transcriptStore 업데이트 → UI 리렌더

## 선행 조건
- TSK-03-01 완료 (useAudioRecorder의 onChunk 콜백)
- TSK-02-05 완료 (백엔드 TranscriptionChannel 구현)
- @rails/actioncable 설치 완료 (package.json 확인)
