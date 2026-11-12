import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../api/meetings', () => ({ exportMeeting: vi.fn(), exportMeetingData: vi.fn(), exportPrompt: vi.fn() }))
vi.mock('../../api/dflow', () => ({
  getDflowSettings: vi.fn().mockResolvedValue({ enabled: false, base_url: null, api_secret_masked: '' }),
}))
vi.mock('../../api/settings', () => ({ getWhiteboardSettings: vi.fn() }))
vi.mock('../../lib/download', () => ({ downloadBlob: vi.fn(), downloadText: vi.fn() }))
vi.mock('../../lib/markdown', () => ({ downloadMarkdown: vi.fn() }))
vi.mock('../../lib/whiteboard/runner', async () => {
  const actual = await vi.importActual<typeof import('../../lib/whiteboard/runner')>('../../lib/whiteboard/runner')
  return { ...actual, detectLocalClaude: vi.fn(), generateBoardLocal: vi.fn() }
})
vi.mock('../../config', async () => ({ ...(await vi.importActual<object>('../../config')), IS_TAURI: true }))
vi.mock('./SendToDflowDialog', () => ({ default: () => null }))

import { ExportButton } from './ExportButton'
import { WhiteboardToast } from './WhiteboardToast'
import { exportMeetingData } from '../../api/meetings'
import { getWhiteboardSettings } from '../../api/settings'
import { downloadBlob, downloadText } from '../../lib/download'
import { detectLocalClaude, generateBoardLocal, WhiteboardRunFailure } from '../../lib/whiteboard/runner'
import { useWhiteboardStore } from '../../stores/whiteboardStore'

const data = (summary: unknown) =>
  ({
    meeting: { id: 1, title: '주간 회의', date: '2026-11-12', start_time: '10:00', end_time: '11:00', status: 'completed', creator_name: 'a' },
    summary,
    transcripts: [],
  }) as never

const board = {
  title: '주간 회의', date: '2026-11-12', headline: 'h',
  zones: [{ title: 'z', kind: 'topic', items: [{ text: 't', tag: null, who: null, due: null }] }],
}

async function openWhiteboard() {
  render(<><ExportButton meetingId={1} meetingTitle="주간 회의" meetingDate="2026-11-12" /><WhiteboardToast /></>)
  await userEvent.click(screen.getByRole('button', { name: /내보내기/ }))
  return screen.findByRole('button', { name: '화이트보드' })
}

describe('ExportButton 화이트보드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWhiteboardStore.setState({ entries: {}, panelOpen: {}, notice: null })
    vi.mocked(exportMeetingData).mockResolvedValue(data({ type: 'notes_markdown', notes_markdown: '## 핵심 요약\n- 안건' }))
    vi.mocked(detectLocalClaude).mockResolvedValue(null)
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'copy', server_claude_available: false })
  })

  it('요약이 없으면 화이트보드 버튼이 비활성이고 안내 툴팁이 있다', async () => {
    vi.mocked(exportMeetingData).mockResolvedValue(data(null))
    const btn = await openWhiteboard()
    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn.parentElement).toHaveAttribute('title', 'AI 회의록이 있어야 만들 수 있습니다')
  })

  it('local 경로: 만들기 → 완료 → 저장은 html 확장자 text/html', async () => {
    vi.mocked(detectLocalClaude).mockResolvedValue('/usr/bin/claude')
    vi.mocked(generateBoardLocal).mockResolvedValue(board as never)
    const btn = await openWhiteboard()
    await userEvent.click(btn)
    expect(await screen.findByText('이 PC의 Claude Code')).toBeInTheDocument()
    expect(screen.queryByLabelText('AI 요약 포함')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    expect(await screen.findByText(/화이트보드를 만들었습니다/)).toBeInTheDocument()
    expect(downloadBlob).not.toHaveBeenCalled() // 자동 다운로드 금지
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0]
    expect(name).toBe('주간_회의_2026-11-12.html')
    expect((blob as Blob).type).toContain('text/html')
  })

  it('local 경로: 실패 문구를 보여 주고 다시 시도할 수 있다', async () => {
    vi.mocked(detectLocalClaude).mockResolvedValue('/usr/bin/claude')
    vi.mocked(generateBoardLocal).mockRejectedValue(
      new WhiteboardRunFailure({ kind: 'auth', message: '이 PC의 Claude Code에 로그인되어 있지 않습니다.' }),
    )
    await userEvent.click(await openWhiteboard())
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    expect(await screen.findByText(/로그인되어 있지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('패널을 닫은 채 끝나면 토스트 버튼으로 저장한다', async () => {
    vi.mocked(detectLocalClaude).mockResolvedValue('/usr/bin/claude')
    let resolve!: (b: never) => void
    vi.mocked(generateBoardLocal).mockReturnValue(new Promise((r) => { resolve = r }))
    await userEvent.click(await openWhiteboard())
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    await act(async () => { resolve(board as never) })
    const save = await screen.findByRole('button', { name: '화이트보드 저장' })
    expect(downloadBlob).not.toHaveBeenCalled()
    await userEvent.click(save)
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled())
  })

  it('copy 경로: 지시문을 .txt 로 내려받는다 (파일명·내용·mime)', async () => {
    await userEvent.click(await openWhiteboard())
    expect(screen.getByTestId('wb-subtext')).toHaveTextContent('지시문 내려받기 · 내 Claude에서')
    const dl = await screen.findByRole('button', { name: '지시문 내려받기 (.txt)' })
    await waitFor(() => expect(dl).toBeEnabled())
    await userEvent.click(dl)
    expect(downloadText).toHaveBeenCalledTimes(1)
    const [content, name, mime] = vi.mocked(downloadText).mock.calls[0]
    expect(name).toBe('주간_회의_2026-11-12_화이트보드_지시문.txt')
    expect(content).toContain('[AI 회의록]')
    expect(mime).toBeUndefined() // downloadText 기본값 text/plain;charset=utf-8
    expect(await screen.findByText(/지시문을 내려받았습니다/)).toBeInTheDocument()
    expect(screen.getByText(/내 claude.ai 계정으로 전달/)).toBeInTheDocument()
  })

  it('copy 안내: 관리자가 끈 경우', async () => {
    await userEvent.click(await openWhiteboard())
    expect(await screen.findByTestId('wb-copy-notice')).toHaveTextContent('Claude 화이트보드가 꺼져 있습니다. 대신 화이트보드 작성 지시문을 .txt 파일로')
  })

  it('copy 안내: 서버에 claude 가 없는 경우', async () => {
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'server_claude', server_claude_available: false })
    await userEvent.click(await openWhiteboard())
    expect(await screen.findByTestId('wb-copy-notice')).toHaveTextContent('서버에서 Claude Code를 찾을 수 없어')
  })

  it('copy 안내: 설정 조회 실패', async () => {
    vi.mocked(getWhiteboardSettings).mockRejectedValue(new Error('x'))
    await userEvent.click(await openWhiteboard())
    expect(await screen.findByTestId('wb-copy-notice')).toHaveTextContent('화이트보드 설정을 확인하지 못했습니다')
  })

  it('copy 경로: 보조 복사 버튼이 클립보드에 지시문을 쓰고 경고를 보여 준다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await userEvent.click(await openWhiteboard())
    const copyBtn = await screen.findByRole('button', { name: '복사' })
    await waitFor(() => expect(copyBtn).toBeEnabled())
    await userEvent.click(copyBtn)
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[AI 회의록]'))
    expect(await screen.findByText(/내 claude.ai 계정으로 전달/)).toBeInTheDocument()
    expect(downloadText).not.toHaveBeenCalled()
  })

  it('copy 경로: 클립보드 실패 시 읽기 전용 textarea로 지시문을 보여 준다', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    await userEvent.click(await openWhiteboard())
    const copyBtn = await screen.findByRole('button', { name: '복사' })
    await waitFor(() => expect(copyBtn).toBeEnabled())
    await userEvent.click(copyBtn)
    const ta = await screen.findByLabelText('화이트보드 지시문')
    expect(ta).toHaveAttribute('readonly')
    expect((ta as HTMLTextAreaElement).value).toContain('[AI 회의록]')
  })

  async function makeLocalBoard() {
    vi.mocked(detectLocalClaude).mockResolvedValue('/usr/bin/claude')
    vi.mocked(generateBoardLocal).mockResolvedValue(board as never)
    await userEvent.click(await openWhiteboard())
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    await screen.findByText(/화이트보드를 만들었습니다/)
  }

  async function reopenPanel() {
    const trigger = screen.getByRole('button', { name: /내보내기/ })
    await userEvent.click(trigger) // 닫기
    await userEvent.click(trigger) // 열기
  }

  it('done 에서 다시 만들기로 새로 생성한다', async () => {
    await makeLocalBoard()
    await userEvent.click(screen.getByRole('button', { name: '다시 만들기' }))
    await waitFor(() => expect(generateBoardLocal).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/화이트보드를 만들었습니다/)).toBeInTheDocument()
  })

  it('회의록이 바뀌면 stale 안내를 보여 주고 다시 만들기를 유도한다', async () => {
    await makeLocalBoard()
    expect(screen.queryByTestId('wb-stale')).not.toBeInTheDocument()
    vi.mocked(exportMeetingData).mockResolvedValue(data({ type: 'notes_markdown', notes_markdown: '## 핵심 요약\n- 재요약된 안건' }))
    await reopenPanel()
    expect(await screen.findByTestId('wb-stale')).toHaveTextContent('회의록이 바뀌었습니다')
    expect(screen.getByRole('button', { name: '다시 만들기' })).toBeEnabled()
  })

  it('완료 entry 가 있으면 다시 열 때 detect 가 실패해도 저장 화면을 유지한다', async () => {
    await makeLocalBoard()
    vi.mocked(detectLocalClaude).mockResolvedValue(null)
    vi.mocked(exportMeetingData).mockRejectedValue(new Error('network'))
    await reopenPanel()
    const save = await screen.findByRole('button', { name: '저장' })
    expect(save).toBeEnabled()
    expect(screen.queryByRole('button', { name: '지시문 내려받기 (.txt)' })).not.toBeInTheDocument()
    await userEvent.click(save)
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled())
  })

  it('저장 실패 시 패널과 토스트에 문구를 보여 준다', async () => {
    await makeLocalBoard()
    vi.mocked(downloadBlob).mockRejectedValueOnce(new Error('disk full'))
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByTestId('whiteboard-toast')).toHaveTextContent('저장하지 못했습니다')
    expect(screen.getAllByText(/저장하지 못했습니다/).length).toBeGreaterThanOrEqual(2)
  })

  it('토스트 저장 실패 문구는 바로 지워지지 않는다', async () => {
    vi.mocked(detectLocalClaude).mockResolvedValue('/usr/bin/claude')
    let resolve!: (b: never) => void
    vi.mocked(generateBoardLocal).mockReturnValue(new Promise((r) => { resolve = r }))
    await userEvent.click(await openWhiteboard())
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    await act(async () => { resolve(board as never) })
    vi.mocked(downloadBlob).mockRejectedValueOnce(new Error('x'))
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 저장' }))
    expect(await screen.findByTestId('whiteboard-toast')).toHaveTextContent('저장하지 못했습니다')
  })
})
