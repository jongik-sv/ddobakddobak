import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentTriageDialog } from './AttachmentTriageDialog'
import { createFileAttachment } from '../../api/attachments'

vi.mock('../../api/attachments', () => ({
  createFileAttachment: vi.fn(),
}))

const mockCreateFileAttachment = vi.mocked(createFileAttachment)

function makeFile(name: string, type = ''): File {
  return new File(['x'], name, { type })
}

beforeEach(() => {
  mockCreateFileAttachment.mockReset()
})

describe('AttachmentTriageDialog', () => {
  it('open=false면 렌더하지 않는다', () => {
    render(
      <AttachmentTriageDialog open={false} meetingId={1} files={[makeFile('a.pdf')]} onClose={vi.fn()} />,
    )
    expect(screen.queryByText('첨부파일 분류')).not.toBeInTheDocument()
  })

  it('휴리스틱으로 카테고리를 사전선택한다', () => {
    render(
      <AttachmentTriageDialog
        open
        meetingId={1}
        files={[makeFile('안건.pdf'), makeFile('조직도.png', 'image/png'), makeFile('명함사진.jpg', 'image/jpeg'), makeFile('회의자료.docx')]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('안건.pdf 카테고리')).toHaveValue('agenda')
    expect(screen.getByLabelText('조직도.png 카테고리')).toHaveValue('stakeholder')
    expect(screen.getByLabelText('명함사진.jpg 카테고리')).toHaveValue('business_card')
    expect(screen.getByLabelText('회의자료.docx 카테고리')).toHaveValue('reference')
  })

  it('카테고리를 수동으로 변경할 수 있다', async () => {
    const user = userEvent.setup()
    render(
      <AttachmentTriageDialog open meetingId={1} files={[makeFile('회의자료.docx')]} onClose={vi.fn()} />,
    )
    const select = screen.getByLabelText('회의자료.docx 카테고리')
    await user.selectOptions(select, 'stakeholder')
    expect(select).toHaveValue('stakeholder')
  })

  it('제거 버튼으로 파일을 목록에서 뺄 수 있다', async () => {
    const user = userEvent.setup()
    render(
      <AttachmentTriageDialog
        open
        meetingId={1}
        files={[makeFile('a.pdf'), makeFile('b.pdf')]}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByLabelText('a.pdf 제거'))
    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('b.pdf')).toBeInTheDocument()
  })

  it('업로드 클릭 시 파일별 category로 createFileAttachment를 호출하고 전부 성공하면 onUploaded 후 onClose 호출', async () => {
    mockCreateFileAttachment.mockResolvedValue({} as never)
    const user = userEvent.setup()
    const onUploaded = vi.fn()
    const onClose = vi.fn()
    render(
      <AttachmentTriageDialog
        open
        meetingId={42}
        files={[makeFile('안건.pdf'), makeFile('회의자료.docx')]}
        onClose={onClose}
        onUploaded={onUploaded}
      />,
    )
    await user.click(screen.getByRole('button', { name: /업로드/ }))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(mockCreateFileAttachment).toHaveBeenCalledWith(42, 'agenda', expect.objectContaining({ name: '안건.pdf' }))
    expect(mockCreateFileAttachment).toHaveBeenCalledWith(42, 'reference', expect.objectContaining({ name: '회의자료.docx' }))
  })

  it('업로드 실패 시 실패 표시 + 재시도 버튼을 보여주고 onClose는 호출하지 않는다', async () => {
    mockCreateFileAttachment.mockRejectedValue(new Error('네트워크 오류'))
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onUploaded = vi.fn()
    render(
      <AttachmentTriageDialog open meetingId={1} files={[makeFile('a.pdf')]} onClose={onClose} onUploaded={onUploaded} />,
    )
    await user.click(screen.getByRole('button', { name: /업로드/ }))

    await waitFor(() => expect(screen.getByText('실패')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '재시도' })).toBeInTheDocument()
  })

  it('재시도 성공 시 해당 파일만 다시 업로드하고 완료 시 onClose/onUploaded 호출', async () => {
    mockCreateFileAttachment.mockRejectedValueOnce(new Error('네트워크 오류'))
    mockCreateFileAttachment.mockResolvedValueOnce({} as never)
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onUploaded = vi.fn()
    render(
      <AttachmentTriageDialog open meetingId={1} files={[makeFile('a.pdf')]} onClose={onClose} onUploaded={onUploaded} />,
    )
    await user.click(screen.getByRole('button', { name: /업로드/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '재시도' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '재시도' }))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    expect(mockCreateFileAttachment).toHaveBeenCalledTimes(2)
  })

  it('파일이 없으면 안내 문구를 보여준다', () => {
    render(<AttachmentTriageDialog open meetingId={1} files={[]} onClose={vi.fn()} />)
    expect(screen.getByText('분류할 파일이 없습니다.')).toBeInTheDocument()
  })

  // 🔴 findings #2: 업로드 진행 중에는 남은 pending 행의 제거 버튼도 비활성화해야 한다
  // (CONCURRENCY=3이므로 4번째 파일은 대기열에 pending으로 남는다).
  it('업로드 중에는 아직 대기 중(pending)인 파일의 제거 버튼도 비활성화된다', async () => {
    let releaseFirst: (() => void) | undefined
    mockCreateFileAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          if (!releaseFirst) releaseFirst = () => resolve({} as never)
        }),
    )
    const user = userEvent.setup()
    render(
      <AttachmentTriageDialog
        open
        meetingId={1}
        files={[makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf'), makeFile('d.pdf')]}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /업로드/ }))

    // CONCURRENCY=3 → 3개가 uploading, d.pdf는 여전히 pending 상태로 대기열에 남는다.
    await waitFor(() => expect(screen.getByLabelText('d.pdf 제거')).toBeDisabled())
  })

  // 🔴 findings #3: setItems 업데이터 내부에서 onUploaded/onClose를 호출하면 안 되고,
  // 업로드 도중 새 파일이 추가된 경우 그 파일까지 포함해 allDone을 판단해야 한다.
  it('업로드 진행 중(runUploads await 도중)에 새 파일이 추가되면, 해당 배치 완료 시점에 새 파일이 아직 pending이라 자동으로 닫히지 않는다', async () => {
    let resolveA: (() => void) | undefined
    mockCreateFileAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveA = () => resolve({} as never)
        }),
    )
    const onClose = vi.fn()
    const onUploaded = vi.fn()
    const user = userEvent.setup()
    const fileA = makeFile('a.pdf')
    const { rerender } = render(
      <AttachmentTriageDialog open meetingId={1} files={[fileA]} onClose={onClose} onUploaded={onUploaded} />,
    )

    // a.pdf 업로드 시작 — createFileAttachment가 아직 resolve되지 않은 상태로 대기한다.
    await user.click(screen.getByRole('button', { name: /업로드/ }))
    await waitFor(() => expect(screen.getByText('업로드중…')).toBeInTheDocument())

    // 업로드 진행 중에 새 파일이 files prop에 병합된다(findings #4 병합 시맨틱).
    // 기존 a.pdf는 동일 File 참조를 유지해야 중복 추가되지 않는다.
    rerender(
      <AttachmentTriageDialog
        open
        meetingId={1}
        files={[fileA, makeFile('late.pdf')]}
        onClose={onClose}
        onUploaded={onUploaded}
      />,
    )
    expect(screen.getByText('late.pdf')).toBeInTheDocument()

    // a.pdf 업로드 완료
    resolveA?.()
    await waitFor(() => expect(screen.getByText('완료')).toBeInTheDocument())

    // late.pdf는 이번 업로드 배치에 포함되지 않았고 여전히 대기 중이다 — 전체 완료가 아니므로
    // 자동으로 닫히면 안 된다(업로드 도중 추가된 항목까지 포함해 allDone을 판단해야 함).
    expect(onClose).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  // 🔴 findings #4 후속: 로컬에서 제거한 파일이 이후 재드롭(병합) 시 다시 나타나면 안 된다.
  // 병합 dedup을 현재 items(prev)가 아니라 "이번 세션에서 본 적 있는 파일" 집합 기준으로
  // 해야 한다 — items 기준이면 제거로 items에서 빠진 순간 다시 "모르는 파일"이 되어 부활한다.
  it('제거한 파일은 이후 같은 세션에서 다시 드롭되어도 재등장하지 않는다', async () => {
    const user = userEvent.setup()
    const fileA = makeFile('a.pdf')
    const fileB = makeFile('b.pdf')
    const { rerender } = render(
      <AttachmentTriageDialog open meetingId={1} files={[fileA]} onClose={vi.fn()} />,
    )

    await user.click(screen.getByLabelText('a.pdf 제거'))
    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument()

    // MeetingPage의 병합 시맨틱: 이전 files(a.pdf 포함)에 새 파일(b.pdf)을 append한 배열을 전달.
    rerender(<AttachmentTriageDialog open meetingId={1} files={[fileA, fileB]} onClose={vi.fn()} />)

    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('b.pdf')).toBeInTheDocument()
  })

  // 🔴 findings #4 후속: MeetingPage는 다이얼로그가 닫힐 때(명시적 닫기든, 전부 완료 후 자동
  // 닫힘이든) files를 []로 리셋해 "세션 종료"를 신호한다. 그 신호를 받으면 seenFilesRef도
  // 함께 비워져야 다음 세션의 새 드롭이 "이미 아는 파일"로 오인돼 조용히 씹히지 않는다.
  it('files가 []로 리셋된 뒤(세션 종료) 새 파일이 드롭되면 정상적으로 나타난다', async () => {
    const fileA = makeFile('a.pdf')
    const fileC = makeFile('c.pdf')
    const { rerender } = render(
      <AttachmentTriageDialog open meetingId={1} files={[fileA]} onClose={vi.fn()} />,
    )
    expect(screen.getByText('a.pdf')).toBeInTheDocument()

    // 다이얼로그가 닫히며(자동完료든 명시적 닫기든) MeetingPage가 files를 비운다.
    rerender(<AttachmentTriageDialog open={false} meetingId={1} files={[]} onClose={vi.fn()} />)

    // 새 세션: 새 파일이 드롭된다.
    rerender(<AttachmentTriageDialog open meetingId={1} files={[fileC]} onClose={vi.fn()} />)

    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('c.pdf')).toBeInTheDocument()
  })
})
