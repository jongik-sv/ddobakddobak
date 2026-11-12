import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../api/meetings', () => ({ exportMeeting: vi.fn(), exportMeetingData: vi.fn(), exportPrompt: vi.fn() }))
vi.mock('../../api/dflow', () => ({
  getDflowSettings: vi.fn().mockResolvedValue({ enabled: false, base_url: null, api_secret_masked: '' }),
}))
vi.mock('../../api/settings', () => ({ getWhiteboardSettings: vi.fn() }))
vi.mock('../../api/whiteboard', async () => {
  const actual = await vi.importActual<typeof import('../../api/whiteboard')>('../../api/whiteboard')
  return { ...actual, postWhiteboard: vi.fn(), getWhiteboard: vi.fn() }
})
vi.mock('../../lib/download', () => ({ downloadBlob: vi.fn(), downloadText: vi.fn() }))
vi.mock('../../lib/markdown', () => ({ downloadMarkdown: vi.fn() }))
vi.mock('../../lib/whiteboard/runner', async () => {
  const actual = await vi.importActual<typeof import('../../lib/whiteboard/runner')>('../../lib/whiteboard/runner')
  return { ...actual, detectLocalClaude: vi.fn(), generateBoardLocal: vi.fn() }
})
vi.mock('../../config', async () => ({ ...(await vi.importActual<object>('../../config')), IS_TAURI: false }))
vi.mock('./SendToDflowDialog', () => ({ default: () => null }))

// 채널 구독은 가짜로 — received/connected 를 테스트가 직접 호출한다.
const channel = vi.hoisted(() => ({ handlers: null as null | { received: (d: unknown) => void; connected?: () => void }, unsub: vi.fn() }))
vi.mock('../../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: () => ({
    subscriptions: {
      create: (_p: unknown, h: { received: (d: unknown) => void; connected?: () => void }) => {
        channel.handlers = h
        return { unsubscribe: channel.unsub }
      },
    },
    disconnect: vi.fn(),
  }),
}))

import { ExportButton } from './ExportButton'
import { WhiteboardToast } from './WhiteboardToast'
import { exportMeetingData } from '../../api/meetings'
import { getWhiteboardSettings } from '../../api/settings'
import { WhiteboardServerDisabledError, getWhiteboard, postWhiteboard } from '../../api/whiteboard'
import { detectLocalClaude } from '../../lib/whiteboard/runner'
import { downloadBlob } from '../../lib/download'
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
  const btn = await screen.findByRole('button', { name: '화이트보드' })
  await userEvent.click(btn)
  return btn
}

describe('ExportButton 화이트보드 서버 모드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    channel.handlers = null
    useWhiteboardStore.setState({ entries: {}, panelOpen: {}, notice: null })
    vi.mocked(exportMeetingData).mockResolvedValue(data({ type: 'notes_markdown', notes_markdown: '## 핵심 요약\n- 안건' }))
    vi.mocked(detectLocalClaude).mockResolvedValue(null)
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'server_claude', server_claude_available: true })
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'none', stale: false })
  })

  it('서버 경로: 문구와 주 버튼이 서버 기준이다', async () => {
    await openWhiteboard()
    expect(await screen.findByText('서버의 Claude Code')).toBeInTheDocument()
    expect(await screen.findByText(/서버 PC의 Claude Code로 만듭니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '화이트보드 만들기' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '지시문 내려받기 (.txt)' })).not.toBeInTheDocument()
  })

  it('POST 200 done 이면 잡 대기 없이 바로 done, 저장은 사용자 클릭 때만', async () => {
    vi.mocked(postWhiteboard).mockResolvedValue({ status: 'done', digest: 'd1', board })
    await openWhiteboard()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    expect(await screen.findByText(/화이트보드를 만들었습니다/)).toBeInTheDocument()
    expect(channel.handlers).toBeNull()
    expect(downloadBlob).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled())
  })

  it('POST 202 → whiteboard_ready 이벤트 → GET → done', async () => {
    vi.mocked(postWhiteboard).mockResolvedValue({ status: 'running', digest: 'd1' })
    await openWhiteboard()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    expect(await screen.findByText(/서버의 Claude Code가 화이트보드를 만드는 중/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '만드는 중…' })).toBeDisabled()
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd1', board, stale: false })
    await act(async () => { channel.handlers!.received({ type: 'whiteboard_ready', meeting_id: 1, digest: 'd1' }) })
    expect(await screen.findByText(/화이트보드를 만들었습니다/)).toBeInTheDocument()
    expect(channel.unsub).toHaveBeenCalled()
  })

  it('whiteboard_failed 는 kind 별 문구, auth 는 서버 문구', async () => {
    vi.mocked(postWhiteboard).mockResolvedValue({ status: 'running', digest: 'd1' })
    await openWhiteboard()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    await screen.findByText(/만드는 중입니다/)
    await act(async () => { channel.handlers!.received({ type: 'whiteboard_failed', meeting_id: 1, error_kind: 'auth', message: 'x' }) })
    expect(await screen.findByText('서버 PC의 Claude Code 로그인이 필요합니다. 관리자에게 알려 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('POST 403 이면 지시문 내려받기로 폴백한다', async () => {
    vi.mocked(postWhiteboard).mockRejectedValue(new WhiteboardServerDisabledError())
    await openWhiteboard()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    expect(await screen.findByRole('button', { name: '지시문 내려받기 (.txt)' })).toBeInTheDocument()
  })

  it('패널을 열면 GET 으로 done 을 복원하고 stale 이면 안내한다', async () => {
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd0', board, stale: true })
    await openWhiteboard()
    expect(await screen.findByText(/화이트보드를 만들었습니다/)).toBeInTheDocument()
    expect(await screen.findByTestId('wb-stale')).toHaveTextContent('회의록이 바뀌었습니다')
  })

  it('GET 이 running 이면 복원하고 채널을 구독한다', async () => {
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'running', digest: 'd0', stale: false })
    await openWhiteboard()
    expect(await screen.findByText(/서버의 Claude Code가 화이트보드를 만드는 중/)).toBeInTheDocument()
    expect(channel.handlers).not.toBeNull()
  })

  it('서버가 준 board 가 스키마 위반이면 형식 오류로 처리한다', async () => {
    vi.mocked(postWhiteboard).mockResolvedValue({ status: 'done', digest: 'd1', board: { zones: [] } })
    await openWhiteboard()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    expect(await screen.findByText('Claude 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.')).toBeInTheDocument()
  })

  it('패널을 닫은 채 완료되면 토스트로 알린다', async () => {
    vi.mocked(postWhiteboard).mockResolvedValue({ status: 'running', digest: 'd1' })
    await openWhiteboard()
    await userEvent.click(await screen.findByRole('button', { name: '화이트보드 만들기' }))
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd1', board, stale: false })
    await act(async () => { channel.handlers!.received({ type: 'whiteboard_ready', meeting_id: 1 }) })
    expect(await screen.findByRole('button', { name: '화이트보드 저장' })).toBeInTheDocument()
  })

  it('다른 회의·내가 만들지 않은 이벤트는 무시한다', async () => {
    useWhiteboardStore.getState().onCableEvent({ type: 'whiteboard_ready', meeting_id: 1 })
    useWhiteboardStore.getState().onCableEvent({ type: 'whiteboard_failed', meeting_id: 1, error_kind: 'auth' })
    expect(getWhiteboard).not.toHaveBeenCalled()
    expect(useWhiteboardStore.getState().entries[1]).toBeUndefined()
  })
})

describe('서버 경로 다시 만들기 노출 조건', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWhiteboardStore.setState({ entries: {}, panelOpen: {}, notice: null })
    vi.mocked(exportMeetingData).mockResolvedValue(data({ type: 'notes_markdown', notes_markdown: '## 핵심 요약\n- 안건' }))
    vi.mocked(detectLocalClaude).mockResolvedValue(null)
    vi.mocked(getWhiteboardSettings).mockResolvedValue({ web_mode: 'server_claude', server_claude_available: true })
  })

  it('done 이고 stale 이 아니면 숨긴다', async () => {
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd0', board, stale: false })
    await openWhiteboard()
    await screen.findByText(/화이트보드를 만들었습니다/)
    expect(screen.queryByRole('button', { name: '다시 만들기' })).toBeNull()
  })

  it('done 이고 stale 이면 노출한다', async () => {
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd0', board, stale: true })
    await openWhiteboard()
    expect(await screen.findByRole('button', { name: '다시 만들기' })).toBeInTheDocument()
  })

  it('error 면 다시 시도를 유지한다', async () => {
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'error', digest: 'd0', error_kind: 'timeout', stale: false })
    await openWhiteboard()
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})
