import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RunHistoryView from './RunHistoryView'
import { runSummary, runDetail, httpError, lvl } from './testHelpers'
import * as api from '../../../api/sttTermLearning'

vi.mock('../../../api/sttTermLearning')
const confirmMock = vi.fn()
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: (...a: unknown[]) => confirmMock(...a) }))
const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  confirmMock.mockResolvedValue(true)
  m.getRuns.mockResolvedValue({
    runs: [runSummary(), runSummary({ id: 2, status: 'failed', error: 'LLM 오류', meeting: { id: 300, title: '실패 회의', level: lvl } })],
    pending: [{ meeting: { id: 400, title: '대기 회의', level: lvl }, summary_id: 9, human_edited_at: '2026-11-23T01:00:00Z', eta: new Date(Date.now() + 12 * 60000 - 1000).toISOString() }],
  })
  m.getRun.mockResolvedValue(runDetail())
  m.analyzeMeeting.mockResolvedValue(runSummary())
  m.rerunRun.mockResolvedValue(runSummary())
  m.revertRun.mockResolvedValue({ run: runSummary(), reverted: 2, skipped_item_ids: [11] })
  m.registerItem.mockResolvedValue(runDetail().items[1])
})

async function openFirst() {
  fireEvent.click(await screen.findByRole('button', { name: /#219 주간 회의/ }))
  await screen.findByText('지금 다시 분석')
}

describe('RunHistoryView', () => {
  it('runs + pending 목록: 등록 N·제외 N, 대기는 "대기 · N분 후", failed 는 "다시 실행" 버튼(rerunRun)', async () => {
    render(<RunHistoryView />)
    expect(await screen.findByText('등록 2 · 제외 1')).toBeInTheDocument()
    expect(screen.getByText('대기 · 12분 후')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }))
    await waitFor(() => expect(m.rerunRun).toHaveBeenCalledWith(2))
  })

  it('run 선택 → getRun, diff 와 판정 표(쌍·판정·근거·등록 위치)', async () => {
    render(<RunHistoryView />)
    await openFirst()
    expect(m.getRun).toHaveBeenCalledWith(1)
    expect(screen.getByText('후판 생산')).toBeInTheDocument()
    expect(screen.getByText('새 줄 등록')).toBeInTheDocument()
    expect(screen.getByText('제외(전사에 없음)')).toBeInTheDocument()
    expect(screen.getAllByText('전사에 있음').length).toBe(2)
    expect(screen.getByText(/생산회의 · STT 오인식\(자동\)/)).toBeInTheDocument()
  })

  it('run 상세의 "지금 다시 분석" 은 analyzeMeeting(run.meeting.id) 호출, 422 면 오류 문구', async () => {
    render(<RunHistoryView />)
    await openFirst()
    fireEvent.click(screen.getByRole('button', { name: '지금 다시 분석' }))
    await waitFor(() => expect(m.analyzeMeeting).toHaveBeenCalledWith(219))
    m.analyzeMeeting.mockRejectedValueOnce(httpError(422, { error: '학습 꺼짐: 설정에서 켜 주세요' }))
    fireEvent.click(screen.getByRole('button', { name: '지금 다시 분석' }))
    expect(await screen.findByText('학습 꺼짐: 설정에서 켜 주세요')).toBeInTheDocument()
  })

  it('"이 회의 등록 전부 되돌리기" 는 confirmDialog 후 revertRun, skipped 항목은 "사람이 수정해 건너뜀" 표시', async () => {
    render(<RunHistoryView />)
    await openFirst()
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '이 회의 등록 전부 되돌리기' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(m.revertRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '이 회의 등록 전부 되돌리기' }))
    await waitFor(() => expect(m.revertRun).toHaveBeenCalledWith(1))
    expect(await screen.findByText('사람이 수정해 건너뜀')).toBeInTheDocument()
  })

  it('제외 항목 "등록" → registerItem', async () => {
    render(<RunHistoryView />)
    await openFirst()
    fireEvent.click(screen.getByRole('button', { name: '후반 등록' }))
    await waitFor(() => expect(m.registerItem).toHaveBeenCalledWith(1, 12))
  })
})
