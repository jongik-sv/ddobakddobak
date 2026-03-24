# TSK-01-05: 팀 관리 프론트엔드 UI - 설계 문서

## 개요

팀 생성, 팀원 초대, 팀원 목록 표시, 팀원 제거 기능을 제공하는 팀 관리 UI 구현.

## 컴포넌트 구조

```
TeamPage.tsx
├── CreateTeamForm      - 팀 생성 폼 (팀 이름 입력)
├── TeamList            - 내 팀 목록
└── TeamDetail          - 선택된 팀 상세
    ├── InviteMemberForm - 이메일로 팀원 초대 (admin만 표시)
    └── MemberList       - 팀원 목록
        └── MemberItem   - 팀원 항목 (admin만 제거 버튼 표시)
```

## 상태 관리

TeamPage 내부 로컬 상태 (useState)로 관리:
- `teams`: Team[] - 팀 목록
- `selectedTeam`: Team | null - 선택된 팀
- `members`: TeamMember[] - 현재 팀의 멤버 목록
- `loading`: boolean - API 호출 중
- `error`: string - 에러 메시지

## 타입 정의 (api/teams.ts)

```ts
export interface Team {
  id: number
  name: string
  role: 'admin' | 'member'  // 현재 로그인 사용자의 역할
}

export interface TeamMember {
  id: number
  name: string
  email: string
  role: 'admin' | 'member'
}
```

## API 함수 (api/teams.ts)

| 함수 | 메서드 | 엔드포인트 | 설명 |
|------|--------|-----------|------|
| `getTeams()` | GET | /teams | 팀 목록 조회 |
| `getTeamMembers(teamId)` | GET | /teams/:id/members | 팀원 목록 조회 |
| `createTeam(name)` | POST | /teams | 팀 생성 |
| `inviteMember(teamId, email)` | POST | /teams/:id/members | 팀원 초대 |
| `removeMember(teamId, userId)` | DELETE | /teams/:id/members/:userId | 팀원 제거 |

## UI/UX 설계

### 레이아웃

```
┌─────────────────────────────────────────────────────┐
│  팀 관리                                              │
├──────────────────┬──────────────────────────────────┤
│  내 팀 목록       │  팀 상세                           │
│  ─────────────   │  ─────────────────────────────    │
│  [팀A] (admin)   │  팀A                               │
│  [팀B] (member)  │                                   │
│                  │  팀원 초대 (admin만 표시)            │
│  ─────────────   │  [이메일 입력] [초대]               │
│  팀 생성         │                                   │
│  [팀 이름] [생성] │  팀원 목록                         │
│                  │  ┌──────────────────────────────┐ │
│                  │  │ 이름  이메일       역할  [제거] │ │
│                  │  │ ...  ...          ...   [제거] │ │
│                  │  └──────────────────────────────┘ │
└──────────────────┴──────────────────────────────────┘
```

### 접근 제어

- `role === 'admin'`인 경우만 초대 폼 및 제거 버튼 노출
- 팀원 본인은 제거 버튼에서 제외 (선택적)

## 라우팅

`/teams` 경로에 TeamPage.tsx 추가, App.tsx PrivateRoute 내부에 등록

## 테스트 시나리오

1. 팀 목록이 렌더링됨
2. 팀 생성 폼이 존재함
3. 팀 생성 성공 시 목록에 추가됨
4. 팀 선택 시 팀원 목록 표시됨
5. admin 역할일 때 초대 폼 표시됨
6. member 역할일 때 초대 폼 미표시됨
7. admin 역할일 때 제거 버튼 표시됨
8. member 역할일 때 제거 버튼 미표시됨
9. 팀원 초대 성공 시 목록에 추가됨
10. 팀원 제거 성공 시 목록에서 제거됨

## 기존 코드 패턴 준수

- Tailwind CSS 4 className 패턴 (LoginPage.tsx 참조)
- vi.hoisted() 패턴 테스트 (LoginPage.test.tsx 참조)
- apiClient (ky) 사용 (api/auth.ts 패턴 참조)
