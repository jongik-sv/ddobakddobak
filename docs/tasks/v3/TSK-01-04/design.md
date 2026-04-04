# TSK-01-04: uiStore 모바일 상태 확장 - 설계 문서

> Zustand uiStore에 모바일 메뉴, 회의 상세 탭, 라이브 탭 상태를 추가한다.

**작성일:** 2026-04-04
**상태:** Design
**참조:** PRD 3.1~3.3 (내비게이션, 탭 상태) / WBS TSK-01-04

---

## 1. 현재 상태

### 1.1 uiStore (`frontend/src/stores/uiStore.ts`)

| 상태 | 타입 | 용도 |
|------|------|------|
| `settingsOpen` | boolean | 설정 모달 열림 여부 |
| `sidebarOpen` | boolean | 사이드바 열림 여부 |
| `memoVisible` | boolean | 메모 패널 표시 여부 |
| `attachmentsVisible` | boolean | 첨부파일 패널 표시 여부 |
| `bookmarksVisible` | boolean | 북마크 패널 표시 여부 |
| `isRecordingActive` | boolean | 녹음 활성 상태 |

모두 데스크톱 전용 상태이며, 모바일 레이아웃에 필요한 상태가 없다.

---

## 2. 추가할 상태 및 액션

### 2.1 인터페이스 확장

```typescript
// 탭 타입 정의
type MeetingTab = 'transcript' | 'summary' | 'memo'
type LiveTab = 'transcript' | 'summary' | 'memo'

// UiState 인터페이스에 추가할 필드
interface UiState {
  // ... 기존 필드 유지 ...

  // 모바일 사이드바 오버레이
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void

  // 회의 상세 페이지 활성 탭
  meetingActiveTab: MeetingTab
  setMeetingActiveTab: (tab: MeetingTab) => void

  // 라이브 녹음 페이지 활성 탭
  liveActiveTab: LiveTab
  setLiveActiveTab: (tab: LiveTab) => void
}
```

### 2.2 필드 상세

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `mobileMenuOpen` | `boolean` | `false` | 모바일에서 사이드바 오버레이 표시 여부. 데스크톱에서는 사용하지 않음 |
| `meetingActiveTab` | `MeetingTab` | `'transcript'` | 회의 상세 페이지(MeetingPage)의 모바일 탭 전환 상태 |
| `liveActiveTab` | `LiveTab` | `'transcript'` | 라이브 녹음 페이지(MeetingLivePage)의 모바일 탭 전환 상태 |

### 2.3 설계 근거

- **`MeetingTab`/`LiveTab` 타입 분리**: 현재 WBS 기준 두 페이지 모두 동일한 3탭(`transcript`/`summary`/`memo`)을 사용하지만, 향후 라이브 페이지에 탭이 추가될 가능성을 고려하여 별도 타입으로 선언. 동일한 경우에도 의미적으로 구분됨
- **기본값 `'transcript'`**: 사용자가 회의에 진입할 때 전사 내용이 가장 먼저 보여야 하므로 transcript를 기본 탭으로 설정
- **`mobileMenuOpen`을 기존 `sidebarOpen`과 분리**: 데스크톱의 사이드바 토글(축소/확장)과 모바일의 오버레이 열기/닫기는 다른 UX이므로 별도 상태로 관리. 데스크톱에서 사이드바를 접어도 모바일 메뉴에는 영향 없음
- **페이지 이동 시 탭 상태 유지**: Zustand 전역 스토어에 저장하므로 React Router로 페이지를 이동해도 탭 선택이 유지됨. 앱을 새로고침하면 기본값으로 초기화되며, 이는 의도된 동작

---

## 3. 구현

### 3.1 타입 export

`MeetingTab`과 `LiveTab` 타입을 named export하여 소비 컴포넌트에서 import할 수 있도록 한다.

```typescript
export type MeetingTab = 'transcript' | 'summary' | 'memo'
export type LiveTab = 'transcript' | 'summary' | 'memo'
```

### 3.2 store 확장

기존 `create<UiState>` 콜백 내부에 새 상태와 setter를 추가한다.

```typescript
export const useUiStore = create<UiState>((set) => ({
  // ... 기존 상태 유지 ...

  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

  meetingActiveTab: 'transcript',
  setMeetingActiveTab: (tab) => set({ meetingActiveTab: tab }),

  liveActiveTab: 'transcript',
  setLiveActiveTab: (tab) => set({ liveActiveTab: tab }),
}))
```

### 3.3 변경 범위

| 파일 | 변경 내용 |
|------|----------|
| `frontend/src/stores/uiStore.ts` | `MeetingTab`, `LiveTab` 타입 추가, `UiState` 인터페이스 확장, store 구현 확장 |

신규 파일 생성 없음. 기존 파일 1개만 수정.

---

## 4. 후속 태스크 소비 지점

| 후속 태스크 | 사용하는 상태 | 용도 |
|------------|-------------|------|
| **TSK-01-03** (AppLayout 반응형) | `mobileMenuOpen`, `setMobileMenuOpen` | 모바일 사이드바 오버레이 열기/닫기 |
| **TSK-02-02** (MeetingPage 패널/탭 분기) | `meetingActiveTab`, `setMeetingActiveTab` | 모바일 탭 전환 |
| **TSK-02-04** (MeetingLivePage 패널/탭 분기) | `liveActiveTab`, `setLiveActiveTab` | 모바일 탭 전환 |
| **TSK-02-01** (MobileTabLayout 컴포넌트) | `MeetingTab`, `LiveTab` 타입 | 탭 ID 타입 제약 |

---

## 5. 테스트 전략

### 5.1 단위 테스트 (`frontend/src/stores/__tests__/uiStore.test.ts`)

Zustand store를 직접 호출하여 상태 변경을 검증한다.

```typescript
import { useUiStore } from '../uiStore'

describe('uiStore - 모바일 상태', () => {
  beforeEach(() => {
    // 각 테스트 전 스토어 초기화
    useUiStore.setState({
      mobileMenuOpen: false,
      meetingActiveTab: 'transcript',
      liveActiveTab: 'transcript',
    })
  })

  describe('mobileMenuOpen', () => {
    it('기본값은 false', () => {
      expect(useUiStore.getState().mobileMenuOpen).toBe(false)
    })

    it('setMobileMenuOpen(true)로 열기', () => {
      useUiStore.getState().setMobileMenuOpen(true)
      expect(useUiStore.getState().mobileMenuOpen).toBe(true)
    })

    it('setMobileMenuOpen(false)로 닫기', () => {
      useUiStore.getState().setMobileMenuOpen(true)
      useUiStore.getState().setMobileMenuOpen(false)
      expect(useUiStore.getState().mobileMenuOpen).toBe(false)
    })
  })

  describe('meetingActiveTab', () => {
    it('기본값은 transcript', () => {
      expect(useUiStore.getState().meetingActiveTab).toBe('transcript')
    })

    it('setMeetingActiveTab으로 탭 변경', () => {
      useUiStore.getState().setMeetingActiveTab('summary')
      expect(useUiStore.getState().meetingActiveTab).toBe('summary')
    })

    it('memo 탭으로 전환', () => {
      useUiStore.getState().setMeetingActiveTab('memo')
      expect(useUiStore.getState().meetingActiveTab).toBe('memo')
    })
  })

  describe('liveActiveTab', () => {
    it('기본값은 transcript', () => {
      expect(useUiStore.getState().liveActiveTab).toBe('transcript')
    })

    it('setLiveActiveTab으로 탭 변경', () => {
      useUiStore.getState().setLiveActiveTab('summary')
      expect(useUiStore.getState().liveActiveTab).toBe('summary')
    })
  })

  describe('탭 상태 독립성', () => {
    it('meetingActiveTab과 liveActiveTab은 서로 영향 없음', () => {
      useUiStore.getState().setMeetingActiveTab('memo')
      useUiStore.getState().setLiveActiveTab('summary')
      expect(useUiStore.getState().meetingActiveTab).toBe('memo')
      expect(useUiStore.getState().liveActiveTab).toBe('summary')
    })
  })
})
```

### 5.2 Acceptance Criteria 검증

| 기준 | 검증 방법 |
|------|----------|
| 상태 변경 시 구독 컴포넌트 리렌더링 | Zustand의 기본 동작으로 보장. `useUiStore(s => s.meetingActiveTab)` 셀렉터 사용 시 해당 값 변경에만 리렌더링 |
| 페이지 이동 시 탭 상태 유지 | Zustand 전역 스토어이므로 React Router 이동 시 상태 유지. 단위 테스트에서 setState 후 getState로 확인 |

---

## 6. 체크리스트

- [ ] `MeetingTab`, `LiveTab` 타입 정의 및 export
- [ ] `UiState` 인터페이스에 3개 상태 + 3개 setter 추가
- [ ] store 구현부에 기본값 및 setter 구현
- [ ] 단위 테스트 작성 및 통과
- [ ] 기존 테스트 깨지지 않음 확인
