import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RunHistoryView from './RunHistoryView'
import { runSummary, runDetail, runItem, httpError, lvl } from './testHelpers'
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

  it('"이 회의 등록 전부 되돌리기" 는 confirmDialog 후 revertRun, skipped 항목은 "변경되어 건너뜀" 표시', async () => {
    render(<RunHistoryView />)
    await openFirst()
    confirmMock.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: '이 회의 등록 전부 되돌리기' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(m.revertRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '이 회의 등록 전부 되돌리기' }))
    await waitFor(() => expect(m.revertRun).toHaveBeenCalledWith(1))
    expect(await screen.findByText('변경되어 건너뜀')).toBeInTheDocument()
  })

  it('제외 항목 "등록" → registerItem', async () => {
    render(<RunHistoryView />)
    await openFirst()
    fireEvent.click(screen.getByRole('button', { name: '후반 등록' }))
    await waitFor(() => expect(m.registerItem).toHaveBeenCalledWith(1, 12))
  })

  it('늦게 도착한 옛 run 상세는 마지막 클릭한 run 을 덮어쓰지 않는다', async () => {
    render(<RunHistoryView />)
    let resolveOld!: (v: ReturnType<typeof runDetail>) => void
    m.getRun.mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
    fireEvent.click(await screen.findByRole('button', { name: /#219 주간 회의/ }))
    m.getRun.mockResolvedValueOnce(runDetail({ id: 2, meeting: { id: 300, title: '실패 회의', level: lvl } }))
    fireEvent.click(screen.getByRole('button', { name: /#300 실패 회의/ }))
    await screen.findByText('지금 다시 분석')
    resolveOld(runDetail())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getAllByText(/#300 실패 회의/).length).toBe(2)
    expect(screen.getAllByText(/#219 주간 회의/).length).toBe(1)
  })

  it('reverted run 의 항목에는 등록 버튼이 없다', async () => {
    m.getRun.mockResolvedValue(runDetail({ status: 'reverted' }))
    render(<RunHistoryView />)
    await openFirst()
    expect(screen.queryByRole('button', { name: '후반 등록' })).toBeNull()
  })

  it('"등록" 은 수동 등록 가능한 판정(제외·전사 없음·충돌·낮은 확신)에만', async () => {
    m.getRun.mockResolvedValue(runDetail({
      items: [
        runItem({ id: 21, wrong: '가1', verdict: 'skipped_excluded', reason: 'reverted_pair' }),
        runItem({ id: 22, wrong: '가2', verdict: 'skipped_not_in_transcript' }),
        runItem({ id: 23, wrong: '가3', verdict: 'skipped_conflict', reason: 'wrong_is_term' }),
        runItem({ id: 24, wrong: '가4', verdict: 'skipped_low_confidence' }),
        runItem({ id: 25, wrong: '나1', verdict: 'skipped_invalid', reason: 'format_chars' }),
        runItem({ id: 26, wrong: '나2', verdict: 'skipped_no_level' }),
        runItem({ id: 27, wrong: '나3', verdict: 'registered' }),
      ],
    }))
    render(<RunHistoryView />)
    await openFirst()
    for (const w of ['가1', '가2', '가3', '가4']) expect(screen.getByRole('button', { name: `${w} 등록` })).toBeInTheDocument()
    for (const w of ['나1', '나2', '나3']) expect(screen.queryByRole('button', { name: `${w} 등록` })).toBeNull()
  })

  it('done 이 아닌 run(failed 등)의 항목에는 등록 버튼이 없다', async () => {
    m.getRun.mockResolvedValue(runDetail({ status: 'failed' }))
    render(<RunHistoryView />)
    await openFirst()
    expect(screen.queryByRole('button', { name: '후반 등록' })).toBeNull()
  })

  it('원시 코드(근거·LLM 생략·오류)는 한글 라벨로, 코드는 title 에 남긴다', async () => {
    m.getRuns.mockResolvedValue({
      runs: [runSummary(), runSummary({ id: 2, status: 'failed', error: 'learning_disabled', meeting: { id: 300, title: '실패 회의', level: lvl } })],
      pending: [],
    })
    m.getRun.mockResolvedValue(runDetail({
      llm_skipped_reason: 'llm_not_configured',
      items: [
        runItem({ id: 31, wrong: '다1', verdict: 'skipped_excluded', reason: 'reverted_pair' }),
        runItem({ id: 32, wrong: '다2', verdict: 'skipped_conflict', reason: 'wrong_is_term' }),
        runItem({ id: 33, wrong: '다3', verdict: 'skipped_invalid', reason: 'file_full' }),
        runItem({ id: 34, wrong: '다4', verdict: 'skipped_invalid', reason: 'format_chars' }),
        runItem({ id: 35, wrong: '다5', verdict: 'skipped_conflict', reason: 'changed_during_run' }),
      ],
    }))
    render(<RunHistoryView />)
    expect(await screen.findByText('학습 꺼짐')).toHaveAttribute('title', 'learning_disabled')
    await openFirst()
    expect(screen.getByText('LLM 생략: LLM 설정 없음')).toBeInTheDocument()
    expect(screen.getByText('되돌린 쌍')).toHaveAttribute('title', 'reverted_pair')
    expect(screen.getByText('기존 용어')).toHaveAttribute('title', 'wrong_is_term')
    expect(screen.getByText('파일 용량 초과')).toHaveAttribute('title', 'file_full')
    expect(screen.getByText('형식 문자 포함')).toHaveAttribute('title', 'format_chars')
    expect(screen.getByText('실행 중 변경됨')).toHaveAttribute('title', 'changed_during_run')
    expect(screen.getAllByText('제외(충돌)')[0]).toHaveAttribute('title', 'skipped_conflict')
    expect(screen.queryByText('reverted_pair')).toBeNull()
  })

  it('LLM 실패 코드도 라벨로', async () => {
    m.getRun.mockResolvedValue(runDetail({ llm_skipped_reason: 'llm_failed' }))
    render(<RunHistoryView />)
    await openFirst()
    expect(screen.getByText('LLM 생략: LLM 실패')).toBeInTheDocument()
  })
})
