# TSK-07-03 리팩토링 보고서: 회의록 공유 기능

## 리팩토링 일시
2026-03-25

---

## 개선 내용

### 1. `MeetingsController` - `authorize_member!` 중복 로직 제거

**파일:** `backend/app/controllers/api/v1/meetings_controller.rb`

**변경 전:**
```ruby
def authorize_team_member!
  membership = @meeting.team.team_memberships.find_by(user: current_user)
  render json: { error: "Forbidden" }, status: :forbidden unless membership
end
```

**변경 후:**
```ruby
def authorize_member!
  require_team_membership!(@meeting.team)
end
```

**이유:**
- `ApplicationController`는 이미 `TeamAuthorizable` concern을 include하고 있으며, 해당 concern에 `require_team_membership!(team)` 메서드가 정의되어 있다.
- 기존 코드는 concern의 동일한 로직을 인라인으로 중복 구현하고 있었다.
- concern 메서드를 재사용함으로써 단일 책임 원칙을 준수하고 코드 중복을 제거했다.
- 메서드명도 `authorize_team_member!` → `authorize_member!`로 간결하게 변경했다 (팀 맥락은 구현 내부에서 명확하므로 중복 표현 불필요).

---

### 2. `meetings.ts` - 미사용 `getMeeting` 함수 및 `Meeting` 인터페이스 정리

**파일:** `frontend/src/api/meetings.ts`

**변경 전:**
```typescript
export interface Meeting {
  id: number
  title: string
  status: 'idle' | 'recording' | 'stopped'
  created_at: string
}

export async function getMeeting(id: number): Promise<Meeting> {
  return apiClient.get(`meetings/${id}`).json()
}
```

**변경 후:**
`getMeeting` 함수 제거. `Meeting` 인터페이스는 `startMeeting`/`stopMeeting`의 반환 타입으로 여전히 사용되므로 유지.

**이유:**
- `getMeeting` 함수는 프로젝트 전체에서 단 한 곳도 호출되지 않는 데드 코드였다.
- 같은 엔드포인트(`meetings/:id`)를 호출하는 `getMeetingDetail`이 이미 존재하며, 에러 처리까지 포함한 완전한 구현이다.
- 데드 코드 제거로 API 모듈의 의도가 더 명확해졌다.

---

### 3. `useMeetingAccess.ts` - async/await 패턴으로 통일

**파일:** `frontend/src/hooks/useMeetingAccess.ts`

**변경 전:**
```typescript
setIsLoading(true)
getMeetingDetail(meetingId).then(({ meeting, error }) => {
  setMeeting(meeting)
  setError(error)
  setIsLoading(false)
})
```

**변경 후:**
```typescript
setIsLoading(true)
const fetchMeeting = async () => {
  const { meeting, error } = await getMeetingDetail(meetingId)
  setMeeting(meeting)
  setError(error)
  setIsLoading(false)
}
fetchMeeting()
```

**이유:**
- 프로젝트 전반에서 비동기 처리는 `async/await` 패턴을 사용한다 (기존 패턴과의 일관성).
- `.then()` 체인보다 가독성이 높고, 추후 에러 핸들링 추가 시 `try/catch`로 자연스럽게 확장 가능하다.
- `useEffect` 내부에서 직접 `async` 함수를 정의하고 즉시 호출하는 패턴은 React 공식 권장 방식이다.

---

## 변경하지 않은 이유

- **`ShareLinkButton.tsx`**: 단순하고 명확한 단일 책임 컴포넌트. 개선이 필요한 부분 없음.
- **`MeetingPage.tsx`**: 에러 상태별 렌더링 분기가 명확하고 가독성이 높음. 개선이 필요한 부분 없음.
- **`set_meeting` rescue 블록**: `ApplicationController`에 `rescue_from ActiveRecord::RecordNotFound`가 있지만, 그 메시지는 모델 기본값(`Couldn't find Meeting with ...`)을 사용한다. `set_meeting`의 인라인 rescue는 "Meeting not found"라는 명확한 메시지를 테스트에서 검증하고 있으므로 변경하지 않았다.

---

## 최종 테스트 결과

### 백엔드
```
cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb --format progress

.....

Finished in 0.06639 seconds (files took 0.77874 seconds to load)
5 examples, 0 failures
```

### 프론트엔드
```
cd frontend && npx vitest run --reporter=verbose

Test Files  31 passed (31)
      Tests  226 passed (226)
   Duration  6.08s
```
