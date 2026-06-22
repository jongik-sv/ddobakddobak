# B(백그라운드 녹음) 핵심 리프트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 녹음 세션을 페이지 종속(`useLiveRecording` in `MeetingLivePage`)에서 앱 레벨 전역 세션으로 승격해, 라우트를 떠나도 녹음·STT가 계속되고 어느 페이지서든 떠다니는 녹음바로 복귀·제어·종료할 수 있게 한다.

**Architecture:** `GatedApp`에 영속 마운트되는 `<RecordingHost/>`가 `recordingStore.activeMeetingId`가 설정되면 헤드리스 `<RecordingSession/>`을 띄워 `useLiveRecording`을 **유일하게** 실행한다. 세션은 상태를 `recordingStore`에 publish하고 제어 핸들러를 등록한다. `MeetingLivePage`는 훅을 직접 실행하지 않고 store를 읽는 **순수 뷰**가 된다(attach-vs-init). `<RecordingBar/>`가 비-라이브 라우트에서 떠다닌다.

**Tech Stack:** React 18 + TypeScript, zustand(스토어), react-router-dom v6, vitest + @testing-library/react, lucide-react(아이콘).

## Global Constraints

- 동작 무변경 원칙: 기존 라이브 녹음 흐름(시작/일시정지/종료/요약/무음완료/오타수정/공유)은 회귀 0. 리팩토링이지 기능변경 아님.
- 캡처 훅(`useAudioRecorder`/`useMicCapture`/`useSystemAudioCapture`/`useTranscription`/`useLocalStt`)은 **de-hook 금지** — 그대로 유지.
- **단일 소유자 불변식**: `useLiveRecording`은 `RecordingSession` 안에서만 실행. `MeetingLivePage`는 절대 직접 호출하지 않는다(좀비 캡처→청크 이중전송→전사 2배).
- 검증 게이트(각 commit 전): `cd frontend && npx vitest run` green, `npx tsc --noEmit` 0 에러.
- 사용자 미커밋 파일 **건드리지 말 것**: `frontend/src/App.tsx`의 `function App()` 내 파일드롭 가드, `IconPicker.tsx`, `pages/ProjectsPage.tsx`, `idea.md`. App.tsx는 `GatedApp()`에만 1줄 추가(비중첩).
- 한글 주석 유지(기존 코드 스타일).

---

## File Structure

**신규:**
- `frontend/src/stores/toastStore.ts` — 전역 토스트(showStatus 대체). 백그라운드 종료 메시지가 다른 라우트서 떠야 함.
- `frontend/src/stores/recordingStore.ts` — 세션-로컬 상태 + 인텐트 + 세션 핸들러 등록.
- `frontend/src/components/recording/RecordingSession.tsx` — 헤드리스. `useLiveRecording` 실행 + store publish/register.
- `frontend/src/components/recording/RecordingHost.tsx` — `activeMeetingId` 있으면 RecordingSession 마운트.
- `frontend/src/components/recording/RecordingBar.tsx` — 하단 전체폭 떠다니는 바.
- `frontend/src/components/recording/RecordingLayer.tsx` — RecordingHost + RecordingBar + 전역 StopMeetingDialog 묶음. App.tsx는 이것 1개만 마운트.
- 각 신규 유닛의 `__tests__/*.test.ts(x)`.

**수정:**
- `frontend/src/hooks/useLiveRecording.ts` — showStatus→toastStore, isApplyingCorrections→store 파라미터, 종료 핸들러 시그니처 정리(performStop noop 외부노출). 동작 무변경.
- `frontend/src/hooks/useNavigationGuards.ts` — 이탈 차단 제거, 웹 beforeunload 경고만 유지.
- `frontend/src/pages/MeetingLivePage.tsx` — 페이지=뷰(store 읽기, attach-vs-init).
- `frontend/src/App.tsx` — `GatedApp()`에 `<RecordingLayer/>` 1줄.

---

## Task 1: 전역 토스트 스토어 (toastStore)

**Files:**
- Create: `frontend/src/stores/toastStore.ts`
- Test: `frontend/src/stores/__tests__/toastStore.test.ts`
- Modify: `frontend/src/components/meeting/LiveStatusBar.tsx`(statusMessage를 store에서도 읽도록 — 호환)

**Interfaces:**
- Produces: `useToastStore` (zustand). state `{ message: string; showStatus(msg: string, durationMs?: number): void; clear(): void }`. 기본 durationMs=3000. `showStatus`는 이전 타이머를 clear하고 새로 건다.

- [ ] **Step 1: 실패 테스트 작성** `frontend/src/stores/__tests__/toastStore.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore } from '../toastStore'

describe('toastStore', () => {
  beforeEach(() => { vi.useFakeTimers(); useToastStore.getState().clear() })
  afterEach(() => { vi.useRealTimers() })

  it('showStatus로 메시지 설정 후 durationMs 경과 시 자동 clear', () => {
    useToastStore.getState().showStatus('저장됨', 1000)
    expect(useToastStore.getState().message).toBe('저장됨')
    vi.advanceTimersByTime(1000)
    expect(useToastStore.getState().message).toBe('')
  })

  it('새 showStatus가 이전 타이머를 교체(이전 메시지 조기 clear 안 됨)', () => {
    useToastStore.getState().showStatus('A', 1000)
    vi.advanceTimersByTime(500)
    useToastStore.getState().showStatus('B', 1000)
    vi.advanceTimersByTime(600) // A의 원래 만료 시점 지남
    expect(useToastStore.getState().message).toBe('B')
    vi.advanceTimersByTime(400)
    expect(useToastStore.getState().message).toBe('')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/stores/__tests__/toastStore.test.ts` Expected: FAIL("Cannot find module '../toastStore'").

- [ ] **Step 3: 구현** `frontend/src/stores/toastStore.ts`

```ts
import { create } from 'zustand'

interface ToastState {
  message: string
  showStatus: (message: string, durationMs?: number) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 전역 상태 토스트. 페이지-로컬 useStatusMessage를 대체 — 백그라운드 녹음 종료 메시지가
 *  라이브 페이지를 떠난 라우트에서도 표시돼야 하므로 전역화한다. */
export const useToastStore = create<ToastState>((set) => ({
  message: '',
  showStatus: (message, durationMs = 3000) => {
    if (timer) clearTimeout(timer)
    set({ message })
    timer = setTimeout(() => { set({ message: '' }); timer = null }, durationMs)
  },
  clear: () => {
    if (timer) { clearTimeout(timer); timer = null }
    set({ message: '' })
  },
}))
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd frontend && npx vitest run src/stores/__tests__/toastStore.test.ts` Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/stores/toastStore.ts frontend/src/stores/__tests__/toastStore.test.ts
git commit -m "feat(recording): 전역 토스트 스토어 — 백그라운드 종료 메시지 라우트 무관 표시"
```

---

## Task 2: 녹음 세션 스토어 (recordingStore)

**Files:**
- Create: `frontend/src/stores/recordingStore.ts`
- Test: `frontend/src/stores/__tests__/recordingStore.test.ts`

**Interfaces:**
- Consumes: `useTranscriptStore`(finals.length — requestStop 분기), Task 1 없음.
- Produces: `useRecordingStore` (zustand). 아래 타입.

```ts
export type RecStatus = 'idle' | 'recording' | 'stopped'
export interface RecHandlers {
  onPause: () => void
  onResume: () => void
  onStop: (skipSummary: boolean) => void
  onManualSummary: () => void
  onToggleSystemAudio: (next: boolean) => void
  onSetSummaryInterval: (sec: number) => void
  onReset: () => Promise<void> | void
}
export interface RecordingState {
  // 세션 식별 / 부트
  activeMeetingId: number | null
  pendingStart: boolean
  // 세션이 publish하는 상태
  status: RecStatus
  meetingApiStatus: 'pending' | 'recording' | 'completed' | null
  isPaused: boolean
  elapsedSeconds: number
  summaryCountdown: number
  summaryIntervalSec: number
  canManualSummary: boolean
  systemAudioEnabled: boolean
  isResetting: boolean
  isStopping: boolean
  error: string | null
  sttEngine: string | null
  activeSttMode: 'server' | 'local'
  isApplyingCorrections: boolean
  showStopConfirm: boolean
  _handlers: RecHandlers | null
  // 인텐트(페이지·바 공용)
  start: (meetingId: number) => void
  pause: () => void
  resume: () => void
  requestStop: () => void
  cancelStop: () => void
  confirmStop: (skipSummary: boolean) => void
  manualSummary: () => void
  toggleSystemAudio: (next: boolean) => void
  setSummaryInterval: (sec: number) => void
  resetMeeting: () => Promise<void> | void
  setApplyingCorrections: (v: boolean) => void
  // 세션 발행/등록/종료
  publish: (partial: Partial<RecordingState>) => void
  registerHandlers: (h: RecHandlers) => void
  consumePendingStart: () => void
  endSession: () => void
}
```

- [ ] **Step 1: 실패 테스트 작성** `frontend/src/stores/__tests__/recordingStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useRecordingStore } from '../recordingStore'
import { useTranscriptStore } from '../transcriptStore'

const reset = () => useRecordingStore.getState().endSession()

describe('recordingStore', () => {
  beforeEach(() => { reset(); useTranscriptStore.getState().reset() })

  it('start(id)로 activeMeetingId+pendingStart 설정', () => {
    useRecordingStore.getState().start(42)
    const s = useRecordingStore.getState()
    expect(s.activeMeetingId).toBe(42)
    expect(s.pendingStart).toBe(true)
  })

  it('이미 같은 meeting active면 start 무시(pendingStart 재설정 안 함)', () => {
    useRecordingStore.getState().start(42)
    useRecordingStore.getState().consumePendingStart()
    useRecordingStore.getState().start(42)
    expect(useRecordingStore.getState().pendingStart).toBe(false)
  })

  it('requestStop: finals 0이면 즉시 onStop(true), 다이얼로그 안 띄움', () => {
    const calls: boolean[] = []
    useRecordingStore.getState().registerHandlers({
      onPause(){}, onResume(){}, onStop(skip){ calls.push(skip) },
      onManualSummary(){}, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    useRecordingStore.getState().requestStop()
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
    expect(calls).toEqual([true])
  })

  it('requestStop: finals 있으면 showStopConfirm=true, onStop 즉시 호출 안 함', () => {
    useTranscriptStore.setState({ finals: [{ id: 1 } as never] })
    let stopped = false
    useRecordingStore.getState().registerHandlers({
      onPause(){}, onResume(){}, onStop(){ stopped = true },
      onManualSummary(){}, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    useRecordingStore.getState().requestStop()
    expect(useRecordingStore.getState().showStopConfirm).toBe(true)
    expect(stopped).toBe(false)
  })

  it('confirmStop(false): 다이얼로그 닫고 onStop(false) 호출', () => {
    let arg: boolean | null = null
    useRecordingStore.getState().registerHandlers({
      onPause(){}, onResume(){}, onStop(skip){ arg = skip },
      onManualSummary(){}, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    useRecordingStore.setState({ showStopConfirm: true })
    useRecordingStore.getState().confirmStop(false)
    expect(useRecordingStore.getState().showStopConfirm).toBe(false)
    expect(arg).toBe(false)
  })

  it('pause/resume/manualSummary 인텐트가 등록 핸들러로 위임', () => {
    const log: string[] = []
    useRecordingStore.getState().registerHandlers({
      onPause(){ log.push('p') }, onResume(){ log.push('r') }, onStop(){},
      onManualSummary(){ log.push('m') }, onToggleSystemAudio(){}, onSetSummaryInterval(){}, onReset(){},
    })
    const g = useRecordingStore.getState()
    g.pause(); g.resume(); g.manualSummary()
    expect(log).toEqual(['p', 'r', 'm'])
  })

  it('endSession: activeMeetingId=null, status=stopped로 정리', () => {
    useRecordingStore.getState().start(7)
    useRecordingStore.getState().publish({ status: 'recording' })
    useRecordingStore.getState().endSession()
    const s = useRecordingStore.getState()
    expect(s.activeMeetingId).toBeNull()
    expect(s._handlers).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/stores/__tests__/recordingStore.test.ts` Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** `frontend/src/stores/recordingStore.ts`

```ts
import { create } from 'zustand'
import { useTranscriptStore } from './transcriptStore'
import { DEFAULT_SUMMARY_INTERVAL_SEC } from '../config'
import type { RecordingState, RecHandlers, RecStatus } from './recordingStore.types'

const initial = {
  activeMeetingId: null as number | null,
  pendingStart: false,
  status: 'idle' as RecStatus,
  meetingApiStatus: null as 'pending' | 'recording' | 'completed' | null,
  isPaused: false,
  elapsedSeconds: 0,
  summaryCountdown: 0,
  summaryIntervalSec: DEFAULT_SUMMARY_INTERVAL_SEC,
  canManualSummary: false,
  systemAudioEnabled: false,
  isResetting: false,
  isStopping: false,
  error: null as string | null,
  sttEngine: null as string | null,
  activeSttMode: 'server' as 'server' | 'local',
  isApplyingCorrections: false,
  showStopConfirm: false,
  _handlers: null as RecHandlers | null,
}

/** 녹음 세션 스토어. 세션-로컬 상태 + 인텐트만 — 전사/요약/공유는 기존 전역 store 직독.
 *  세션(RecordingSession)이 publish()로 상태를 올리고 registerHandlers()로 제어를 등록한다.
 *  페이지·바는 이 스토어를 읽고 인텐트를 호출한다. */
export const useRecordingStore = create<RecordingState>((set, get) => ({
  ...initial,
  start: (meetingId) => {
    if (get().activeMeetingId === meetingId) return
    set({ activeMeetingId: meetingId, pendingStart: true, status: 'idle' })
  },
  pause: () => get()._handlers?.onPause(),
  resume: () => get()._handlers?.onResume(),
  requestStop: () => {
    if (useTranscriptStore.getState().finals.length === 0) {
      get()._handlers?.onStop(true)
      return
    }
    set({ showStopConfirm: true })
  },
  cancelStop: () => set({ showStopConfirm: false }),
  confirmStop: (skipSummary) => { set({ showStopConfirm: false }); get()._handlers?.onStop(skipSummary) },
  manualSummary: () => get()._handlers?.onManualSummary(),
  toggleSystemAudio: (next) => get()._handlers?.onToggleSystemAudio(next),
  setSummaryInterval: (sec) => { set({ summaryIntervalSec: sec }); get()._handlers?.onSetSummaryInterval(sec) },
  resetMeeting: () => get()._handlers?.onReset(),
  setApplyingCorrections: (v) => set({ isApplyingCorrections: v }),
  publish: (partial) => set(partial),
  registerHandlers: (h) => set({ _handlers: h }),
  consumePendingStart: () => set({ pendingStart: false }),
  endSession: () => set({ ...initial }),
}))
```

`frontend/src/stores/recordingStore.types.ts` — Interfaces 블록의 타입 3개(`RecStatus`, `RecHandlers`, `RecordingState`)를 그대로 export. (순환 import 회피용 별도 파일.)

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd frontend && npx vitest run src/stores/__tests__/recordingStore.test.ts` Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/stores/recordingStore.ts frontend/src/stores/recordingStore.types.ts frontend/src/stores/__tests__/recordingStore.test.ts
git commit -m "feat(recording): 세션 스토어 — 세션-로컬 상태 + 인텐트 위임"
```

---

## Task 3: useLiveRecording 입출력 디커플 (동작 무변경)

**목표:** 훅을 페이지-결합 입력에서 떼어내되, **페이지는 아직 훅을 직접 호출**(동작 무변경, 회귀 0). 이후 Task 4가 세션으로 옮긴다.

**Files:**
- Modify: `frontend/src/hooks/useLiveRecording.ts`
- Modify: `frontend/src/pages/MeetingLivePage.tsx`(showStatus 인자 제거 호출부만 — 잠정)
- Test: `frontend/src/hooks/__tests__/useLiveRecording.decouple.test.tsx`(toast 경유 확인)

**Interfaces:**
- 변경 전: `useLiveRecording(meetingId, { showStatus, isApplyingCorrections, clearMemoEditor })`.
- 변경 후: `useLiveRecording(meetingId, { isApplyingCorrections, clearMemoEditor })`. 내부 `showStatus`는 `useToastStore.getState().showStatus`로 대체.
- Produces(반환에 추가): `performStop: (skipSummary: boolean) => Promise<void>`(기존 내부 함수 노출 — Task 4가 onStop으로 등록). 나머지 반환 동일.

- [ ] **Step 1: 실패 테스트 작성** — toast 경유 검증. `useLiveRecording`은 무거우니 핵심만: showStatus 호출이 toastStore로 흐르는지 얇은 통합으로.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useToastStore } from '../../stores/toastStore'
// performStop 노출 + showStatus 디커플은 타입/런타임 계약 — 컴파일 + 아래 스모크로 가드.

describe('useLiveRecording decouple', () => {
  beforeEach(() => useToastStore.getState().clear())
  it('toastStore.showStatus가 존재하고 호출 가능(전역 토스트 경유 계약)', () => {
    useToastStore.getState().showStatus('회의 종료 중...', 100)
    expect(useToastStore.getState().message).toBe('회의 종료 중...')
  })
})
```

(주: 전체 훅 렌더 테스트는 캡처 모킹이 과해 비용 큼 — 디커플은 타입 시그니처 변경 + 기존 페이지 테스트 회귀로 가드. 행동 보존이 핵심이라 신규 행동 테스트는 최소.)

- [ ] **Step 2: 테스트 실패/현황 확인** — Run: `cd frontend && npx vitest run src/hooks/__tests__/useLiveRecording.decouple.test.tsx` Expected: PASS(토스트 스토어는 Task1 존재) — 이 테스트는 계약 스모크. 본 작업의 RED는 tsc(아래).

- [ ] **Step 3: 구현 — showStatus 디커플**

`useLiveRecording.ts`:
- import 추가: `import { useToastStore } from '../stores/app... '` → 정확히 `import { useToastStore } from '../stores/toastStore'`.
- 옵션 타입에서 `showStatus` 제거: `interface UseLiveRecordingOptions { isApplyingCorrections: boolean; clearMemoEditor: () => void }`.
- 시그니처에서 구조분해 `showStatus` 제거.
- 본문 최상단에 지역 헬퍼: `const showStatus = (msg: string, durationMs?: number) => useToastStore.getState().showStatus(msg, durationMs)`. (본문 내 모든 `showStatus(...)` 호출 그대로 동작.)
- 반환 객체에 `performStop`을 추가: `return { ..., performStop } as const`. (이미 정의된 `performStop` 함수 노출.)
- **recordingDenied navigate 게이트**(251-257 effect): 훅이 라우트 무관 세션으로 옮겨지므로, 다른 라우트(대시보드 등)에 있을 때 2번째 클라 레이스로 `navigate('.../viewer')`가 발화하면 사용자를 엉뚱하게 끌어간다. navigate를 **현재 이 회의의 live 라우트일 때만** 실행하도록 가드:
  ```ts
  if (window.location.pathname === `/meetings/${meetingId}/live`) {
    navigate(`/meetings/${meetingId}/viewer`, { replace: true })
  }
  ```
  (캡처 중지/discard는 그대로. navigate만 게이트.)

`MeetingLivePage.tsx`(잠정 — Task 8이 대체):
- `useLiveRecording(meetingId, { showStatus, isApplyingCorrections, clearMemoEditor: ... })` → `showStatus` 인자 제거.
- 페이지의 `useStatusMessage`는 유지하되, `showStatus`를 toastStore로 교체: `const showStatus = useToastStore((s) => s.showStatus)`. `statusMessage`는 `useToastStore((s) => s.message)`로. (LiveStatusBar에 그대로 전달.)
- import `useToastStore` 추가, `useStatusMessage` 사용 제거.

- [ ] **Step 4: 전체 테스트 + 타입 확인** — Run: `cd frontend && npx vitest run && npx tsc --noEmit` Expected: 기존 테스트 green 유지, tsc 0. (showStatus 제거로 깨지는 호출부가 있으면 전부 toastStore 경유로 수정.)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/hooks/useLiveRecording.ts frontend/src/pages/MeetingLivePage.tsx frontend/src/hooks/__tests__/useLiveRecording.decouple.test.tsx
git commit -m "refactor(recording): useLiveRecording showStatus→전역토스트 디커플 + performStop 노출 (동작 무변경)"
```

---

## Task 4: RecordingSession + RecordingHost (세션을 store에 브리지)

**목표:** `useLiveRecording`을 헤드리스 컴포넌트로 옮기고 store에 publish/register. 아직 App에 마운트 안 함(Task 9). 페이지는 여전히 자체 훅 호출(Task 8 전까지 공존하지 않도록 — Host 미마운트라 중복 없음).

**Files:**
- Create: `frontend/src/components/recording/RecordingSession.tsx`
- Create: `frontend/src/components/recording/RecordingHost.tsx`
- Test: `frontend/src/components/recording/__tests__/RecordingHost.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useRecordingStore`(activeMeetingId, pendingStart, publish, registerHandlers, consumePendingStart, endSession), Task 3 `useLiveRecording`(+performStop).
- Produces: `<RecordingHost/>`(default export 아님, named). 내부에서 `activeMeetingId != null`일 때만 `<RecordingSession meetingId={activeMeetingId} startOnMount={pendingStart} />` 렌더.

- [ ] **Step 1: 실패 테스트 작성** `__tests__/RecordingHost.test.tsx` — useLiveRecording을 모킹해 호출 횟수/마운트 분기만 검증.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRecordingStore } from '../../../stores/recordingStore'

const liveMock = vi.fn(() => ({
  isActive: false, isPaused: false, elapsedSeconds: 0, status: 'idle',
  meetingApiStatus: 'pending', summaryCountdown: 0, summaryIntervalSec: 120,
  canManualSummary: false, systemAudioEnabled: false, isResetting: false,
  isStopping: false, error: null, sttEngine: null, activeSttMode: 'server',
  handlePause(){}, handleResume(){}, performStop: async () => {}, handleManualSummary(){},
  handleToggleSystemAudio(){}, setSummaryIntervalSec(){}, handleResetConfirm: async () => {},
  handleStart: vi.fn(),
}))
vi.mock('../../../hooks/useLiveRecording', () => ({ useLiveRecording: (...a: unknown[]) => liveMock(...(a as [])) }))

import { RecordingHost } from '../RecordingHost'

const wrap = () => render(<MemoryRouter><RecordingHost /></MemoryRouter>)

describe('RecordingHost', () => {
  beforeEach(() => { liveMock.mockClear(); useRecordingStore.getState().endSession() })

  it('activeMeetingId null이면 useLiveRecording 미실행', () => {
    wrap()
    expect(liveMock).not.toHaveBeenCalled()
  })

  it('activeMeetingId 설정되면 useLiveRecording 1회 실행(단일 소유자)', () => {
    const { rerender } = wrap()
    useRecordingStore.getState().start(99)
    rerender(<MemoryRouter><RecordingHost /></MemoryRouter>)
    expect(liveMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/RecordingHost.test.tsx` Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현**

`RecordingSession.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { useLiveRecording } from '../../hooks/useLiveRecording'
import { useRecordingStore } from '../../stores/recordingStore'
import { useTranscriptStore } from '../../stores/transcriptStore'

/** 헤드리스 라이브 세션. RecordingHost에서만 마운트. useLiveRecording을 유일하게 실행하고
 *  상태를 recordingStore에 publish + 제어 핸들러를 register한다. UI 렌더 없음(null). */
export function RecordingSession({ meetingId, startOnMount }: { meetingId: number; startOnMount: boolean }) {
  const live = useLiveRecording(meetingId, {
    isApplyingCorrections: useRecordingStore((s) => s.isApplyingCorrections),
    clearMemoEditor: () => {/* 리셋 메모clear는 페이지-로컬(Task 8) — 세션에선 noop */},
  })

  // pendingStart 소비 → handleStart 1회
  const startedRef = useRef(false)
  useEffect(() => {
    if (!startOnMount || startedRef.current) return
    startedRef.current = true
    useRecordingStore.getState().consumePendingStart()
    void live.handleStart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOnMount])

  // 핸들러 등록(렌더마다 최신 클로저로 갱신)
  useEffect(() => {
    useRecordingStore.getState().registerHandlers({
      onPause: live.handlePause,
      onResume: live.handleResume,
      // 종료 완료 후 endSession() → activeMeetingId=null → 세션 언마운트.
      // 이게 없으면 activeMeetingId가 stuck → start() early-return으로 재개(reopen) 불가.
      // 언마운트로 key(activeMeetingId) 변경 → 다음 start 시 startedRef 초기화된 새 세션 → handleStart 재발화.
      onStop: (skip) => { void Promise.resolve(live.performStop(skip)).then(() => useRecordingStore.getState().endSession()) },
      onManualSummary: live.handleManualSummary,
      onToggleSystemAudio: (next) => { void live.handleToggleSystemAudio(next) },
      onSetSummaryInterval: live.setSummaryIntervalSec,
      onReset: live.handleResetConfirm,
    })
  })

  // 상태 publish
  const finalsCount = useTranscriptStore((s) => s.finals.length)
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)
  useEffect(() => {
    useRecordingStore.getState().publish({
      status: live.isActive ? 'recording' : (live.meetingApiStatus === 'completed' ? 'stopped' : 'idle'),
      meetingApiStatus: live.meetingApiStatus,
      isPaused: live.isPaused,
      elapsedSeconds: live.elapsedSeconds,
      summaryCountdown: live.summaryCountdown,
      summaryIntervalSec: live.summaryIntervalSec,
      canManualSummary: live.canManualSummary,
      systemAudioEnabled: live.systemAudioEnabled,
      isResetting: live.isResetting,
      isStopping: live.isStopping,
      error: live.error ?? live.systemAudioError ?? null,
      sttEngine: live.sttEngine,
      activeSttMode: live.activeSttMode,
    })
  }, [live.isActive, live.meetingApiStatus, live.isPaused, live.elapsedSeconds,
      live.summaryCountdown, live.summaryIntervalSec, live.canManualSummary,
      live.systemAudioEnabled, live.isResetting, live.isStopping, live.error,
      live.systemAudioError, live.sttEngine, live.activeSttMode, finalsCount, isSummarizing])

  return null
}
```

`RecordingHost.tsx`:

```tsx
import { useRecordingStore } from '../../stores/recordingStore'
import { RecordingSession } from './RecordingSession'

/** activeMeetingId가 설정되면 헤드리스 세션을 마운트한다. GatedApp(영속)에 마운트되어
 *  라우트가 바뀌어도 언마운트되지 않으므로 녹음이 페이지 이탈에도 계속된다. */
export function RecordingHost() {
  const activeMeetingId = useRecordingStore((s) => s.activeMeetingId)
  const pendingStart = useRecordingStore((s) => s.pendingStart)
  if (activeMeetingId == null) return null
  return <RecordingSession key={activeMeetingId} meetingId={activeMeetingId} startOnMount={pendingStart} />
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/RecordingHost.test.tsx` Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/recording/RecordingSession.tsx frontend/src/components/recording/RecordingHost.tsx frontend/src/components/recording/__tests__/RecordingHost.test.tsx
git commit -m "feat(recording): RecordingHost/Session — useLiveRecording을 앱 레벨 헤드리스로 (단일 소유자)"
```

---

## Task 5: RecordingBar (떠다니는 하단 바)

**Files:**
- Create: `frontend/src/components/recording/RecordingBar.tsx`
- Test: `frontend/src/components/recording/__tests__/RecordingBar.test.tsx`

**Interfaces:**
- Consumes: `useRecordingStore`(activeMeetingId, status, isPaused, elapsedSeconds, summaryCountdown, canManualSummary, intents), `useTranscriptStore`(finals 마지막 발화, isSummarizing), `useLocation`/`useNavigate`(라우트 비교/복귀).
- 표시 조건: `activeMeetingId != null && status === 'recording' && location.pathname !== '/meetings/{activeMeetingId}/live'`.

- [ ] **Step 1: 실패 테스트 작성** `__tests__/RecordingBar.test.tsx`

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RecordingBar } from '../RecordingBar'
import { useRecordingStore } from '../../../stores/recordingStore'
import { useTranscriptStore } from '../../../stores/transcriptStore'

const renderAt = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><RecordingBar /></MemoryRouter>)

describe('RecordingBar', () => {
  beforeEach(() => { useRecordingStore.getState().endSession(); useTranscriptStore.getState().reset() })

  it('녹음 중 + 다른 라우트면 표시', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording', elapsedSeconds: 754 })
    renderAt('/meetings')
    expect(screen.getByText('12:34')).toBeInTheDocument()
  })

  it('녹음 중이지만 해당 회의 라이브 라우트면 숨김', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording' })
    const { container } = renderAt('/meetings/5/live')
    expect(container).toBeEmptyDOMElement()
  })

  it('idle이면 숨김', () => {
    const { container } = renderAt('/meetings')
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/RecordingBar.test.tsx` Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** `RecordingBar.tsx` — 하단 전체폭, 아이콘 컨트롤(폭 최소, title/aria-label).

```tsx
import { useLocation, useNavigate } from 'react-router-dom'
import { Pause, Play, Sparkles, Maximize2, Square } from 'lucide-react'
import { useRecordingStore } from '../../stores/recordingStore'
import { useTranscriptStore } from '../../stores/transcriptStore'

function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 떠다니는 녹음바. 녹음 중 + 해당 회의 라이브 라우트가 아닐 때 하단 전체폭으로 표시.
 *  아이콘 컨트롤(요약/일시정지/돌아가기/종료) + 마지막 발화 미리보기. */
export function RecordingBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeMeetingId = useRecordingStore((s) => s.activeMeetingId)
  const status = useRecordingStore((s) => s.status)
  const isPaused = useRecordingStore((s) => s.isPaused)
  const elapsedSeconds = useRecordingStore((s) => s.elapsedSeconds)
  const summaryCountdown = useRecordingStore((s) => s.summaryCountdown)
  const canManualSummary = useRecordingStore((s) => s.canManualSummary)
  const lastFinal = useTranscriptStore((s) => s.finals[s.finals.length - 1])
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)

  if (activeMeetingId == null || status !== 'recording') return null
  if (location.pathname === `/meetings/${activeMeetingId}/live`) return null

  const store = useRecordingStore.getState()
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 flex items-center gap-3 px-4 py-2 bg-gray-900 text-white shadow-[0_-2px_8px_rgba(0,0,0,0.2)]">
      <span className="flex items-center gap-1.5 shrink-0 font-medium">
        <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}`} />
        {fmt(elapsedSeconds)}
      </span>
      <span className="flex-1 truncate text-sm text-gray-300">
        {isSummarizing ? '요약 중…' : (lastFinal ? `${lastFinal.speakerLabel ?? ''} ${lastFinal.text}`.trim() : '듣는 중…')}
      </span>
      <span className="shrink-0 text-xs text-gray-400 tabular-nums">⏱{fmt(summaryCountdown)}</span>
      <button title="지금 요약" aria-label="지금 요약" disabled={!canManualSummary}
        onClick={() => store.manualSummary()} className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40">
        <Sparkles className={`w-4 h-4 ${isSummarizing ? 'animate-spin' : ''}`} />
      </button>
      <button title={isPaused ? '재개' : '일시정지'} aria-label={isPaused ? '재개' : '일시정지'}
        onClick={() => (isPaused ? store.resume() : store.pause())} className="p-1.5 rounded hover:bg-white/10">
        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      </button>
      <button title="회의로 돌아가기" aria-label="회의로 돌아가기"
        onClick={() => navigate(`/meetings/${activeMeetingId}/live`)} className="p-1.5 rounded hover:bg-white/10">
        <Maximize2 className="w-4 h-4" />
      </button>
      <button title="녹음 종료" aria-label="녹음 종료"
        onClick={() => store.requestStop()} className="p-1.5 rounded bg-red-600 hover:bg-red-500">
        <Square className="w-4 h-4" />
      </button>
    </div>
  )
}
```

(주: `lastFinal.speakerLabel`/`.text` 필드명은 transcriptStore의 final 타입에 맞춘다 — 구현 시 `transcriptStore.ts`의 finals 요소 타입 확인하여 정확한 필드명 사용. 미리보기 텍스트만 쓰므로 안전한 옵셔널 접근.)

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/RecordingBar.test.tsx && npx tsc --noEmit` Expected: PASS, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/recording/RecordingBar.tsx frontend/src/components/recording/__tests__/RecordingBar.test.tsx
git commit -m "feat(recording): 떠다니는 녹음바 — 하단 전체폭 + 미리보기 + 아이콘 컨트롤"
```

---

## Task 6: RecordingLayer + 전역 종료 다이얼로그

**Files:**
- Create: `frontend/src/components/recording/RecordingLayer.tsx`
- Test: `frontend/src/components/recording/__tests__/RecordingLayer.test.tsx`

**Interfaces:**
- Consumes: Task 4 `RecordingHost`, Task 5 `RecordingBar`, 기존 `StopMeetingDialog`, `useRecordingStore`(showStopConfirm, confirmStop, cancelStop).
- Produces: `<RecordingLayer/>` — App이 마운트할 단일 컴포넌트.

- [ ] **Step 1: 실패 테스트 작성** — showStopConfirm일 때 다이얼로그 렌더 + 버튼이 store 인텐트 호출.

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RecordingLayer } from '../RecordingLayer'
import { useRecordingStore } from '../../../stores/recordingStore'

describe('RecordingLayer 전역 종료확인', () => {
  beforeEach(() => useRecordingStore.getState().endSession())

  it('showStopConfirm=true면 StopMeetingDialog 렌더', () => {
    useRecordingStore.setState({ showStopConfirm: true })
    render(<MemoryRouter><RecordingLayer /></MemoryRouter>)
    // StopMeetingDialog의 식별 텍스트(요약/건너뛰기/취소 중 하나) 존재
    expect(screen.getByText(/종료/)).toBeInTheDocument()
  })
})
```

(주: StopMeetingDialog의 실제 버튼 라벨을 구현 시 확인해 정확한 텍스트로 단언.)

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/RecordingLayer.test.tsx` Expected: FAIL(모듈 없음).

- [ ] **Step 3: 구현** `RecordingLayer.tsx`

```tsx
import { RecordingHost } from './RecordingHost'
import { RecordingBar } from './RecordingBar'
import { StopMeetingDialog } from '../meeting/StopMeetingDialog'
import { useRecordingStore } from '../../stores/recordingStore'

/** 앱 레벨 녹음 레이어 — GatedApp에 단일 마운트. 영속 세션 호스트 + 떠다니는 바 +
 *  전역 종료확인 다이얼로그(어느 라우트서든 바의 [종료]가 띄움). */
export function RecordingLayer() {
  const showStopConfirm = useRecordingStore((s) => s.showStopConfirm)
  const confirmStop = useRecordingStore((s) => s.confirmStop)
  const cancelStop = useRecordingStore((s) => s.cancelStop)
  return (
    <>
      <RecordingHost />
      <RecordingBar />
      {showStopConfirm && (
        <StopMeetingDialog
          onSummarize={() => confirmStop(false)}
          onSkip={() => confirmStop(true)}
          onCancel={cancelStop}
        />
      )}
    </>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/RecordingLayer.test.tsx` Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/recording/RecordingLayer.tsx frontend/src/components/recording/__tests__/RecordingLayer.test.tsx
git commit -m "feat(recording): RecordingLayer — 호스트+바+전역 종료확인 단일 마운트"
```

---

## Task 7: useNavigationGuards 이탈 차단 제거

**Files:**
- Modify: `frontend/src/hooks/useNavigationGuards.ts`
- Test: `frontend/src/hooks/__tests__/useNavigationGuards.test.tsx`

**목표:** 녹음 중 이탈 **차단 제거**(자유 네비). 웹(`!IS_TAURI`) `beforeunload` 경고만 유지(탭/창 닫기 손실 경고).

**Interfaces:**
- 변경 후 반환: `{ handleNavigateBack }`만(showLeaveBlock/setShowLeaveBlock 제거). `handleNavigateBack`은 항상 미리보기로 네비(차단 없음).

- [ ] **Step 1: 실패 테스트 작성** `__tests__/useNavigationGuards.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }))
import { useNavigationGuards } from '../useNavigationGuards'

describe('useNavigationGuards (반전: 차단 없음)', () => {
  it('녹음 중에도 handleNavigateBack이 즉시 미리보기로 네비(차단 안 함)', () => {
    navigate.mockClear()
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    result.current.handleNavigateBack()
    expect(navigate).toHaveBeenCalledWith('/meetings/7')
  })
  it('반환에 showLeaveBlock 없음(차단 UI 제거)', () => {
    const { result } = renderHook(() => useNavigationGuards(7, true), { wrapper: MemoryRouter })
    expect('showLeaveBlock' in result.current).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/hooks/__tests__/useNavigationGuards.test.tsx` Expected: FAIL(현재 showLeaveBlock 반환 + 차단).

- [ ] **Step 3: 구현** `useNavigationGuards.ts` 전체 교체

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IS_TAURI } from '../config'

/**
 * 라이브 녹음 중 네비게이션 정책.
 *
 * B(백그라운드 녹음): 이탈 차단 제거 — 녹음 중에도 자유롭게 페이지를 떠날 수 있고
 * 녹음은 앱 레벨 세션에서 계속된다. 웹(브라우저)에서만 beforeunload 경고를 유지한다
 * (탭/창을 닫으면 JS가 죽어 녹음이 끊기므로). 데스크톱(Tauri)은 닫기=창 숨김이라 손실 없음.
 */
export function useNavigationGuards(meetingId: number, isActive: boolean) {
  const navigate = useNavigate()

  const handleNavigateBack = () => navigate(`/meetings/${meetingId}`)

  // 웹 한정: 녹음 중 탭/창 닫기·새로고침 경고(브라우저 기본 다이얼로그)
  useEffect(() => {
    if (IS_TAURI || !isActive) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  return { handleNavigateBack }
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `cd frontend && npx vitest run src/hooks/__tests__/useNavigationGuards.test.tsx` Expected: PASS.

> **⚠️ 실행자 경고(T7):** 이 변경 후 `tsc`는 `MeetingLivePage.tsx`가 `showLeaveBlock`/`setShowLeaveBlock`를 참조해 **RED가 정상이다**(Task 8이 해소). 이 태스크는 **vitest green만** 게이트로 삼는다. **`MeetingLivePage.tsx`를 절대 수정하지 말 것** — 수정하면 Task 8과 충돌해 시퀀스가 깨진다. `useNavigationGuards.ts`와 그 테스트만 건드린다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/hooks/useNavigationGuards.ts frontend/src/hooks/__tests__/useNavigationGuards.test.tsx
git commit -m "refactor(recording): 이탈 차단 제거(자유 네비), 웹 beforeunload 경고만 유지"
```

(주: Task 7과 Task 8은 tsc 상호의존 — 둘을 연속 실행하고 Task 8 끝에서 tsc 0 확인. 중간 커밋은 vitest green 기준.)

---

## Task 8: MeetingLivePage 페이지=뷰 (attach-vs-init) — 핵심

**Files:**
- Modify: `frontend/src/pages/MeetingLivePage.tsx`
- Test: `frontend/src/pages/__tests__/MeetingLivePage.attach.test.tsx`

**목표:** 페이지가 `useLiveRecording`을 **직접 호출하지 않는다**. recordingStore를 읽어 라이브 뷰를 렌더하고, 시작/일시정지/종료/요약/리셋을 store 인텐트로 보낸다. `meeting` 표시 데이터는 페이지가 자체 fetch.

**⚠️ tsc는 잘못된 매핑을 못 잡는다**(`handlePause → rec.resume`도 컴파일 통과). 그래서:
- [ ] **Step 0a: 기존 테스트 파악** — Run: `grep -rl "MeetingLivePage" frontend/src --include="*.test.tsx"` + `grep -rn "live\." frontend/src/pages/MeetingLivePage.tsx | wc -l`. 기존 페이지 테스트가 얇으면(거의 없음) 매핑 회귀를 tsc로만 못 막으므로 Step 1의 동작 단언을 반드시 추가.
- [ ] **Step 0b: 매핑 체크리스트 작성** — 아래 Step 3의 `live.X → rec.Y` 표를 그대로 따라가며 1:1 확인. 추측 금지.

**Interfaces:**
- Consumes: `useRecordingStore`(상태 전체 + 인텐트), `useTranscriptStore`, `getMeeting`(표시), `useNavigationGuards`(반전됨).
- 핵심 파생: `const isActive = status === 'recording' && activeMeetingId === meetingId`.

- [ ] **Step 1: 실패 테스트 작성** `__tests__/MeetingLivePage.attach.test.tsx` — 단일 소유자 + **인텐트 배선 동작 단언**(잘못된 매핑 가드). 종료 버튼 클릭 → `rec.requestStop` 발화, 일시정지 → `rec.pause`.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useRecordingStore } from '../../stores/recordingStore'

const liveSpy = vi.fn()
vi.mock('../../hooks/useLiveRecording', () => ({ useLiveRecording: (...a: unknown[]) => { liveSpy(...(a as [])); return {} } }))
// 페이지의 무거운 자식들 경량 모킹
vi.mock('../../api/meetings', async (o) => ({ ...(await o() as object), getMeeting: vi.fn().mockResolvedValue({ id: 5, title: 'T', status: 'recording', created_by: { id: 1 } }) }))

import MeetingLivePage from '../MeetingLivePage'

describe('MeetingLivePage 단일 소유자', () => {
  beforeEach(() => { liveSpy.mockClear(); useRecordingStore.getState().endSession() })

  const renderLive = () => render(
    <MemoryRouter initialEntries={['/meetings/5/live']}>
      <Routes><Route path="/meetings/:id/live" element={<MeetingLivePage />} /></Routes>
    </MemoryRouter>,
  )

  it('페이지는 useLiveRecording을 직접 호출하지 않는다(좀비 캡처 방지)', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording' })
    renderLive()
    expect(liveSpy).not.toHaveBeenCalled()
  })

  it('종료 버튼이 rec.requestStop을 호출(매핑 회귀 가드)', () => {
    useRecordingStore.getState().start(5)
    useRecordingStore.getState().publish({ status: 'recording' })
    const spy = vi.spyOn(useRecordingStore.getState(), 'requestStop')
    renderLive()
    // 데스크톱/모바일 컨트롤의 종료 버튼(aria-label 또는 텍스트)으로 클릭 — 실제 라벨 확인해 셀렉터 맞춤
    // 예: fireEvent.click(screen.getByRole('button', { name: /종료/ }))
    // expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

(주: 종료/일시정지 버튼은 `DesktopRecordControls`/`MobileRecordControls` 내부 — 실제 aria-label/텍스트를 구현 시 확인해 `getByRole('button', { name: ... })`로 클릭 단언. 위 주석 라인을 실제 단언으로 활성화. 헤드리스 환경에선 isDesktop 분기에 맞춰 한쪽만 렌더되므로 `useMediaQuery` 모킹 또는 양쪽 라벨 중 존재하는 것 선택.)

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd frontend && npx vitest run src/pages/__tests__/MeetingLivePage.attach.test.tsx` Expected: FAIL(현재 페이지가 useLiveRecording 호출).

- [ ] **Step 3: 구현** — `MeetingLivePage.tsx` 리팩토링. 핵심 변경:

1. `import { useLiveRecording }` **제거**. `import { useRecordingStore } from '../stores/recordingStore'` 추가. `getMeeting` import 유지.
2. `const live = useLiveRecording(...)` 블록 **삭제**. 대신:
   ```tsx
   const meetingId = Number(id)
   const rec = useRecordingStore()
   const isActive = rec.status === 'recording' && rec.activeMeetingId === meetingId
   const isThisSession = rec.activeMeetingId === meetingId
   // 표시 데이터(제목/메모 등)는 페이지가 자체 로드
   const [meeting, setMeeting] = useState<Meeting | null>(null)
   const [meetingMemo, setMeetingMemo] = useState<string | null>(null)
   useEffect(() => {
     getMeeting(meetingId).then((m) => { setMeeting(m); if (m.memo) setMeetingMemo(m.memo) }).catch(() => {})
   }, [meetingId])
   ```
3. 라이브 상태/핸들러 매핑(기존 `live.*` → `rec.*`):
   - `isPaused` → `isThisSession ? rec.isPaused : false`
   - `elapsedSeconds` → `isThisSession ? rec.elapsedSeconds : 0`
   - `summaryCountdown`/`summaryIntervalSec`/`canManualSummary`/`systemAudioEnabled`/`isResetting`/`isStopping`/`error`/`sttEngine`/`activeSttMode`/`meetingApiStatus` → `isThisSession ? rec.X : <기본>`
   - `handleStart` → `() => rec.start(meetingId)`
   - `handlePause` → `rec.pause`, `handleResume` → `rec.resume`
   - `handleStop` → `rec.requestStop`
   - `handleManualSummary` → `rec.manualSummary`
   - `handleToggleSystemAudio` → `rec.toggleSystemAudio`
   - `setSummaryIntervalSec` → `rec.setSummaryInterval`
   - `handleResetClick`/`showResetConfirm`/`setShowResetConfirm` → 페이지-로컬 useState 유지(리셋 다이얼로그). `handleResetConfirm` → `async () => { await rec.resetMeeting(); clearMemoEditorRef.current(); setShowResetConfirm(false) }` (메모clear 페이지-로컬).
   - `showStopConfirm` 블록(464-470) **삭제**(전역 RecordingLayer가 처리).
   - `showLeaveBlock` 다이얼로그(430-450) **삭제**(차단 제거).
   - `isSharing`/`isHost`/`currentUserId` → sharingStore에서 직접 계산(기존 hook 로직 이식): `const sharingParticipants = useSharingStore((s)=>s.participants)`, `isSharing = useSharingStore((s)=>s.shareCode!==null)`, currentUserId/isHost는 기존 useLiveRecording 로직(102-105, 583-586) 페이지로 이식.
   - `setMeeting` → 위 로컬 setMeeting 사용.
4. `isApplyingCorrections` 흐름: 기존 `useLiveTermCorrections` 유지. 그 값을 store에 흘림:
   ```tsx
   useEffect(() => { useRecordingStore.getState().setApplyingCorrections(isApplyingCorrections) }, [isApplyingCorrections])
   ```
5. `showStatus`는 Task 3에서 toastStore 경유로 바뀜 — 유지.
6. autoStart effect(86-96): `handleStart()` → `rec.start(meetingId)` 로 교체. 가드 동일.
7. `useNavigationGuards`: 반환이 `{ handleNavigateBack }`만 → `showLeaveBlock` 참조 제거.

(상세: 기존 페이지의 모든 `live.X` 참조를 위 매핑으로 1:1 치환. 자식 컴포넌트 props 시그니처는 불변 — 값 출처만 store로 바뀜.)

- [ ] **Step 4a: 잔여 참조 grep** — Run: `grep -nE "\blive\b|\blive\?\.|\blive\." frontend/src/pages/MeetingLivePage.tsx`. Expected: **0건**(모든 `live.X`가 `rec.X`/로컬로 치환됨). 남으면 매핑 누락 — 수정.
- [ ] **Step 4b: 전체 테스트 + 타입 확인** — Run: `cd frontend && npx vitest run && npx tsc --noEmit` Expected: 신규 attach 테스트 PASS(동작 단언 포함), 기존 테스트 green, tsc 0. (Task 7의 tsc도 여기서 해소.)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/MeetingLivePage.tsx frontend/src/pages/__tests__/MeetingLivePage.attach.test.tsx
git commit -m "refactor(recording): MeetingLivePage 페이지=뷰 — store 읽기 + attach-vs-init (단일 소유자)"
```

---

## Task 9: App에 RecordingLayer 마운트 + 통합 검증

**Files:**
- Modify: `frontend/src/App.tsx`(`GatedApp()`에 1줄 — 사용자 미커밋 `function App()` 비중첩)
- Test: `frontend/src/components/recording/__tests__/persistence.integration.test.tsx`

**Interfaces:**
- Consumes: Task 6 `RecordingLayer`.

- [ ] **Step 1: 실패 테스트 작성** — 라우트를 바꿔도 세션(host)이 언마운트되지 않음(useLiveRecording 1회만 실행)을 통합 검증.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RecordingLayer } from '../RecordingLayer'
import { useRecordingStore } from '../../../stores/recordingStore'

const liveMock = vi.fn(() => ({ /* Task 4 테스트와 동일한 최소 stub */ isActive: true, handleStart: vi.fn() } as never))
vi.mock('../../../hooks/useLiveRecording', () => ({ useLiveRecording: () => liveMock() }))

function App() {
  return (<>
    <Routes>
      <Route path="/a" element={<div>A</div>} />
      <Route path="/b" element={<div>B</div>} />
    </Routes>
    <RecordingLayer />
  </>)
}

// SMOKE 테스트(로컬 App 트리) — 실제 라우트 영속 보장은 수동 E2E #1이 담당.
// 여기선 "세션이 라우트 밖 RecordingLayer에 있어 라우트 변경에 재마운트 안 됨" 구조 속성만 가드.
describe('녹음 지속성(라우트 변경) smoke', () => {
  beforeEach(() => { liveMock.mockClear(); useRecordingStore.getState().endSession() })
  it('세션은 정확히 1회 마운트되고 라우트가 바뀌어도 재마운트되지 않는다', () => {
    const { rerender } = render(<MemoryRouter initialEntries={['/a']}><App /></MemoryRouter>)
    expect(liveMock).not.toHaveBeenCalled() // idle: 미마운트
    useRecordingStore.getState().start(1)
    rerender(<MemoryRouter initialEntries={['/a']}><App /></MemoryRouter>)
    expect(liveMock).toHaveBeenCalledTimes(1) // 마운트 1회
    rerender(<MemoryRouter initialEntries={['/b']}><App /></MemoryRouter>) // 라우트 변경
    expect(liveMock).toHaveBeenCalledTimes(1) // 재마운트 없음 — 녹음 지속
  })
})
```

- [ ] **Step 2: 테스트 실패/현황 확인** — Run: `cd frontend && npx vitest run src/components/recording/__tests__/persistence.integration.test.tsx` Expected: 구현 후 PASS. 핵심=재마운트 없음 회귀 가드(smoke). 실제 영속은 수동 E2E #1.

- [ ] **Step 3: 구현** — `App.tsx` `GatedApp()` 수정. 기존(237-241):

```tsx
    <RecordingRecovery />
    <ScheduledMeetingWatcher />
    <ClosePrompt />
    <SettingsModal />
    <UserManagementModal />
```

→ `<RecordingLayer />` 추가 + import:

```tsx
import { RecordingLayer } from './components/recording/RecordingLayer'
// ...
    <RecordingRecovery />
    <ScheduledMeetingWatcher />
    <ClosePrompt />
    <RecordingLayer />
    <SettingsModal />
    <UserManagementModal />
```

(주의: `function App()`의 파일드롭 가드(사용자 미커밋)는 **건드리지 않는다**. `GatedApp()`만 수정.)

- [ ] **Step 4: 전체 게이트** — Run: `cd frontend && npx vitest run && npx tsc --noEmit && npx vite build` Expected: 전체 green, tsc 0, build OK.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/App.tsx frontend/src/components/recording/__tests__/persistence.integration.test.tsx
git commit -m "feat(recording): GatedApp에 RecordingLayer 마운트 — 백그라운드 녹음 활성화"
```

---

## Self-Review (작성자 체크 결과)

**Spec coverage:**
- 앱 레벨 RecordingHost+Session → T4 ✓ / store 경계 → T2 ✓ / 페이지=뷰 attach-vs-init → T8 ✓ / 떠다니는 바(아이콘+미리보기+요약카운트다운+수동요약+일시정지) → T5 ✓ / 전역 종료확인 → T6 ✓ / showStatus 전역토스트 → T1,T3 ✓ / isApplyingCorrections store → T8 ✓ / 이탈가드 반전 → T7 ✓ / 하트비트·caffeinate·setRecordingActive·타이머 → 훅 따라 자동 이동(T4, useLiveRecording 무변경 본문) ✓ / 데스크톱 백그라운드 = 닫기 hide(코드 변경 불요, 검증만) ✓ / 단일소유자 불변식 테스트 → T4,T8 ✓.
- transcript/sharing init·reset 페이지→세션 이동: T8에서 페이지의 transcript reset/load·sharing init을 **세션 소유**로 옮김 — useLiveRecording 본문(111-125, 575-608)이 이미 그 로직 보유 → 세션(T4)이 실행. 페이지는 표시용 getMeeting만. ✓

**Placeholder scan:** 코드 스텝 전부 실제 코드. transcriptStore final 필드명(speakerLabel/text)은 T5에서 실제 타입 확인 명시. StopMeetingDialog 버튼 라벨은 T6에서 확인 명시.

**Type consistency:** RecHandlers(onPause/onResume/onStop/onManualSummary/onToggleSystemAudio/onSetSummaryInterval/onReset) — T2 정의, T4 등록, store 인텐트가 호출. 일치. `performStop`(T3 노출) → T4 onStop으로 등록. 일치.

**알려진 뉘앙스(검증 대상):**
- 종료 후 전이: 세션이 status='stopped' publish → 페이지가 완료 회의 표시. activeMeetingId 정리 시점은 endSession 호출(performStop 완료 후). 깜빡임 가능 — 수동 E2E 확인.
- transcriptStore reset 소유권: 세션이 시작 시 reset+load. 페이지는 attach 시 reset 안 함(단일 소유자). 회귀 테스트로 가드.

## 수동 E2E 게이트(구현 후)
1. 웹: 녹음 중 다른 회의/대시보드 다녀와도 녹음·전사 유지. 바 표시·미리보기·요약카운트다운·일시정지·돌아가기·종료(전역 확인) 동작.
2. 데스크톱: 녹음 중 창 닫기(백그라운드 유지)→숨김서 녹음 계속(요약 타이머 정확)→복귀 이어짐.
3. A 결합: 백그라운드 중 하트비트 지속(서버 stale 자동종결 안 됨).
4. 회귀: 시작/일시정지/종료/요약/무음완료/오타수정/공유/모바일탭 정상.
