# TSK-04-01: config.ts 모드 분기 테스트 보고서

## 실행 결과

| 항목 | 값 |
|------|-----|
| 테스트 파일 수 | 43 |
| 전체 테스트 수 | 338 |
| 통과 | 338 |
| 실패 | 0 |
| 실행 시간 | 3.95s |

## 초기 실행 결과 (수정 전)

| 항목 | 값 |
|------|-----|
| 테스트 파일 | 43 (14 failed, 29 passed) |
| 테스트 | 335 (52 failed, 283 passed) |
| Unhandled Errors | 3 |

## 실패 원인 분석 및 수정 내용

### 1. MermaidBlock 모듈 로드 실패 (App, MeetingEditor, AiSummaryPanel, MeetingLivePage)

**원인:** `createReactBlockSpec`이 jsdom에서 정상 동작하지 않아 `MermaidBlock()`이 함수가 아니라는 오류 발생. `MermaidBlock`을 호출하는 모든 모듈 체인에서 실패 전파.

**수정:** 영향받는 테스트 파일에서 `mermaidBlock` 모듈을 `vi.mock()`으로 직접 모킹.

- `src/App.test.tsx`
- `src/components/editor/MeetingEditor.test.tsx`
- `src/components/meeting/AiSummaryPanel.test.tsx`

### 2. useTranscription 테스트 구조 불일치

**원인:** `useTranscription` 훅이 `createConsumer`를 직접 사용하지 않고 `createAuthenticatedConsumer()`와 `createTranscriptionChannel()`을 사용하도록 변경됨. 또한 `received` 콜백의 메시지 형식이 중첩 `data` 객체에서 flat 구조(`text`, `speaker` 등)로 변경됨.

**수정:** `@rails/actioncable` 대신 `../lib/actionCableAuth`를 모킹. 메시지 형식을 flat 구조(`text`, `speaker`, `seq` 등)로 변경.

- `src/hooks/useTranscription.test.ts`

### 3. useAudioPlayer 훅 인터페이스 변경

**원인:** `useAudioPlayer` 훅이 `(meetingId, waveformRef)` 시그니처에서 `(meetingId)` 시그니처로 변경됨. WaveSurfer 기반에서 HTML Audio 기반으로 전환. 반환 타입에 `hasAudio`, `audioLoaded`, `durationMs`, `playbackRate`, `download` 등 새 필드 추가.

**수정:** WaveSurfer mock 제거, 새로운 훅 인터페이스에 맞게 테스트 전면 재작성.

- `src/hooks/useAudioPlayer.test.ts`

### 4. AudioPlayer 컴포넌트 변경

**원인:** `AudioPlayer` 컴포넌트가 `data-testid="waveform"` div 제거, 새로운 프로그레스 바 UI 도입, `useAudioPlayer` 반환 타입 변경에 따른 mock 필드 추가 필요.

**수정:** mock에 `hasAudio`, `audioLoaded`, `durationMs`, `playbackRate`, `setPlaybackRate`, `download` 추가. waveform 관련 테스트를 버튼 클릭 기반 테스트로 교체.

- `src/components/meeting/AudioPlayer.test.tsx`

### 5. Sidebar 스타일 변경

**원인:** Sidebar가 `hidden`/`md:flex` CSS 반응형 클래스 대신 `sidebarOpen` zustand 상태로 visibility를 제어하도록 변경됨.

**수정:** CSS 클래스 테스트를 `sidebarOpen=false`일 때 `null` 렌더링 확인으로 교체.

- `src/components/layout/Sidebar.test.tsx`

### 6. meetings API 시그니처 변경

**원인:**
- `createMeeting`이 `{ json: { meeting: data } }` 대신 `{ json: data }`로 변경.
- 응답이 `{ meeting: Meeting }` 래핑으로 변경.
- `getMeetingDetail` 응답이 `{ meeting: MeetingDetail }` 래핑으로 변경.

**수정:** 테스트의 mock 데이터와 assertion을 새 API 시그니처에 맞게 수정.

- `src/api/meetings.test.ts`

### 7. ExportButton 옵션 변경

**원인:** `ExportButton`에 `include_memo` 옵션 추가, 패널 제목이 "Markdown 내보내기"에서 "회의록 내보내기"로 변경, 기본값에서 `include_transcript`가 `false`로 변경.

**수정:** 테스트의 assertion을 새 옵션 구조에 맞게 수정.

- `src/components/meeting/ExportButton.test.tsx`

### 8. useBlockSync 빈 블록 동작 변경

**원인:** 빈 블록 배열일 때 `initialContent`가 `[]` 대신 `null`을 반환하도록 변경 (에디터 기본 콘텐츠 사용).

**수정:** `expect(result.current.initialContent).toEqual([])` → `expect(result.current.initialContent).toBeNull()`.

- `src/hooks/__tests__/useBlockSync.test.ts`

### 9. useAudioRecorder 의존성 추가

**원인:** `useBrowserRecorder`가 `loadAppSettings()`, `getEffectiveAudioConfig()`, `createMediaStreamDestination()`, 시스템 오디오 인젝터 모듈 등 새로운 의존성 추가.

**수정:** `appSettingsStore` mock 추가, `createMediaStreamDestination` mock 추가, workletNode에 `connect` mock 추가.

- `src/hooks/useAudioRecorder.test.ts`

### 10. MeetingLivePage 컴포넌트 변경

**원인:** "회의 종료" 버튼이 항상 표시되지 않고 `isActive` 상태일 때만 표시. `handleStop`에 2초 대기 로직 추가. 새 훅 의존성(`useMicCapture`, `useSystemAudioCapture`, `useMemoEditor`) 추가. `react-resizable-panels` mock 필요.

**수정:** 비활성 상태 테스트를 "버튼 미표시" 확인으로 변경. 종료 테스트에 `vi.useFakeTimers` + `advanceTimersByTime` 추가. 새 hook mock 추가.

- `src/pages/MeetingLivePage.test.tsx`

### 11. MeetingsPage 구조 변경

**원인:** `getTeams` API 제거, `useMeetingStore.fetchMeetings` 사용으로 변경. 페이지 제목이 "회의 목록"에서 "전체 회의"로 변경. 검색 placeholder가 "제목 검색"으로 변경. 데이터 로드에 300ms 디바운스 추가.

**수정:** `getTeams` mock 제거, `fetchMeetings` 디바운스 처리를 위한 `vi.useFakeTimers` 추가, assertion을 새 UI에 맞게 수정.

- `src/pages/MeetingsPage.test.tsx`

### 12. MeetingPage 환경 의존성

**원인:** `react-resizable-panels`가 `ResizeObserver` 필요, `@mantine/core`가 `matchMedia` 필요. 새 hook 의존성(`useMeeting`, `useMeetingAccess`, `useFileTranscriptionProgress`, `useMemoEditor`). `AiSummaryPanel`이 mermaidBlock 의존.

**수정:** `matchMedia`/`ResizeObserver` polyfill 추가. 새 hook mock 추가. `mockMeetingBase`를 `vi.hoisted()`로 이동. 테스트를 모킹된 `useMeeting` 기반으로 재작성.

- `src/pages/MeetingPage.test.tsx`

## 최종 결과

모든 338개 테스트가 통과했다. config.ts의 모드 분기 함수(`getMode`, `getServerUrl`, `getApiBaseUrl`, `getWsUrl`)는 기존 8개 테스트가 변경 없이 통과하며, TSK-04-01 설계 문서에서 식별한 사용처(JWT 헤더, ActionCable 인증 등)의 코드 변경에 대한 테스트도 모두 통과한다.
