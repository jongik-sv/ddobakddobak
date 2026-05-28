# 서버 설정 — 저장된 서버 + 스캔 피드백 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 설정 화면의 "최근 서버"를 이름/위치 편집·삭제가 가능한 "저장된 서버"로 바꾸고, 포트 표시를 정리하고, 스캔 버튼 피드백을 강화한다.

**Architecture:** localStorage 영속 로직을 `lib/savedServers.ts`로 분리(단위 테스트 가능)하고, `ServerSetup.tsx`는 그 모듈을 호출해 목록 렌더·인라인 편집·삭제·스캔 UI만 담당한다. 데이터는 기존 `recent_servers` 키를 재사용하되 `string[]`/객체 두 형태를 모두 로드(마이그레이션).

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, Tauri invoke, Tailwind, lucide-react.

스펙: `docs/superpowers/specs/2026-05-28-server-setup-saved-servers-design.md`

---

## File Structure

- **Create** `frontend/src/lib/savedServers.ts` — SavedServer 타입 + 로드/마이그레이션/upsert/update/remove. localStorage 캡슐화.
- **Create** `frontend/src/lib/__tests__/savedServers.test.ts` — 위 모듈 단위 테스트.
- **Modify** `frontend/src/components/auth/ServerSetup.tsx` — recent_servers 인라인 로직 제거 → 모듈 사용. 목록 렌더(이름/host/포트), 인라인 편집, 삭제, 스캔 버튼 피드백.
- **Modify** `frontend/src/components/auth/__tests__/ServerSetup.test.tsx` — placeholder 불일치 정상화 + 저장된 서버 렌더/편집/삭제 테스트 추가.

테스트 실행 기준 디렉터리: `frontend/`. 명령: `npx vitest run <path>`.

---

### Task 1: savedServers 모듈 — 타입 + 로드/마이그레이션

**Files:**
- Create: `frontend/src/lib/savedServers.ts`
- Test: `frontend/src/lib/__tests__/savedServers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/lib/__tests__/savedServers.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadSavedServers } from '../savedServers'

const KEY = 'recent_servers'

describe('loadSavedServers', () => {
  beforeEach(() => localStorage.clear())

  it('빈 저장소면 빈 배열', () => {
    expect(loadSavedServers()).toEqual([])
  })

  it('구버전 string[] 을 객체로 마이그레이션한다', () => {
    localStorage.setItem(KEY, JSON.stringify(['http://192.168.0.10:13323', 'http://10.0.0.5:8080']))
    const list = loadSavedServers()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ url: 'http://192.168.0.10:13323', lastConnectedAt: 0 })
    expect(list[0].name).toBeUndefined()
  })

  it('객체 형태는 그대로 로드하고 lastConnectedAt 내림차순 정렬', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { url: 'http://a:13323', lastConnectedAt: 100 },
      { url: 'http://b:13323', name: '집', lastConnectedAt: 300 },
      { url: 'http://c:13323', lastConnectedAt: 200 },
    ]))
    const list = loadSavedServers()
    expect(list.map((s) => s.url)).toEqual(['http://b:13323', 'http://c:13323', 'http://a:13323'])
    expect(list[0].name).toBe('집')
  })

  it('손상된 JSON 이면 빈 배열', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadSavedServers()).toEqual([])
  })

  it('url 없는 항목은 버린다', () => {
    localStorage.setItem(KEY, JSON.stringify([{ name: 'x', lastConnectedAt: 1 }, { url: 'http://ok:13323', lastConnectedAt: 2 }]))
    expect(loadSavedServers().map((s) => s.url)).toEqual(['http://ok:13323'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/savedServers.test.ts`
Expected: FAIL — `loadSavedServers` 모듈 없음.

- [ ] **Step 3: 최소 구현**

`frontend/src/lib/savedServers.ts`:

```ts
const RECENT_SERVERS_KEY = 'recent_servers'
const MAX_SAVED = 10

export interface SavedServer {
  url: string
  name?: string
  location?: string
  lastConnectedAt: number
}

/** 저장소의 한 항목(문자열=구버전 / 객체=신버전)을 SavedServer로 변환. 실패 시 null. */
function coerce(item: unknown): SavedServer | null {
  if (typeof item === 'string') return { url: item, lastConnectedAt: 0 }
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    if (typeof o.url !== 'string') return null
    return {
      url: o.url,
      name: typeof o.name === 'string' ? o.name : undefined,
      location: typeof o.location === 'string' ? o.location : undefined,
      lastConnectedAt: typeof o.lastConnectedAt === 'number' ? o.lastConnectedAt : 0,
    }
  }
  return null
}

/** 저장된 서버 목록을 로드한다(구버전 string[] 마이그레이션, 최근접속순 정렬). */
export function loadSavedServers(): SavedServer[] {
  try {
    const raw = localStorage.getItem(RECENT_SERVERS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    const list = arr.map(coerce).filter((s): s is SavedServer => s !== null)
    return list.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
  } catch {
    return []
  }
}

function save(list: SavedServer[]): SavedServer[] {
  const sorted = [...list].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt).slice(0, MAX_SAVED)
  localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(sorted))
  return sorted
}
```

> 참고: `MAX_SAVED`/`save`는 Task 2에서 사용. Step 3 빌드 통과를 위해 `save`에 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 불필요 — 같은 커밋에 Task 2 포함되지 않으므로 export 안 하면 unused 경고 가능. 경고 회피 위해 Task 2 전까지 `save`를 추가하지 말고, Task 2 Step 3에서 함께 추가한다. (즉 이 Task의 구현에는 `coerce`/`loadSavedServers`/상수만 포함.)

수정: 이 Task에서는 아래만 작성한다 — 상수 `RECENT_SERVERS_KEY`, `MAX_SAVED`(주석으로 다음 Task 예고 불필요, 그냥 선언), `SavedServer`, `coerce`, `loadSavedServers`. `save`는 Task 2에서 추가.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/savedServers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/savedServers.ts frontend/src/lib/__tests__/savedServers.test.ts
git commit -m "feat(frontend): savedServers loader with legacy string[] migration"
```

---

### Task 2: upsertOnConnect / updateSavedServer / removeSavedServer

**Files:**
- Modify: `frontend/src/lib/savedServers.ts`
- Test: `frontend/src/lib/__tests__/savedServers.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`savedServers.test.ts` 하단에 추가:

```ts
import { upsertOnConnect, updateSavedServer, removeSavedServer } from '../savedServers'

describe('upsertOnConnect', () => {
  beforeEach(() => localStorage.clear())

  it('신규 url 을 추가하고 lastConnectedAt 을 채운다', () => {
    const before = Date.now()
    const list = upsertOnConnect('http://192.168.0.10:13323')
    expect(list).toHaveLength(1)
    expect(list[0].url).toBe('http://192.168.0.10:13323')
    expect(list[0].lastConnectedAt).toBeGreaterThanOrEqual(before)
  })

  it('기존 url 의 name/location 을 보존하고 lastConnectedAt 만 갱신', () => {
    localStorage.setItem('recent_servers', JSON.stringify([
      { url: 'http://a:13323', name: '사무실', location: '회의실', lastConnectedAt: 1 },
    ]))
    const list = upsertOnConnect('http://a:13323')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: '사무실', location: '회의실' })
    expect(list[0].lastConnectedAt).toBeGreaterThan(1)
  })

  it('최근 접속이 맨 앞에 온다', () => {
    upsertOnConnect('http://a:13323')
    const list = upsertOnConnect('http://b:13323')
    expect(list[0].url).toBe('http://b:13323')
  })

  it('11개째부터 가장 오래된 항목이 밀려난다 (캡 10)', () => {
    for (let i = 0; i < 11; i++) upsertOnConnect(`http://h${i}:13323`)
    const list = loadSavedServers()
    expect(list).toHaveLength(10)
    expect(list.some((s) => s.url === 'http://h0:13323')).toBe(false)
  })
})

describe('updateSavedServer', () => {
  beforeEach(() => localStorage.clear())

  it('이름/위치를 갱신한다', () => {
    upsertOnConnect('http://a:13323')
    const list = updateSavedServer('http://a:13323', { name: '집', location: '서재' })
    expect(list[0]).toMatchObject({ name: '집', location: '서재' })
  })

  it('빈 문자열 patch 는 undefined 로 정리한다', () => {
    localStorage.setItem('recent_servers', JSON.stringify([{ url: 'http://a:13323', name: 'x', lastConnectedAt: 1 }]))
    const list = updateSavedServer('http://a:13323', { name: '', location: '' })
    expect(list[0].name).toBeUndefined()
    expect(list[0].location).toBeUndefined()
  })
})

describe('removeSavedServer', () => {
  beforeEach(() => localStorage.clear())

  it('해당 url 을 제거한다', () => {
    upsertOnConnect('http://a:13323')
    upsertOnConnect('http://b:13323')
    const list = removeSavedServer('http://a:13323')
    expect(list.map((s) => s.url)).toEqual(['http://b:13323'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/savedServers.test.ts`
Expected: FAIL — 세 함수 미정의.

- [ ] **Step 3: 구현 추가**

`savedServers.ts`에 `save` 함수(Task 1에서 미작성)와 세 함수를 추가:

```ts
function save(list: SavedServer[]): SavedServer[] {
  const sorted = [...list].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt).slice(0, MAX_SAVED)
  localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(sorted))
  return sorted
}

/** 접속 성공한 url 을 기록한다. 기존 항목이면 name/location 보존, lastConnectedAt 만 갱신. */
export function upsertOnConnect(url: string): SavedServer[] {
  const now = Date.now()
  const list = loadSavedServers()
  const existing = list.find((s) => s.url === url)
  if (existing) {
    existing.lastConnectedAt = now
    return save(list)
  }
  return save([{ url, lastConnectedAt: now }, ...list])
}

/** url 항목의 이름/위치를 갱신한다. 빈 문자열은 제거(undefined). */
export function updateSavedServer(
  url: string,
  patch: { name?: string; location?: string },
): SavedServer[] {
  const list = loadSavedServers()
  const target = list.find((s) => s.url === url)
  if (target) {
    if (patch.name !== undefined) target.name = patch.name.trim() || undefined
    if (patch.location !== undefined) target.location = patch.location.trim() || undefined
  }
  return save(list)
}

/** url 항목을 삭제한다. */
export function removeSavedServer(url: string): SavedServer[] {
  return save(loadSavedServers().filter((s) => s.url !== url))
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/savedServers.test.ts`
Expected: PASS (전체).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/savedServers.ts frontend/src/lib/__tests__/savedServers.test.ts
git commit -m "feat(frontend): savedServers upsert/update/remove with cap 10"
```

---

### Task 3: 표시 헬퍼 (host/port) + 모듈 export

**Files:**
- Modify: `frontend/src/lib/savedServers.ts`
- Test: `frontend/src/lib/__tests__/savedServers.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

```ts
import { displayHost, displayPort, DEFAULT_PORT } from '../savedServers'

describe('display helpers', () => {
  it('displayHost 는 호스트만 반환', () => {
    expect(displayHost('http://192.168.0.10:13323')).toBe('192.168.0.10')
    expect(displayHost('https://example.com:8080')).toBe('example.com')
  })

  it('displayPort 는 기본포트면 null', () => {
    expect(displayPort(`http://192.168.0.10:${DEFAULT_PORT}`)).toBeNull()
  })

  it('displayPort 는 비기본포트면 문자열', () => {
    expect(displayPort('http://10.0.0.5:8080')).toBe('8080')
  })

  it('파싱 불가 url 은 host=원문, port=null', () => {
    expect(displayHost('garbage')).toBe('garbage')
    expect(displayPort('garbage')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/__tests__/savedServers.test.ts`
Expected: FAIL — `displayHost`/`displayPort`/`DEFAULT_PORT` 미정의.

- [ ] **Step 3: 구현 추가**

`savedServers.ts` 상단(상수 옆)과 함수 추가:

```ts
export const DEFAULT_PORT = '13323'

/** url 에서 호스트만 추출. 파싱 실패 시 원문 반환. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** url 의 포트. 기본포트(13323) 또는 파싱 실패면 null. */
export function displayPort(url: string): string | null {
  try {
    const port = new URL(url).port
    if (!port || port === DEFAULT_PORT) return null
    return port
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/__tests__/savedServers.test.ts`
Expected: PASS (전체).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/savedServers.ts frontend/src/lib/__tests__/savedServers.test.ts
git commit -m "feat(frontend): savedServers display host/port helpers"
```

---

### Task 4: ServerSetup — 모듈 연동 + 저장된 서버 렌더

**Files:**
- Modify: `frontend/src/components/auth/ServerSetup.tsx`
- Modify: `frontend/src/components/auth/__tests__/ServerSetup.test.tsx`

이 Task는 기존 인라인 `recent_servers` 로직을 모듈로 교체하고 목록 행을 새 표시 규칙으로 렌더한다. 편집/삭제는 Task 5.

- [ ] **Step 1: 컴포넌트 수정 — import 및 상태 교체**

`ServerSetup.tsx` 상단 import에 추가:

```ts
import { Monitor, Globe, CheckCircle, XCircle, Loader2, Search, Pencil, Trash2 } from 'lucide-react'
import {
  type SavedServer,
  loadSavedServers,
  upsertOnConnect,
  updateSavedServer,
  removeSavedServer,
  displayHost,
  displayPort,
} from '../../lib/savedServers'
```

`ServerSetup.tsx`에서 다음 기존 코드 블록 삭제 (라인 28~46 부근):

```ts
const RECENT_SERVERS_KEY = 'recent_servers'
const MAX_RECENT = 5
function loadRecentServers(): string[] { ... }
function pushRecentServer(url: string): void { ... }
```

(`normalizeUrl`, `DEFAULT_PORT` 상수 중 컴포넌트 로컬 `DEFAULT_PORT='13323'`은 `normalizeUrl`이 쓰므로 유지. 모듈의 `DEFAULT_PORT`와 이름 충돌하므로 모듈에서는 `DEFAULT_PORT`를 import하지 않고 `displayPort`만 사용한다 — 위 import에서 `DEFAULT_PORT` 제거.)

> 정정: import 줄에서 `DEFAULT_PORT`를 빼고 `loadSavedServers, upsertOnConnect, updateSavedServer, removeSavedServer, displayHost, displayPort, type SavedServer`만 가져온다. 컴포넌트 로컬 `DEFAULT_PORT`(normalizeUrl용)는 그대로 둔다.

상태 교체 — 기존:
```ts
const [recentServers] = useState<string[]>(loadRecentServers)
```
변경:
```ts
const [savedServers, setSavedServers] = useState<SavedServer[]>(loadSavedServers)
const [editingUrl, setEditingUrl] = useState<string | null>(null)
const [editName, setEditName] = useState('')
const [editLocation, setEditLocation] = useState('')
```

- [ ] **Step 2: handleComplete 의 pushRecentServer 교체**

기존:
```ts
pushRecentServer(normalized)
```
변경:
```ts
setSavedServers(upsertOnConnect(normalized))
```

- [ ] **Step 3: "최근 서버" 섹션을 "저장된 서버"로 교체**

기존 `{recentServers.length > 0 && ( ... )}` 블록 전체를 아래로 교체:

```tsx
{savedServers.length > 0 && (
  <div className="space-y-1">
    <p className="text-xs font-medium text-slate-500">저장된 서버</p>
    {savedServers.map((srv) => {
      const isSelected = selectedUrl === srv.url
      const port = displayPort(srv.url)
      const host = displayHost(srv.url)
      const primary = srv.name || host
      const subParts = [
        srv.name ? host : null,
        port ? `포트 ${port}` : null,
        srv.location || null,
      ].filter(Boolean)
      return (
        <div
          key={srv.url}
          className={`rounded-lg border transition-all ${
            isSelected
              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
              : 'border-slate-200 hover:border-blue-400'
          }`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => pickServer(srv.url)}
              className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg active:scale-[0.99] transition-transform"
            >
              <Globe className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-500'}`} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${isSelected ? 'text-blue-700 font-medium' : 'text-slate-700'}`}>{primary}</span>
                {subParts.length > 0 && (
                  <span className="block truncate text-xs text-slate-400">{subParts.join(' · ')}</span>
                )}
              </span>
              {renderRowStatus(srv.url)}
            </button>
            <button
              type="button"
              aria-label="편집"
              onClick={(e) => { e.stopPropagation(); startEdit(srv) }}
              className="p-2 text-slate-400 hover:text-slate-600 active:scale-90 transition-transform"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="삭제"
              onClick={(e) => { e.stopPropagation(); setSavedServers(removeSavedServer(srv.url)) }}
              className="p-2 mr-1 text-slate-400 hover:text-red-500 active:scale-90 transition-transform"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          {editingUrl === srv.url && (
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-100">
              <input
                aria-label="서버 이름"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="이름 (예: 사무실 서버)"
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                aria-label="서버 위치"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="위치 (예: 회의실 A)"
                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={cancelEdit} className="px-3 py-1 text-sm text-slate-500 hover:text-slate-700">취소</button>
                <button type="button" onClick={() => saveEdit(srv.url)} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
              </div>
            </div>
          )}
        </div>
      )
    })}
  </div>
)}
```

- [ ] **Step 4: 편집 핸들러 추가**

`pickServer` 근처에 추가:

```ts
const startEdit = (srv: SavedServer) => {
  setEditingUrl(srv.url)
  setEditName(srv.name ?? '')
  setEditLocation(srv.location ?? '')
}
const cancelEdit = () => setEditingUrl(null)
const saveEdit = (url: string) => {
  setSavedServers(updateSavedServer(url, { name: editName, location: editLocation }))
  setEditingUrl(null)
}
```

- [ ] **Step 5: 빌드/타입 확인**

Run: `npx tsc --noEmit -p tsconfig.app.json` (또는 `npm run build` 의 타입 단계)
Expected: 타입 에러 없음. (사용 안 하는 import 없는지 확인 — `Pencil`, `Trash2` 사용됨.)

> tsconfig 파일명이 다르면 `npx tsc --noEmit`로 대체.

- [ ] **Step 6: 기존 테스트 placeholder 정상화**

`ServerSetup.test.tsx`에서 `getByPlaceholderText('https://api.example.com')`를 실제 placeholder로 일괄 교체. 실제 코드 placeholder:
`192.168.0.10 또는 http://example.com:13323`

`getByPlaceholderText('https://api.example.com')` → `getByLabelText('서버 URL')` 로 교체 (placeholder 변경에 강건). 단, 입력값 검증 테스트(`urlInput.value`)는 `getByLabelText('서버 URL') as HTMLInputElement` 유지.

- [ ] **Step 7: 전체 ServerSetup 테스트 통과 확인**

Run: `npx vitest run src/components/auth/__tests__/ServerSetup.test.tsx`
Expected: PASS (기존 테스트 전부).

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/components/auth/ServerSetup.tsx frontend/src/components/auth/__tests__/ServerSetup.test.tsx
git commit -m "feat(frontend): saved servers list with name/location + delete in ServerSetup"
```

---

### Task 5: ServerSetup — 저장된 서버 렌더/편집/삭제 테스트

**Files:**
- Modify: `frontend/src/components/auth/__tests__/ServerSetup.test.tsx`

- [ ] **Step 1: 실패 테스트 추가**

파일 하단 `describe` 추가. (모드 카드 클릭으로 서버 모드 진입 헬퍼 재사용.)

```tsx
describe('저장된 서버', () => {
  function enterServerMode() {
    const serverCard = screen.getByText('서버 연결').closest('button')!
    fireEvent.click(serverCard)
  }

  it('저장된 서버가 이름/호스트/포트 규칙대로 렌더된다', async () => {
    localStorage.setItem('recent_servers', JSON.stringify([
      { url: 'http://192.168.0.10:13323', name: '사무실', lastConnectedAt: 200 },
      { url: 'http://10.0.0.5:8080', location: '집', lastConnectedAt: 100 },
    ]))
    render(<ServerSetup onComplete={onComplete} />)
    await act(async () => { enterServerMode() })

    expect(screen.getByText('저장된 서버')).toBeInTheDocument()
    // name 우선 표시, 기본포트는 숨김
    expect(screen.getByText('사무실')).toBeInTheDocument()
    expect(screen.queryByText(/포트 13323/)).not.toBeInTheDocument()
    // 비기본포트는 표시
    expect(screen.getByText(/포트 8080/)).toBeInTheDocument()
    expect(screen.getByText(/집/)).toBeInTheDocument()
  })

  it('편집 → 이름 저장 시 표시가 갱신되고 localStorage 에 반영된다', async () => {
    localStorage.setItem('recent_servers', JSON.stringify([
      { url: 'http://192.168.0.10:13323', lastConnectedAt: 200 },
    ]))
    render(<ServerSetup onComplete={onComplete} />)
    await act(async () => { enterServerMode() })

    await act(async () => { fireEvent.click(screen.getByLabelText('편집')) })
    const nameInput = screen.getByLabelText('서버 이름')
    await act(async () => { fireEvent.change(nameInput, { target: { value: '사무실 서버' } }) })
    await act(async () => { fireEvent.click(screen.getByText('저장')) })

    expect(screen.getByText('사무실 서버')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem('recent_servers')!)
    expect(stored[0].name).toBe('사무실 서버')
  })

  it('삭제 시 행이 제거된다', async () => {
    localStorage.setItem('recent_servers', JSON.stringify([
      { url: 'http://192.168.0.10:13323', name: '삭제대상', lastConnectedAt: 200 },
    ]))
    render(<ServerSetup onComplete={onComplete} />)
    await act(async () => { enterServerMode() })

    expect(screen.getByText('삭제대상')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByLabelText('삭제')) })
    expect(screen.queryByText('삭제대상')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실행 확인**

Run: `npx vitest run src/components/auth/__tests__/ServerSetup.test.tsx`
Expected: PASS (전부). Task 4 구현이 이미 동작을 제공하므로 신규 테스트도 그린.

> 만약 `enterServerMode`에서 IS_MOBILE 분기로 모드카드가 없을 경우, 테스트 환경 기본은 비모바일(jsdom)이라 카드 노출됨. 실패 시 `localStorage.setItem('mode','server')` 선설정으로 대체.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/auth/__tests__/ServerSetup.test.tsx
git commit -m "test(frontend): saved servers render/edit/delete in ServerSetup"
```

---

### Task 6: 스캔 버튼 피드백 강화

**Files:**
- Modify: `frontend/src/components/auth/ServerSetup.tsx`

- [ ] **Step 1: 스캔 버튼 className 및 보조 힌트 수정**

기존 스캔 버튼 className의 `active:scale-[0.99]`를 `active:scale-95` + `transition-transform` 강화:

```tsx
<button
  type="button"
  onClick={handleScan}
  disabled={scanning}
  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
>
  {scanning ? (
    <><Loader2 className="w-4 h-4 animate-spin" /> 서버 검색 중...</>
  ) : (
    <><Search className="w-4 h-4" /> 같은 Wi-Fi에서 서버 찾기</>
  )}
</button>
{scanning && (
  <p className="text-xs text-slate-400 text-center">같은 네트워크를 살펴보는 중… 수 초 걸려요</p>
)}
```

- [ ] **Step 2: 회귀 확인**

Run: `npx vitest run src/components/auth/__tests__/ServerSetup.test.tsx`
Expected: PASS (기존/신규 전부).

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/components/auth/ServerSetup.tsx
git commit -m "feat(frontend): stronger press feedback + scanning hint on LAN scan button"
```

---

### Task 7: 전체 회귀 + 빌드

**Files:** 없음 (검증만)

- [ ] **Step 1: 프론트엔드 전체 테스트**

Run: `cd frontend && npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 2: 타입/빌드**

Run: `cd frontend && npm run build`
Expected: 성공.

- [ ] **Step 3: 최종 커밋(필요 시)**

빌드 산출물/락 변경 없으면 커밋 불필요.

---

## Self-Review

- **Spec coverage:**
  - 데이터 모델/마이그레이션 → Task 1·2. ✅
  - 캡 10, 최근순 → Task 2. ✅
  - 포트 숨김/표시 → Task 3 헬퍼 + Task 4 렌더. ✅
  - 저장된 서버 다중 이력 → Task 2 upsert + Task 4 목록. ✅
  - 이름/위치 인라인 편집 → Task 4·5. ✅
  - 즉시 삭제 → Task 4·5. ✅
  - 스캔 피드백 → Task 6. ✅
  - 선결 테스트 정상화 → Task 4 Step 6. ✅
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음. ✅
- **Type consistency:** `SavedServer`, `loadSavedServers`, `upsertOnConnect`, `updateSavedServer`, `removeSavedServer`, `displayHost`, `displayPort`, `DEFAULT_PORT` — Task 1~3 정의와 Task 4~6 사용 일치. localStorage 키 `recent_servers` 일관. ✅
- **주의:** Task 1 Step 3 본문에 `save` 작성 여부 혼선 → "이 Task에서는 coerce/loadSavedServers/상수만, save는 Task 2"로 정정 명시함. 실행자는 Task 2 Step 3에서 `save` 추가.
