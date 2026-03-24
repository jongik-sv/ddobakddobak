# TSK-06-02: 회의 목록 페이지 UI - 설계

## 구현 방향

기존 `api/meetings.ts`에 목록 조회 및 생성 함수를 추가하고, `stores/meetingStore.ts`를 신규 생성하여 회의 목록 상태(meetings, pagination, search)를 Zustand로 관리한다. `pages/MeetingsPage.tsx`는 팀 선택 드롭다운, 검색 입력, 회의 목록 카드, 회의 생성 모달로 구성하며, 회의 클릭 시 `/meetings/:id`로 이동한다. 회의 상태(pending/recording/completed)는 배지(badge) 형태로 표시한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/api/meetings.ts` | `getMeetings`, `createMeeting` 함수 추가 + `Meeting` 타입 확장 | 수정 |
| `frontend/src/stores/meetingStore.ts` | 회의 목록/페이지네이션/검색어/선택팀 상태 관리 Zustand 스토어 | 신규 |
| `frontend/src/pages/MeetingsPage.tsx` | 회의 목록 페이지 (검색, 팀 필터, 목록, 생성 모달) | 신규 |

---

## 주요 구조

### `api/meetings.ts` — 추가 함수 및 타입

**`Meeting` 인터페이스 확장**
```ts
export interface Meeting {
  id: number
  title: string
  status: 'pending' | 'recording' | 'completed'
  team: { id: number; name: string }
  created_by: { id: number; name: string }
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export interface MeetingListMeta {
  total: number
  page: number
  per: number
}

export interface MeetingListResponse {
  meetings: Meeting[]
  meta: MeetingListMeta
}
```

**`getMeetings(params)`** — `GET /api/v1/meetings?page=&per=&q=&team_id=`
- 파라미터: `{ page?: number; per?: number; q?: string; team_id?: number }`
- 반환: `MeetingListResponse`

**`createMeeting(data)`** — `POST /api/v1/meetings { title, team_id }`
- 파라미터: `{ title: string; team_id: number }`
- 반환: `Meeting`

---

### `stores/meetingStore.ts` — Zustand 스토어

```ts
interface MeetingState {
  // 상태
  meetings: Meeting[]
  meta: MeetingListMeta | null
  selectedTeamId: number | null
  searchQuery: string
  isLoading: boolean
  error: string | null

  // 액션
  setSelectedTeam: (teamId: number | null) => void
  setSearchQuery: (q: string) => void
  fetchMeetings: (page?: number) => Promise<void>
  addMeeting: (meeting: Meeting) => void
  reset: () => void
}
```

- `fetchMeetings(page)`: `selectedTeamId`, `searchQuery`를 참조하여 `getMeetings()` 호출 후 상태 업데이트
- `setSearchQuery`: 검색어 변경 시 자동으로 `fetchMeetings(1)` 트리거 (디바운스 없이 저장만, 컴포넌트에서 `useEffect`로 처리)
- `addMeeting`: 신규 생성된 회의를 목록 맨 앞에 추가

---

### `pages/MeetingsPage.tsx` — 회의 목록 페이지

**컴포넌트 구성:**
```
MeetingsPage
├── 헤더 영역
│   ├── 팀 선택 <select> (getTeams() 로드)
│   ├── 검색 <input> (debounce 300ms)
│   └── "새 회의" <button> → 생성 모달 오픈
├── 회의 목록
│   ├── MeetingCard (n개)
│   │   ├── 제목
│   │   ├── 팀명
│   │   ├── 상태 배지 (StatusBadge)
│   │   ├── 생성일시 (date-fns format)
│   │   └── 클릭 → navigate('/meetings/:id')
│   └── 빈 상태 메시지 (목록 없을 때)
├── 페이지네이션 (이전/다음 버튼)
└── CreateMeetingModal (조건부 렌더링)
    ├── 회의 제목 <input>
    ├── 팀 선택 <select>
    └── 생성 / 취소 버튼
```

**상태 배지 (`StatusBadge`) 스타일:**
- `pending`: 회색 (`bg-muted text-muted-foreground`) — "대기중"
- `recording`: 빨간색 (`bg-red-100 text-red-700`) + 녹음중 표시 — "녹음중"
- `completed`: 초록색 (`bg-green-100 text-green-700`) — "완료"

**검색 디바운스 처리:**
- `useEffect`에서 `setTimeout 300ms` 사용, 검색어 변경 시 `fetchMeetings(1)` 재호출

**팀 선택 변경 처리:**
- `setSelectedTeam` 호출 후 `fetchMeetings(1)` 재호출

---

## 데이터 흐름

**초기 로드:** `MeetingsPage` 마운트 → `getTeams()` 팀 목록 로드 → 첫 번째 팀 자동 선택 → `fetchMeetings(1)` → 회의 목록 표시

**검색:** 검색어 입력 → 300ms 디바운스 → `fetchMeetings(1, searchQuery)` → 목록 갱신

**회의 생성:** "새 회의" 클릭 → 모달 표시 → 제목/팀 입력 → `createMeeting({ title, team_id })` → `addMeeting(meeting)` → 모달 닫기 → 목록 맨 앞에 추가

**상세 이동:** 회의 카드 클릭 → `navigate('/meetings/:id')`

---

## 선행 조건

- TSK-06-01: `GET /api/v1/meetings`, `POST /api/v1/meetings` 엔드포인트 구현 완료
- TSK-01-06: `getTeams()` API 및 팀 목록 페이지 완료 (팀 선택에 활용)
- `frontend/src/api/teams.ts` — `getTeams()` 이미 구현되어 있음 (재사용)
- `frontend/src/api/client.ts` — JWT 인증 apiClient 이미 구현되어 있음
- React Router `useNavigate` 라우팅 (`/meetings/:id` 경로 등록 필요 여부 확인)
