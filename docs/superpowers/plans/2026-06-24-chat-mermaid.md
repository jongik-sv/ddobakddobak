# AI 챗 Mermaid 렌더링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 챗 답변의 ` ```mermaid ` 코드펜스를 검은 코드블록 대신 다이어그램(SVG)으로 렌더링하고, 클릭 시 확대 모달을 띄운다.

**Architecture:** 챗 답변은 모두 `ChatMarkdown.tsx`(react-markdown) 단일 경로를 거친다. 기존 `mermaidBlock.tsx`의 `MermaidRenderer`를 export 가능화하고 실패 폴백 prop을 추가한 뒤, 신규 `ChatMermaid.tsx`(정적 SVG + Dialog 확대 모달)로 감싸 `ChatMarkdown`의 `pre` 오버라이드에서 mermaid 펜스만 분기한다. 회의/폴더/프로젝트 챗 3개 스코프가 한 곳 수정으로 커버된다.

**Tech Stack:** React 18 + TypeScript, react-markdown v10 + remark-gfm, mermaid ^11.13.0, vitest + @testing-library/react, 기존 `components/ui/Dialog.tsx`.

## Global Constraints

- 신규 npm 의존성 추가 금지. mermaid `^11.13.0`, react-markdown v10 이미 존재.
- mermaid 테마 = `theme:'default'`(라이트) 고정. 다크 전환 비목표.
- BlockNote 회귀 0: `mermaidBlock.tsx` 변경은 하위호환(기본값 유지)이어야 한다.
- 진짜 타입체크 = `cd frontend && npx tsc -p tsconfig.app.json --noEmit` (bare `tsc --noEmit`는 0파일 검사=거짓 green). 기준선 ~24 사전존재 에러 — **내가 만든 파일 신규 에러 0**이 기준.
- 테스트 실행 = `cd frontend && npx vitest run <path>`.
- **커밋은 사용자 명시 승인 시에만(기본 보류)** — 저장된 피드백 규칙. 아래 Commit 스텝은 승인 후에만 실행.

---

### Task 1: `MermaidRenderer` export + 실패 폴백 prop

**Files:**
- Modify: `frontend/src/components/meeting/mermaidBlock.tsx:29-88` (`MermaidRenderer`)
- Test: `frontend/src/components/meeting/mermaidBlock.test.tsx` (신규 또는 기존에 append)

**Interfaces:**
- Produces: `export function MermaidRenderer({ code, zoom, fallback }: { code: string; zoom: number; fallback?: ReactNode }): JSX.Element | null` — `code` 렌더 성공 시 SVG div, 실패 시 `fallback`(기본 `null`).

- [ ] **Step 1: 실패 폴백 테스트 작성**

`frontend/src/components/meeting/mermaidBlock.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { MermaidRenderer } from './mermaidBlock'
import mermaid from 'mermaid'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), parse: vi.fn(), render: vi.fn() },
}))

describe('MermaidRenderer', () => {
  beforeEach(() => {
    ;(mermaid.parse as Mock).mockReset()
    ;(mermaid.render as Mock).mockReset()
  })

  it('잘못된 mermaid → fallback 렌더', async () => {
    ;(mermaid.parse as Mock).mockRejectedValue(new Error('bad syntax'))
    render(<MermaidRenderer code="not mermaid" zoom={1} fallback={<div>FALLBACK</div>} />)
    await waitFor(() => expect(screen.getByText('FALLBACK')).toBeInTheDocument())
  })

  it('정상 mermaid → svg 렌더', async () => {
    ;(mermaid.parse as Mock).mockResolvedValue(true)
    ;(mermaid.render as Mock).mockResolvedValue({ svg: '<svg><rect/></svg>' })
    const { container } = render(<MermaidRenderer code="graph TD; A-->B" zoom={1} />)
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy())
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/mermaidBlock.test.tsx`
Expected: FAIL — `MermaidRenderer` is not exported / `fallback` 미지원으로 첫 테스트 실패.

- [ ] **Step 3: 최소 구현**

`mermaidBlock.tsx` 상단 import에 `ReactNode` 타입 추가 (기존 `import { useState, useEffect, useRef, useCallback } from 'react'` 옆):

```tsx
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
```

`MermaidRenderer` 시그니처와 에러 반환부 교체:

```tsx
export function MermaidRenderer({
  code,
  zoom,
  fallback = null,
}: {
  code: string
  zoom: number
  fallback?: ReactNode
}) {
```

그리고 기존 `if (error) { return null }` 를:

```tsx
  if (error) {
    return <>{fallback}</>
  }
```

(나머지 본문/effect 로직은 변경하지 않는다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/components/meeting/mermaidBlock.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: BlockNote 회귀 확인 (타입체크)**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep mermaidBlock`
Expected: mermaidBlock 관련 신규 에러 없음(출력 비어 있음).

- [ ] **Step 6: Commit (승인 시에만)**

```bash
git add frontend/src/components/meeting/mermaidBlock.tsx frontend/src/components/meeting/mermaidBlock.test.tsx
git commit -m "feat(chat): MermaidRenderer export + 실패 폴백 prop"
```

---

### Task 2: `ChatMermaid` 컴포넌트 (정적 SVG + 확대 모달)

**Files:**
- Create: `frontend/src/components/meeting/ChatMermaid.tsx`
- Test: `frontend/src/components/meeting/ChatMermaid.test.tsx`

**Interfaces:**
- Consumes: `MermaidRenderer`(Task 1), `Dialog`(`components/ui/Dialog.tsx`).
- Produces: `export function ChatMermaid({ code }: { code: string }): JSX.Element`.

- [ ] **Step 1: 테스트 작성**

`frontend/src/components/meeting/ChatMermaid.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatMermaid } from './ChatMermaid'

// MermaidRenderer는 mermaid/DOM 의존이 커서 모킹 — code를 노출하는 더미로 대체
vi.mock('./mermaidBlock', () => ({
  MermaidRenderer: ({ code }: { code: string }) => <div data-testid="mr">{code}</div>,
}))

describe('ChatMermaid', () => {
  it('다이어그램 렌더 + 클릭 시 확대 모달 open/close', () => {
    render(<ChatMermaid code="graph TD; A-->B" />)
    // 인라인 1개
    expect(screen.getAllByTestId('mr')).toHaveLength(1)
    // 클릭 → 모달(2번째 인스턴스 + 닫기 버튼)
    fireEvent.click(screen.getByRole('button', { name: '다이어그램 확대' }))
    expect(screen.getAllByTestId('mr')).toHaveLength(2)
    const closeBtn = screen.getByRole('button', { name: /닫기/ })
    fireEvent.click(closeBtn)
    expect(screen.getAllByTestId('mr')).toHaveLength(1)
  })

  it('Enter 키로도 모달 open', () => {
    render(<ChatMermaid code="graph TD; A-->B" />)
    fireEvent.keyDown(screen.getByRole('button', { name: '다이어그램 확대' }), { key: 'Enter' })
    expect(screen.getAllByTestId('mr')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMermaid.test.tsx`
Expected: FAIL — `ChatMermaid` 모듈 없음.

- [ ] **Step 3: 구현**

`frontend/src/components/meeting/ChatMermaid.tsx`:

```tsx
import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { MermaidRenderer } from './mermaidBlock'

// 잘못된 mermaid 또는 렌더 실패 시 원문을 보여주는 폴백 — ChatMarkdown의 pre 스타일과 동일.
function CodeFallback({ code }: { code: string }) {
  return (
    <pre className="bg-gray-800 text-gray-100 rounded p-2 overflow-x-auto text-xs my-1">
      <code className="bg-transparent p-0 font-mono">{code}</code>
    </pre>
  )
}

export function ChatMermaid({ code }: { code: string }) {
  const [open, setOpen] = useState(false)
  const fallback = <CodeFallback code={code} />

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="다이어그램 확대"
        title="클릭하면 확대"
        className="overflow-x-auto max-w-full my-1 cursor-zoom-in rounded hover:bg-black/5"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <MermaidRenderer code={code} zoom={1} fallback={fallback} />
      </div>
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          closeOnBackdrop
          ariaLabel="다이어그램 확대 보기"
          className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl bg-white p-4 shadow-2xl"
        >
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setOpen(false)}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              닫기 ✕
            </button>
          </div>
          <div className="overflow-auto">
            <MermaidRenderer code={code} zoom={1.6} fallback={fallback} />
          </div>
        </Dialog>
      )}
    </>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMermaid.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (승인 시에만)**

```bash
git add frontend/src/components/meeting/ChatMermaid.tsx frontend/src/components/meeting/ChatMermaid.test.tsx
git commit -m "feat(chat): ChatMermaid 정적 렌더 + 확대 모달"
```

---

### Task 3: `ChatMarkdown` mermaid 펜스 분기 (hast node 기반)

**Files:**
- Modify: `frontend/src/components/meeting/ChatMarkdown.tsx` (import 추가, `pre` 오버라이드 교체, 순수 헬퍼 추가)
- Test: `frontend/src/components/meeting/ChatMarkdown.test.tsx` (기존 파일에 케이스 append — 기존 테스트 유지)

**Interfaces:**
- Consumes: `ChatMermaid`(Task 2).
- Produces: 모듈 내부 헬퍼 `mermaidCodeFromNode(node): string | null` (export 불필요, 테스트 위해 export).

> 주의: 기존 `code` 오버라이드가 className을 자기 스타일로 덮어써서, 렌더된 자식에서 `language-mermaid`를 읽을 수 없다. react-markdown이 컴포넌트에 넘기는 **hast `node`** 를 읽어야 한다 (`node.children[0]` = code 엘리먼트, `properties.className` = `['language-mermaid']`, `children[0].value` = 코드 텍스트).

- [ ] **Step 1: 헬퍼 단위 테스트 + 렌더 테스트 작성**

`frontend/src/components/meeting/ChatMarkdown.test.tsx` 에 append (상단에 import 추가):

```tsx
import { mermaidCodeFromNode } from './ChatMarkdown'

vi.mock('./ChatMermaid', () => ({
  ChatMermaid: ({ code }: { code: string }) => <div data-testid="chat-mermaid">{code}</div>,
}))
```

테스트 케이스:

```tsx
describe('mermaidCodeFromNode', () => {
  it('language-mermaid code 노드 → 코드 텍스트(끝 개행 제거)', () => {
    const node = {
      tagName: 'pre',
      children: [
        {
          tagName: 'code',
          properties: { className: ['language-mermaid'] },
          children: [{ type: 'text', value: 'graph TD\nA-->B\n' }],
        },
      ],
    }
    expect(mermaidCodeFromNode(node)).toBe('graph TD\nA-->B')
  })

  it('비 mermaid 코드 → null', () => {
    const node = {
      tagName: 'pre',
      children: [{ tagName: 'code', properties: { className: ['language-js'] }, children: [{ type: 'text', value: 'x' }] }],
    }
    expect(mermaidCodeFromNode(node)).toBeNull()
  })

  it('code 자식 없음 → null', () => {
    expect(mermaidCodeFromNode({ tagName: 'pre', children: [] })).toBeNull()
    expect(mermaidCodeFromNode(undefined)).toBeNull()
  })
})

describe('ChatMarkdown mermaid 분기', () => {
  it('```mermaid 펜스 → ChatMermaid 렌더', () => {
    render(<ChatMarkdown content={'```mermaid\ngraph TD\nA-->B\n```'} />)
    expect(screen.getByTestId('chat-mermaid')).toHaveTextContent('graph TD')
  })

  it('```js 펜스 → 기존 코드블록(pre), ChatMermaid 아님', () => {
    const { container } = render(<ChatMarkdown content={'```js\nconst x = 1\n```'} />)
    expect(screen.queryByTestId('chat-mermaid')).toBeNull()
    expect(container.querySelector('pre')).toBeTruthy()
  })
})
```

(이 파일에 `render`, `screen`, `vi`, `ChatMarkdown` import가 이미 있는지 확인 후 없으면 추가.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMarkdown.test.tsx`
Expected: FAIL — `mermaidCodeFromNode` export 없음 / mermaid 펜스가 ChatMermaid 아닌 pre로 렌더.

- [ ] **Step 3: 구현**

`ChatMarkdown.tsx` 상단 import 블록에 추가:

```tsx
import type { ReactNode } from 'react'
import { ChatMermaid } from './ChatMermaid'
```

순수 헬퍼 추가 (`markersToSeekLinks` 근처, 모듈 스코프):

```tsx
type HastNode = {
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
  value?: string
}

// react-markdown이 넘기는 hast node에서 ```mermaid 코드 텍스트를 추출. 아니면 null.
export function mermaidCodeFromNode(node: HastNode | undefined): string | null {
  const codeEl = node?.children?.[0]
  if (!codeEl || codeEl.tagName !== 'code') return null
  const cls = codeEl.properties?.className
  const classes = Array.isArray(cls) ? cls : typeof cls === 'string' ? [cls] : []
  if (!classes.includes('language-mermaid')) return null
  const text = codeEl.children?.[0]?.value
  return typeof text === 'string' ? text.replace(/\n$/, '') : null
}
```

`MAP`의 `pre` 항목 교체 (line 37-41):

```tsx
  pre: ({ node, children }) => {
    const mermaidCode = mermaidCodeFromNode(node as HastNode | undefined)
    if (mermaidCode != null) return <ChatMermaid code={mermaidCode} />
    return (
      <pre className="bg-gray-800 text-gray-100 rounded p-2 overflow-x-auto text-xs my-1 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    )
  },
```

(만약 `ReactNode`가 파일에서 미사용으로 남으면 import에서 제거 — 위 헬퍼는 `HastNode`만 사용하므로 `ReactNode` import는 불필요할 수 있다. 빌드 에러 시 정리.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMarkdown.test.tsx`
Expected: PASS (신규 5 케이스 + 기존 케이스 전부 green).

- [ ] **Step 5: Commit (승인 시에만)**

```bash
git add frontend/src/components/meeting/ChatMarkdown.tsx frontend/src/components/meeting/ChatMarkdown.test.tsx
git commit -m "feat(chat): ChatMarkdown mermaid 펜스→다이어그램 분기"
```

---

### Task 4: 전체 검증 (타입체크 + 풀 테스트)

**Files:** 없음(게이트만).

- [ ] **Step 1: 타입체크 (신규 에러 0)**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: 내가 만든/수정한 4파일(mermaidBlock.tsx, ChatMermaid.tsx, ChatMarkdown.tsx, 테스트들) 관련 신규 에러 0. 기준선(~24 사전존재) 외 증가 없음.

- [ ] **Step 2: 챗 관련 풀 테스트**

Run: `cd frontend && npx vitest run src/components/meeting/ src/components/folder/`
Expected: PASS — AiChatPanel, ChatMarkdown, ChatMermaid, FolderChatDrawer 등 전부 green.

- [ ] **Step 3: frontend 전체 vitest (회귀 확인)**

Run: `cd frontend && npx vitest run`
Expected: 기준선(메모리상 ~1485) 대비 신규 실패 0, 신규 통과 추가.

- [ ] **Step 4: 수동 스모크 (기기/dev, 사용자)**

- dev 서버에서 회의 챗에 mermaid 포함 답변 유도(또는 시드) → 다이어그램 렌더 확인.
- 다이어그램 클릭 → 확대 모달, Esc/닫기 동작 확인.
- 잘못된 mermaid → 코드블록 폴백 확인.
- 폴더/프로젝트 챗에서도 동일 동작 확인.

---

## Self-Review (작성자 체크)

- **Spec coverage:** MermaidRenderer 재사용(T1) / ChatMermaid 정적+모달+폴백(T2) / ChatMarkdown 분기 3스코프(T3) / 라이트테마(loadMermaid 불변) / 검증(T4). 스펙 항목 전부 태스크 매핑됨.
- **스펙 정정:** 스펙의 "child.props className 검사"는 hast `node` 기반(`mermaidCodeFromNode`)으로 구체화 — 기존 `code` 오버라이드가 className을 덮어쓰는 문제 회피. 스펙 문서도 동일하게 정정.
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함, TBD/TODO 없음.
- **Type consistency:** `MermaidRenderer({code, zoom, fallback})` / `ChatMermaid({code})` / `mermaidCodeFromNode(node): string|null` — T1~T3 시그니처 일치.
