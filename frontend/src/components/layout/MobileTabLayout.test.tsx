import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileText, Bot, StickyNote } from 'lucide-react'

import MobileTabLayout from './MobileTabLayout'

const tabs = [
  { id: 'transcript', label: '전사', icon: FileText, content: <div>전사 콘텐츠</div> },
  { id: 'summary', label: 'AI 요약', icon: Bot, content: <div>AI 요약 콘텐츠</div> },
  { id: 'memo', label: '메모', icon: StickyNote, content: <div>메모 콘텐츠</div> },
]

describe('MobileTabLayout', () => {
  // --- 렌더링 ---

  it('모든 탭 버튼이 렌더링됨', () => {
    render(<MobileTabLayout tabs={tabs} />)
    expect(screen.getByRole('tab', { name: /전사/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /AI 요약/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /메모/ })).toBeInTheDocument()
  })

  it('모든 탭 콘텐츠가 DOM에 마운트됨 (DOM 유지)', () => {
    render(<MobileTabLayout tabs={tabs} />)
    expect(screen.getByText('전사 콘텐츠')).toBeInTheDocument()
    expect(screen.getByText('AI 요약 콘텐츠')).toBeInTheDocument()
    expect(screen.getByText('메모 콘텐츠')).toBeInTheDocument()
  })

  // --- 기본 탭 ---

  it('defaultTab 미지정 시 첫 번째 탭이 활성화됨', () => {
    render(<MobileTabLayout tabs={tabs} />)
    const firstTab = screen.getByRole('tab', { name: /전사/ })
    expect(firstTab).toHaveAttribute('aria-selected', 'true')
  })

  it('defaultTab 지정 시 해당 탭이 활성화됨', () => {
    render(<MobileTabLayout tabs={tabs} defaultTab="memo" />)
    const memoTab = screen.getByRole('tab', { name: /메모/ })
    expect(memoTab).toHaveAttribute('aria-selected', 'true')
  })

  // --- 탭 전환 ---

  it('탭 클릭 시 활성 탭이 전환됨', async () => {
    const user = userEvent.setup()
    render(<MobileTabLayout tabs={tabs} />)

    const summaryTab = screen.getByRole('tab', { name: /AI 요약/ })
    await user.click(summaryTab)

    expect(summaryTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /전사/ })).toHaveAttribute('aria-selected', 'false')
  })

  // --- 비활성 탭 숨김 (visibility: hidden + position: absolute) ---

  it('비활성 탭 콘텐츠는 visibility: hidden이고 활성 탭은 visible', () => {
    render(<MobileTabLayout tabs={tabs} defaultTab="transcript" />)

    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    const activePanel = panels.find(p => p.getAttribute('data-tab-id') === 'transcript')!
    const hiddenPanel = panels.find(p => p.getAttribute('data-tab-id') === 'summary')!

    expect(activePanel).toHaveStyle({ visibility: 'visible' })
    expect(hiddenPanel).toHaveStyle({ visibility: 'hidden' })
  })

  it('비활성 탭 콘텐츠는 position: absolute', () => {
    render(<MobileTabLayout tabs={tabs} defaultTab="transcript" />)

    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    const hiddenPanel = panels.find(p => p.getAttribute('data-tab-id') === 'summary')!

    expect(hiddenPanel).toHaveClass('absolute')
  })

  // --- 3개 탭 균등 너비 ---

  it('탭 버튼이 flex-1 클래스로 균등 너비 배분됨', () => {
    render(<MobileTabLayout tabs={tabs} />)

    const tabButtons = screen.getAllByRole('tab')
    tabButtons.forEach(btn => {
      expect(btn).toHaveClass('flex-1')
    })
  })

  // --- 탭 바 스타일 ---

  it('탭 바가 h-10 sticky top-0으로 고정됨', () => {
    render(<MobileTabLayout tabs={tabs} />)

    const tabList = screen.getByRole('tablist')
    expect(tabList).toHaveClass('h-10', 'sticky', 'top-0')
  })

  // --- 활성 탭 인디케이터 ---

  it('활성 탭에 border-b-2 border-primary 인디케이터가 있음', () => {
    render(<MobileTabLayout tabs={tabs} defaultTab="transcript" />)

    const activeTab = screen.getByRole('tab', { name: /전사/ })
    expect(activeTab).toHaveClass('border-b-2', 'border-primary')
  })

  it('비활성 탭에는 text-muted-foreground 클래스가 있음', () => {
    render(<MobileTabLayout tabs={tabs} defaultTab="transcript" />)

    const inactiveTab = screen.getByRole('tab', { name: /AI 요약/ })
    expect(inactiveTab).toHaveClass('text-muted-foreground')
  })

  // --- 제어/비제어 패턴 ---

  it('비제어 모드: 내부 상태로 탭 전환 관리', async () => {
    const user = userEvent.setup()
    render(<MobileTabLayout tabs={tabs} />)

    await user.click(screen.getByRole('tab', { name: /메모/ }))
    expect(screen.getByRole('tab', { name: /메모/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('제어 모드: activeTab prop으로 활성 탭 제어', () => {
    render(<MobileTabLayout tabs={tabs} activeTab="summary" />)

    expect(screen.getByRole('tab', { name: /AI 요약/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /전사/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('제어 모드: onTabChange 콜백이 호출됨', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<MobileTabLayout tabs={tabs} activeTab="transcript" onTabChange={onTabChange} />)

    await user.click(screen.getByRole('tab', { name: /메모/ }))
    expect(onTabChange).toHaveBeenCalledWith('memo')
  })

  it('제어 모드: onTabChange 없이 activeTab만 있으면 내부 전환되지 않음', async () => {
    const user = userEvent.setup()
    render(<MobileTabLayout tabs={tabs} activeTab="transcript" />)

    await user.click(screen.getByRole('tab', { name: /메모/ }))
    // activeTab prop이 제어하므로 여전히 transcript가 활성
    expect(screen.getByRole('tab', { name: /전사/ })).toHaveAttribute('aria-selected', 'true')
  })

  // --- 콘텐츠 영역 ---

  it('콘텐츠 영역이 flex-1 overflow-auto 클래스를 가짐', () => {
    render(<MobileTabLayout tabs={tabs} />)

    const tabList = screen.getByRole('tablist')
    const contentArea = tabList.parentElement!.querySelector('[data-content-area]')!
    expect(contentArea).toHaveClass('flex-1', 'overflow-auto')
  })

  // --- 탭 전환 후 이전 탭 스크롤/상태 보존 ---

  it('탭 전환 후 이전 탭 콘텐츠가 DOM에 남아있음 (언마운트되지 않음)', async () => {
    const user = userEvent.setup()
    render(<MobileTabLayout tabs={tabs} />)

    // 처음에 모든 탭 콘텐츠가 있음
    expect(screen.getByText('전사 콘텐츠')).toBeInTheDocument()

    // 다른 탭으로 전환
    await user.click(screen.getByRole('tab', { name: /AI 요약/ }))

    // 이전 탭 콘텐츠가 여전히 DOM에 존재
    expect(screen.getByText('전사 콘텐츠')).toBeInTheDocument()
    expect(screen.getByText('AI 요약 콘텐츠')).toBeInTheDocument()
  })
})
