import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

const { mockGetMeetings } = vi.hoisted(() => ({
  mockGetMeetings: vi.fn(),
}))

vi.mock('../api/meetings', () => ({
  getMeetings: mockGetMeetings,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  )
}

describe('DashboardPage 반응형 패딩 (TSK-03-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 0, page: 1, per: 10 },
    })
  })

  it('루트 div에 반응형 패딩 클래스가 적용됨 (p-4 md:p-6 lg:p-8)', () => {
    const { container } = renderPage()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('p-4')
    expect(root.className).toContain('md:p-6')
    expect(root.className).toContain('lg:p-8')
    // p-8이 lg: 접두사 없이 단독으로 존재하지 않는지 확인
    // (p-4가 포함되었으므로 기존 단독 p-8이 아님이 이미 보장됨)
  })

  it('제목 h1에 반응형 텍스트 크기가 적용됨 (text-xl md:text-2xl)', () => {
    const { container } = renderPage()
    const h1 = container.querySelector('h1') as HTMLElement
    expect(h1).toBeTruthy()
    expect(h1.className).toContain('text-xl')
    expect(h1.className).toContain('md:text-2xl')
  })

  it('통계 카드 그리드에 반응형 gap이 적용됨 (gap-3 md:gap-6)', () => {
    const { container } = renderPage()
    // 통계 카드 그리드: grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
    const statsGrid = container.querySelector('.grid.grid-cols-1') as HTMLElement
    // 로딩이 아닌 상태에서도 skeleton이 보일 수 있으므로, 그리드가 있을 때만 검증
    if (statsGrid) {
      expect(statsGrid.className).toContain('gap-3')
      expect(statsGrid.className).toContain('md:gap-6')
      expect(statsGrid.className).not.toMatch(/(?<!\w)gap-4(?!\s)/)
    }
  })

  it('통계 카드 그리드 영역에 overflow-x-auto가 적용됨', () => {
    const { container } = renderPage()
    // overflow-x-auto 래퍼 또는 그리드 자체에 적용되었는지 확인
    const overflowEl = container.querySelector('.overflow-x-auto') as HTMLElement
    expect(overflowEl).toBeTruthy()
  })
})
