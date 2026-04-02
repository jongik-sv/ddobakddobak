# TSK-05-03: 회의 공유 UI (호스트) - 설계

## 구현 방향
- 회의 녹음 화면(MeetingLivePage)에 공유 버튼과 참여자 목록을 추가한다.
- 별도의 sharingStore(Zustand)를 생성하여 공유 상태(코드, 참여자, 공유 여부)를 관리한다.
- ActionCable TranscriptionChannel에서 수신하는 participant_joined / participant_left / host_changed 이벤트를 처리하여 참여자 목록을 실시간 업데이트한다.
- TSK-05-01에서 구현된 백엔드 API(share, stopShare, participants, transferHost)를 호출하는 프론트엔드 API 함수를 meetings.ts에 추가한다.
- 호스트 위임 확인은 별도 다이얼로그(HostTransferDialog)로 처리한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/api/meetings.ts` | sharing 관련 API 함수 5개 추가 | 수정 |
| `frontend/src/stores/sharingStore.ts` | 공유 상태 관리 (shareCode, participants, isSharing, isHost) | 신규 |
| `frontend/src/components/meeting/ShareButton.tsx` | 공유 버튼 + 공유 코드 표시 패널 | 신규 |
| `frontend/src/components/meeting/ParticipantList.tsx` | 참여자 목록 (호스트/뷰어 구분, 호스트 넘기기 버튼) | 신규 |
| `frontend/src/components/meeting/HostTransferDialog.tsx` | 호스트 위임 확인 다이얼로그 | 신규 |
| `frontend/src/channels/transcription.ts` | participant_joined / participant_left / host_changed 이벤트 핸들링 추가 | 수정 |
| `frontend/src/pages/MeetingLivePage.tsx` | ShareButton, ParticipantList, HostTransferDialog 통합 | 수정 |

## 주요 구조

### API 함수 추가 (meetings.ts)

```typescript
// --- 공유 API ---

export interface Participant {
  id: number
  user_id: number
  user_name: string
  role: 'host' | 'viewer'
  joined_at: string
}

export interface ShareResponse {
  share_code: string
  participants: Participant[]
}

export interface JoinResponse {
  meeting: Meeting
  participant: Participant
}

export async function shareMeeting(meetingId: number): Promise<ShareResponse> {
  return apiClient.post(`meetings/${meetingId}/share`).json()
}

export async function stopSharing(meetingId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/share`)
}

export async function joinMeeting(shareCode: string): Promise<JoinResponse> {
  return apiClient.post('meetings/join', { json: { share_code: shareCode } }).json()
}

export async function getParticipants(meetingId: number): Promise<Participant[]> {
  const res = await apiClient.get(`meetings/${meetingId}/participants`).json<{ participants: Participant[] }>()
  return res.participants
}

export async function transferHost(meetingId: number, targetUserId: number): Promise<Participant[]> {
  const res = await apiClient.post(`meetings/${meetingId}/transfer_host`, {
    json: { target_user_id: targetUserId },
  }).json<{ participants: Participant[] }>()
  return res.participants
}
```

### sharingStore.ts

```typescript
import { create } from 'zustand'
import type { Participant } from '../api/meetings'

interface SharingState {
  // 상태
  shareCode: string | null
  participants: Participant[]
  isSharing: boolean
  isLoading: boolean

  // 액션
  setShareCode: (code: string | null) => void
  setParticipants: (participants: Participant[]) => void
  addParticipant: (participant: Participant) => void
  removeParticipant: (userId: number) => void
  updateParticipantRole: (userId: number, role: 'host' | 'viewer') => void
  startSharing: (code: string, participants: Participant[]) => void
  stopSharing: () => void
  reset: () => void
}
```

**설계 원칙:**
- `isSharing`은 `shareCode !== null`로 유도할 수 있지만, 명시적 플래그로 관리하여 공유 시작/중지 API 호출 중의 중간 상태를 처리한다.
- `participants` 배열은 항상 host가 먼저 오도록 정렬한다 (role === 'host' 우선).
- `isHost` 판별은 스토어에 두지 않고, 컴포넌트 레벨에서 `participants.find(p => p.role === 'host')?.user_id === currentUserId`로 계산한다. 이렇게 하면 authStore의 사용자 정보와의 결합을 최소화한다.

### ShareButton.tsx

공유 버튼 + 공유 코드 표시 + 중지 버튼을 하나의 컴포넌트로 구현한다.

```
[미공유 상태]
┌─────────────────┐
│ Share2  공유     │  ← 클릭 시 shareMeeting API 호출
└─────────────────┘

[공유 중 상태]
┌──────────────────────────────────┐
│ Share2  A1B2C3  Copy │ X 중지   │
└──────────────────────────────────┘
```

**Props:**
```typescript
interface ShareButtonProps {
  meetingId: number
}
```

**동작 흐름:**
1. 미공유 시: "공유" 버튼 표시 (Share2 아이콘). 클릭 → `shareMeeting(meetingId)` API 호출 → sharingStore에 코드+참여자 저장.
2. 공유 중: 공유 코드 표시 + Copy 아이콘 버튼 (클립보드 복사) + "중지" 버튼 (X 아이콘).
3. 중지 클릭 → `stopSharing(meetingId)` API 호출 → sharingStore 초기화.
4. 복사 시 2초간 "복사됨" 피드백 표시 (Check 아이콘으로 변경).

**아이콘:** `Share2`, `Copy`, `Check`, `X` (lucide-react)

### ParticipantList.tsx

참여자 목록을 사이드바 또는 공유 패널 내에 표시한다.

```
┌──────────────────────────────────┐
│ 참여자 (3)                        │
├──────────────────────────────────┤
│ Crown  홍길동 (나)        호스트   │
│ Eye    김철수         [넘기기]    │
│ Eye    이영희         [넘기기]    │
└──────────────────────────────────┘
```

**Props:**
```typescript
interface ParticipantListProps {
  meetingId: number
  isHost: boolean
}
```

**동작:**
- 참여자 목록을 sharingStore에서 구독하여 표시.
- 호스트(Crown 아이콘) / 뷰어(Eye 아이콘) 구분.
- 현재 사용자가 호스트인 경우(`isHost === true`), 뷰어 옆에 "넘기기" 버튼 표시.
- "넘기기" 클릭 시 HostTransferDialog 열기 (대상 사용자 정보 전달).
- ActionCable 이벤트로 실시간 업데이트.

### HostTransferDialog.tsx

호스트 위임 확인 다이얼로그.

```
┌──────────────────────────────────┐
│ 호스트 위임                       │
│                                  │
│ 정말 김철수에게 호스트를            │
│ 넘기시겠습니까?                    │
│                                  │
│ 호스트를 넘기면 녹음 컨트롤         │
│ 권한이 이동합니다.                 │
│                                  │
│              [취소]  [위임하기]    │
└──────────────────────────────────┘
```

**Props:**
```typescript
interface HostTransferDialogProps {
  open: boolean
  targetUserName: string
  targetUserId: number
  meetingId: number
  onClose: () => void
  onTransferred: () => void
}
```

**동작:**
- "위임하기" 클릭 → `transferHost(meetingId, targetUserId)` API 호출 → 성공 시 sharingStore 참여자 목록 업데이트 + onTransferred 콜백.
- API 호출 중 버튼 비활성화 + "위임 중..." 텍스트.
- 기존 MeetingLivePage의 초기화 확인 다이얼로그와 동일한 스타일.

### ActionCable 이벤트 처리 (transcription.ts 수정)

TranscriptionChannel에서 수신하는 sharing 관련 이벤트 3개를 추가 핸들링한다.

```typescript
// received(raw: BackendMessage) 내부에 추가
case 'participant_joined': {
  const sharingStore = useSharingStore.getState()
  sharingStore.addParticipant({
    id: raw.participant_id,
    user_id: raw.user_id,
    user_name: raw.user_name,
    role: raw.role as 'host' | 'viewer',
    joined_at: raw.joined_at,
  })
  break
}
case 'participant_left': {
  const sharingStore = useSharingStore.getState()
  sharingStore.removeParticipant(raw.user_id)
  break
}
case 'host_changed': {
  const sharingStore = useSharingStore.getState()
  sharingStore.updateParticipantRole(raw.old_host_user_id, 'viewer')
  sharingStore.updateParticipantRole(raw.new_host_user_id, 'host')
  break
}
```

**BackendMessage 타입 확장:**
```typescript
type BackendMessage = {
  // 기존 필드...
  participant_id?: number
  user_id?: number
  user_name?: string
  role?: string
  joined_at?: string
  old_host_user_id?: number
  new_host_user_id?: number
}
```

### MeetingLivePage.tsx 수정

#### 헤더 영역 변경
- 우측 컨트롤 영역에 ShareButton 추가 (녹음 컨트롤 버튼 좌측에 배치).
- 공유 중일 때만 ParticipantList 표시.

#### 레이아웃 배치
```
[헤더 컨트롤 바]
┌─ 좌측: 네비게이션 ─────── 중앙: 녹음 상태 ─── 우측: [공유] [컨트롤 버튼] ─┐

[3영역 레이아웃]
┌─ 기록(20%) ─┬─ AI 회의록(50%) ─┬─ 메모/피드백(30%) ─┐
│              │                  │                    │
│              │                  │                    │
│  RecordTab   │  AiSummaryPanel  │  메모 + 피드백      │
│              │                  │                    │
│  SpeakerPanel│                  │                    │
│              │                  │                    │
│  (공유 중일 때)                  │                    │
│ ParticipantList                 │                    │
└──────────────┴──────────────────┴────────────────────┘
```

- ParticipantList는 기록/화자 영역의 SpeakerPanel 하단에 배치한다.
  - 공유 중(`isSharing === true`)일 때만 렌더링된다.
  - SpeakerPanel과 ParticipantList 사이에 border-t로 구분.

#### 뒤로가기 처리
- 호스트가 나가기 시(`handleNavigateBack`), 공유 중이고 다른 참여자가 있으면:
  - 위임 확인 다이얼로그를 표시 (남은 참여자 중 선택 가능).
  - 위임 없이 나가기 선택 시 → `stopSharing` 호출 후 나가기.
- 기존 녹음 중 뒤로가기 차단 로직은 유지한다.

#### 페이지 진입 시 초기화
- MeetingLivePage 마운트 시, 현재 회의의 공유 상태를 확인:
  - `getMeeting(meetingId)` 응답에 `share_code`가 있으면 → `getParticipants(meetingId)` 호출 → sharingStore 초기화.
  - 없으면 → sharingStore.reset().
- MeetingLivePage 언마운트 시 sharingStore.reset().

## 데이터 흐름

### 공유 시작
사용자 "공유" 클릭 → ShareButton → `shareMeeting(meetingId)` API → 성공 응답 `{ share_code, participants }` → `sharingStore.startSharing(code, participants)` → UI에 공유 코드 + 참여자 표시

### 클립보드 복사
사용자 "복사" 클릭 → `navigator.clipboard.writeText(shareCode)` → 2초 피드백

### 공유 중지
사용자 "중지" 클릭 → `stopSharing(meetingId)` API → `sharingStore.stopSharing()` → UI에서 공유 코드/참여자 제거

### 참여자 입장 (실시간)
ActionCable `participant_joined` 이벤트 수신 → `sharingStore.addParticipant(participant)` → ParticipantList 재렌더

### 참여자 퇴장 (실시간)
ActionCable `participant_left` 이벤트 수신 → `sharingStore.removeParticipant(userId)` → ParticipantList 재렌더

### 호스트 위임
사용자 "넘기기" 클릭 → HostTransferDialog 열림 → "위임하기" 클릭 → `transferHost(meetingId, targetUserId)` API → 성공 → `sharingStore.setParticipants(updatedList)` → UI 업데이트
+ ActionCable `host_changed` 이벤트로 모든 참여자에게 브로드캐스트 → 이전 호스트 UI에서 녹음 컨트롤 비활성화, 새 호스트 UI에서 활성화

### 호스트 나가기
호스트 뒤로가기 클릭 → 참여자 있으면 위임 확인 다이얼로그 → 위임 선택 시 transferHost → 나가기 / 위임 없이 나가기 선택 시 stopSharing → 나가기

## UI 스타일

### ShareButton 스타일
- 미공유 시: `px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50` (기존 링크 복사 버튼 스타일과 유사)
- 공유 중: `px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md` (공유 활성 표시)
- 중지 버튼: `text-red-500 hover:text-red-700` (아이콘 버튼)

### ParticipantList 스타일
- 컨테이너: `px-3 py-2`
- 헤더: `text-xs font-semibold text-gray-500 mb-1`
- 각 항목: `flex items-center gap-2 py-1 text-sm`
- 호스트 아이콘(Crown): `text-amber-500 w-4 h-4`
- 뷰어 아이콘(Eye): `text-gray-400 w-4 h-4`
- 넘기기 버튼: `text-xs text-blue-600 hover:text-blue-800 hover:underline`

### HostTransferDialog 스타일
- 기존 MeetingLivePage 다이얼로그 패턴 사용:
  - 오버레이: `fixed inset-0 z-50 flex items-center justify-center bg-black/40`
  - 카드: `bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4`
  - 제목: `text-lg font-semibold text-gray-900 mb-2`
  - 본문: `text-sm text-gray-600 mb-5`
  - 취소 버튼: `px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200`
  - 확인 버튼: `px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700`

## 현재 사용자 식별

호스트 여부 판별을 위해 현재 로그인 사용자의 ID가 필요하다. 두 가지 접근법이 있다:

1. **authStore 확장**: authStore에 `userId` 필드 추가 (로그인 시 JWT 디코딩 또는 `/api/v1/user/me` API 호출).
2. **Meeting 응답 활용**: `getMeeting(meetingId)` 응답의 `created_by.id`와 참여자 목록의 host user_id를 비교.

**선택: 접근법 2** — Meeting 응답의 `created_by.id`를 이용한다.
- 페이지 진입 시 이미 `getMeeting`을 호출하므로 추가 API 없이 사용 가능.
- 공유 시작 시 호스트로 등록되는 사용자 = 회의 생성자이므로, `created_by.id`와 sharingStore participants 내 host의 `user_id`를 비교하여 isHost를 결정한다.
- 호스트 위임 후에는 `host_changed` 이벤트로 participants가 업데이트되므로, 현재 사용자가 더 이상 host가 아님을 감지할 수 있다.

단, 로그인 사용자 ID를 MeetingLivePage에서 관리해야 하므로 `getMeeting` 응답의 `created_by.id`를 state로 저장하고, participants의 host user_id와 비교하는 computed 로직을 사용한다.

**보완:** 호스트 위임 이후에는 `created_by.id`가 더 이상 호스트가 아닐 수 있다. 따라서 `isHost` 판별 기준은:
- `sharingStore.participants`에서 `role === 'host'`인 참여자의 `user_id` === 현재 사용자의 `user_id`

현재 사용자 ID는 `getMeeting` 결과의 `created_by.id`를 초기값으로 사용하되, 향후 authStore에 userId가 추가되면 그것을 사용하도록 한다. 현 단계에서는 Meeting 응답으로 충분하다.

## 선행 조건
- TSK-05-01 (회의 공유 모델 및 API) [xx] — 완료됨. 백엔드 API 사용 가능.
- TSK-05-02 (실시간 전사 브로드캐스트) — participant_joined / participant_left / host_changed 이벤트 브로드캐스트가 구현되어야 실시간 업데이트가 동작한다. 미완료 시, 초기 참여자 목록은 getParticipants API 폴링으로 대체 가능하지만, 실시간 업데이트 수용 기준을 충족하지 못한다.

## 테스트 계획

### 단위 테스트
- `sharingStore`: startSharing, stopSharing, addParticipant, removeParticipant, updateParticipantRole 동작 검증
- `ShareButton`: 미공유/공유 중 상태별 렌더링, 복사 동작, API 호출 검증
- `ParticipantList`: 참여자 목록 렌더링, isHost에 따른 넘기기 버튼 표시/숨김
- `HostTransferDialog`: 열기/닫기, API 호출, 로딩 상태

### 통합 테스트
- MeetingLivePage에서 공유 시작 → 코드 표시 → 참여자 추가 이벤트 → 목록 업데이트 → 공유 중지 전체 흐름
- 호스트 위임 후 UI 상태 변경 (넘기기 버튼 사라짐, 녹음 컨트롤 변경)
