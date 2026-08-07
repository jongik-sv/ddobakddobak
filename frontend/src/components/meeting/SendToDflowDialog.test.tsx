import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HTTPError } from 'ky'
import SendToDflowDialog from './SendToDflowDialog'
import {
  getDflowStatus,
  getDflowMeta,
  uploadToDflow,
  setDflowLink,
  claimDflowMinute,
  listDflowMinutes,
} from '../../api/dflow'
import { useAuthStore } from '../../stores/authStore'
import type { Meeting } from '../../api/meetings'

vi.mock('../../api/dflow', () => ({
  getDflowStatus: vi.fn(),
  getDflowMeta: vi.fn(),
  uploadToDflow: vi.fn(),
  setDflowLink: vi.fn(),
  claimDflowMinute: vi.fn(),
  listDflowMinutes: vi.fn(),
}))

const confirmDialog = vi.fn<(...args: unknown[]) => Promise<boolean>>()
confirmDialog.mockResolvedValue(true)
vi.mock('../../lib/confirmDialog', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}))

/** ky HTTPError 구성 헬퍼 (MeetingLivePage.recorderlock.test.tsx 관례). */
function makeHttpError(status: number, body: Record<string, unknown>) {
  const response = { status, statusText: '', json: () => Promise.resolve(body) } as unknown as Response
  const request = { method: 'POST', url: 'http://localhost/api/v1/meetings/1/dflow/upload' } as unknown as Request
  return new HTTPError(response, request, {} as never)
}

const baseMeeting: Meeting = {
  id: 1,
  title: '물류공정_260716',
  status: 'completed',
  meeting_type: 'general',
  created_by: { id: 1, name: '테스터' },
  brief_summary: null,
  folder_id: 10,
  folder_path: [{ id: 1, name: 'MES' }, { id: 2, name: '물류' }],
  audio_duration_ms: 0,
  last_transcript_end_ms: 0,
  last_sequence_number: 0,
  memo: null,
  attendees: null,
  shared: true,
  locked: false,
  locked_at: null,
  important: false,
  started_at: '2026-07-16T00:00:00Z',
  ended_at: '2026-07-16T01:00:00Z',
  created_at: '2026-07-16T00:00:00Z',
}

const emptyStatus = { public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false }
const defaultMeta = { teams: ['MES', 'MDM'], projects: [], limits: { max_body_chars: 100000, max_request_bytes: 0, max_attachments: 0, max_attachment_bytes: 0 } }

describe('SendToDflowDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmDialog.mockResolvedValue(true)
    useAuthStore.setState({ user: { id: 1, email: 'sender@x.com', name: '보낸이', role: 'member' } } as never)
    vi.mocked(getDflowStatus).mockResolvedValue(emptyStatus)
    vi.mocked(getDflowMeta).mockResolvedValue(defaultMeta)
  })

  it('열리면 team 자동 판정(일치) 결과를 수정 불가 텍스트로, 제목은 자동 조립 기본값으로 보여준다', async () => {
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)

    expect(await screen.findByText('MES')).toBeInTheDocument()
    expect(screen.queryByLabelText('대상 구분')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('물류공정_260716')).toBeInTheDocument()
    expect(screen.getByText('sender@x.com')).toBeInTheDocument()
  })

  // W7: 다이얼로그 미리보기를 편철 경로 표시로 바꾼다. root === 이번 전송 team → team 접두 없음.
  it("편철 경로 미리보기를 'MES / 품질 / 주간정례' 형태로 보여준다(W7, 루트==team)", async () => {
    render(
      <SendToDflowDialog
        meeting={{
          ...baseMeeting,
          folder_path: [
            { id: 1, name: 'MES' },
            { id: 2, name: '품질' },
            { id: 3, name: '주간정례' },
          ],
        }}
        onClose={vi.fn()}
      />
    )
    await screen.findByText('MES')

    expect(screen.getByText('편철 경로 미리보기')).toBeInTheDocument()
    expect(screen.getByText('MES / 품질 / 주간정례')).toBeInTheDocument()
  })

  // W7: 루트가 팀코드가 아니면 선택한 team이 앞에 붙는 모습을 그대로 보여준다(정규화 ② 한 칸 내림).
  // 판정 기준은 dflowEffectiveFolderDepth와 동일한 함수를 공유한다(dflowAutoAssign.ts).
  it("루트가 팀코드가 아니면 선택한 team이 앞에 붙는 모습을 보여준다(W7, 정규화 ②)", async () => {
    render(
      <SendToDflowDialog
        meeting={{ ...baseMeeting, folder_path: [{ id: 9, name: '신규TF' }, { id: 10, name: '킥오프' }] }}
        onClose={vi.fn()}
      />
    )
    const select = await screen.findByLabelText('대상 구분')
    // team 미확정 상태 — 아직 team을 모르므로 미리보기에 접두를 붙이지 않는다.
    expect(screen.getByText('신규TF / 킥오프')).toBeInTheDocument()

    await userEvent.selectOptions(select, 'MES')

    expect(await screen.findByText('MES / 신규TF / 킥오프')).toBeInTheDocument()
  })

  // W7: 깊이 경고가 떠 있을 때는 미리보기가 "절단 전" 경로임을 안내해야 한다(최종 위치 아님).
  it('깊이 경고가 뜨면 미리보기가 절단 전 경로임을 안내한다(W7)', async () => {
    render(
      <SendToDflowDialog
        meeting={{
          ...baseMeeting,
          folder_path: [
            { id: 1, name: 'MES' },
            { id: 2, name: 'A' },
            { id: 3, name: 'B' },
            { id: 4, name: 'C' },
            { id: 5, name: 'D' },
            { id: 6, name: 'E' },
          ],
        }}
        onClose={vi.fn()}
      />
    )
    await screen.findByText('MES')

    expect(await screen.findByText(/실제 저장 위치는 전송 후 확인해 주세요/)).toBeInTheDocument()
  })

  it('실효 깊이(§2-C)가 5를 넘으면 비차단 경고를 보여준다(W4 3-b)', async () => {
    render(
      <SendToDflowDialog
        meeting={{
          ...baseMeeting,
          folder_path: [
            { id: 1, name: 'MES' },
            { id: 2, name: 'A' },
            { id: 3, name: 'B' },
            { id: 4, name: 'C' },
            { id: 5, name: 'D' },
            { id: 6, name: 'E' },
          ],
        }}
        onClose={vi.fn()}
      />
    )
    await screen.findByText('MES')

    expect(await screen.findByText(/D'Flow 보존 한도\(5단\)를 넘습니다/)).toBeInTheDocument()
    // 비차단 — 전송 버튼은 그대로 활성 상태여야 한다(정본 §2-C: 차단 금지).
    expect(screen.getByRole('button', { name: '전송' })).not.toBeDisabled()
  })

  it('실효 깊이가 5 이하면 경고를 보여주지 않는다', async () => {
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(screen.queryByText(/D'Flow 보존 한도/)).not.toBeInTheDocument()
  })

  // 정본 §2-C "경고는 teamOverride 확정 이후 재평가": 루트(MES)가 meta.teams에 있어 처음엔
  // 자동 판정되어 경고가 없지만, team_required 재시도로 사용자가 root와 다른 team(MDM)을
  // 고르면 D'Flow가 team 폴더를 한 단 더 끼워 넣으므로 그 시점에 경고가 나타나야 한다.
  it('team_required 재시도로 root와 다른 team을 선택하면 §2-C 재평가로 경고가 나타난다', async () => {
    vi.mocked(uploadToDflow).mockRejectedValue(makeHttpError(422, { error: '...', code: 'team_required' }))
    const deepPath = [
      { id: 1, name: 'MES' },
      { id: 2, name: 'A' },
      { id: 3, name: 'B' },
      { id: 4, name: 'C' },
      { id: 5, name: 'D' },
    ]
    render(<SendToDflowDialog meeting={{ ...baseMeeting, folder_path: deepPath }} onClose={vi.fn()} />)
    await screen.findByText('MES') // 자동 판정(5단, root===team) → 경고 없음
    expect(screen.queryByText(/D'Flow 보존 한도/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '전송' }))
    const select = await screen.findByLabelText('대상 구분') // team_required로 select 강제 노출
    await userEvent.selectOptions(select, 'MDM')

    expect(await screen.findByText(/D'Flow 보존 한도\(5단\)를 넘습니다/)).toBeInTheDocument()
  })

  it('최상위 폴더명이 meta.teams와 불일치하면 select를 노출한다', async () => {
    render(
      <SendToDflowDialog
        meeting={{ ...baseMeeting, folder_path: [{ id: 9, name: '임원 인터뷰' }] }}
        onClose={vi.fn()}
      />
    )

    const select = await screen.findByLabelText('대상 구분')
    expect(select).toBeInTheDocument()
    // team 미선택 상태 → 전송 버튼 비활성
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
  })

  it('전송 성공 시 titleOverride를 항상 포함하고(teamOverride는 생략), 결과 링크를 보여준다', async () => {
    vi.mocked(uploadToDflow).mockResolvedValue({
      public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: '전송' }))

    await waitFor(() => {
      expect(uploadToDflow).toHaveBeenCalledWith(1, { titleOverride: '물류공정_260716' })
    })
    expect(await screen.findByRole('link', { name: "D'Flow에서 보기" })).toHaveAttribute(
      'href', 'https://dflow.example.com/m/1'
    )
  })

  // W8: 전송 후 실제 편철 결과(folder_id/folder_path 에코) + folder_path_status 배지.
  describe('folder_path_status 배지 + 전송 후 실제 경로(W8)', () => {
    it('folder_path_status 키가 없으면 배지를 렌더하지 않는다(3값 규약 — 키 부재를 exact로 간주하지 말 것)', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: 'folder-1', folder_path: ['MES', '품질'],
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      await screen.findByText(/전송됨/)
      expect(screen.queryByText('경로 절단됨')).not.toBeInTheDocument()
      expect(screen.queryByText('상위 폴더까지만')).not.toBeInTheDocument()
      expect(screen.queryByText('미분류')).not.toBeInTheDocument()
    })

    it("folder_path_status: 'exact'면 배지를 렌더하지 않는다(성공은 조용히)", async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: 'folder-1', folder_path: ['MES', '품질'], folder_path_status: 'exact',
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      await screen.findByText(/전송됨/)
      expect(screen.queryByText('경로 절단됨')).not.toBeInTheDocument()
      expect(screen.getByText('편철 결과 경로')).toBeInTheDocument()
      expect(screen.getByText('MES / 품질')).toBeInTheDocument()
    })

    it("folder_path_status: 'truncated'면 배지와 절단 안내 문구를 보여준다", async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: 'folder-1', folder_path: ['MES', 'A', 'B', 'C', 'D'], folder_path_status: 'truncated',
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      expect(await screen.findByText('경로 절단됨')).toBeInTheDocument()
      expect(screen.getByText(/보존 한도\(5단\)를 넘어 상위 폴더로 조정되어 저장되었습니다/)).toBeInTheDocument()
    })

    it("folder_path_status: 'partial'이면 배지와 부분 편철 안내 문구를 보여준다", async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: 'folder-1', folder_path: ['MES'], folder_path_status: 'partial',
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      expect(await screen.findByText('상위 폴더까지만')).toBeInTheDocument()
      expect(screen.getByText(/중간 폴더 생성에 실패해 상위 폴더까지만 편철되었습니다/)).toBeInTheDocument()
    })

    it("folder_path_status: 'unclassified'면 배지를 보여준다", async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: null, folder_path: null, folder_path_status: 'unclassified',
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      expect(await screen.findByText('미분류')).toBeInTheDocument()
      // folder_id: null → 기존 미분류 문구(established text)도 함께 보인다. 중복 렌더 없이 1곳에서만.
      expect(screen.getAllByText(/미분류로 들어갔습니다\(D'Flow에서 편철 필요\)/)).toHaveLength(1)
    })

    it("folder_path_status: 'unclassified'인데 folder_id 키가 없으면(구버전 D'Flow 등) 배지 옆에" +
       ' 설명 문구를 보완한다(빈 배지만 남지 않도록)', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_path_status: 'unclassified',
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      expect(await screen.findByText('미분류')).toBeInTheDocument()
      expect(screen.getByText(/미분류로 들어갔습니다\(D'Flow에서 편철 필요\)/)).toBeInTheDocument()
      // folder_id 키 자체가 없으므로 "편철 결과 경로" 줄은 렌더되지 않는다.
      expect(screen.queryByText('편철 결과 경로')).not.toBeInTheDocument()
    })

    it('folder_id: null이면 미분류 문구를 보여준다(folder_path_status 키가 없어도)', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: null, folder_path: null,
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      expect(await screen.findByText(/미분류로 들어갔습니다\(D'Flow에서 편철 필요\)/)).toBeInTheDocument()
    })

    it('folder_id·folder_path 키가 없으면 실제 경로 표시 자체를 렌더하지 않는다(구버전 D\'Flow)', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      await screen.findByText(/전송됨/)
      expect(screen.queryByText('편철 결과 경로')).not.toBeInTheDocument()
    })

    it('전송 성공 시 실제 편철 경로를 보여주고 W7 미리보기와 라벨을 구분한다', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: 'folder-1', folder_path: ['MES', '실제경로'],
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      // 전송 전: W7 미리보기(예측)가 먼저 보인다.
      expect(screen.getByText('편철 경로 미리보기')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      // 전송 후: 실제 결과가 별도 라벨로 추가된다 — 미리보기와 공존하며 뭉개지지 않는다.
      expect(await screen.findByText('편철 결과 경로')).toBeInTheDocument()
      expect(screen.getByText('MES / 실제경로')).toBeInTheDocument()
      expect(screen.getByText('편철 경로 미리보기')).toBeInTheDocument()
    })

    it('folder_id가 있고 folder_path가 빈 배열이면 최상위 폴더로 표시한다', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
        folder_id: 'root-folder-uuid', folder_path: [],
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      expect(await screen.findByText('(최상위 폴더)')).toBeInTheDocument()
    })
  })

  it('전송 성공 후 닫기 버튼이 렌더되고 클릭 시 onClose를 호출한다', async () => {
    vi.mocked(uploadToDflow).mockResolvedValue({
      public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://dflow.example.com/m/1', needs_resync: false,
    })
    const onClose = vi.fn()
    render(<SendToDflowDialog meeting={baseMeeting} onClose={onClose} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByRole('link', { name: "D'Flow에서 보기" })

    // 성공 후에는 전송 버튼 행이 사라지고 닫기 버튼만 남는다 — Esc 외 닫을 수단이 없어지는 회귀 방지.
    expect(screen.queryByRole('button', { name: '전송' })).not.toBeInTheDocument()
    const closeButton = screen.getByRole('button', { name: '닫기' })
    await userEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('team 판정 실패 상태에서 전송 시 select 값을 teamOverride로 포함한다', async () => {
    vi.mocked(uploadToDflow).mockResolvedValue({
      public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: null, needs_resync: false,
    })
    render(
      <SendToDflowDialog
        meeting={{ ...baseMeeting, folder_path: [{ id: 9, name: '임원 인터뷰' }] }}
        onClose={vi.fn()}
      />
    )
    const select = await screen.findByLabelText('대상 구분')
    await userEvent.selectOptions(select, 'MDM')
    await userEvent.click(screen.getByRole('button', { name: '전송' }))

    await waitFor(() => {
      // folder_path가 1단계(임원 인터뷰)뿐이라 sub가 없음 → 제목은 원제목 그대로.
      expect(uploadToDflow).toHaveBeenCalledWith(1, {
        titleOverride: '물류공정_260716',
        teamOverride: 'MDM',
      })
    })
  })

  it('dflow_unknown_user(422) → 고정 안내문을 표시한다', async () => {
    vi.mocked(uploadToDflow).mockRejectedValue(makeHttpError(422, { error: '...', code: 'dflow_unknown_user' }))
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: '전송' }))

    expect(await screen.findByText(/D'Flow에 동일 이메일 계정이 필요합니다/)).toBeInTheDocument()
  })

  it('team_required(422) → select를 강제로 노출한다', async () => {
    vi.mocked(uploadToDflow).mockRejectedValue(makeHttpError(422, { error: '...', code: 'team_required' }))
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES') // 처음엔 자동 판정 성공 텍스트

    await userEvent.click(screen.getByRole('button', { name: '전송' }))

    expect(await screen.findByLabelText('대상 구분')).toBeInTheDocument()
  })

  it('body_too_long(422) → 전송 버튼을 비활성화하고 고정 메시지를 표시한다', async () => {
    vi.mocked(uploadToDflow).mockRejectedValue(makeHttpError(422, { error: '...', code: 'body_too_long' }))
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: '전송' }))

    expect(await screen.findByText(/본문이 100,000자를 넘습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
  })

  it('연결 관리: public_uid가 있으면 복사 버튼과 존재 확인 상태를 보여준다', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false, exists_on_dflow: true,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByText('연결 관리'))
    expect(await screen.findByText('abc-uid')).toBeInTheDocument()
    expect(screen.getByText(/존재함/)).toBeInTheDocument()
  })

  it("D'Flow에 이미 존재하면 전송 전(연결 관리를 펼치지 않아도)에 덮어쓸 회의록의 제목·날짜를 안내한다(W17)", async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: true, dflow_title: '물류-물류공정_260716', dflow_date: '2026-07-16',
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(await screen.findByText(/물류-물류공정_260716/)).toBeInTheDocument()
    expect(screen.getByText(/2026-07-16/)).toBeInTheDocument()
    expect(screen.getByText(/덮어씁니다/)).toBeInTheDocument()
  })

  it('존재하지 않으면(exists_on_dflow=false) 덮어쓰기 안내를 보여주지 않는다(W17)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(screen.queryByText(/덮어씁니다/)).not.toBeInTheDocument()
  })

  it('exists_on_dflow=false ＋ dflow_synced_at 있음 → 원인 미단정 안내 + [전송] 차단(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(await screen.findByText("D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
    expect(screen.getByRole('button', { name: "D'Flow에서 찾기로 재연결" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새로 전송' })).toBeInTheDocument()
  })

  it('exists_on_dflow=false ＋ dflow_synced_at 없음(수동 입력 직후 등) → 차단 안내를 띄우지 않는다(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: null, dflow_url: null, needs_resync: false,
      exists_on_dflow: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(screen.queryByText(/확인되지 않습니다/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).not.toBeDisabled()
  })

  it('차단 안내의 [D\'Flow에서 찾기로 재연결] 클릭 시 연결 관리를 펼치고 검색 패널을 연다(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: "D'Flow에서 찾기로 재연결" }))

    expect(await screen.findByRole('button', { name: '검색' })).toBeInTheDocument()
  })

  it('차단 안내의 [새로 전송] 클릭 시 확인 후에만 전송한다(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: false,
    })
    vi.mocked(uploadToDflow).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: '새로 전송' }))

    expect(confirmDialog).toHaveBeenCalledWith("D'Flow에서 확인되지 않아 새 회의록으로 전송됩니다. 계속할까요?")
    await waitFor(() => {
      expect(uploadToDflow).toHaveBeenCalled()
    })
  })

  it('차단 안내의 [새로 전송]에서 확인을 거부하면 전송하지 않는다(W14)', async () => {
    confirmDialog.mockResolvedValue(false)
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByRole('button', { name: '새로 전송' }))

    expect(confirmDialog).toHaveBeenCalled()
    expect(uploadToDflow).not.toHaveBeenCalled()
    // 거부해도 안내와 두 갈래는 그대로 남아 있어야 한다 — 사용자가 다시 선택할 수 있어야 한다.
    expect(screen.getByText("D'Flow에서 확인되지 않습니다(초기화·보관·삭제 중 하나)")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새로 전송' })).not.toBeDisabled()
  })

  it('exists_on_dflow=true ＋ dflow_archived=true → 보관 안내를 표시하고 덮어쓰기 안내를 대체한다(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: true, dflow_title: '물류-물류공정_260716', dflow_date: '2026-07-16', dflow_archived: true,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(
      await screen.findByText("D'Flow에서 보관됨 — 재전송은 막힙니다. D'Flow에서 보관 해제 후 다시 시도하세요.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/덮어씁니다/)).not.toBeInTheDocument()
    // [전송]은 막지 않는다 — archived 플래그는 stale할 수 있고(방금 보관 해제된 경우 등),
    // 막으면 D'Flow가 실제로 주는 정확한 409 안내로 갈 길이 없어진다.
    expect(screen.getByRole('button', { name: '전송' })).not.toBeDisabled()
  })

  it('exists_on_dflow=true ＋ dflow_archived 키 없음(R1 이전) → 종전대로 덮어쓰기 안내를 표시한다(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: true, dflow_title: '물류-물류공정_260716', dflow_date: '2026-07-16',
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    expect(await screen.findByText(/덮어씁니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전송' })).not.toBeDisabled()
  })

  it('연결 관리: dflow_archived=true 이면 존재 확인에 "존재함(보관됨)"을 보여준다(W14)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: true, dflow_title: '물류-물류공정_260716', dflow_date: '2026-07-16', dflow_archived: true,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByText('연결 관리'))
    expect(await screen.findByText(/존재함\(보관됨\)/)).toBeInTheDocument()
  })

  it('전송 성공 후에는 덮어쓰기 안내가 사라진다(W17)', async () => {
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      exists_on_dflow: true, dflow_title: '물류-물류공정_260716', dflow_date: '2026-07-16',
    })
    vi.mocked(uploadToDflow).mockResolvedValue({
      public_uid: 'abc-uid', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')
    expect(await screen.findByText(/덮어씁니다/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByRole('link', { name: "D'Flow에서 보기" })

    expect(screen.queryByText(/덮어씁니다/)).not.toBeInTheDocument()
  })

  it('수동 입력: UUID 형식이 아니면 API를 호출하지 않고 인라인 에러를 표시한다', async () => {
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByText('연결 관리'))
    await userEvent.click(screen.getByRole('button', { name: '수동 입력' }))
    const input = screen.getByLabelText("D'Flow public_uid 수동 입력")
    await userEvent.type(input, 'not-a-uuid')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText('올바른 UUID 형식이 아닙니다.')).toBeInTheDocument()
    expect(setDflowLink).not.toHaveBeenCalled()
  })

  it('수동 입력: 유효한 UUID면 저장 후 exists_on_dflow=false면 경고를 표시한다', async () => {
    vi.mocked(setDflowLink).mockResolvedValue({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false })
    vi.mocked(getDflowStatus)
      .mockResolvedValueOnce(emptyStatus) // 최초 로드
      .mockResolvedValueOnce({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false, exists_on_dflow: false }) // 저장 직후 재확인

    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByText('연결 관리'))
    await userEvent.click(screen.getByRole('button', { name: '수동 입력' }))
    const input = screen.getByLabelText("D'Flow public_uid 수동 입력")
    await userEvent.type(input, '01911f3e-7a3b-7000-8000-abcdefabcdef')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(setDflowLink).toHaveBeenCalledWith(1, '01911f3e-7a3b-7000-8000-abcdefabcdef')
    })
    expect(await screen.findByText(/D'Flow에 해당 회의록이 없습니다/)).toBeInTheDocument()
  })

  it('수동 입력: 저장 후 exists_on_dflow=true ＋ dflow_archived=true면 보관 경고를 표시한다(W14)', async () => {
    vi.mocked(setDflowLink).mockResolvedValue({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false })
    vi.mocked(getDflowStatus)
      .mockResolvedValueOnce(emptyStatus) // 최초 로드
      .mockResolvedValueOnce({
        public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false,
        exists_on_dflow: true, dflow_archived: true,
      }) // 저장 직후 재확인

    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')

    await userEvent.click(screen.getByText('연결 관리'))
    await userEvent.click(screen.getByRole('button', { name: '수동 입력' }))
    const input = screen.getByLabelText("D'Flow public_uid 수동 입력")
    await userEvent.type(input, '01911f3e-7a3b-7000-8000-abcdefabcdef')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(setDflowLink).toHaveBeenCalledWith(1, '01911f3e-7a3b-7000-8000-abcdefabcdef')
    })
    expect(await screen.findByText(/D'Flow에서 보관된 회의록입니다/)).toBeInTheDocument()
  })

  it('수동 입력: 대문자로 붙여넣어도 소문자로 정규화해 검증·전송한다', async () => {
    vi.mocked(setDflowLink).mockResolvedValue({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false })
    vi.mocked(getDflowStatus)
      .mockResolvedValueOnce(emptyStatus)
      .mockResolvedValueOnce({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false, exists_on_dflow: true })

    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')
    await userEvent.click(screen.getByText('연결 관리'))
    await userEvent.click(screen.getByRole('button', { name: '수동 입력' }))
    const input = screen.getByLabelText("D'Flow public_uid 수동 입력")
    await userEvent.type(input, '01911F3E-7A3B-7000-8000-ABCDEFABCDEF')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      // 서버 link는 소문자 전용 — 대문자 입력도 소문자로 정규화해 보내야 422를 피한다.
      expect(setDflowLink).toHaveBeenCalledWith(1, '01911f3e-7a3b-7000-8000-abcdefabcdef')
    })
  })

  it('재발급: confirmDialog 승인 시 해제 후 안내 문구를 표시한다', async () => {
    vi.mocked(getDflowStatus)
      .mockResolvedValueOnce({ public_uid: 'existing-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false, exists_on_dflow: true })
      .mockResolvedValueOnce(emptyStatus)
    vi.mocked(setDflowLink).mockResolvedValue({ public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false })

    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')
    await userEvent.click(screen.getByText('연결 관리'))
    await screen.findByText('existing-uid')

    await userEvent.click(screen.getByRole('button', { name: '재발급' }))

    expect(confirmDialog).toHaveBeenCalledWith(
      "다음 전송 시 D'Flow에 새 회의록이 생성되고 기존 것은 남습니다. 계속할까요?"
    )
    await waitFor(() => {
      expect(setDflowLink).toHaveBeenCalledWith(1, null)
    })
    expect(await screen.findByText('다음 전송 시 새 식별자가 자동 발급됩니다.')).toBeInTheDocument()
  })

  it('해제: confirmDialog를 거부하면 API를 호출하지 않는다', async () => {
    confirmDialog.mockResolvedValue(false)
    vi.mocked(getDflowStatus).mockResolvedValue({
      public_uid: 'existing-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false, exists_on_dflow: true,
    })
    render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
    await screen.findByText('MES')
    await userEvent.click(screen.getByText('연결 관리'))
    await screen.findByText('existing-uid')

    await userEvent.click(screen.getByRole('button', { name: '해제' }))

    expect(confirmDialog).toHaveBeenCalled()
    expect(setDflowLink).not.toHaveBeenCalled()
  })

  describe("D'Flow에서 찾기", () => {
    it('ddobak: 프리픽스 항목 선택 → setDflowLink(A) 호출', async () => {
      vi.mocked(listDflowMinutes).mockResolvedValue({
        items: [{
          id: 'minute-1', title: '외부 제목', date: '2026-07-01', team: 'MES',
          external_id: 'ddobak:01911f3e-7a3b-7000-8000-abcdefabcdef',
          created_by_name: '누군가', created_at: '', updated_at: '', url: 'https://x',
        }],
        total: 1, page: 1, per_page: 20,
      })
      vi.mocked(setDflowLink).mockResolvedValue({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false })

      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await userEvent.click(screen.getByRole('button', { name: "D'Flow에서 찾기" }))
      await userEvent.click(screen.getByRole('button', { name: '검색' }))

      const linkButton = await screen.findByRole('button', { name: '연결' })
      await userEvent.click(linkButton)

      await waitFor(() => {
        expect(setDflowLink).toHaveBeenCalledWith(1, '01911f3e-7a3b-7000-8000-abcdefabcdef')
      })
      expect(claimDflowMinute).not.toHaveBeenCalled()
    })

    it('external_id 없는 항목 선택 → claimDflowMinute(B) 호출', async () => {
      vi.mocked(listDflowMinutes).mockResolvedValue({
        items: [{
          id: 'minute-2', title: '외부 제목2', date: '2026-07-02', team: 'MES',
          external_id: null,
          created_by_name: '누군가', created_at: '', updated_at: '', url: 'https://x',
        }],
        total: 1, page: 1, per_page: 20,
      })
      vi.mocked(claimDflowMinute).mockResolvedValue({ public_uid: 'new-uid', dflow_synced_at: null, dflow_url: null, needs_resync: false })

      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await userEvent.click(screen.getByRole('button', { name: "D'Flow에서 찾기" }))
      await userEvent.click(screen.getByRole('button', { name: '검색' }))

      const linkButton = await screen.findByRole('button', { name: '연결' })
      await userEvent.click(linkButton)

      await waitFor(() => {
        expect(claimDflowMinute).toHaveBeenCalledWith(1, 'minute-2')
      })
      expect(setDflowLink).not.toHaveBeenCalled()
    })

    it('dflow_link_conflict(409) → 인라인 에러를 표시한다', async () => {
      vi.mocked(listDflowMinutes).mockResolvedValue({
        items: [{
          id: 'minute-3', title: '외부 제목3', date: '2026-07-03', team: 'MES',
          external_id: null,
          created_by_name: '누군가', created_at: '', updated_at: '', url: 'https://x',
        }],
        total: 1, page: 1, per_page: 20,
      })
      vi.mocked(claimDflowMinute).mockRejectedValue(makeHttpError(409, { error: 'conflict', code: 'dflow_link_conflict' }))

      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await userEvent.click(screen.getByRole('button', { name: "D'Flow에서 찾기" }))
      await userEvent.click(screen.getByRole('button', { name: '검색' }))

      const linkButton = await screen.findByRole('button', { name: '연결' })
      await userEvent.click(linkButton)

      expect(await screen.findByText('이미 다른 회의에 연결된 항목입니다.')).toBeInTheDocument()
    })
  })

  describe('onChanged 훅', () => {
    it('전송 성공 시 onChanged를 호출한다', async () => {
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      })
      const onChanged = vi.fn()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} onChanged={onChanged} />)
      await screen.findByText('MES')

      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledTimes(1)
      })
    })

    it('해제 성공 시 onChanged를 호출한다', async () => {
      vi.mocked(getDflowStatus).mockResolvedValue({
        public_uid: 'existing-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false, exists_on_dflow: true,
      })
      vi.mocked(setDflowLink).mockResolvedValue({ public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false })
      const onChanged = vi.fn()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} onChanged={onChanged} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await screen.findByText('existing-uid')

      await userEvent.click(screen.getByRole('button', { name: '해제' }))

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledTimes(1)
      })
    })

    it('재발급 성공 시 onChanged를 호출한다', async () => {
      vi.mocked(getDflowStatus)
        .mockResolvedValueOnce({ public_uid: 'existing-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false, exists_on_dflow: true })
        .mockResolvedValueOnce(emptyStatus)
      vi.mocked(setDflowLink).mockResolvedValue({ public_uid: null, dflow_synced_at: null, dflow_url: null, needs_resync: false })
      const onChanged = vi.fn()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} onChanged={onChanged} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await screen.findByText('existing-uid')

      await userEvent.click(screen.getByRole('button', { name: '재발급' }))

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledTimes(1)
      })
    })

    it('수동 입력 저장 성공 시 onChanged를 호출한다', async () => {
      vi.mocked(setDflowLink).mockResolvedValue({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false })
      vi.mocked(getDflowStatus)
        .mockResolvedValueOnce(emptyStatus)
        .mockResolvedValueOnce({ public_uid: '01911f3e-7a3b-7000-8000-abcdefabcdef', dflow_synced_at: null, dflow_url: null, needs_resync: false, exists_on_dflow: true })
      const onChanged = vi.fn()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} onChanged={onChanged} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await userEvent.click(screen.getByRole('button', { name: '수동 입력' }))
      const input = screen.getByLabelText("D'Flow public_uid 수동 입력")
      await userEvent.type(input, '01911f3e-7a3b-7000-8000-abcdefabcdef')
      await userEvent.click(screen.getByRole('button', { name: '저장' }))

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledTimes(1)
      })
    })

    it("D'Flow에서 찾기로 연결(claim) 성공 시 onChanged를 호출한다", async () => {
      vi.mocked(listDflowMinutes).mockResolvedValue({
        items: [{
          id: 'minute-4', title: '외부 제목4', date: '2026-07-04', team: 'MES',
          external_id: null,
          created_by_name: '누군가', created_at: '', updated_at: '', url: 'https://x',
        }],
        total: 1, page: 1, per_page: 20,
      })
      vi.mocked(claimDflowMinute).mockResolvedValue({ public_uid: 'new-uid', dflow_synced_at: null, dflow_url: null, needs_resync: false })
      const onChanged = vi.fn()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} onChanged={onChanged} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await userEvent.click(screen.getByRole('button', { name: "D'Flow에서 찾기" }))
      await userEvent.click(screen.getByRole('button', { name: '검색' }))
      const linkButton = await screen.findByRole('button', { name: '연결' })
      await userEvent.click(linkButton)

      await waitFor(() => {
        expect(onChanged).toHaveBeenCalledTimes(1)
      })
    })

    it('mutation 실패 시(예: 해제 실패)는 onChanged를 호출하지 않는다', async () => {
      vi.mocked(getDflowStatus).mockResolvedValue({
        public_uid: 'existing-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false, exists_on_dflow: true,
      })
      vi.mocked(setDflowLink).mockRejectedValue(makeHttpError(500, { error: 'boom' }))
      const onChanged = vi.fn()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} onChanged={onChanged} />)
      await screen.findByText('MES')
      await userEvent.click(screen.getByText('연결 관리'))
      await screen.findByText('existing-uid')

      await userEvent.click(screen.getByRole('button', { name: '해제' }))

      await waitFor(() => {
        expect(setDflowLink).toHaveBeenCalled()
      })
      expect(onChanged).not.toHaveBeenCalled()
    })
  })

  // 특성화 테스트(characterization) — MeetingLinkSection 추출 전 현행 동작을 고정한다.
  // WP-F5 §2: 무테스트 영역이라 추출 전에 먼저 그린으로 만든다.
  describe('회의 연결(선택)', () => {
    const metaWithProject = {
      teams: ['MES', 'MDM'],
      projects: [{ id: 'proj-1', name: '테스트 프로젝트' }],
      limits: { max_body_chars: 100000, max_request_bytes: 0, max_attachments: 0, max_attachment_bytes: 0 },
    }
    const projectMeetingItems = [
      { id: 'meet-1', title: '킥오프 회의', date: '2026-07-15', category: 'kickoff', recurrence: 'none' },
    ]

    function mockMetaWithMeetings() {
      vi.mocked(getDflowMeta).mockImplementation(async (projectId?: string) =>
        projectId ? { ...metaWithProject, meetings: projectMeetingItems } : metaWithProject
      )
    }

    it("status에 dflow_meeting_id가 있으면 meetingMode 초기값이 'keep'이라 연결 스냅샷(프로젝트/회의명 + 변경·연결 해제)을 보여준다", async () => {
      vi.mocked(getDflowStatus).mockResolvedValue({
        public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
        dflow_meeting_id: 'meet-1', dflow_meeting_title: '킥오프 회의', dflow_project_name: '테스트 프로젝트',
      })
      mockMetaWithMeetings()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')

      expect(await screen.findByText('테스트 프로젝트 / 킥오프 회의')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '변경' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '연결 해제' })).toBeInTheDocument()
      expect(screen.queryByLabelText("D'Flow 프로젝트")).not.toBeInTheDocument()
    })

    it("status에 dflow_meeting_id가 없으면 meetingMode 초기값이 'none'이라 프로젝트 select를 보여준다", async () => {
      mockMetaWithMeetings()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')

      expect(await screen.findByLabelText("D'Flow 프로젝트")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '변경' })).not.toBeInTheDocument()
    })

    it('프로젝트를 선택하면 getDflowMeta(projectId)로 회의 목록을 불러와 회의 select에 보여준다', async () => {
      mockMetaWithMeetings()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')

      const projectSelect = await screen.findByLabelText("D'Flow 프로젝트")
      await userEvent.selectOptions(projectSelect, 'proj-1')

      await waitFor(() => {
        expect(getDflowMeta).toHaveBeenCalledWith('proj-1')
      })
      const meetingSelect = await screen.findByLabelText("D'Flow 회의")
      expect(screen.getByText(/킥오프 회의/)).toBeInTheDocument()
      expect(screen.getByText('➕ 신규 회의 등록')).toBeInTheDocument()
      expect(meetingSelect).toBeInTheDocument()
    })

    it('회의를 선택해 전송하면 meeting: { mode: "link", meeting_id, display } 이 함께 전송된다', async () => {
      mockMetaWithMeetings()
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')

      const projectSelect = await screen.findByLabelText("D'Flow 프로젝트")
      await userEvent.selectOptions(projectSelect, 'proj-1')
      const meetingSelect = await screen.findByLabelText("D'Flow 회의")
      await userEvent.selectOptions(meetingSelect, 'meet-1')

      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      await waitFor(() => {
        expect(uploadToDflow).toHaveBeenCalledWith(1, expect.objectContaining({
          meeting: {
            mode: 'link',
            meeting_id: 'meet-1',
            display: { meeting_title: '킥오프 회의', project_name: '테스트 프로젝트' },
          },
        }))
      })
    })

    it('[변경] 클릭 시 keep 스냅샷에서 프로젝트/회의 재선택 UI로 전환한다', async () => {
      vi.mocked(getDflowStatus).mockResolvedValue({
        public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
        dflow_meeting_id: 'meet-1', dflow_meeting_title: '킥오프 회의', dflow_project_name: '테스트 프로젝트',
      })
      mockMetaWithMeetings()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await screen.findByText('테스트 프로젝트 / 킥오프 회의')

      await userEvent.click(screen.getByRole('button', { name: '변경' }))

      expect(await screen.findByLabelText("D'Flow 프로젝트")).toBeInTheDocument()
      expect(screen.queryByText('테스트 프로젝트 / 킥오프 회의')).not.toBeInTheDocument()
    })

    it('[연결 해제] 클릭 시 해제 예정 안내를 보여주고, [취소] 클릭 시 원래 연결 스냅샷으로 되돌아간다', async () => {
      vi.mocked(getDflowStatus).mockResolvedValue({
        public_uid: 'abc-uid', dflow_synced_at: '2026-07-01T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
        dflow_meeting_id: 'meet-1', dflow_meeting_title: '킥오프 회의', dflow_project_name: '테스트 프로젝트',
      })
      mockMetaWithMeetings()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')
      await screen.findByText('테스트 프로젝트 / 킥오프 회의')

      await userEvent.click(screen.getByRole('button', { name: '연결 해제' }))
      expect(await screen.findByText(/연결 해제 예정/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: '취소' }))
      expect(await screen.findByText('테스트 프로젝트 / 킥오프 회의')).toBeInTheDocument()
    })

    it("'➕ 신규 회의 등록' 선택 시 제목·날짜·구분 입력 폼을 보여주고, 전송하면 meeting: { mode: 'create', ... } 이 전송된다", async () => {
      mockMetaWithMeetings()
      vi.mocked(uploadToDflow).mockResolvedValue({
        public_uid: 'uid-1', dflow_synced_at: '2026-07-20T00:00:00Z', dflow_url: 'https://x', needs_resync: false,
      })
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')

      const projectSelect = await screen.findByLabelText("D'Flow 프로젝트")
      await userEvent.selectOptions(projectSelect, 'proj-1')
      const meetingSelect = await screen.findByLabelText("D'Flow 회의")
      await userEvent.selectOptions(meetingSelect, '__new__')

      expect(await screen.findByLabelText('제목')).toHaveValue('물류공정_260716')
      expect(screen.getByLabelText('날짜')).toHaveValue('2026-07-16')

      await userEvent.click(screen.getByRole('button', { name: '전송' }))

      await waitFor(() => {
        expect(uploadToDflow).toHaveBeenCalledWith(1, expect.objectContaining({
          meeting: {
            mode: 'create',
            project_id: 'proj-1',
            title: '물류공정_260716',
            date: '2026-07-16',
            category: 'general',
            display: { meeting_title: '물류공정_260716', project_name: '테스트 프로젝트' },
          },
        }))
      })
    })

    it('신규 회의 등록 모드에서 제목을 비우면 전송 버튼이 비활성화되고, 다시 채우면 활성화된다(추출 시 반응성 회귀 방지)', async () => {
      mockMetaWithMeetings()
      render(<SendToDflowDialog meeting={baseMeeting} onClose={vi.fn()} />)
      await screen.findByText('MES')

      const projectSelect = await screen.findByLabelText("D'Flow 프로젝트")
      await userEvent.selectOptions(projectSelect, 'proj-1')
      const meetingSelect = await screen.findByLabelText("D'Flow 회의")
      await userEvent.selectOptions(meetingSelect, '__new__')

      const titleInput = await screen.findByLabelText('제목')
      await userEvent.clear(titleInput)

      expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()

      await userEvent.type(titleInput, '새 회의 제목')

      expect(screen.getByRole('button', { name: '전송' })).not.toBeDisabled()
    })
  })
})
