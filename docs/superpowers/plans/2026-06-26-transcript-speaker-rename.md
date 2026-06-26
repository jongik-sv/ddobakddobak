# 트랜스크립트 화자 이름 인라인 더블클릭 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트랜스크립트 본문의 화자 이름 칩을 더블클릭하면 그 자리에서 인라인으로 화자 이름을 바꾼다 (TranscriptPanel + FullRecord).

**Architecture:** 편집 로직을 두 패널이 공유하는 `SpeakerLabel`에 옵셔널 prop(`editable`, `onRename`)으로 추가한다. 저장은 기존 `renameSpeaker` PUT + `setSpeakerName` store 경로를 재사용한다. 백엔드/API/라우트 변경 없음.

**Tech Stack:** React 18 + TypeScript, Zustand store, vitest + @testing-library/react + @testing-library/user-event.

## Global Constraints

- 백엔드·API·라우트 변경 금지. 기존 `renameSpeaker(meetingId, id, name)` (`frontend/src/api/speakers.ts`)와 `useTranscriptStore.setSpeakerName(speakerLabel, name|null)` 재사용.
- 진짜 타입체크 = `cd frontend && npx tsc -p tsconfig.app.json` (bare `tsc --noEmit`는 0파일 검사 = 거짓 green). 게이트 = 내가 만진 파일 신규 에러 0.
- 단위 테스트 = `cd frontend && npx vitest run <path>`.
- 잠금(`readOnly`) 시 편집 비활성 — SpeakerPanel 가드와 동작 일치.
- 저장 실패는 `.catch(() => null)` → store 미갱신(화면 변화 없음).
- 커밋은 사용자 명시 요청 전까지 보류(프로젝트 메모리 규칙). 각 Task의 커밋 스텝은 "사용자 승인 시" 실행.

---

### Task 1: SpeakerLabel 인라인 편집

**Files:**
- Modify: `frontend/src/components/meeting/SpeakerLabel.tsx:52-72`
- Test: `frontend/src/components/meeting/SpeakerLabel.test.tsx` (Create)

**Interfaces:**
- Consumes: 기존 `speakerColor(speakerLabel)` (동일 파일).
- Produces: `SpeakerLabel`에 옵셔널 prop
  `editable?: boolean` (기본 false),
  `onRename?: (name: string) => void | Promise<void>`.
  편집 입력은 `role="textbox"` + `aria-label="화자 이름 편집"`.

- [ ] **Step 1: 실패 테스트 작성**

Create `frontend/src/components/meeting/SpeakerLabel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpeakerLabel } from './SpeakerLabel'

describe('SpeakerLabel 인라인 편집', () => {
  it('editable + 더블클릭 → 입력 노출, Enter → onRename(trim된 값)', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<SpeakerLabel speakerLabel="화자1" editable onRename={onRename} />)
    await user.dblClick(screen.getByText('화자1'))
    const input = screen.getByRole('textbox', { name: '화자 이름 편집' })
    await user.type(input, '  김철수  ')
    await user.keyboard('{Enter}')
    expect(onRename).toHaveBeenCalledWith('김철수')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('커스텀 이름 있으면 입력 시작값 = 그 이름', async () => {
    const user = userEvent.setup()
    render(<SpeakerLabel speakerLabel="화자1" speakerName="김철수" editable onRename={vi.fn()} />)
    await user.dblClick(screen.getByText('김철수'))
    expect(screen.getByRole('textbox', { name: '화자 이름 편집' })).toHaveValue('김철수')
  })

  it('커스텀 이름 없으면(라벨로 fallback) 입력 시작값 = 빈칸', async () => {
    const user = userEvent.setup()
    render(<SpeakerLabel speakerLabel="화자1" speakerName="화자1" editable onRename={vi.fn()} />)
    await user.dblClick(screen.getByText('화자1'))
    expect(screen.getByRole('textbox', { name: '화자 이름 편집' })).toHaveValue('')
  })

  it('Esc → onRename 미호출, 입력 종료', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<SpeakerLabel speakerLabel="화자1" editable onRename={onRename} />)
    await user.dblClick(screen.getByText('화자1'))
    await user.type(screen.getByRole('textbox'), '버릴값')
    await user.keyboard('{Escape}')
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('값이 현재와 같으면 onRename 미호출', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<SpeakerLabel speakerLabel="화자1" speakerName="김철수" editable onRename={onRename} />)
    await user.dblClick(screen.getByText('김철수'))
    await user.keyboard('{Enter}')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('비-editable이면 더블클릭해도 입력 안 뜸', async () => {
    const user = userEvent.setup()
    render(<SpeakerLabel speakerLabel="화자1" />)
    await user.dblClick(screen.getByText('화자1'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/SpeakerLabel.test.tsx`
Expected: FAIL (editable/onRename prop 없음 → 더블클릭해도 textbox 안 뜸).

- [ ] **Step 3: SpeakerLabel 구현**

`frontend/src/components/meeting/SpeakerLabel.tsx` 상단에 import 추가(파일 맨 위):

```tsx
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
```

`SpeakerLabelProps` 인터페이스(현 52-58행)를 교체:

```tsx
interface SpeakerLabelProps {
  speakerLabel: string
  /** 표시 이름. null/undefined면 라벨로 fallback */
  speakerName?: string | null
  /** 칩 크기. 'sm'(기본) 또는 'md'(미리보기 등 크게) */
  size?: 'sm' | 'md'
  /** true면 더블클릭으로 인라인 이름 편집 가능 (onRename 필요). 기본 false */
  editable?: boolean
  /** 편집 저장 콜백. trim된 새 이름을 받는다 */
  onRename?: (name: string) => void | Promise<void>
}
```

`SpeakerLabel` 함수(현 60-72행)를 교체:

```tsx
export function SpeakerLabel({
  speakerLabel,
  speakerName,
  size = 'sm',
  editable = false,
  onRename,
}: SpeakerLabelProps) {
  const colorClass = speakerColor(speakerLabel)
  const sizeClass = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'
  const canEdit = editable && !!onRename
  const current = speakerName ?? speakerLabel

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const cancelRef = useRef(false)

  function startEdit() {
    if (!canEdit) return
    const isCustom = speakerName != null && speakerName !== speakerLabel
    setValue(isCustom ? speakerName : '')
    setEditing(true)
  }

  // onBlur가 유일한 저장 경로 — Enter/Esc는 blur를 유발한다 (이중 저장 방지)
  function commit() {
    setEditing(false)
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    const name = value.trim()
    if (name && name !== current && onRename) onRename(name)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRef.current = true
      e.currentTarget.blur()
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        placeholder={speakerLabel}
        aria-label="화자 이름 편집"
        className={`inline-block rounded font-semibold border-b border-blue-400 outline-none bg-transparent ${sizeClass} ${colorClass}`}
      />
    )
  }

  return (
    <span
      role="status"
      onDoubleClick={startEdit}
      title={canEdit ? '더블클릭하여 이름 편집' : undefined}
      className={`inline-block rounded font-semibold ${sizeClass} ${colorClass} ${canEdit ? 'cursor-text' : ''}`}
    >
      {current}
    </span>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/components/meeting/SpeakerLabel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: 타입체크**

Run: `cd frontend && npx tsc -p tsconfig.app.json 2>&1 | grep SpeakerLabel`
Expected: 출력 없음 (SpeakerLabel 관련 신규 에러 0).

- [ ] **Step 6: 커밋 (사용자 승인 시)**

```bash
git add frontend/src/components/meeting/SpeakerLabel.tsx frontend/src/components/meeting/SpeakerLabel.test.tsx
git commit -m "feat(meeting): SpeakerLabel 더블클릭 인라인 화자명 편집"
```

---

### Task 2: TranscriptPanel 배선

**Files:**
- Modify: `frontend/src/components/meeting/TranscriptPanel.tsx` (import 5-6행, store 셀렉터 ~45행, 핸들러 추가, SpeakerLabel 렌더 118-122행)

**Interfaces:**
- Consumes: Task 1의 `SpeakerLabel` `editable`/`onRename` prop. `renameSpeaker(meetingId, id, name)` (`../../api/speakers`). `useTranscriptStore.setSpeakerName`.
- Produces: 없음 (UI 배선).

- [ ] **Step 1: import + store 셀렉터 추가**

`TranscriptPanel.tsx`의 import 블록(현 5-6행 부근)에 추가:

```tsx
import { renameSpeaker } from '../../api/speakers'
```

컴포넌트 본문에서 `storeFinals` 셀렉터(현 45행) 아래에 추가:

```tsx
  const setSpeakerName = useTranscriptStore((s) => s.setSpeakerName)
```

- [ ] **Step 2: handleRename 핸들러 추가**

`groups` useMemo(현 67-89행) 뒤에 추가:

```tsx
  async function handleRename(speakerLabel: string, name: string) {
    const updated = await renameSpeaker(meetingId, speakerLabel, name).catch(() => null)
    if (updated) {
      setSpeakerName(speakerLabel, updated.name === speakerLabel ? null : updated.name)
    }
  }
```

- [ ] **Step 3: SpeakerLabel에 prop 전달**

현 118-122행 `<SpeakerLabel .../>`를 교체:

```tsx
            <SpeakerLabel
              speakerLabel={group.segments[0].transcript.speaker_label}
              speakerName={group.name}
              size="md"
              editable={!readOnly}
              onRename={(name) => handleRename(group.segments[0].transcript.speaker_label, name)}
            />
```

- [ ] **Step 4: 타입체크 + 전체 테스트**

Run: `cd frontend && npx tsc -p tsconfig.app.json 2>&1 | grep TranscriptPanel`
Expected: 출력 없음.
Run: `cd frontend && npx vitest run src/components/meeting/SpeakerLabel.test.tsx`
Expected: PASS (회귀 없음).

- [ ] **Step 5: 커밋 (사용자 승인 시)**

```bash
git add frontend/src/components/meeting/TranscriptPanel.tsx
git commit -m "feat(meeting): TranscriptPanel 화자 칩 더블클릭 편집 배선"
```

---

### Task 3: FullRecord 배선

**Files:**
- Modify: `frontend/src/components/meeting/FullRecord.tsx` (import 2-5행, store 셀렉터 ~17행, 핸들러 추가, SpeakerLabel 렌더 107행)

**Interfaces:**
- Consumes: Task 1의 `SpeakerLabel` prop. `renameSpeaker`. `useTranscriptStore.setSpeakerName`.
- Produces: 없음.

- [ ] **Step 1: import + store 셀렉터 추가**

`FullRecord.tsx` import 블록에 추가:

```tsx
import { renameSpeaker } from '../../api/speakers'
```

컴포넌트 본문 `finals` 셀렉터(현 17행) 아래에 추가:

```tsx
  const setSpeakerName = useTranscriptStore((s) => s.setSpeakerName)
```

- [ ] **Step 2: handleRename 핸들러 추가**

`groups` useMemo(현 29-53행) 뒤에 추가:

```tsx
  const handleRename = async (speakerLabel: string, name: string) => {
    const updated = await renameSpeaker(meetingId, speakerLabel, name).catch(() => null)
    if (updated) {
      setSpeakerName(speakerLabel, updated.name === speakerLabel ? null : updated.name)
    }
  }
```

- [ ] **Step 3: SpeakerLabel에 prop 전달**

현 107행 `<SpeakerLabel speakerLabel={first.speaker_label} speakerName={first.speaker_name} />`를 교체:

```tsx
                <SpeakerLabel
                  speakerLabel={first.speaker_label}
                  speakerName={first.speaker_name}
                  editable={!readOnly}
                  onRename={(name) => handleRename(first.speaker_label, name)}
                />
```

- [ ] **Step 4: 타입체크 + 전체 테스트**

Run: `cd frontend && npx tsc -p tsconfig.app.json 2>&1 | grep FullRecord`
Expected: 출력 없음.
Run: `cd frontend && npx vitest run src/components/meeting/`
Expected: PASS (회귀 없음).

- [ ] **Step 5: 빌드 검증**

Run: `cd frontend && npx vite build`
Expected: 성공 (타입·번들 에러 없음).

- [ ] **Step 6: 커밋 (사용자 승인 시)**

```bash
git add frontend/src/components/meeting/FullRecord.tsx
git commit -m "feat(meeting): FullRecord 화자 칩 더블클릭 편집 배선"
```

---

### Task 4: SpeakerPanel 이름 표시 store 동기화 (버그 수정)

**버그**: 트랜스크립트 인라인 편집은 `renameSpeaker` + store `setSpeakerName`(=finals)만 갱신하는데, SpeakerPanel(화자 목록)은 자체 `getSpeakers` 로컬 state(`speakers[].name`)로 이름을 그려서, 인라인 편집 결과가 화자 목록에 반영되지 않는다(녹음 아닐 땐 refetch도 없음).

**수정**: SpeakerPanel이 store finals의 `speaker_name`을 표시에 오버레이한다(TranscriptPanel과 동일 패턴, 네트워크 없음). `visibleSpeakers`는 이미 finals 라벨로 필터되므로 표시되는 모든 화자는 finals에 존재한다.

**Files:**
- Modify: `frontend/src/components/meeting/SpeakerPanel.tsx`
- Test: `frontend/src/components/meeting/SpeakerPanel.test.tsx` (append describe)

자세한 단계·코드는 `.superpowers/sdd/task-4-brief.md` 참조(컨트롤러 직접 작성).

## 수동 E2E (구현 후)

- 저장된 회의 열기 → 트랜스크립트 본문 화자 칩 더블클릭 → 인라인 입력 → 이름 입력 + Enter → 즉시 반영, SpeakerPanel·FullRecord에도 동일 반영.
- Esc → 변경 취소.
- 빈 입력 + Enter → 이름 비움(라벨로 fallback).
- 잠긴 회의 → 더블클릭 무반응.
- FullRecord 탭에서도 동일 동작 (화자 칩 클릭=seek 아님, 행 클릭만 seek).

## Self-Review 메모

- 스펙 커버리지: SpeakerLabel 편집(Task 1) / TranscriptPanel(Task 2) / FullRecord(Task 3) / 잠금 게이팅(`editable={!readOnly}`, 전 Task) / 에러 처리(`.catch(() => null)`) / 테스트(Task 1) 모두 매핑됨.
- 타입 일관성: `onRename: (name: string) => void | Promise<void>`, `handleRename(speakerLabel, name)` 세 파일 동일 시그니처.
- 함정: Esc 시 input 언마운트 → onBlur가 commit 호출하는 이중 저장 → `cancelRef`로 가드(Task 1 commit/onKeyDown).
