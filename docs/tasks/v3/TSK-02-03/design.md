# TSK-02-03: MiniAudioPlayer 컴포넌트 - 설계

## 구현 방향
- 모바일 전용 미니 오디오 플레이어를 MeetingPage 하단에 고정 배치 (48px, `bottom-14`)
- 기존 `useAudioPlayer` 훅을 재사용하여 재생 상태를 풀 플레이어와 공유
- `<input type="range">`로 경량 프로그레스 바 구현 (wavesurfer.js 미사용)
- 미니 플레이어 탭 시 기존 AudioPlayer를 바텀 시트로 확장하는 토글 상태 관리

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/meeting/MiniAudioPlayer.tsx` | 미니 오디오 플레이어 컴포넌트 | 신규 |
| `frontend/src/components/meeting/__tests__/MiniAudioPlayer.test.tsx` | 단위 테스트 | 신규 |
| `frontend/src/pages/MeetingPage.tsx` | MiniAudioPlayer 통합, 바텀 시트 토글 | 수정 |

## 주요 구조

- **MiniAudioPlayer** — 미니 플레이어 UI 컴포넌트
  - Props: `isPlaying`, `currentTimeMs`, `durationMs`, `onPlay`, `onPause`, `onSeek`, `onExpand`
  - 재생/일시정지 버튼, range 프로그레스 바, 시간 표시
  - `h-12 fixed bottom-14 lg:hidden` 스타일링

- **MeetingPage 통합** — 미니/풀 플레이어 전환 상태 관리
  - `showFullPlayer` 상태로 미니↔풀 전환 제어
  - 모바일: 미니 플레이어 기본 표시, 탭 시 풀 플레이어 바텀 시트 오픈
  - 데스크톱(`lg:` 이상): 기존 AudioPlayer 그대로 표시

## 데이터 흐름
`useAudioPlayer` 훅 → MeetingPage(상태 관리) → MiniAudioPlayer(Props) → 사용자 인터랙션 → onPlay/onPause/onSeek 콜백 → useAudioPlayer 훅

## 선행 조건
- TSK-00-02: 프론트엔드 기반 설정 (완료 필요)
- 기존 `useAudioPlayer` 훅 (`frontend/src/hooks/useAudioPlayer.ts`)
- 기존 `AudioPlayer` 컴포넌트 (`frontend/src/components/meeting/AudioPlayer.tsx`)
- `formatTime` 유틸리티 함수
