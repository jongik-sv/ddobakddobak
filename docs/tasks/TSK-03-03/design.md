# TSK-03-03: 실시간 자막 UI 컴포넌트 - 설계

## 구현 방향
transcriptStore에서 partial/finals/currentSpeaker를 구독하여 실시간 자막을 렌더한다.
SpeakerLabel은 화자 레이블을 색상으로 매핑하는 독립 컴포넌트로 분리한다.
LiveTranscript는 자동 스크롤을 useEffect + ref로 구현하고, partial은 회색/italic, final은 검정/고정으로 표시한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| frontend/src/components/meeting/SpeakerLabel.tsx | 화자 레이블 + 색상 배지 컴포넌트 | 신규 |
| frontend/src/components/meeting/SpeakerLabel.test.tsx | SpeakerLabel 테스트 | 신규 |
| frontend/src/components/meeting/LiveTranscript.tsx | 실시간 자막 목록 컴포넌트 | 신규 |
| frontend/src/components/meeting/LiveTranscript.test.tsx | LiveTranscript 테스트 | 신규 |

## 주요 구조
- `SpeakerLabel({ speakerLabel })` – SPEAKER_00~09를 색상 배열로 매핑, 배지 형태 렌더
- `LiveTranscript()` – transcriptStore 구독, finals 목록 + partial 항목 렌더
- `scrollRef` – 컨테이너 ref, finals/partial 변경 시 scrollIntoView로 자동 스크롤
- 색상 팔레트 – 화자 인덱스 기반 Tailwind 색상 클래스 배열

## 데이터 흐름
transcriptStore(partial, finals, currentSpeaker) → LiveTranscript 렌더 → 자동 스크롤

## 선행 조건
- TSK-03-02 완료 (transcriptStore 구현)
