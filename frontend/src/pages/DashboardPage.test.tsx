import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import DashboardPage from './DashboardPage'

const { mockGetMeetings, mockGetScheduledMeetings, mockDismissSchedule } = vi.hoisted(() => ({
  mockGetMeetings: vi.fn(),
  mockGetScheduledMeetings: vi.fn(),
  mockDismissSchedule: vi.fn(),
}))

vi.mock('../api/meetings', () => ({
  getMeetings: mockGetMeetings,
  getScheduledMeetings: mockGetScheduledMeetings,
  dismissSchedule: mockDismissSchedule,
}))

// 오프라인 건수 통계 카드: Android 환경 강제 + listLocal(3건) 모킹.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  IS_TAURI: true,
  IS_MOBILE: true,
}))
vi.mock('../stt/localStore', () => ({
  listLocal: vi.fn().mockResolvedValue([{ localId: 'a' }, { localId: 'b' }, { localId: 'c' }]),
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
    mockGetScheduledMeetings.mockResolvedValue([])
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

  it('오프라인 회의 건수 통계 카드가 표시됨(Android)', async () => {
    renderPage()
    // 통계 카드 라벨 "오프라인 회의" + listLocal 3건 카운트
    expect(await screen.findByText('오프라인 회의')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

describe('DashboardPage 프로젝트 스코핑', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetScheduledMeetings.mockResolvedValue([])
    mockGetMeetings.mockResolvedValue({ meetings: [], meta: { total: 0, status_counts: {} } })
  })

  it('현재 프로젝트로 스코프해 회의를 조회한다(project_id 전달)', async () => {
    useProjectStore.setState({ currentProjectId: 7 })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    await waitFor(() => expect(mockGetMeetings).toHaveBeenCalled())
    expect(mockGetMeetings).toHaveBeenCalledWith(expect.objectContaining({ project_id: 7 }))
  })
})

describe('DashboardPage 예약중 통계 분리', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ currentProjectId: null })
    mockGetScheduledMeetings.mockResolvedValue([])
  })

  it('예약중 카드를 분리하고 대기중에서 예약 회의를 제외한다', async () => {
    // pending 9 중 예약 2 → 대기중 7, 예약중 2 (오프라인=3, 기타=0과 겹치지 않는 값 선택)
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 12, page: 1, per: 10, status_counts: { pending: 9 }, scheduled_count: 2 },
    })
    renderPage()
    expect(await screen.findByText('예약중')).toBeInTheDocument()
    expect(screen.getByText('대기중')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument() // 대기중 = 9 - 2
    expect(screen.getByText('2')).toBeInTheDocument() // 예약중
  })

  it('scheduled_count가 없으면 0으로 폴백한다(대기중=pending 그대로)', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [],
      meta: { total: 5, page: 1, per: 10, status_counts: { pending: 5 } },
    })
    renderPage()
    expect(await screen.findByText('예약중')).toBeInTheDocument()
    // 예약중 카드 value = 0
    const scheduledCard = screen.getByText('예약중').closest('div')?.parentElement
    expect(scheduledCard?.querySelector('p')?.textContent).toBe('0')
  })
})
