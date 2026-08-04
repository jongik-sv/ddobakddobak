# D'Flow 프로젝트 초대 — 이식 스펙

> **이 문서만 읽고 D'Flow(wbs-web) 저장소에서 바로 구현할 수 있도록 작성된 자기완결 스펙이다.**
> 원본(또박또박)의 "프로젝트 초대"(초대 링크 생성 → 링크로 참여/가입 → 프로젝트 멤버 등록) 기능을
> D'Flow 스택(Next.js 15 App Router + React 19 + Supabase + Tailwind 4 + vitest)으로 번역했다.
> 원본 저장소 접근은 불필요하다. 대상 저장소: wbs-web (이 파일을 저장한 레포)
>
> 각 구현 태스크에는 권장 실행 모델(haiku/sonnet/opus)이 지정되어 있다(§9).

---

## 1. 목적·스코프

프로젝트 관리자(project_roles.role='admin' 또는 슈퍼유저)가 **초대 링크를 만들어 공유하면,
받은 사람이 링크만으로 (a) 로그인 계정이 있으면 즉시 프로젝트 멤버로 합류, (b) 계정이 없으면
그 자리에서 가입과 동시에 합류**할 수 있게 한다. 현재 D'Flow는 계정을 전부 관리자가
비밀번호까지 지정해 만드는 구조라, 외부 인원 온보딩이 관리자 병목이다 — 이를 셀프서비스로 푼다.

**포함**:
- 초대 링크 CRUD (프로젝트 설정 화면, 프로젝트 admin 전용): 만료일·최대 사용횟수 옵션, 링크 복사, 취소
- 공개 초대 페이지 `/invite/[token]`: 미리보기 → 로그인 사용자 합류 / 비로그인 가입+합류 / 기존 계정 로그인+합류
- 합류 결과 = `project_roles`에 `role='member'` 행 생성 (D'Flow 권한 체계에 그대로 편입)
- 원자적 사용횟수 소비(동시 요청 안전), 만료·소진 검증

**제외**:
- 초대 이메일 발송 — 원본에도 없음. 링크 복사·공유만 (nodemailer 재사용은 후속 과제)
- `project_members`(인력 로스터) 행 신규 생성 — 로스터는 인력 계획 데이터로 초대와 별개 축. 초대는 **권한(project_roles)만** 부여한다. 단, 이메일이 일치하는 기존 로스터 행에 계정을 연결하는 사후 링크는 수행한다(§4-3 7단계 — 기존 트리거는 `project_members` insert/update 시에만 발화하므로 계정 생성 쪽에서 수동 연결하는 것이 이 레포의 확립된 관례다)
- 초대로 admin 권한 부여 — 원본과 동일하게 초대는 항상 member. admin 승급은 기존 `ProjectRolesManager`에서
- 개인(personal) 프로젝트 관련 로직 전부 — D'Flow에 개인 프로젝트 개념 없음 (§11 부록)
- 회의(Meeting) 초대 메일(`meetingNotify.ts` 등) — 이름만 비슷한 무관 기능. 절대 수정 금지

---

## 2. 개념 모델

| 용어 | 정의 |
|---|---|
| 초대(invite) | 특정 프로젝트에 대한 합류 자격 토큰. 프로젝트 admin이 생성, 만료일·최대횟수 옵션 |
| 토큰(token) | 초대를 식별하는 UUID(v4). URL 경로에 노출됨: `/invite/{token}` |
| redeem | 토큰 제출 → 검증 → `project_roles`에 member 행 생성 + `use_count` 1 증가 |
| 소진(exhausted) | `max_uses`가 설정돼 있고 `use_count >= max_uses` |
| redeemable | 만료 전 AND 미소진. 조회 시마다 재계산(저장 안 함) |
| 가입+합류(signup redeem) | 비로그인 방문자가 이름/이메일/비밀번호로 계정 생성과 동시에 redeem |
| 프로젝트 admin | `project_roles.role='admin'` 보유자 또는 `memberships.is_superuser=true` — 기존 `requireProjectAdmin()` 판정 그대로 |

원본 대비 용어 번역: 또박 `ProjectMembership(role admin|member)` → D'Flow `project_roles(role admin|member)`.
D'Flow의 `project_members` 테이블은 **이름이 비슷하지만 무관한 인력 로스터**다. 이 스펙에서 절대 혼용하지 말 것.

---

## 3. 데이터 모델

### 3-1. 새 테이블 `project_invites`

마이그레이션 파일: `supabase/migrations/0055_project_invites.sql`
(현재 최대 순번 0054 실측 — 0055 미사용 확인됨. `0055_project_invites_rollback.sql` 짝 파일 필수)

```sql
begin;

set search_path = public, extensions;

create table if not exists public.project_invites (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token      uuid not null unique,
  team_id    uuid not null references public.teams(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  max_uses   integer check (max_uses is null or max_uses > 0),
  use_count  integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_invites_project_idx on public.project_invites(project_id);

-- 토큰은 비밀값: RLS 켜고 정책은 만들지 않는다(전면 차단).
-- 모든 접근은 서버 액션의 service_role(createAdminClient) 경유.
-- ※ "읽기 전면 개방"(D6) 관례의 의도적 예외 — anon/authenticated가 토큰을 열람하면
--    초대 링크가 로그인만 하면 전부 수집 가능해지기 때문.
alter table public.project_invites enable row level security;

-- RLS는 TRUNCATE를 막지 못한다(0051_usage_events.sql에 문서화된 함정) —
-- service_role 전용 테이블 관례대로 기본 GRANT를 회수하고 명시 재부여한다.
revoke all on table public.project_invites from public, anon, authenticated;
grant all on table public.project_invites to service_role;

-- 원자적 소비: 검증과 증가를 단일 UPDATE로 묶어 TOCTOU(만료·소진 체크와 증가 사이의
-- 경쟁)를 제거한다. 행이 반환되지 않으면 "만료·소진·미존재" 중 하나.
create or replace function public.consume_project_invite(p_token uuid)
returns table (project_id uuid, team_id uuid, created_by uuid)
language sql
security invoker
as $$
  update public.project_invites pi
     set use_count = pi.use_count + 1
   where pi.token = p_token
     and (pi.expires_at is null or pi.expires_at > now())
     and (pi.max_uses is null or pi.use_count < pi.max_uses)
  returning pi.project_id, pi.team_id, pi.created_by;
$$;

-- Postgres 함수 EXECUTE는 PUBLIC으로 상속된다 — revoke만 하면 service_role까지 막힐 수
-- 있고, grant를 빠뜨리면 redeem 전 경로가 permission denied로 죽는다(테스트는 전부
-- mock이라 못 잡음). 이 레포 관례(0047·0049)대로 revoke+grant를 반드시 쌍으로.
revoke all on function public.consume_project_invite(uuid) from public, anon, authenticated;
grant execute on function public.consume_project_invite(uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'project_invites'
  ) then
    raise exception 'project_invites 테이블 생성 실패';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'consume_project_invite'
  ) then
    raise exception 'consume_project_invite 함수 생성 실패';
  end if;
end $$;

reset search_path;

commit;
```

롤백 파일(`0055_project_invites_rollback.sql`):
```sql
begin;
drop function if exists public.consume_project_invite(uuid);
drop table if exists public.project_invites;
commit;
```

컬럼 의미:

| 컬럼 | 근거 |
|---|---|
| `token uuid unique` | 원본은 6자 영숫자였으나 D'Flow 선례(`minutes.share_token` = `crypto.randomUUID()` + UUID 정규식 검증)를 따른다. 122bit 엔트로피로 무차별 대입 무의미. **토큰 생성은 서버 액션에서 `crypto.randomUUID()`** — DB default 아님(선례와 동일) |
| `team_id not null` | 가입+합류 시 새 계정의 `memberships.team_id`(not null 제약)에 넣을 팀. 초대 생성 시점에 생성자 Actor의 `teamId`를 저장한다(별도 UI 없음). 기존 계정 합류에는 사용하지 않음 |
| `created_by set null` | 원본은 FK가 아예 없어 orphan 가능성이 있었다 — FK+set null로 개선 |
| `max_uses check > 0` | 0이나 음수 초대는 생성 시점에 차단 |

기존 테이블 변경: **없음**. `project_roles`, `memberships`, `projects`, `teams`는 스키마 그대로 사용.

### 3-2. redeem이 쓰는 기존 테이블 (참고 — 변경 없음)

- `project_roles (project_id uuid, user_id uuid, role text check in ('admin','member'), granted_by nullable, granted_at)` PK `(project_id, user_id)` — 합류 시 `role='member'`로 **`.upsert(row, { onConflict: 'project_id,user_id', ignoreDuplicates: true })`** (SQL의 `on conflict do nothing`과 동등 — 정확한 호출 형태는 §5-3)
- `memberships (user_id uuid PK, team_id uuid not null, role text not null, is_superuser boolean default false)` — 가입+합류 시에만 insert. `role`은 deprecated지만 not null이라 기존 관례(`src/app/actions/accounts.ts`)대로 더미값 `'team_editor'`를 넣는다. `is_superuser`는 미지정(default false)

---

## 4. API/액션 계약

전부 서버 액션(D'Flow 관례). route handler 불필요. 응답 포맷은 관례대로 `{ ok: true, ... } | { ok: false, error: string }`.

### 4-1. 도메인 순수 함수 — `src/lib/domain/invites.ts` (신규)

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 공개 라우트 토큰 형식 검증 — DB 조회 전 비정상 입력 차단 (share.ts의 isShareToken과 동일 패턴) */
export function isInviteToken(s: string): boolean {
  return UUID_RE.test(s)
}

export interface InviteState {
  expiresAt: string | null   // ISO
  maxUses: number | null
  useCount: number
}

/** 만료 전 AND 미소진. now 주입으로 순수함수 유지 */
export function isInviteRedeemable(inv: InviteState, now: Date): boolean {
  if (inv.expiresAt && new Date(inv.expiresAt) <= now) return false
  if (inv.maxUses != null && inv.useCount >= inv.maxUses) return false
  return true
}

/** 사용현황 라벨: maxUses 있으면 "3/10회 사용", 없으면 "3회 사용" */
export function inviteUsageLabel(inv: InviteState): string {
  return inv.maxUses != null ? `${inv.useCount}/${inv.maxUses}회 사용` : `${inv.useCount}회 사용`
}

export interface SignupInput {
  name: string
  email: string
  password: string
  passwordConfirmation: string
}

/** 가입 입력 검증. 에러 문구는 §7 표의 원문 그대로 반환.
 *  이메일·비밀번호 검증은 기존 함수 재사용 — 정규식 재구현 금지:
 *  isValidEmail (src/lib/domain/validate.ts — accounts.ts가 이미 사용 중),
 *  isValidPassword (src/lib/domain/accounts.ts — 8자 이상) */
export function validateSignupInput(input: SignupInput): { ok: true } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: '이름을 입력해 주세요.' }
  if (!isValidEmail(input.email.trim())) return { ok: false, error: '이메일 형식을 확인해 주세요.' }
  if (!isValidPassword(input.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (input.password !== input.passwordConfirmation) return { ok: false, error: '비밀번호가 일치하지 않습니다.' }
  return { ok: true }
}
```

### 4-2. 초대 관리 액션 — `src/app/actions/projectInvites.ts` (신규)

게이트: 세 함수 모두 `requireProjectAdmin(projectId)` (from `@/lib/authz`). 실패 시 `{ ok: false, error: g.error }` 즉시 반환(fail-closed). DB 접근은 전부 `createAdminClient()`.

```ts
'use server'

export interface InviteRow {
  id: string
  token: string
  expiresAt: string | null
  maxUses: number | null
  useCount: number
  redeemable: boolean      // isInviteRedeemable(row, new Date()) 계산값
  createdAt: string
}

/** 프로젝트의 초대 목록, created_at desc */
export async function listProjectInvites(projectId: string):
  Promise<{ ok: true; rows: InviteRow[] } | { ok: false; error: string }>

/** 초대 생성. token = crypto.randomUUID(), team_id = 게이트가 돌려준 actor의 teamId
 *  (requireProjectAdmin 성공 시 { ok:true, actor }를 반환하므로 별도 getActor() 호출 불필요).
 *  ⚠️ Actor.teamId는 nullable(memberships 행 부재·teams 조인 공백 — 슈퍼유저가 현실적
 *  케이스)인데 project_invites.team_id는 not null — null이면 insert 전에
 *  { ok:false, error:'초대 생성자의 팀 정보를 확인할 수 없습니다.' }로 fail-closed (E14).
 *  input.expiresAt: ISO 문자열 또는 null. input.maxUses: 양의 정수 또는 null.
 *  maxUses가 0 이하·비정수면 { ok:false, error:'최대 사용 횟수는 1 이상의 정수여야 합니다.' } */
export async function createProjectInvite(
  projectId: string,
  input: { expiresAt?: string | null; maxUses?: number | null },
): Promise<{ ok: true; row: InviteRow } | { ok: false; error: string }>

/** 초대 취소(행 삭제). 해당 projectId 소속이 아닌 inviteId면 { ok:false, error:'초대를 찾을 수 없습니다.' } */
export async function revokeProjectInvite(projectId: string, inviteId: string):
  Promise<{ ok: true } | { ok: false; error: string }>
```

- `createProjectInvite`·`revokeProjectInvite` 성공 시 `revalidatePath(\`/p/${projectId}/settings\`)`
- delete는 반드시 `.eq('id', inviteId).eq('project_id', projectId)` 이중 조건 — projectId 게이트를 통과한 뒤 남의 프로젝트 invite id를 찍는 교차 참조 차단

### 4-3. 공개 redeem 액션 — `src/app/actions/inviteRedeem.ts` (신규)

인증 게이트 없음(공개 플로우). 단, 모든 함수 첫 줄에서 `isInviteToken(token)` 검증 — 실패 시 `{ ok: false, error: '초대를 찾을 수 없습니다.' }` (형식 오류와 미존재를 구분해 알려주지 않는다).

```ts
'use server'

export interface InvitePreview {
  project: { id: string; name: string; description: string | null }
  valid: boolean   // isInviteRedeemable 계산값
}

/** 미리보기. 토큰 미존재 → { ok:false, error:'초대를 찾을 수 없습니다.' }
 *  만료·소진이어도 ok:true + valid:false (원본과 동일: 미리보기는 200, 상태만 표시) */
export async function getInvitePreview(token: string):
  Promise<{ ok: true } & InvitePreview | { ok: false; error: string }>

/** 로그인 사용자 합류.
 *  1. 세션 확인 — 기존 헬퍼 getSession()(src/lib/auth.ts) 사용. 주의: createServerClient()는
 *     async라 직접 쓸 땐 (await createServerClient()).auth... 형태여야 한다.
 *     세션 없으면 { ok:false, error:'로그인이 필요합니다.' }
 *  2. project_roles에 (project_id, user_id) 행이 이미 있으면 소비 없이
 *     { ok:true, projectId, alreadyMember:true } — 원본은 기존 멤버 재방문에도 use_count를
 *     낭비하는 결함이 있었다. 여기서 수정한다.
 *  3. admin.rpc('consume_project_invite', { p_token: token }) — 행 0개면
 *     { ok:false, error:'만료되었거나 사용할 수 없는 초대입니다.' }
 *  4. project_roles를 §5-3의 upsert(ignoreDuplicates)로 추가:
 *     { project_id, user_id, role:'member', granted_by: consume가 반환한 created_by ?? user_id }
 *     ※ 소비(3) 후 이 단계가 실패하면 use_count를 되돌리지 않는다 — console.error만 남기고
 *     에러 반환(의도된 트레이드오프: 복원 로직의 복잡도 대비, 실패 시 사용자가 버튼 재클릭으로
 *     재시도 가능하고 upsert 실패 자체가 이례적).
 *  5. revalidatePath('/projects') 후 { ok:true, projectId, alreadyMember:false } */
export async function redeemInvite(token: string):
  Promise<{ ok: true; projectId: string; alreadyMember: boolean } | { ok: false; error: string }>

/** 가입+합류 (비로그인 전용 — 세션이 있으면 { ok:false, error:'이미 로그인되어 있습니다.' }).
 *  1. validateSignupInput 실패 시 그 에러 그대로 반환
 *  2. 미리보기 수준 사전 검증: 토큰 조회 → 미존재 '초대를 찾을 수 없습니다.' /
 *     redeemable 아님 '만료되었거나 사용할 수 없는 초대입니다.'
 *  3. admin.auth.admin.createUser({ email: trim, password, email_confirm: true,
 *     user_metadata: { full_name: name } }) — 중복 이메일 등 실패 시
 *     { ok:false, error:'이미 사용 중인 이메일이거나 입력값을 확인해 주세요.' }
 *  4. memberships insert { user_id, team_id: (invite.team_id), role: 'team_editor' }
 *  5. rpc consume_project_invite — 행 0개(그 사이 소진)면 보상 롤백 후
 *     '만료되었거나 사용할 수 없는 초대입니다.'
 *  6. project_roles를 §5-3의 upsert(ignoreDuplicates)로 추가 (redeemInvite 4단계와 동일)
 *  7. 로스터 사후 연결: admin.from('project_members')
 *       .update({ user_id }).is('user_id', null).eq('email', email.trim().toLowerCase())
 *     — 기존 accounts.ts의 계정 생성 직후 수동 연결 관례 그대로(트리거는 project_members
 *     insert/update에만 발화하므로 auth 계정 생성만으로는 연결 안 됨).
 *     이 단계는 실패해도 전체 성공을 유지한다(console.error만).
 *  실패 보상: 3단계 성공 이후 4·5·6 중 어디서든 실패하면
 *  admin.auth.admin.deleteUser(userId) 호출(memberships·project_roles는 FK cascade로 정리),
 *  롤백 자체가 실패하면 console.error만 남기고 원래 에러를 반환 —
 *  기존 accounts.ts의 보상 롤백 관례와 동일.
 *  성공: { ok:true, projectId, email } — 클라이언트가 이 email+입력했던 password로
 *  signInWithPassword를 수행한다(§6-2) */
export async function redeemInviteWithSignup(token: string, input: SignupInput):
  Promise<{ ok: true; projectId: string; email: string } | { ok: false; error: string }>
```

`getInvitePreview`의 조회는 `createAdminClient()`(RLS 전면 차단이므로 필수) + 컬럼 화이트리스트 select — `share/minutes/[token]` 페이지의 기존 패턴과 동일.

---

## 5. 핵심 통합 지점 (가장 위험한 부분)

### 5-1. `src/middleware.ts` matcher — **누락 시 기능 전체가 죽는다**

`/invite/**`가 미들웨어 인증 게이트에 걸리면 비로그인 방문자가 전부 `/login`으로 튕겨 초대 링크가 무용지물이 된다. matcher의 negative-lookahead 그룹에 `invite/`를 추가한다. **반드시 슬래시로 앵커** (`invite`가 아니라 `invite/`) — 파일 내 기존 주석("접두사만 쓰면 /share-xxx 같은 미래 경로까지 인증이 풀린다")이 지적하는 함정과 동일.

현재 원문:
```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api|share/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'],
}
```
변경 후:
```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api|share/|invite/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)).*)'],
}
```
`middleware()` 함수 본체는 수정 불필요 — matcher 제외만으로 게이트를 통과한다(`/share/**`와 동일 구조).

### 5-2. 설정 화면 `AUTHORIZATION` 섹션 — `src/app/(app)/p/[projectId]/settings/page.tsx`

기존 SectionCard 중 **eyebrow가 `AUTHORIZATION`인 카드**(`isAdmin`일 때만 렌더, 내부에서 `listProjectRoles` 호출 후 `ProjectRolesManager canManageAdmins={isSuperuser}` 렌더 — 순서로 찾지 말 것, 일부 카드는 조건부라 순번이 밀린다)가 초대 UI의 정확한 삽입 지점이다. 같은 SectionCard 안에서 `ProjectRolesManager` **아래에** 초대 블록을 추가한다:

```tsx
{isAdmin && (
  <SectionCard eyebrow="AUTHORIZATION" title={locale === 'ko' ? '권한' : 'Roles'} icon={Shield}>
    {/* 기존 ProjectRolesManager 렌더 코드는 그대로 두고, 그 아래에: */}
    {await (async () => {
      const inv = await listProjectInvites(projectId)
      if (!inv.ok) return <p className="text-sm text-delayed">{inv.error}</p>
      return <ProjectInviteManager projectId={projectId} rows={inv.rows} />
    })()}
  </SectionCard>
)}
```
기존 코드 구조(섹션 순서, `isAdmin`/`isSuperuser` 계산, 다른 SectionCard)는 일절 변경하지 않는다.

### 5-3. `project_roles` insert 방식

- supabase-js에는 `insert ... on conflict do nothing`을 직접 쓰는 API가 없다. DO NOTHING 의미를 내는 유일한 경로는 **`.upsert()` + `ignoreDuplicates: true`**:
  ```ts
  await admin.from('project_roles').upsert(
    { project_id: projectId, user_id: userId, role: 'member', granted_by: grantedBy },
    { onConflict: 'project_id,user_id', ignoreDuplicates: true },
  )
  ```
  기존 선례: `src/app/actions/minutes.ts`의 즐겨찾기 upsert(`{ onConflict: 'user_id,minute_id', ignoreDuplicates: true }`).
- **`ignoreDuplicates: true`를 빠뜨리면 안 된다** — 없으면 UPDATE가 수행되어 이미 admin인 사용자가 초대 링크를 밟는 순간 member로 강등된다(기존 `projectRoles.ts`의 `setProjectRole`이 쓰는 형태가 바로 그 update형 upsert — 그건 의도된 역할 변경 액션이라 맞고, 여기서는 틀리다).
- 이 insert로 사용자는 D'Flow 권한 체계에 완전 편입된다: `requireProjectMember` 통과, Actor의 `projectRoles` Map에 등장, RLS 헬퍼 `is_project_member(pid)` true. **추가 연동 코드 불필요** — 이것이 이 설계가 project_roles를 목표 테이블로 삼는 이유다.

### 5-4. 가입+합류의 계정 생성 — 기존 `accounts.ts` 관례 준수

`admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } })` + memberships 더미 role `'team_editor'` + 실패 시 `deleteUser` 보상 롤백. 이 4요소는 전부 기존 `src/app/actions/accounts.ts`의 확립된 패턴이므로 그대로 복제한다. `memberships.role`을 권한 판정에 쓰는 코드를 절대 새로 만들지 말 것(deprecated 컬럼).

### 5-5. 신규 계정의 team 배정

`memberships.team_id`는 not null이라 회피 불가. 초대 생성 시점의 생성자 팀(게이트가 반환한 `actor.teamId`)을 `project_invites.team_id`에 저장해 두었다가 가입 시 사용한다. `actor.teamId`가 null이면 생성 자체를 E14로 거부(§4-2). 팀 선택 UI는 만들지 않는다(v1 단순화 — 필요해지면 초대 생성 폼에 팀 select 추가가 자연스러운 확장점).

---

## 6. UI/UX

### 6-1. 초대 관리 — `src/components/settings/ProjectInviteManager.tsx` (신규, `'use client'`)

`ProjectRolesManager.tsx`의 기존 패턴(useTransition + 서버 액션 직접 호출 + 행별 에러 + `router.refresh()`)을 따른다. 외부 UI 라이브러리 금지 — Tailwind 유틸리티 + lucide-react 아이콘. 네이티브 `alert/confirm` 금지.

구조 (원본 또박 UI의 "초대 링크" 섹션 이식):
- 소제목: `초대 링크`
- 생성 폼 (한 줄): 만료일 `<input type="date">` (라벨 `만료 (선택)`) · 최대횟수 `<input type="number" min="1">` (placeholder `무제한`) · `링크 생성` 버튼
  - date 값은 그날 23:59:59 로컬 → ISO 변환해 `expiresAt`으로, 빈 값이면 null. 숫자 빈 값이면 null
- 초대 목록 (0개면 안내문 `활성 초대 링크가 없습니다.`): 각 행에
  - 링크 전문 `{origin}/invite/{token}` — `font-mono text-xs`, `window.location.origin` 기반
  - 상태 텍스트: `inviteUsageLabel(row)` + (expiresAt 있으면 ` · ~{YYYY-MM-DD}`) + (!redeemable이면 ` · 만료됨`)
  - 복사 버튼: `navigator.clipboard.writeText(url)`, 성공 시 1.5초간 체크 아이콘(lucide `Check`)으로 교체 후 복귀 (아이콘: 평시 lucide `Copy`)
  - 취소 버튼(lucide `Trash2`): `revokeProjectInvite` 호출. 실행 전 확인은 기존 `Modal` 컴포넌트 사용 — 메시지 `이 초대 링크를 취소할까요? 이미 합류한 멤버는 영향받지 않습니다.`
- 액션 실패 시 행/폼 하단에 `role="alert"` 빨간 텍스트: `초대 링크 생성에 실패했습니다.` / `초대 취소에 실패했습니다.` (서버가 준 error 문구가 있으면 그것을 우선 표시)
- 성공 시 토스트 — 실제 API: `const { toast } = useToast()` 후 `toast({ title: '초대 링크를 만들었습니다.', variant: 'success' })` / 취소: `toast({ title: '초대 링크를 취소했습니다.', variant: 'success' })` (`toast('문자열')` 형태 아님)

### 6-2. 공개 초대 페이지 — `src/app/invite/[token]/page.tsx` (신규) + `src/components/invite/InviteRedeemCard.tsx` (신규, `'use client'`)

**page.tsx** (서버 컴포넌트, `(app)` 그룹 밖, `/share/minutes/[token]`과 같은 위상):
- `export const dynamic = 'force-dynamic'` (캐시 방지 — share 페이지 선례)
- `export const metadata = { robots: { index: false, follow: false } }` — 초대 링크는 검색엔진 노출 금지(share 페이지 선례)
- Next.js 15: `params`는 Promise다 — `{ params }: { params: Promise<{ token: string }> }` 시그니처 후 `const { token } = await params` (share 페이지·settings 페이지 선례와 동일)
- share 페이지 선례의 env 가드 유지: service_role 키 미설정 환경이면 `notFound()`
- `isInviteToken(token)` 실패 또는 `getInvitePreview` `ok:false` → 오류 카드만 렌더
- 세션 유무를 서버에서 판정 — `(await createServerClient()).auth.getClaims()` (createServerClient는 async) — 해서 `isAuthed`로 클라이언트 컴포넌트에 전달
- 성공 시 `<InviteRedeemCard token={token} preview={preview} isAuthed={isAuthed} />`
- 로그인 화면(`src/app/login/page.tsx`)의 기존 레이아웃·톤을 참고해 중앙 카드형으로

**InviteRedeemCard 상태 전이** (원본 InviteRedeemPage 이식):

| 상태 | 화면 |
|---|---|
| 토큰 미존재·형식 오류·`valid:false` | `만료되었거나 유효하지 않은 초대 링크입니다.` + `로그인 화면으로` 버튼(→ `/login` — `/`는 비로그인 시 어차피 `/login`으로 튕기므로 직접 링크가 정직) |
| 정상 + 공통 헤더 | 프로젝트명(굵게) + `프로젝트에 초대되었습니다.` + description 있으면 아래 회색 표시 |
| `isAuthed` | `합류하기` 버튼 하나. 클릭 → `redeemInvite(token)` → 성공 시 toast(`alreadyMember` ? `이미 참여 중인 프로젝트입니다.` : `프로젝트에 합류했습니다.`) 후 `router.push('/projects')`. 실패 시 `role="alert"`로 서버 error 문구(없으면 `합류에 실패했습니다. 다시 시도해 주세요.`) |
| 비로그인 · 가입 모드(기본) | 이름/이메일/비밀번호/비밀번호 확인 4필드 + `가입하고 합류하기` 버튼. 하단 `이미 계정이 있으신가요? 로그인` 링크(모드 전환) |
| 비로그인 · 로그인 모드 | 이메일/비밀번호 2필드 + `로그인하고 합류하기` 버튼. 하단 `계정이 없으신가요? 가입` 링크 |

- **가입 제출**: 클라이언트에서 `password !== passwordConfirm`이면 제출 없이 즉시 `비밀번호가 일치하지 않습니다.` 표시. 통과 시 `redeemInviteWithSignup(token, input)` → `ok:true`면 `createBrowserClient().auth.signInWithPassword({ email: 반환된 email, password: 입력값 })` → 성공 시 `router.push('/projects')` + toast `프로젝트에 합류했습니다.`. signIn이 실패하면(이례적) toast `variant:'info'`로 `가입은 완료되었습니다. 로그인 페이지에서 로그인해 주세요.` 후 `router.push('/login')`
- **로그인 제출**: `createBrowserClient().auth.signInWithPassword` → 실패 시 `로그인에 실패했습니다. 이메일·비밀번호를 확인해 주세요.` / 성공 시 이어서 `redeemInvite(token)` 호출(합류 처리 후 위 authed 성공 플로우와 동일). 로그인 성공+합류 실패의 부분 실패 상태 가능 — 에러 문구를 보여주되 세션은 유지(원본과 동일한 트레이드오프, 사용자는 버튼 재클릭으로 재시도 가능)
- 서버 액션 대기 중엔 해당 버튼 `disabled` + 라벨 `처리 중…`
- 페이지 로딩 자체는 서버 컴포넌트라 별도 로딩 상태 불필요
- 이 컴포넌트의 모든 토스트도 §6-1의 실제 API 형태(`toast({ title, variant })`)를 따른다

---

## 7. 검증·에러 규칙 표

| # | 상황 | 검증 위치 | 사용자 문구(원문) |
|---|---|---|---|
| E1 | 토큰 형식 비정상(UUID 아님) | 서버 액션 첫 줄 `isInviteToken` | `초대를 찾을 수 없습니다.` |
| E2 | 토큰 미존재 | preview/redeem 조회 | `초대를 찾을 수 없습니다.` |
| E3 | 만료·소진 | `consume_project_invite` 행 0개 / preview `valid:false` | `만료되었거나 사용할 수 없는 초대입니다.` (페이지 문구: `만료되었거나 유효하지 않은 초대 링크입니다.`) |
| E4 | 비로그인 상태로 `redeemInvite` 호출 | 액션 내 세션 확인 | `로그인이 필요합니다.` |
| E5 | 로그인 상태로 `redeemInviteWithSignup` 호출 | 액션 내 세션 확인 | `이미 로그인되어 있습니다.` |
| E6 | 이름 공백 | `validateSignupInput` | `이름을 입력해 주세요.` |
| E7 | 이메일 형식 오류 | `validateSignupInput` | `이메일 형식을 확인해 주세요.` |
| E8 | 비밀번호 8자 미만 | `validateSignupInput` | `비밀번호는 8자 이상이어야 합니다.` |
| E9 | 비밀번호 불일치 | 클라이언트 선검증 + `validateSignupInput` 이중 | `비밀번호가 일치하지 않습니다.` |
| E10 | 중복 이메일 등 createUser 실패 | `redeemInviteWithSignup` 3단계 | `이미 사용 중인 이메일이거나 입력값을 확인해 주세요.` |
| E11 | 초대 관리 권한 없음 | `requireProjectAdmin` | 게이트가 반환하는 error 그대로 |
| E12 | `maxUses` 0 이하·비정수 | `createProjectInvite` 입력 검증 + DB check | `최대 사용 횟수는 1 이상의 정수여야 합니다.` |
| E13 | 취소 대상 invite가 해당 프로젝트 소속 아님 | delete 이중 조건 | `초대를 찾을 수 없습니다.` |
| E14 | 초대 생성자 Actor의 `teamId`가 null (슈퍼유저 등) | `createProjectInvite` insert 전 | `초대 생성자의 팀 정보를 확인할 수 없습니다.` |

규칙:
- E1과 E2는 같은 문구 — 형식 오류와 미존재를 구분해 노출하지 않는다(토큰 추측 단서 차단)
- 원시 Postgres/Supabase 에러 메시지를 사용자에게 그대로 노출하지 않는다(기존 관례)
- 기존 멤버의 redeem은 에러가 아니다 — 성공 처리 + `alreadyMember:true` + use_count 미소비

---

## 8. 보안 체크리스트

- [ ] `project_invites` RLS enable + **정책 0개**(전면 차단) + 테이블 GRANT 회수(revoke)·service_role 재부여 — RLS는 TRUNCATE를 막지 못하므로 둘 다 필요. 확인: anon 키로 REST 호출 `curl "$SUPABASE_URL/rest/v1/project_invites?select=token" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"` 가 빈 배열 또는 permission 에러
- [ ] `consume_project_invite` — `revoke ... from public, anon, authenticated` **및** `grant execute ... to service_role` 둘 다 존재 (grant 누락 시 redeem 전체가 permission denied)
- [ ] redeem·초대관리 액션 파일은 `'use server'`이며 클라이언트 컴포넌트에서 직접 import되는 것은 액션 함수뿐(admin client가 클라이언트 번들에 새지 않게 `createAdminClient` 호출은 액션 본문 안에서만)
- [ ] 초대 관리 3액션 전부 `requireProjectAdmin` 게이트 선행, fail-closed
- [ ] 미리보기 select는 컬럼 화이트리스트(`projects`의 id/name/description만) — start/end 일정, 멤버 목록 등 비공개 정보 미노출
- [ ] 토큰을 서버 로그(`console.log`)에 남기지 않는다
- [ ] `revokeProjectInvite` delete에 `project_id` 이중 조건(교차 프로젝트 취소 차단)
- [ ] `project_roles` insert는 `role:'member'` 고정 — 클라이언트 입력으로 role을 받지 않는다
- [ ] 가입 실패 보상 롤백(`deleteUser`)으로 유령 계정 방지
- [ ] 시크릿 신규 도입 없음(기존 SERVICE_ROLE 키만 사용) — env 변경 불필요

---

## 9. 구현 순서 — 태스크·게이트·권장 모델

각 태스크는 독립 서브에이전트(또는 별도 세션)로 실행 가능하도록 나눴다. 게이트를 통과해야 다음으로.

| # | 태스크 | 산출물 | 게이트 | 권장 모델 |
|---|---|---|---|---|
| T1 | 마이그레이션 작성 (§3-1 SQL + rollback 짝) | `supabase/migrations/0055_project_invites.sql`, `0055_project_invites_rollback.sql` | SQL 문법 검토 + 순번 충돌 없음(0055가 이미 쓰였으면 다음 번호로) + `grant execute ... to service_role` 존재 확인. **마이그레이션과 앱 코드를 같은 커밋에 담지 말 것**(레포 pre-push 게이트가 차단). 적용은 이 레포 관례상 사람이 Management API로 수행 — 자동 적용 시도 금지 | **sonnet** |
| T2 | 도메인 순수함수 + 단위 테스트 (§4-1) | `src/lib/domain/invites.ts`, `tests/domain/invites.test.ts` | `npx vitest run tests/domain/invites.test.ts` green. 만료 경계(정확히 now)·소진 경계(useCount==maxUses)·라벨 2형 포함 | **sonnet** |
| T3 | 초대 관리 서버 액션 + 게이트 테스트 (§4-2) | `src/app/actions/projectInvites.ts`, `tests/actions/project-invites-gate.test.ts` | 게이트 테스트 green — 비admin 거부 3케이스(list/create/revoke)가 admin client 도달 전에 차단됨을 단언. mock 패턴은 기존 `tests/actions/accounts-gate.test.ts` 방식(`vi.hoisted` 스파이 + `@/lib/authz`·`@/lib/supabase/admin` mock) | **sonnet** |
| T4 | redeem 서버 액션 2종 + 테스트 (§4-3) | `src/app/actions/inviteRedeem.ts`, `tests/actions/invite-redeem.test.ts` | 테스트 green: 세션無 redeemInvite 거부·기존멤버 무소비·소진 시 에러·가입 플로우 보상 롤백(consume 실패 시 deleteUser 호출됨) 단언 | **opus** — 계정 생성·보상 롤백·원자 소비가 겹치는 보안 민감 구간 |
| T5 | middleware matcher 수정 (§5-1) | `src/middleware.ts` 1줄 | 변경 diff가 §5-1 원문과 정확히 일치. dev 서버에서 비로그인 `/invite/아무값` 접근 시 /login 리다이렉트 안 됨 | **haiku** — 정확한 diff가 스펙에 있음 |
| T6 | 설정 화면 초대 관리 UI (§5-2, §6-1) | `src/components/settings/ProjectInviteManager.tsx`, settings/page.tsx 수정 | `npx tsc --noEmit` 통과(레포에 별도 typecheck 스크립트 없음 — 이 명령이 유효함 확인됨) + 기존 테스트 회귀 없음(`npm run test`) | **sonnet** |
| T7 | 공개 초대 페이지 (§6-2) | `src/app/invite/[token]/page.tsx`, `src/components/invite/InviteRedeemCard.tsx` | 타입체크 통과 + §10 수동 시나리오 M1~M3 화면 확인 | **sonnet** |
| T8 | 통합 리뷰 + 수동 검증 | 리뷰 보고 + §10 전체 수행 결과 | §8 보안 체크리스트 전항목 + §10 전 시나리오 pass | **opus** (또는 세션 최상위 모델) |

의존성: T1 → T2 → (T3, T4 병렬) → T5 → (T6, T7 병렬) → T8.
T2~T4는 마이그레이션이 실제 DB에 적용되기 전에도 완료 가능(테스트가 전부 mock 기반).
T7의 수동 확인은 마이그레이션 적용 후에만 가능.

---

## 10. 수용 기준 — 수동 검증 시나리오

전제: 마이그레이션 적용 완료, dev 서버 기동, 프로젝트 P에 admin 계정 A·무관 계정 B·미가입 이메일 C 준비.

1. **M1 생성·복사**: A가 P 설정 → 권한 섹션에서 만료·횟수 없이 링크 생성 → 목록에 `{origin}/invite/{uuid}` 표시, `0회 사용`, 복사 버튼으로 클립보드 복사됨
2. **M2 기존 계정 합류**: B(로그인 상태)가 링크 접속 → 프로젝트명 + `합류하기` → 클릭 → `/projects` 이동, P가 목록에 보이고 편집 가능(member 권한). 설정 화면에서 use_count `1회 사용` 확인. P의 권한 섹션에 B가 member로 표시
3. **M3 가입+합류**: 로그아웃(시크릿 창)에서 링크 접속 → 가입 폼 → C 이메일로 가입 → 자동 로그인되어 `/projects` 도착, P 접근 가능. `/admin/accounts`(슈퍼유저)에서 C 계정 존재·팀이 초대 생성자 팀과 일치 확인
4. **M4 기존 멤버 재방문**: B가 같은 링크 재접속 → `합류하기` → `이미 참여 중인 프로젝트입니다.` toast, use_count 증가 없음
5. **M5 admin 강등 없음**: A가 자기 초대 링크 접속·합류 클릭 → A의 role이 admin 그대로(권한 섹션 확인)
6. **M6 소진**: 최대횟수 1로 새 초대 생성 → 계정 하나로 소비 → 다른 비멤버 계정으로 접속 시 `만료되었거나 유효하지 않은 초대 링크입니다.`
7. **M7 만료**: 만료일을 어제로 생성(DB에서 expires_at을 과거로 update해도 됨) → 접속 시 만료 화면
8. **M8 취소**: A가 초대 취소(Modal 확인) → 목록에서 사라짐, 기존 합류자 B는 여전히 member
9. **M9 권한 차단**: B(member, admin 아님)로 P 설정 접근 → 권한 섹션 자체가 안 보이거나 초대 액션 거부. anon 키 REST 호출(§8 첫 항목의 curl)로 `project_invites` 직접 조회 → 토큰 안 나옴
10. **M10 비밀번호 검증**: 가입 폼에서 비밀번호 불일치 → 제출 없이 인라인 에러. 7자 비밀번호 → `비밀번호는 8자 이상이어야 합니다.`
11. **M11 잘못된 토큰**: `/invite/not-a-uuid`, `/invite/{무작위 uuid}` 접속 → 둘 다 동일한 오류 화면(구분 불가)
12. **M12 비로그인 게이트**: 비로그인으로 `/invite/{유효 토큰}` 접속 시 `/login`으로 리다이렉트되지 않고 초대 화면이 뜸 (T5 검증)

---

## 11. 부록

### 11-1. 의도적으로 버린/바꾼 원본 요소

| 원본(또박) | 처리 | 이유 |
|---|---|---|
| 6자 영숫자 코드(`SecureRandom.alphanumeric(6)`) + unique 루프 | UUID(`crypto.randomUUID()`)로 대체 | D'Flow `share_token` 선례 재사용, 형식 검증 헬퍼 동일 패턴, 엔트로피 상향. unique 재시도 루프 불필요해짐 |
| `redeemable?` 체크 후 별도 `consume!` (TOCTOU race — 동시 요청 시 max_uses 초과 가능) | 단일 UPDATE(`consume_project_invite`)로 원자화 | 원본의 알려진 결함 수정. Postgres라 공짜 |
| 기존 멤버 재방문에도 `consume!` 실행(use_count 낭비) | 멤버십 선확인 후 무소비 성공 처리 | 원본의 알려진 결함 수정 |
| 개인(personal) 프로젝트 3중 차단(생성 409·redeem 409·모델 validation) | 전부 제거 | D'Flow에 personal 프로젝트 개념 없음 |
| `EnsurePersonalProject`(가입 시 "내 회의" 자동 생성) | 제거 | 동상 |
| JWT 발급(`JwtService.issue_session`) 후 토큰 반환 | Supabase auth: 가입 후 클라이언트 `signInWithPassword` | D'Flow 인증 스택. 서버 액션에서 세션 쿠키를 직접 심지 않고 기존 로그인 관례 따름 |
| 하이브리드 인증 오판 방지(`signup_requested?`로 가입 의도 판별) | 액션 2개로 분리(`redeemInvite`/`redeemInviteWithSignup`) | D'Flow엔 로컬 데스크톱 모드가 없어 세션 판별이 신뢰 가능. 파라미터 스니핑보다 명시적 |
| 시스템 role 이중 게이트(manager 이상 AND 프로젝트 admin) | `requireProjectAdmin`(슈퍼유저 OR 프로젝트 admin) 단일 게이트 | D'Flow 권한 2축 체계의 확립된 판정 함수. 시스템 role 축(User.role)에 대응물 없음 |
| 멤버 추가/역할 변경/제거 UI(ProjectMembersPanel 섹션 1·2) | 이식 안 함 | D'Flow `ProjectRolesManager`가 이미 동등 기능 제공 |
| redeem 응답에 프로젝트 icon_type/icon_value/color | name/description만 | D'Flow projects에 아이콘·색 컬럼 없음(실측) |
| `use_count` 표시 시 만료일 `~{날짜}` 포맷 | 유지 | — |
| 초대 목록 API가 별도 컨트롤러(`invites#index`) | 서버 액션 1파일 | D'Flow 관례(route handler는 특수 케이스만) |

### 11-2. 원본 대응표 (검증용 — 대상 세션에서는 불필요)

| 스펙 섹션 | 원본(ddobakddobak) |
|---|---|
| §3 데이터 모델 | backend/db/schema.rb:297-319, app/models/project_invite.rb |
| §4-1 redeemable 계산 | app/models/project_invite.rb `redeemable?` |
| §4-2 관리 액션 | app/controllers/api/v1/project_invites_controller.rb |
| §4-3 redeem 액션 | app/controllers/api/v1/invites_controller.rb |
| §6-1 관리 UI | frontend/src/components/project/ProjectMembersPanel.tsx §"초대 링크" |
| §6-2 공개 페이지 | frontend/src/pages/InviteRedeemPage.tsx, App.tsx:151-156 |
| §7 에러 문구 | 두 컨트롤러 + InviteRedeemPage의 한글 문구 원문 |
| §10 시나리오 | backend/spec/requests/api/v1/invites_spec.rb·project_invites_spec.rb 케이스 + 원본 미커버 갭(취소·소진 재시도·동시성) 보강 |

### 11-3. 대상 레포 실측 근거 (스펙 작성 시점 확인값)

- `project_roles(project_id, user_id, role check in ('admin','member'), granted_by, granted_at)` PK `(project_id, user_id)` — `supabase/migrations/0052_authz_roles.sql`
- `memberships(user_id PK, team_id not null FK teams cascade, role not null check in ('pmo_admin','team_editor') — deprecated, is_superuser boolean default false)` — `0001_init.sql` + `0052`
- `projects` 실효 컬럼: id/name/start_date/end_date/created_at/description/base_date (icon·color 없음)
- 가드: `src/lib/authz/index.ts` — `requireProjectAdmin`(성공 시 `{ ok:true, actor }`), `Actor.teamId`는 **nullable**
- 마이그레이션 순번: 최대 0054 → 이 기능은 0055 (검증 시점 실측)
- 이메일 검증: `src/lib/domain/validate.ts` `isValidEmail`
- 계정 생성 관례: `src/app/actions/accounts.ts` — `admin.auth.admin.createUser` + memberships 더미 role + deleteUser 보상 롤백
- 비밀번호 정책: `src/lib/domain/accounts.ts` `isValidPassword`(8자 이상)
- 토큰 선례: `src/lib/minutes/share.ts`(`isShareToken`, UUID 정규식), 생성은 `src/app/actions/minutes.ts`의 `crypto.randomUUID()`
- 공개 라우트 선례: `src/app/share/minutes/[token]/page.tsx`(`force-dynamic`, admin client, 컬럼 화이트리스트)
- matcher 원문: `src/middleware.ts` (§5-1에 인용)
- UI 관례: `src/components/ui/Modal.tsx`·`Toast.tsx`(`useToast`), `SectionCard.tsx`, `src/components/settings/ProjectRolesManager.tsx`
- 테스트 관례: `vitest.config.ts`(`tests/**/*.test.{ts,tsx}`), `tests/actions/accounts-gate.test.ts` mock 패턴
