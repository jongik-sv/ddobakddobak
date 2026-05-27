# 회의 접근 제어 (소유자 기반 + 공유코드 뷰어) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의를 소유자(`created_by`)만 직접 접근하게 하고, 비소유자는 공유코드로만 뷰어 참여하도록 백엔드에서 강제한다.

**Architecture:** 백엔드(Rails)에 ① 목록 스코프, ② `MeetingLookup#set_meeting` 공통 읽기 인가(403), ③ 제어 액션 소유자/호스트 인가를 추가한다. 프론트(React)는 이미 있는 `useMeetingAccess`/`getMeetingDetail`(403→forbidden) 패턴을 `MeetingLivePage`/`MeetingViewerPage`에도 적용한다. WS 채널(`TranscriptionChannel`)은 이미 인가돼 있어 변경 없음.

**Tech Stack:** Rails (RSpec request specs), React + TypeScript (Vitest), ky HTTP client.

**Spec:** `docs/superpowers/specs/2026-05-27-meeting-access-control-design.md`

**테스트 명령**
- 백엔드: `cd backend && bundle exec rspec <path>`
- 프론트: `cd frontend && npx vitest run <path>`

**커밋 정책:** 사용자 설정상 자동 커밋 금지. 각 Task의 커밋 단계는 사용자 승인 후에만 실행한다(또는 사용자가 직접 커밋).

---

## File Structure

**백엔드 (수정)**
- `app/controllers/concerns/meeting_lookup.rb` — `set_meeting`에 읽기 인가 추가, `authorize_meeting_read!`/`authorize_meeting_control!`/`meeting_admin?` 헬퍼 정의
- `app/controllers/api/v1/meetings_controller.rb` — index 스코프, 제어 액션 before_action
- `app/controllers/api/v1/decisions_controller.rb` — index 스코프
- `app/controllers/api/v1/speakers_controller.rb` — MeetingLookup 적용(읽기 인가)

**백엔드 (테스트)**
- `spec/requests/api/v1/meetings_spec.rb` — 스코프/인가 테스트 추가
- `spec/requests/api/v1/transcripts_spec.rb` — 참여자 인가 테스트(없으면 생성)

**프론트 (수정)**
- `src/pages/MeetingLivePage.tsx` — 403(forbidden) 가드
- `src/pages/MeetingViewerPage.tsx` — 403(forbidden) 가드

**프론트 (테스트)**
- `src/pages/MeetingLivePage.access.test.tsx` (신규)
- `src/pages/MeetingViewerPage.access.test.tsx` (신규)

---

## Task 1: 백엔드 — 회의 목록을 소유자 스코프로 제한

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb:9-34` (index)
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성** — `meetings_spec.rb`의 `describe "GET /api/v1/meetings"` 블록 안에 추가:

```ruby
it "다른 사용자가 만든 회의는 목록에 포함되지 않는다" do
  create(:meeting, team: team, creator: user, title: "내 회의")
  create(:meeting, team: team, creator: other_user, title: "남의 회의")

  get "/api/v1/meetings"

  titles = response.parsed_body["meetings"].map { |m| m["title"] }
  expect(titles).to include("내 회의")
  expect(titles).not_to include("남의 회의")
end

it "admin은 모든 사용자의 회의를 본다" do
  admin = create(:user, role: "admin")
  create(:meeting, team: team, creator: other_user, title: "남의 회의")
  login_as(admin)

  get "/api/v1/meetings"

  titles = response.parsed_body["meetings"].map { |m| m["title"] }
  expect(titles).to include("남의 회의")
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "다른 사용자가 만든 회의"`
Expected: FAIL (남의 회의가 목록에 포함됨)

- [ ] **Step 3: index 스코프 구현** — `meetings_controller.rb`의 index 첫 줄을 교체:

```ruby
      def index
        base = current_user.admin? ? Meeting.all : Meeting.where(created_by_id: current_user.id)
        meetings = base.search_with_summary(params[:q])
                       .by_status(params[:status])
                       .created_after(params[:date_from])
                       .created_before(params[:date_to])
```

(이후 folder_id 분기/pagination/render는 그대로 유지)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb`
Expected: PASS (신규 2개 포함 전체 통과)

- [ ] **Step 5: 커밋(사용자 승인 후)**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(backend): scope meeting list to owner (admin sees all)"
```

---

## Task 2: 백엔드 — 개별 회의 읽기 인가 (MeetingLookup 공통)

**Files:**
- Modify: `backend/app/controllers/concerns/meeting_lookup.rb`
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성** — `describe "GET /api/v1/meetings/:id"` 블록에 추가:

```ruby
context "접근 권한" do
  it "소유자가 아니고 참여자도 아니면 403" do
    foreign = create(:meeting, team: team, creator: other_user)

    get "/api/v1/meetings/#{foreign.id}"

    expect(response).to have_http_status(:forbidden)
  end

  it "공유코드로 참여한 viewer는 조회 가능(200)" do
    foreign = create(:meeting, team: team, creator: other_user)
    create(:meeting_participant, meeting: foreign, user: user, role: "viewer")

    get "/api/v1/meetings/#{foreign.id}"

    expect(response).to have_http_status(:ok)
  end

  it "admin은 남의 회의도 조회 가능(200)" do
    foreign = create(:meeting, team: team, creator: other_user)
    login_as(create(:user, role: "admin"))

    get "/api/v1/meetings/#{foreign.id}"

    expect(response).to have_http_status(:ok)
  end
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "접근 권한"`
Expected: FAIL (현재는 남의 회의도 200)

- [ ] **Step 3: MeetingLookup에 인가 추가** — `meeting_lookup.rb` 전체를 다음으로 교체:

```ruby
module MeetingLookup
  extend ActiveSupport::Concern

  private

  def set_meeting
    @meeting = Meeting.find(params[:meeting_id] || params[:id])
    authorize_meeting_read!
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Meeting not found" }, status: :not_found
  end

  # 읽기 인가: admin / 소유자 / active participant 만 허용
  def authorize_meeting_read!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    return if @meeting.active_participants.exists?(user_id: current_user.id)

    render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
  end

  # 제어 인가: admin / 소유자 / 현재 host participant 만 허용
  def authorize_meeting_control!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    return if @meeting.host_participant&.user_id == current_user.id

    render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
  end

  def meeting_admin?
    current_user.respond_to?(:admin?) && current_user.admin?
  end
end
```

(`set_meeting`이 `render` 후 그대로 끝나면 before_action 체인이 중단되어 액션이 실행되지 않는다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb`
Expected: PASS

- [ ] **Step 5: transcripts 인가 테스트(데이터 누수 방지)** — `spec/requests/api/v1/transcripts_spec.rb`가 없으면 생성:

```ruby
require "rails_helper"

RSpec.describe "Api::V1::Transcripts", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:foreign) { create(:meeting, creator: other_user) }

  before { login_as(user) }

  it "비참여자는 남의 회의 transcripts에 접근할 수 없다(403)" do
    get "/api/v1/meetings/#{foreign.id}/transcripts"
    expect(response).to have_http_status(:forbidden)
  end

  it "viewer 참여자는 transcripts 조회 가능(200)" do
    create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
    get "/api/v1/meetings/#{foreign.id}/transcripts"
    expect(response).to have_http_status(:ok)
  end
end
```

- [ ] **Step 6: transcripts 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb`
Expected: PASS (set_meeting 공통 인가가 transcripts에도 적용됨)

- [ ] **Step 7: 회귀 확인 (set_meeting 쓰는 8개 컨트롤러)**

Run: `cd backend && bundle exec rspec spec/requests`
Expected: PASS (기존 spec들이 login_as한 소유자/참여자로 동작하므로 통과. 실패 시 해당 spec이 비소유자로 접근하던 것 → 소유자/참여자로 수정)

- [ ] **Step 8: 커밋(사용자 승인 후)**

```bash
git add backend/app/controllers/concerns/meeting_lookup.rb backend/spec/requests/api/v1/meetings_spec.rb backend/spec/requests/api/v1/transcripts_spec.rb
git commit -m "feat(backend): authorize meeting read access (owner/participant/admin) in MeetingLookup"
```

---

## Task 3: 백엔드 — 제어 액션은 소유자/호스트만

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb:7` (before_action 추가)
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성** — `meetings_spec.rb`에 추가:

```ruby
describe "제어 액션 인가" do
  let(:foreign) { create(:meeting, team: team, creator: other_user, status: "pending") }

  it "viewer 참여자는 회의를 제어(start)할 수 없다(403)" do
    create(:meeting_participant, meeting: foreign, user: user, role: "viewer")

    post "/api/v1/meetings/#{foreign.id}/start"

    expect(response).to have_http_status(:forbidden)
  end

  it "viewer 참여자는 update할 수 없다(403)" do
    create(:meeting_participant, meeting: foreign, user: user, role: "viewer")

    patch "/api/v1/meetings/#{foreign.id}", params: { title: "해킹" }

    expect(response).to have_http_status(:forbidden)
    expect(foreign.reload.title).not_to eq("해킹")
  end
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "제어 액션 인가"`
Expected: FAIL (viewer가 start/update 가능)

- [ ] **Step 3: 제어 인가 before_action 추가** — `meetings_controller.rb`의 **기존** `before_action :set_meeting, only: %i[...]` 줄(7번 줄, 그대로 둔다) **바로 아래에 한 줄만 추가**:

```ruby
      before_action :authorize_meeting_control!, only: %i[update destroy start stop reopen reset_content summarize update_notes regenerate_stt regenerate_notes]
```

(set_meeting 줄은 이미 존재하므로 중복 추가하지 말 것. 읽기 액션 show/summary/transcripts/export/export_prompt/feedback 은 set_meeting의 읽기 인가만 받는다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb`
Expected: PASS

- [ ] **Step 5: 커밋(사용자 승인 후)**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(backend): restrict meeting control actions to owner/host"
```

---

## Task 4: 백엔드 — decisions/speakers 누수 경로 차단

**Files:**
- Modify: `backend/app/controllers/api/v1/decisions_controller.rb:9-15` (index)
- Modify: `backend/app/controllers/api/v1/speakers_controller.rb`
- Test: `backend/spec/requests/api/v1/speakers_spec.rb` (신규)

- [ ] **Step 1: decisions index 스코프 구현** — `decisions_controller.rb`의 index 첫 줄 교체:

```ruby
      def index
        meetings = current_user.admin? ? Meeting.all : Meeting.where(created_by_id: current_user.id)
        meetings = meetings.where(folder_id: params[:folder_id]) if params[:folder_id].present?
        decisions = Decision.where(meeting_id: meetings.select(:id)).order(created_at: :desc)
        render json: decisions.map { |d| serialize_decision(d) }
      end
```

- [ ] **Step 2: speakers 실패 테스트 작성** — `spec/requests/api/v1/speakers_spec.rb` 생성:

```ruby
require "rails_helper"

RSpec.describe "Api::V1::Speakers", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:foreign) { create(:meeting, creator: other_user) }

  before { login_as(user) }

  it "비참여자는 남의 회의 화자 목록에 접근할 수 없다(403)" do
    get "/api/v1/meetings/#{foreign.id}/speakers"
    expect(response).to have_http_status(:forbidden)
  end
end
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/speakers_spec.rb`
Expected: FAIL (현재 200 또는 sidecar 호출)

- [ ] **Step 4: speakers_controller에 MeetingLookup 적용** — `speakers_controller.rb`를 다음으로 교체:

```ruby
module Api
  module V1
    class SpeakersController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting

      def index
        result = SidecarClient.new.get_speakers(@meeting.id)
        render json: result
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { speakers: [] }
      end

      def update
        speaker_id = params[:id]
        name = params.require(:name)
        result = SidecarClient.new.rename_speaker(speaker_id, name, @meeting.id)
        render json: result
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :not_found
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      def destroy_all
        SidecarClient.new.reset_speakers(@meeting.id)
        render json: { ok: true }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { ok: true }
      end
    end
  end
end
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/speakers_spec.rb`
Expected: PASS

- [ ] **Step 6: 커밋(사용자 승인 후)**

```bash
git add backend/app/controllers/api/v1/decisions_controller.rb backend/app/controllers/api/v1/speakers_controller.rb backend/spec/requests/api/v1/speakers_spec.rb
git commit -m "feat(backend): scope decisions list and authorize speakers by meeting access"
```

---

## Task 5: 프론트 — MeetingLivePage 403 가드

**Files:**
- Modify: `frontend/src/pages/MeetingLivePage.tsx`
- Test: `frontend/src/pages/MeetingLivePage.access.test.tsx` (신규)

참고: `MeetingPage.tsx:52,290`이 이미 `useMeetingAccess` + `accessError === 'forbidden'` 패턴을 쓴다. 동일 패턴 적용.

> **주의(렌더 의존성):** `MeetingLivePage`는 미디어/실시간 훅(`useAudioRecorder`, `useMicCapture`, `useSystemAudioCapture`, `useTranscription`, `useMemoEditor`)을 import하며, 이들은 메인 `return` 전 렌더 시점에 실행된다. jsdom에서 렌더가 실패하면 아래 테스트 상단에 각 훅 모듈을 no-op으로 `vi.mock` 처리한다(반환 형태는 해당 훅 소스의 구조분해 대상 키를 비활성 값으로 채움 — `isRecording:false`, `start:vi.fn()` 등). 기존 `src/pages/MeetingPage.test.tsx`의 mock 패턴을 참고.

- [ ] **Step 1: 실패하는 테스트 작성** — `MeetingLivePage.access.test.tsx` 생성:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import * as meetingsApi from '../api/meetings'
import MeetingLivePage from './MeetingLivePage'

vi.mock('../api/meetings', async (orig) => ({
  ...(await orig<typeof meetingsApi>()),
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: null, error: 'forbidden' }),
  getMeeting: vi.fn().mockRejectedValue(new Error('forbidden')),
  getTranscripts: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue(null),
  getParticipants: vi.fn().mockResolvedValue([]),
}))

describe('MeetingLivePage 접근 제어', () => {
  it('forbidden이면 접근 권한 없음 안내를 보여준다', async () => {
    render(
      <MemoryRouter initialEntries={['/meetings/99/live']}>
        <MeetingLivePage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/접근 권한이 없습니다/)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/pages/MeetingLivePage.access.test.tsx`
Expected: FAIL ("접근 권한이 없습니다" 없음)

- [ ] **Step 3: 가드 구현** — `MeetingLivePage.tsx`에서 (a) import 추가, (b) 훅 호출 추가, (c) 메인 `return (` 직전에 가드 추가.

(a) 상단 import 영역에 추가:
```tsx
import { useMeetingAccess } from '../hooks/useMeetingAccess'
```

(b) 다른 훅들과 함께(예: `const isDesktop = useMediaQuery(...)` 부근)에 추가:
```tsx
  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)
```

(c) 컴포넌트의 메인 `return (` 바로 위에 추가:
```tsx
  if (!accessLoading && (accessError === 'forbidden' || accessError === 'not_found')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <p className="text-sm text-gray-600">
          {accessError === 'forbidden'
            ? '이 회의에 접근 권한이 없습니다. 공유 코드로 참여하세요.'
            : '회의를 찾을 수 없습니다.'}
        </p>
        <button
          onClick={() => navigate('/meetings')}
          className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
        >
          회의 목록으로
        </button>
      </div>
    )
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/pages/MeetingLivePage.access.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋(사용자 승인 후)**

```bash
git add frontend/src/pages/MeetingLivePage.tsx frontend/src/pages/MeetingLivePage.access.test.tsx
git commit -m "feat(frontend): guard MeetingLivePage against forbidden/not-found access"
```

---

## Task 6: 프론트 — MeetingViewerPage 403 가드

**Files:**
- Modify: `frontend/src/pages/MeetingViewerPage.tsx`
- Test: `frontend/src/pages/MeetingViewerPage.access.test.tsx` (신규)

- [ ] **Step 1: 실패하는 테스트 작성** — `MeetingViewerPage.access.test.tsx` 생성:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import * as meetingsApi from '../api/meetings'
import MeetingViewerPage from './MeetingViewerPage'

vi.mock('../api/meetings', async (orig) => ({
  ...(await orig<typeof meetingsApi>()),
  getMeetingDetail: vi.fn().mockResolvedValue({ meeting: null, error: 'forbidden' }),
}))

describe('MeetingViewerPage 접근 제어', () => {
  it('forbidden이면 접근 권한 없음 안내를 보여준다', async () => {
    render(
      <MemoryRouter initialEntries={['/meetings/99/viewer']}>
        <MeetingViewerPage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/접근 권한이 없습니다/)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/pages/MeetingViewerPage.access.test.tsx`
Expected: FAIL

- [ ] **Step 3: 가드 구현** — `MeetingViewerPage.tsx`에서 (a) import 추가, (b) 훅 추가, (c) 기존 `if (error)` 반환 위에 forbidden 가드 추가.

(a) import:
```tsx
import { useMeetingAccess } from '../hooks/useMeetingAccess'
```

(b) 컴포넌트 내 훅 영역(예: `const { meetingTitle, isLoaded, error } = useViewerData(meetingId)` 아래):
```tsx
  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)
```

(c) 기존 `if (error) { ... }` 블록 **위**에 추가:
```tsx
  if (!accessLoading && (accessError === 'forbidden' || accessError === 'not_found')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <p className="text-sm text-gray-600">
          {accessError === 'forbidden'
            ? '이 회의에 접근 권한이 없습니다. 공유 코드로 참여하세요.'
            : '회의를 찾을 수 없습니다.'}
        </p>
        <button
          onClick={() => navigate('/meetings')}
          className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
        >
          회의 목록으로
        </button>
      </div>
    )
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/pages/MeetingViewerPage.access.test.tsx`
Expected: PASS

- [ ] **Step 5: 프론트 전체 회귀**

Run: `cd frontend && npx vitest run`
Expected: PASS (기존 테스트 영향 없음)

- [ ] **Step 6: 커밋(사용자 승인 후)**

```bash
git add frontend/src/pages/MeetingViewerPage.tsx frontend/src/pages/MeetingViewerPage.access.test.tsx
git commit -m "feat(frontend): guard MeetingViewerPage against forbidden/not-found access"
```

---

## 최종 검증 (전체)

- [ ] 백엔드 전체: `cd backend && bundle exec rspec` → PASS
- [ ] 프론트 전체: `cd frontend && npx vitest run` → PASS
- [ ] 수동 검증(디바이스): 호스트 계정에서 회의 생성/공유코드 발급 → 다른 계정(태블릿)에서 ① 목록에 그 회의 안 보임 ② 공유코드로 참여 시 뷰어 진입 ③ 코드 없이 URL 직접 접근 시 "접근 권한 없음"
- [ ] **배포**: 백엔드 변경이므로 Rails 재배포 필요 (DB 마이그레이션 없음)

## 비목표 / 추후
- "내가 참여한 회의" 목록/히스토리
- 채널 구독 인가 정책 일반화 (현재도 인가됨)
