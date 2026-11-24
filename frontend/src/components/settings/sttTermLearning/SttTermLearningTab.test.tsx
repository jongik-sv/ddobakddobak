import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SttTermLearningTab, { PROJECT_STORAGE_KEY } from './SttTermLearningTab'
import { useProjectStore } from '../../../stores/projectStore'
import { treeFixture } from './fixtures'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useProjectStore.setState({ currentProjectId: 2 })
  m.getScopeProjects.mockResolvedValue([
    { id: 1, name: 'TF', personal: false },
    { id: 2, name: '제강', personal: false },
  ])
  m.getTree.mockResolvedValue(treeFixture)
  m.getTerms.mockResolvedValue({ terms: [] })
  m.getRuns.mockResolvedValue({ runs: [], pending: [] })
  m.getMisrecognitions.mockResolvedValue({ misrecognitions: [], counts: { total: 0, undecided: 0 } })
  m.getSettings.mockResolvedValue({ enabled: true, idle_minutes: 10, min_confidence: 0.8 })
})

const select = () => screen.getByLabelText('프로젝트 선택') as HTMLSelectElement

describe('SttTermLearningTab 프로젝트 선택기', () => {
  it('기본값 = 현재 프로젝트, API 호출에 project_id 가 실린다', async () => {
    render(<SttTermLearningTab />)
    await waitFor(() => expect(select().value).toBe('2'))
    await waitFor(() => expect(m.getTree).toHaveBeenCalledWith(2))
    expect(m.getTerms).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2 }))
  })

  it('저장된 선택이 현재 프로젝트보다 우선, 보이지 않는 저장값은 무시', async () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, '1')
    const { unmount } = render(<SttTermLearningTab />)
    await waitFor(() => expect(select().value).toBe('1'))
    unmount()
    localStorage.setItem(PROJECT_STORAGE_KEY, '999')
    render(<SttTermLearningTab />)
    await waitFor(() => expect(select().value).toBe('2'))
  })

  it('현재 프로젝트가 안 보이면 첫 프로젝트', async () => {
    useProjectStore.setState({ currentProjectId: 77 })
    render(<SttTermLearningTab />)
    await waitFor(() => expect(select().value).toBe('1'))
  })

  it('변경하면 저장하고 다시 불러온다', async () => {
    render(<SttTermLearningTab />)
    await waitFor(() => expect(select().value).toBe('2'))
    fireEvent.change(select(), { target: { value: '1' } })
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe('1')
    await waitFor(() => expect(m.getTree).toHaveBeenLastCalledWith(1))
  })

  it('처리 내역·오인식 탭도 project_id 를 싣고, 설정·등록 흐름 탭에서는 선택기가 비활성', async () => {
    render(<SttTermLearningTab />)
    await waitFor(() => expect(select().value).toBe('2'))
    fireEvent.click(screen.getByRole('tab', { name: '처리 내역' }))
    await waitFor(() => expect(m.getRuns).toHaveBeenCalledWith(undefined, 2))
    fireEvent.click(screen.getByRole('tab', { name: '오인식 기록' }))
    await waitFor(() => expect(m.getMisrecognitions).toHaveBeenCalledWith(expect.objectContaining({ projectId: 2 })))
    fireEvent.click(screen.getByRole('tab', { name: '설정' }))
    expect(select()).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: '등록 흐름' }))
    expect(select()).toBeDisabled()
  })

  it('프로젝트 목록 조회가 실패해도 전체(비한정) 보기로 폴백하고 오류를 알린다', async () => {
    m.getScopeProjects.mockRejectedValue(new Error('500'))
    render(<SttTermLearningTab />)
    await screen.findByText('프로젝트 목록을 불러오지 못했습니다.')
    await waitFor(() => expect(m.getTree).toHaveBeenCalled())
    expect(m.getTree).toHaveBeenCalledWith(null)
    expect(select()).toBeDisabled()
  })
})

describe('SttTermLearningTab 관리 프로젝트 없음', () => {
  it('프로젝트 목록이 비면 안내 문구만 보이고 데이터를 조회하지 않는다', async () => {
    m.getScopeProjects.mockResolvedValue([])
    render(<SttTermLearningTab />)
    expect(await screen.findByText('관리자로 지정된 프로젝트가 없습니다.')).toBeInTheDocument()
    expect(m.getTree).not.toHaveBeenCalled()
  })
})
