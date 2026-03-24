# TSK-07-02: Markdown 내보내기 UI — 설계 문서

> status: design
> created: 2026-03-25
> depends: TSK-07-01 (백엔드 export API), TSK-06-03 (회의 상세 페이지)

---

## 1. 개요

회의 상세 페이지(`MeetingPage.tsx`)에 Markdown 내보내기 버튼을 추가한다.
사용자는 AI 요약 포함/제외, 원본 텍스트 포함/제외를 선택한 후 `.md` 파일을 다운로드한다.

**사용자 흐름:**
```
내보내기 버튼 클릭
  → 드롭다운/팝오버 옵션 패널 표시
      ├── [체크박스] AI 요약 포함 (기본: ON)
      └── [체크박스] 원본 텍스트 포함 (기본: ON)
  → "다운로드" 클릭
  → GET /api/v1/meetings/:id/export?include_summary=true&include_transcript=true
  → blob 수신 → meeting-{id}-{date}.md 파일 저장
```

---

## 2. 파일 구성

```
frontend/src/
├── lib/
│   └── markdown.ts                          # 신규: 다운로드 헬퍼
├── api/
│   └── meetings.ts                          # 수정: exportMeeting() 추가
├── components/
│   └── meeting/
│       ├── ExportButton.tsx                 # 신규: 내보내기 버튼 컴포넌트
│       └── ExportButton.test.tsx            # 신규: Vitest 테스트
└── pages/
    └── MeetingPage.tsx                      # 수정: ExportButton 통합
```

---

## 3. `frontend/src/lib/markdown.ts` 설계

### 역할
- API에서 받은 텍스트 blob을 파일로 다운로드하는 순수 헬퍼 함수 모음
- DOM 조작 로직을 컴포넌트에서 분리

### 인터페이스

```typescript
/**
 * 텍스트 콘텐츠를 .md 파일로 다운로드한다.
 * @param content - Markdown 텍스트
 * @param filename - 저장할 파일명 (예: meeting-42-2026-03-25.md)
 */
export function downloadMarkdown(content: string, filename: string): void

/**
 * 회의 ID와 날짜로 표준 파일명을 생성한다.
 * 형식: meeting-{id}-{YYYY-MM-DD}.md
 * @param meetingId - 회의 ID
 * @param date - ISO 8601 날짜 문자열 또는 Date 객체 (기본: 오늘)
 */
export function buildMarkdownFilename(meetingId: number, date?: string | Date): string
```

### 구현 상세

```typescript
// frontend/src/lib/markdown.ts

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function buildMarkdownFilename(meetingId: number, date?: string | Date): string {
  const d = date ? new Date(date) : new Date()
  const dateStr = d.toISOString().slice(0, 10) // YYYY-MM-DD
  return `meeting-${meetingId}-${dateStr}.md`
}
```

**주의:**
- `URL.createObjectURL` / `revokeObjectURL`은 브라우저 환경 전용
- Vitest 테스트에서는 `jsdom` 환경 + `URL.createObjectURL` mock 필요

---

## 4. `frontend/src/api/meetings.ts` 수정 — `exportMeeting()` 추가

### 추가할 인터페이스 및 함수

```typescript
export interface ExportOptions {
  include_summary: boolean
  include_transcript: boolean
}

/**
 * 회의록을 Markdown 텍스트로 내보낸다.
 * GET /api/v1/meetings/:id/export
 * Response: text/markdown
 */
export async function exportMeeting(
  meetingId: number,
  options: ExportOptions,
): Promise<string> {
  const searchParams = new URLSearchParams({
    include_summary: String(options.include_summary),
    include_transcript: String(options.include_transcript),
  })
  return apiClient
    .get(`meetings/${meetingId}/export`, { searchParams })
    .text()
}
```

**설계 결정:**
- `ky`의 `.text()` 메서드로 `text/markdown` 응답을 string으로 수신
- 오류는 상위 컴포넌트(`ExportButton`)에서 catch하여 사용자에게 표시

---

## 5. `ExportButton` 컴포넌트 설계

### 파일: `frontend/src/components/meeting/ExportButton.tsx`

### Props

```typescript
interface ExportButtonProps {
  meetingId: number
  /**
   * meeting.started_at 또는 meeting.created_at — 파일명 날짜에 사용
   * 없으면 오늘 날짜 사용
   */
  meetingDate?: string | null
}
```

### 상태

| 상태 변수 | 타입 | 초기값 | 설명 |
|-----------|------|--------|------|
| `isOpen` | boolean | false | 옵션 패널 표시 여부 |
| `includeSummary` | boolean | true | AI 요약 포함 여부 |
| `includeTranscript` | boolean | true | 원본 텍스트 포함 여부 |
| `isDownloading` | boolean | false | 다운로드 진행 중 여부 |
| `error` | string \| null | null | 오류 메시지 |

### UI 구조

```
[내보내기 버튼] (헤더 영역, ShareLinkButton 옆)
  ↓ 클릭 시
┌──────────────────────────────┐
│  Markdown 내보내기           │
│                              │
│  [✓] AI 요약 포함           │
│  [✓] 원본 텍스트 포함       │
│                              │
│  [취소]  [다운로드 .md]     │
└──────────────────────────────┘
```

옵션 패널은 버튼 아래 절대 위치 드롭다운으로 구현한다.
외부 클릭 시 패널 닫힘 (`useEffect` + `document.addEventListener`).

### 이벤트 흐름

```
handleDownload():
  1. isDownloading = true, error = null
  2. content = await exportMeeting(meetingId, { include_summary, include_transcript })
  3. filename = buildMarkdownFilename(meetingId, meetingDate)
  4. downloadMarkdown(content, filename)
  5. isOpen = false, isDownloading = false
  catch:
  6. error = '내보내기에 실패했습니다. 다시 시도해 주세요.'
  7. isDownloading = false
```

### 컴포넌트 스케치

```tsx
export function ExportButton({ meetingId, meetingDate }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeTranscript, setIncludeTranscript] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 외부 클릭으로 패널 닫기
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)
    try {
      const content = await exportMeeting(meetingId, {
        include_summary: includeSummary,
        include_transcript: includeTranscript,
      })
      const filename = buildMarkdownFilename(meetingId, meetingDate ?? undefined)
      downloadMarkdown(content, filename)
      setIsOpen(false)
    } catch {
      setError('내보내기에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* 트리거 버튼 */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
      >
        <span>↓</span>
        <span>내보내기</span>
      </button>

      {/* 옵션 패널 */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10">
          <p className="text-sm font-medium text-gray-800 mb-3">Markdown 내보내기</p>

          <label className="flex items-center gap-2 text-sm text-gray-700 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSummary}
              onChange={(e) => setIncludeSummary(e.target.checked)}
              className="rounded"
            />
            AI 요약 포함
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={includeTranscript}
              onChange={(e) => setIncludeTranscript(e.target.checked)}
              className="rounded"
            />
            원본 텍스트 포함
          </label>

          {error && (
            <p className="text-xs text-red-500 mb-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setIsOpen(false)}
              className="flex-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex-1 px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isDownloading ? '...' : '다운로드 .md'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## 6. `MeetingPage.tsx` 통합 설계

### 변경 내용

헤더 영역에 `ExportButton`을 추가한다.
기존 `ShareLinkButton` 옆에 배치한다.

```tsx
// 수정 전
import { ShareLinkButton } from '../components/meeting/ShareLinkButton'

// 수정 후
import { ShareLinkButton } from '../components/meeting/ShareLinkButton'
import { ExportButton } from '../components/meeting/ExportButton'
```

```tsx
// 수정 전 헤더
<div className="flex items-center justify-between px-4 py-2 border-b bg-white">
  <h1 className="text-base font-medium text-gray-900 truncate">
    {meeting?.title ?? '회의록'}
  </h1>
  <ShareLinkButton meetingId={meetingId} />
</div>

// 수정 후 헤더
<div className="flex items-center justify-between px-4 py-2 border-b bg-white">
  <h1 className="text-base font-medium text-gray-900 truncate">
    {meeting?.title ?? '회의록'}
  </h1>
  <div className="flex items-center gap-2">
    <ExportButton
      meetingId={meetingId}
      meetingDate={meeting?.started_at ?? meeting?.created_at}
    />
    <ShareLinkButton meetingId={meetingId} />
  </div>
</div>
```

**`meeting` 객체는 `useMeetingAccess`에서 이미 제공**하므로 추가 API 호출 없음.
`MeetingDetail` 타입에 `created_at`이 이미 존재하며, `started_at`을 우선 사용한다.

---

## 7. Vitest 테스트 설계

### 7.1 `frontend/src/lib/markdown.ts` 테스트

파일: `frontend/src/lib/__tests__/markdown.test.ts`

```typescript
describe('buildMarkdownFilename', () => {
  it('meetingId와 날짜 문자열로 올바른 파일명을 반환한다', () => {
    expect(buildMarkdownFilename(42, '2026-03-25T14:00:00Z')).toBe('meeting-42-2026-03-25.md')
  })

  it('Date 객체를 받을 수 있다', () => {
    expect(buildMarkdownFilename(1, new Date('2026-01-01'))).toBe('meeting-1-2026-01-01.md')
  })

  it('날짜 미입력 시 오늘 날짜를 사용한다', () => {
    // vi.setSystemTime으로 고정된 날짜 사용
    vi.setSystemTime(new Date('2026-03-25'))
    expect(buildMarkdownFilename(99)).toBe('meeting-99-2026-03-25.md')
  })
})

describe('downloadMarkdown', () => {
  it('URL.createObjectURL을 호출하고 anchor click을 실행한다', () => {
    // mock: URL.createObjectURL, URL.revokeObjectURL, HTMLAnchorElement.click
    const mockUrl = 'blob:mock-url'
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => mockUrl),
      revokeObjectURL: vi.fn(),
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMarkdown('# Hello', 'test.md')

    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/markdown;charset=utf-8' })
    )
    expect(clickSpy).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(mockUrl)
  })
})
```

### 7.2 `ExportButton.tsx` 테스트

파일: `frontend/src/components/meeting/ExportButton.test.tsx`

```typescript
// mock
vi.mock('../../api/meetings', () => ({ exportMeeting: vi.fn() }))
vi.mock('../../lib/markdown', () => ({
  downloadMarkdown: vi.fn(),
  buildMarkdownFilename: vi.fn(() => 'meeting-1-2026-03-25.md'),
}))

describe('ExportButton', () => {
  it('초기에는 옵션 패널이 보이지 않는다', () => {
    render(<ExportButton meetingId={1} />)
    expect(screen.queryByText('Markdown 내보내기')).not.toBeInTheDocument()
  })

  it('버튼 클릭 시 옵션 패널이 표시된다', async () => {
    render(<ExportButton meetingId={1} />)
    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    expect(screen.getByText('Markdown 내보내기')).toBeInTheDocument()
    expect(screen.getByLabelText('AI 요약 포함')).toBeChecked()
    expect(screen.getByLabelText('원본 텍스트 포함')).toBeChecked()
  })

  it('체크박스 해제 후 다운로드 시 올바른 옵션으로 API를 호출한다', async () => {
    const mockExport = vi.mocked(exportMeeting).mockResolvedValue('# Meeting')
    render(<ExportButton meetingId={1} meetingDate="2026-03-25T00:00:00Z" />)

    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByLabelText('AI 요약 포함'))  // 체크 해제
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(mockExport).toHaveBeenCalledWith(1, {
      include_summary: false,
      include_transcript: true,
    })
    expect(downloadMarkdown).toHaveBeenCalledWith('# Meeting', 'meeting-1-2026-03-25.md')
  })

  it('API 오류 시 에러 메시지를 표시한다', async () => {
    vi.mocked(exportMeeting).mockRejectedValue(new Error('Network error'))
    render(<ExportButton meetingId={1} />)

    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(await screen.findByText(/내보내기에 실패했습니다/)).toBeInTheDocument()
  })

  it('취소 버튼 클릭 시 패널이 닫힌다', async () => {
    render(<ExportButton meetingId={1} />)
    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByText('Markdown 내보내기')).not.toBeInTheDocument()
  })

  it('다운로드 완료 후 패널이 자동으로 닫힌다', async () => {
    vi.mocked(exportMeeting).mockResolvedValue('# Meeting')
    render(<ExportButton meetingId={1} />)

    await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    await waitFor(() => {
      expect(screen.queryByText('Markdown 내보내기')).not.toBeInTheDocument()
    })
  })
})
```

---

## 8. 의존성 및 전제조건

| 항목 | 내용 |
|------|------|
| 백엔드 API | `GET /api/v1/meetings/:id/export` 구현 완료 (TSK-07-01) |
| 응답 형식 | `Content-Type: text/markdown`, body는 plain text |
| 인증 | `apiClient`가 JWT Bearer 토큰을 자동 첨부 (기존 동작) |
| shadcn/ui | 체크박스에 `shadcn/ui Checkbox` 컴포넌트 사용 가능하나, 네이티브 `<input type="checkbox">`로도 충분 |
| 브라우저 API | `Blob`, `URL.createObjectURL`, `<a download>` — 지원 대상 브라우저(Chrome 90+, Safari 15+, Firefox 90+) 모두 지원 |

---

## 9. 구현 체크리스트

- [ ] `frontend/src/lib/markdown.ts` 구현
- [ ] `frontend/src/lib/__tests__/markdown.test.ts` 작성
- [ ] `frontend/src/api/meetings.ts`에 `exportMeeting()` 추가
- [ ] `frontend/src/api/meetings.test.ts`에 `exportMeeting` 테스트 추가
- [ ] `frontend/src/components/meeting/ExportButton.tsx` 구현
- [ ] `frontend/src/components/meeting/ExportButton.test.tsx` 작성
- [ ] `frontend/src/pages/MeetingPage.tsx` 수정 (ExportButton 통합)
- [ ] 전체 테스트 통과 확인 (`npm test`)
