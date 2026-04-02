# TSK-07-03: 회의록 공유 기능 - 설계 문서

## 1. 개요 및 목적

같은 팀 소속 사용자만 회의 상세 페이지에 접근할 수 있도록 권한 체크를 구현한다.
프론트엔드에서는 공유 링크 복사 UI를 제공하고, 비팀원이 접근할 경우 권한 에러 페이지를 표시한다.

### 요구사항 정리

| 항목 | 내용 |
|------|------|
| 공유 링크 | `/meetings/:id` URL을 팀원에게 공유 |
| 접근 제어 | 같은 팀 소속 사용자만 회의 상세 페이지 접근 허용 |
| 비팀원 접근 | HTTP 403 응답 → 프론트엔드 권한 에러 페이지 표시 |
| 인증 미보유 | HTTP 401 응답 → 로그인 페이지 리다이렉트 (기존 동작 유지) |

---

## 2. 아키텍처 설계

### 2.1 전체 데이터 흐름

```
[팀원이 공유 링크 클릭]
     |
     v
React Router /meetings/:id 라우트
  -> MeetingPage 렌더링 시작
     |
     v
GET /api/v1/meetings/:id
  Authorization: Bearer <JWT>
     |
     v
Api::V1::MeetingsController#show
  -> authenticate_user!         # JWT 검증 (401 미인증)
  -> set_meeting                # Meeting.find(params[:id]) (404 없음)
  -> authorize_team_member!     # 팀 멤버 확인 (403 비팀원)
  -> render meeting JSON
     |
     v
프론트엔드 상태 분기:
  200 OK  → 회의 상세 렌더링 + [링크 복사] 버튼 표시
  401     → 로그인 페이지 리다이렉트 (apiClient afterResponse 훅 기존 동작)
  403     → ForbiddenPage 렌더링
  404     → NotFoundPage 렌더링
```

### 2.2 컴포넌트 구조

```
App.tsx (라우터)
├── PrivateRoute (기존, 로그인 필수)
│   └── /meetings/:id
│       └── AppLayout
│           └── MeetingPage (변경)
│               ├── useMeetingAccess(meetingId)  [신규 훅]
│               │   └── GET /api/v1/meetings/:id
│               ├── ShareLinkButton              [신규 컴포넌트]
│               └── MeetingEditor (기존)
│
└── /meetings/:id/forbidden  [신규 - 선택적, 인라인 처리도 가능]
```

### 2.3 신규 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/app/controllers/api/v1/meetings_controller.rb` | 신규: 회의 CRUD, 팀 멤버 권한 체크 |
| `frontend/src/api/meetings.ts` | 변경: `getMeeting()` 에러 처리 보강 |
| `frontend/src/hooks/useMeetingAccess.ts` | 신규: 회의 접근 권한 상태 훅 |
| `frontend/src/components/meeting/ShareLinkButton.tsx` | 신규: 링크 복사 버튼 컴포넌트 |
| `frontend/src/pages/MeetingPage.tsx` | 변경: 권한 에러 처리 + ShareLinkButton 추가 |

### 2.4 기존 파일 변경 목록

| 파일 | 변경 내용 |
|------|----------|
| `backend/config/routes.rb` | `resources :meetings, only: %i[show]` 추가 |
| `frontend/src/App.tsx` | `/meetings/:id` 라우트 추가 (AppLayout 포함) |
| `frontend/src/api/meetings.ts` | `getMeetingDetail()` 함수 추가, 403/404 에러 구분 |
| `frontend/src/pages/MeetingPage.tsx` | `useMeetingAccess` 훅 사용, 에러 분기, ShareLinkButton 추가 |

---

## 3. 상세 구현 계획

### 3.1 백엔드: `backend/app/controllers/api/v1/meetings_controller.rb` (신규)

```ruby
module Api
  module V1
    class MeetingsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_team_member!

      def show
        render json: meeting_json(@meeting)
      end

      private

      def set_meeting
        @meeting = Meeting.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def authorize_team_member!
        return if @meeting.nil?  # set_meeting에서 이미 렌더링됨
        unless @meeting.team.team_memberships.exists?(user: current_user)
          render json: { error: "Forbidden" }, status: :forbidden
        end
      end

      def meeting_json(meeting)
        {
          id: meeting.id,
          title: meeting.title,
          status: meeting.status,
          started_at: meeting.started_at,
          ended_at: meeting.ended_at,
          team_id: meeting.team_id,
          created_by_id: meeting.created_by_id,
          created_at: meeting.created_at,
          updated_at: meeting.updated_at
        }
      end
    end
  end
end
```

**권한 체크 패턴:**
- `BlocksController#authorize_meeting_member!`와 동일한 패턴 사용
- `@meeting.team.team_memberships.exists?(user: current_user)` — N+1 없이 EXISTS 쿼리 1회

### 3.2 백엔드: `backend/config/routes.rb` 변경

```ruby
# 기존 meetings 리소스 블록에 show 추가
resources :meetings, only: %i[show] do
  # 기존 action_items 중첩 유지
end

# 또는 기존 두 개의 resources :meetings 블록 중 하나에 show 추가
resources :meetings, only: %i[show] do
  resources :action_items,
    only: %i[index create],
    controller: "meeting_action_items"
end
```

변경 후 라우트:
```
GET /api/v1/meetings/:id  →  api/v1/meetings#show
```

### 3.3 프론트엔드: `frontend/src/api/meetings.ts` 변경

```typescript
// 기존 getMeeting()은 live 페이지용 (간소화된 응답)
// 신규: 회의 상세 조회 (권한 에러 구분)

export interface MeetingDetail {
  id: number
  title: string
  status: 'pending' | 'recording' | 'completed'
  started_at: string | null
  ended_at: string | null
  team_id: number
  created_by_id: number
  created_at: string
  updated_at: string
}

export type MeetingAccessError = 'forbidden' | 'not_found' | 'unknown'

export interface MeetingAccessResult {
  meeting: MeetingDetail | null
  error: MeetingAccessError | null
}

export async function getMeetingDetail(id: number): Promise<MeetingAccessResult> {
  try {
    const meeting = await apiClient.get(`meetings/${id}`).json<MeetingDetail>()
    return { meeting, error: null }
  } catch (err: unknown) {
    if (err instanceof HTTPError) {
      if (err.response.status === 403) return { meeting: null, error: 'forbidden' }
      if (err.response.status === 404) return { meeting: null, error: 'not_found' }
    }
    return { meeting: null, error: 'unknown' }
  }
}
```

**주의:** `apiClient`의 `afterResponse` 훅이 401을 처리하여 `logout()`을 호출하므로 401은 별도 처리 불필요.

### 3.4 프론트엔드: `frontend/src/hooks/useMeetingAccess.ts` (신규)

```typescript
import { useState, useEffect } from 'react'
import { getMeetingDetail, type MeetingDetail, type MeetingAccessError } from '../api/meetings'

interface UseMeetingAccessReturn {
  meeting: MeetingDetail | null
  isLoading: boolean
  error: MeetingAccessError | null
}

export function useMeetingAccess(meetingId: number): UseMeetingAccessReturn {
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<MeetingAccessError | null>(null)

  useEffect(() => {
    if (!meetingId || isNaN(meetingId)) {
      setError('not_found')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    getMeetingDetail(meetingId).then(({ meeting, error }) => {
      setMeeting(meeting)
      setError(error)
      setIsLoading(false)
    })
  }, [meetingId])

  return { meeting, isLoading, error }
}
```

### 3.5 프론트엔드: `frontend/src/components/meeting/ShareLinkButton.tsx` (신규)

```typescript
import { useState } from 'react'

interface ShareLinkButtonProps {
  meetingId: number
}

export function ShareLinkButton({ meetingId }: ShareLinkButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const url = `${window.location.origin}/meetings/${meetingId}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
    >
      {copied ? (
        <>
          <span>✓</span>
          <span>복사됨</span>
        </>
      ) : (
        <>
          <span>🔗</span>
          <span>링크 복사</span>
        </>
      )}
    </button>
  )
}
```

**공유 URL 형식:** `http://localhost:5173/meetings/:id` (origin 기반 자동 생성)

### 3.6 프론트엔드: `frontend/src/pages/MeetingPage.tsx` 변경

```typescript
import { useParams } from 'react-router-dom'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { ShareLinkButton } from '../components/meeting/ShareLinkButton'
import { useBlockSync } from '../hooks/useBlockSync'
// ... 기존 import

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)

  const { meeting, isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)
  const editorRef = useRef<BlockNoteEditor<typeof customSchema.blockSpecs> | null>(null)
  const { isLoading, isSaving, error, initialContent, onEditorChange } = useBlockSync({
    meetingId,
    editorRef,
  })

  // 권한 에러 처리
  if (!accessLoading && accessError === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <div className="text-4xl">🚫</div>
        <h2 className="text-lg font-semibold text-gray-800">접근 권한이 없습니다</h2>
        <p className="text-sm text-gray-500 text-center">
          이 회의록은 같은 팀 소속 멤버만 볼 수 있습니다.
        </p>
      </div>
    )
  }

  if (!accessLoading && accessError === 'not_found') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <div className="text-4xl">📭</div>
        <h2 className="text-lg font-semibold text-gray-800">회의록을 찾을 수 없습니다</h2>
        <p className="text-sm text-gray-500">삭제되었거나 존재하지 않는 회의입니다.</p>
      </div>
    )
  }

  if (accessLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-gray-500 text-sm">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더: 회의 제목 + 공유 버튼 */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
        <h1 className="text-base font-medium text-gray-900 truncate">
          {meeting?.title ?? '회의록'}
        </h1>
        <ShareLinkButton meetingId={meetingId} />
      </div>

      {/* 저장 상태 */}
      {(isSaving || error) && (
        <div className="flex items-center justify-end px-4 py-1 border-b bg-gray-50">
          {isSaving && <span className="text-xs text-gray-400">저장 중...</span>}
          {error && <span className="text-xs text-red-500">저장 실패: {error}</span>}
        </div>
      )}

      {/* 에디터 */}
      <div className="flex-1 overflow-auto">
        <MeetingEditor
          initialContent={initialContent ?? undefined}
          onChange={onEditorChange}
          editorRef={editorRef}
        />
      </div>
    </div>
  )
}
```

### 3.7 프론트엔드: `frontend/src/App.tsx` 변경

```typescript
// 기존 import에 추가
import MeetingPage from './pages/MeetingPage'

// PrivateRoute 내부에 라우트 추가
<Route
  path="/meetings/:id"
  element={
    <AppLayout>
      <MeetingPage />
    </AppLayout>
  }
/>
```

---

## 4. API 설계

### 4.1 회의 상세 조회

**Request:**
```
GET /api/v1/meetings/:id
Authorization: Bearer <JWT>
```

**Response 200 OK (팀 멤버):**
```json
{
  "id": 1,
  "title": "3월 스프린트 회고",
  "status": "completed",
  "started_at": "2026-03-25T10:00:00.000Z",
  "ended_at": "2026-03-25T11:00:00.000Z",
  "team_id": 1,
  "created_by_id": 2,
  "created_at": "2026-03-25T09:50:00.000Z",
  "updated_at": "2026-03-25T11:00:00.000Z"
}
```

**Response 401 Unauthorized (미인증):**
```json
{ "error": "Unauthorized" }
```

**Response 403 Forbidden (비팀원):**
```json
{ "error": "Forbidden" }
```

**Response 404 Not Found (없는 회의):**
```json
{ "error": "Meeting not found" }
```

---

## 5. 권한 체크 로직 상세

### 5.1 백엔드 권한 체크 흐름

```
authenticate_user!
  → bearer_token 없음 또는 JWT 무효 → 401

set_meeting
  → Meeting.find(id) 없음 → 404

authorize_team_member!
  → @meeting.team.team_memberships.exists?(user: current_user)
    → false → 403
    → true  → show 실행
```

### 5.2 팀 멤버 확인 쿼리

```sql
-- authorize_team_member! 실행 쿼리
SELECT 1
FROM team_memberships
WHERE team_memberships.team_id = <meeting.team_id>
  AND team_memberships.user_id = <current_user.id>
LIMIT 1
```

`EXISTS` 패턴으로 인덱스 활용: `index_team_memberships_on_user_id_and_team_id` (unique 인덱스 존재)

### 5.3 기존 코드와의 일관성

- `BlocksController#authorize_meeting_member!`와 동일한 패턴
- `TeamAuthorizable` concern의 `require_team_membership!` 메서드 활용 가능:

```ruby
# 대안: concern 활용
def authorize_team_member!
  return if @meeting.nil?
  require_team_membership!(@meeting.team)
end
```

`require_team_membership!`은 `TeamAuthorizable` concern에 이미 구현되어 있으므로 재사용한다.

---

## 6. 공유 링크 UX 설계

### 6.1 공유 링크 형식

```
http://localhost:5173/meetings/42
```

- SPA 라우트 URL 직접 사용 (별도 공유 토큰 불필요)
- 같은 팀 소속인 수신자가 로그인 후 접근하면 바로 회의 상세 확인

### 6.2 비팀원 접근 시나리오

1. 비팀원 A가 링크 `/meetings/42` 클릭
2. `PrivateRoute` 통과 (A는 로그인 상태)
3. `MeetingPage` 진입 → `useMeetingAccess(42)` 실행
4. `GET /api/v1/meetings/42` → 403 응답
5. `accessError === 'forbidden'` → 권한 에러 UI 표시

### 6.3 미로그인 접근 시나리오

1. 미로그인 사용자가 링크 `/meetings/42` 클릭
2. `PrivateRoute`가 `/login`으로 리다이렉트
3. 로그인 완료 후 원래 URL로 복귀 (React Router state 활용 — 선택적 구현)

---

## 7. 테스트 계획

### 7.1 백엔드 테스트: `spec/requests/api/v1/meetings_spec.rb` (신규)

| 케이스 | 기대 응답 |
|--------|----------|
| 팀 멤버가 GET /meetings/:id 요청 | 200 + meeting JSON |
| 비팀원이 GET /meetings/:id 요청 | 403 + { error: "Forbidden" } |
| 미인증 GET /meetings/:id | 401 + { error: "Unauthorized" } |
| 존재하지 않는 id GET /meetings/99999 | 404 + { error: "Meeting not found" } |
| 다른 팀 멤버가 접근 | 403 (팀이 달라도 멤버가 아니면 차단) |

### 7.2 프론트엔드 테스트: `src/hooks/useMeetingAccess.test.ts` (신규)

| 케이스 | 검증 내용 |
|--------|----------|
| 정상 응답 | `meeting` 객체 반환, `error` null |
| 403 응답 | `error === 'forbidden'`, `meeting` null |
| 404 응답 | `error === 'not_found'`, `meeting` null |
| 로딩 중 | `isLoading === true` |
| 완료 후 | `isLoading === false` |

### 7.3 프론트엔드 테스트: `src/components/meeting/ShareLinkButton.test.tsx` (신규)

| 케이스 | 검증 내용 |
|--------|----------|
| 버튼 클릭 시 클립보드 복사 | `navigator.clipboard.writeText` 호출, URL 포함 확인 |
| 복사 직후 | "복사됨" 텍스트 표시 |
| 2초 후 | 원래 "링크 복사" 텍스트 복귀 |

### 7.4 통합 시나리오

| 시나리오 | 검증 내용 |
|---------|----------|
| 팀원 A → 공유 링크 → 회의 상세 | 200, 에디터 정상 렌더링, 공유 버튼 표시 |
| 비팀원 B → 공유 링크 | 403, "접근 권한이 없습니다" UI |
| 미로그인 → 공유 링크 | 로그인 페이지 리다이렉트 |
| 없는 회의 ID | 404, "회의록을 찾을 수 없습니다" UI |

---

## 8. 구현 순서

1. **백엔드: `routes.rb` 변경** — `resources :meetings, only: %i[show]` 추가 (1분)
2. **백엔드: `meetings_controller.rb` 구현** — show + 권한 체크 (15분)
3. **백엔드: RSpec 테스트 작성 및 통과 확인** (20분)
4. **프론트엔드: `api/meetings.ts` 변경** — `getMeetingDetail()` 추가 (10분)
5. **프론트엔드: `hooks/useMeetingAccess.ts` 구현** (10분)
6. **프론트엔드: `components/meeting/ShareLinkButton.tsx` 구현** (10분)
7. **프론트엔드: `pages/MeetingPage.tsx` 변경** — 권한 에러 분기 + ShareLinkButton (15분)
8. **프론트엔드: `App.tsx` 변경** — `/meetings/:id` 라우트 추가 (5분)
9. **프론트엔드: 단위 테스트 작성** (20분)
10. **수동 E2E 검증** — 팀원 접근 / 비팀원 접근 시나리오 (10분)

---

## 9. 주요 설계 결정 사항

### 9.1 공유 토큰 방식 vs SPA URL 방식

SPA URL(`/meetings/:id`) 직접 공유 방식을 채택.

이유:
- 같은 팀 소속 확인이 이미 JWT + team_memberships로 가능
- 별도 공유 토큰 생성/관리 오버헤드 없음
- PRD 3.5의 "앱 내 공유 (팀원에게 링크 공유)" 요구사항에 부합
- 로컬 앱 환경에서 외부 공유가 아닌 팀 내부 공유가 목적

### 9.2 권한 체크 위치: 백엔드 vs 프론트엔드

백엔드 API에서 HTTP 403으로 차단하고 프론트엔드는 에러 UI 표시만 담당.

이유:
- 프론트엔드 라우트 가드만으로는 API 직접 호출 차단 불가
- `BlocksController`가 이미 같은 패턴(`authorize_meeting_member!`)으로 blocks를 보호 중
- 블록 API는 보호되나 회의 메타데이터 API가 없어 이번에 추가 필요

### 9.3 MeetingsController 신규 생성 vs 기존 컨트롤러 활용

`Api::V1::MeetingsController`를 신규 생성.

이유:
- 현재 meetings 관련 컨트롤러가 `MeetingActionItemsController`, `BlocksController`로 분리되어 있으나 meetings 리소스 자체의 CRUD를 담당하는 컨트롤러가 없음
- `show` 단독으로 시작하여 향후 `index`, `create`, `update`, `destroy`를 점진적으로 추가 가능한 구조

### 9.4 `useMeetingAccess` 훅 분리 이유

`useBlockSync`에 권한 체크를 추가하지 않고 별도 훅으로 분리.

이유:
- 권한 체크(회의 메타데이터 조회)와 블록 동기화는 관심사가 다름
- `useBlockSync`는 blocks API(`/meetings/:id/blocks`)를 사용하는데, 이 API도 이미 `authorize_meeting_member!`로 보호됨
- 별도 훅으로 분리하면 403 응답 시 에디터 로드 전에 에러 UI를 먼저 표시 가능
