# TSK-06-04: 오디오 재생 및 타임라인 동기화 - 설계

## 구현 방향

`AudioPlayer` 컴포넌트를 신규 생성하여 WaveSurfer.js 7+로 파형 시각화 및 재생/정지를 처리한다. 오디오 소스는 기존 `GET /api/v1/meetings/:id/audio` 엔드포인트(구현 완료)를 그대로 사용한다. 트랜스크립트 목록 조회를 위해 `GET /api/v1/meetings/:id/transcripts` 라우트와 컨트롤러를 추가하고, 프론트엔드에서 `started_at_ms` / `ended_at_ms`를 기반으로 재생 위치와 텍스트 세그먼트를 동기화한다. `useAudioPlayer` 커스텀 훅이 WaveSurfer 인스턴스 생명주기, 현재 재생 시간, 세그먼트 하이라이트 로직을 캡슐화한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/meeting/AudioPlayer.tsx` | WaveSurfer.js 파형 + 재생/정지 UI 컴포넌트 | 신규 |
| `frontend/src/hooks/useAudioPlayer.ts` | WaveSurfer 인스턴스 관리, 재생 시간 추적, seek 제어 | 신규 |
| `frontend/src/components/meeting/TranscriptPanel.tsx` | 트랜스크립트 세그먼트 목록 표시 + 하이라이트 + 클릭 seek | 신규 |
| `frontend/src/api/meetings.ts` | `getTranscripts(meetingId)` 함수 추가 | 수정 |
| `frontend/src/pages/MeetingPage.tsx` | AudioPlayer + TranscriptPanel 레이아웃 통합 | 수정 |
| `backend/app/controllers/api/v1/transcripts_controller.rb` | `GET /api/v1/meetings/:id/transcripts` 응답 | 신규 |
| `backend/config/routes.rb` | `resources :transcripts, only: [:index]` nested 추가 | 수정 |
| `frontend/package.json` | `wavesurfer.js` 의존성 추가 | 수정 |

---

## 주요 구조

**`useAudioPlayer(meetingId, waveformRef)`**
- WaveSurfer 인스턴스를 `useEffect`에서 생성·소멸 관리 (`wavesurfer.js` 7+ API)
- `audioUrl`: `GET /api/v1/meetings/:id/audio` URL을 Bearer 토큰 포함 fetch 후 Blob URL 생성
- `currentTimeMs`: `wavesurfer.on('timeupdate', ...)` 이벤트로 ms 단위 현재 재생 위치 상태 관리
- `seekTo(ms)`: `wavesurfer.seekTo(ms / duration)` 호출로 특정 타임스탬프로 이동
- 반환: `{ isReady, isPlaying, currentTimeMs, play, pause, seekTo }`

**`AudioPlayer` 컴포넌트**
- `waveformRef`를 WaveSurfer 마운트 대상 `div`에 연결
- `useAudioPlayer` 훅 사용, 재생/정지 버튼 + 현재 시간/전체 시간 표시
- `onSeek(ms)` prop을 통해 부모(MeetingPage)로 seek 이벤트 전달

**`TranscriptPanel` 컴포넌트**
- `transcripts: Transcript[]` prop (각 항목: `id, speaker_label, content, started_at_ms, ended_at_ms`)
- `currentTimeMs` prop을 받아 `started_at_ms <= currentTimeMs < ended_at_ms`인 세그먼트에 하이라이트 CSS 적용
- 세그먼트 클릭 시 `onSeek(started_at_ms)` 호출
- 하이라이트 세그먼트로 자동 스크롤 (`scrollIntoView`)

**`Api::V1::TranscriptsController#index`**
- `before_action :authenticate_user!`, `set_meeting` (팀 소속 확인)
- `@meeting.transcripts.order(:sequence_number)` 반환
- 응답 JSON: `{ transcripts: [{ id, speaker_label, content, started_at_ms, ended_at_ms, sequence_number }] }`

**`MeetingPage` 레이아웃 통합**
- 상단: `AudioPlayer` (파형 + 컨트롤)
- 하단 분할: 좌측 `TranscriptPanel`, 우측 `MeetingEditor`
- `seekMs` 상태를 `AudioPlayer`와 `TranscriptPanel` 사이에서 공유 (useState로 lift up)

---

## 데이터 흐름

**오디오 재생:** `MeetingPage` 마운트 → `useAudioPlayer`가 `/api/v1/meetings/:id/audio` 스트리밍 URL을 Blob URL로 변환 → WaveSurfer 파형 렌더링 → 재생 시 `timeupdate` 이벤트로 `currentTimeMs` 갱신 → `TranscriptPanel`에 전달하여 해당 세그먼트 하이라이트

**텍스트 클릭 → seek:** `TranscriptPanel` 세그먼트 클릭 → `onSeek(started_at_ms)` → `MeetingPage`의 `seekMs` 상태 업데이트 → `AudioPlayer`의 `useAudioPlayer.seekTo(ms)` 호출 → WaveSurfer 재생 위치 이동

**트랜스크립트 로드:** `MeetingPage` 마운트 → `getTranscripts(meetingId)` → `GET /api/v1/meetings/:id/transcripts` → `TranscriptsController#index` → `transcripts` 배열 응답 → `TranscriptPanel` 렌더링

---

## 선행 조건

- TSK-06-01: `GET /api/v1/meetings/:id/audio` (MeetingsAudioController#show, `send_file` 스트리밍) 구현 완료
- DB 스키마: `transcripts` 테이블에 `started_at_ms`, `ended_at_ms` 컬럼 존재 (확인 완료)
- 외부 라이브러리: `wavesurfer.js` 7+ (`npm install wavesurfer.js`) — 아직 package.json에 없으므로 추가 필요
- JWT 인증: `authenticate_user!` concern 구현 완료 (TSK-01-03)
