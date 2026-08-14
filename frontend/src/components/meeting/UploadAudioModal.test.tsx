import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadAudioModal } from './UploadAudioModal'
import type { Meeting } from '../../api/meetings'

vi.mock('../../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config')>()),
  IS_TAURI: false,
  IS_MOBILE: false,
}))

const mockUploadAudioFile = vi.fn()
const mockGetMeetings = vi.fn()
vi.mock('../../api/meetings', () => ({
  uploadAudioFile: (...args: unknown[]) => mockUploadAudioFile(...args),
  getMeetings: (...args: unknown[]) => mockGetMeetings(...args),
}))

const mockMergeAudioFiles = vi.fn()
vi.mock('../../lib/audioMerge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/audioMerge')>()),
  mergeAudioFiles: (...args: unknown[]) => mockMergeAudioFiles(...args),
}))

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: null }) },
}))

const MEETING_TYPE_LIST = [{ value: 'general', label: '일반' }]

function makeFile(name: string, size = 100, type = 'audio/mpeg'): File {
  const file = new File([new Uint8Array(size)], name, { type })
  return file
}

function renderModal(props: Partial<React.ComponentProps<typeof UploadAudioModal>> = {}) {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  const utils = render(
    <UploadAudioModal
      folderId={null}
      meetingTypeList={MEETING_TYPE_LIST}
      onClose={onClose}
      onCreated={onCreated}
      {...props}
    />,
  )
  return { ...utils, onClose, onCreated }
}

function selectFiles(files: File[]) {
  const input = document.getElementById('audio-file-input') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

function dropFilesOn(element: Element, files: File[]) {
  fireEvent.drop(element, { dataTransfer: { files } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetMeetings.mockResolvedValue({ meetings: [] })
  mockUploadAudioFile.mockResolvedValue({ id: 1, title: 'merged' } as Meeting)
  mockMergeAudioFiles.mockResolvedValue(makeFile('merged.wav', 999, 'audio/wav'))
})

describe('UploadAudioModal', () => {
  it('단일 파일 선택 시 순서 리스트 없이 단일 파일 UI를 보여준다', async () => {
    renderModal()
    selectFiles([makeFile('a.mp3')])

    await waitFor(() => expect(screen.getByText('a.mp3')).toBeInTheDocument())
    expect(screen.queryByLabelText('위로 이동')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '업로드 및 변환' })).toBeInTheDocument()
  })

  it('다중 선택 시 파일명을 자연 정렬 순서로 리스트에 렌더한다', async () => {
    renderModal()
    selectFiles([makeFile('part10.mp3'), makeFile('part2.mp3'), makeFile('part1.mp3')])

    const items = await screen.findAllByRole('listitem')
    const names = items.map((li) => li.querySelector('p.font-medium')?.textContent)
    expect(names).toEqual(['part1.mp3', 'part2.mp3', 'part10.mp3'])
    expect(screen.getByRole('button', { name: '병합 후 업로드' })).toBeInTheDocument()
  })

  it('파일 2개 이상 제출 시 mergeAudioFiles를 호출하고 그 결과 File을 uploadAudioFile에 전달한다', async () => {
    const mergedFile = makeFile('merged.wav', 555, 'audio/wav')
    mockMergeAudioFiles.mockResolvedValue(mergedFile)
    renderModal()
    selectFiles([makeFile('b.mp3'), makeFile('a.mp3')])
    await waitFor(() => expect(screen.getByText('b.mp3')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '병합 후 업로드' }))

    await waitFor(() => expect(mockUploadAudioFile).toHaveBeenCalled())
    expect(mockMergeAudioFiles).toHaveBeenCalledTimes(1)
    const [mergedArgFiles] = mockMergeAudioFiles.mock.calls[0]
    expect(mergedArgFiles.map((f: File) => f.name)).toEqual(['a.mp3', 'b.mp3'])
    expect(mockUploadAudioFile.mock.calls[0][0].audio).toBe(mergedFile)
  })

  it('파일 1개 제출 시 mergeAudioFiles를 호출하지 않는다', async () => {
    renderModal()
    selectFiles([makeFile('a.mp3')])
    await waitFor(() => expect(screen.getByText('a.mp3')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '업로드 및 변환' }))

    await waitFor(() => expect(mockUploadAudioFile).toHaveBeenCalled())
    expect(mockMergeAudioFiles).not.toHaveBeenCalled()
    expect(mockUploadAudioFile.mock.calls[0][0].audio.name).toBe('a.mp3')
  })

  it('병합 실패 시 에러를 표시하고 uploadAudioFile은 호출하지 않는다', async () => {
    mockMergeAudioFiles.mockRejectedValue(new Error('디코딩 실패: bad.mp3'))
    renderModal()
    selectFiles([makeFile('bad.mp3'), makeFile('a.mp3')])
    await waitFor(() => expect(screen.getByText('bad.mp3')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '병합 후 업로드' }))

    // errorToMessage는 Error.message가 있으면 그것을 우선 사용한다 (fallback은 message가 없을 때만)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('디코딩 실패: bad.mp3'))
    expect(mockUploadAudioFile).not.toHaveBeenCalled()
    // 파일 목록은 유지되어 재시도 가능해야 한다
    expect(screen.getByText('bad.mp3')).toBeInTheDocument()
  })

  it('initialFiles가 2개 이상이면 마운트 시 즉시 순서 리스트를 렌더한다', async () => {
    renderModal({ initialFiles: [makeFile('z.mp3'), makeFile('a.mp3')] })

    const items = await screen.findAllByRole('listitem')
    const names = items.map((li) => li.querySelector('p.font-medium')?.textContent)
    expect(names).toEqual(['a.mp3', 'z.mp3'])
  })

  it('이름+크기가 같은 파일을 다시 추가하면 스킵한다', async () => {
    renderModal()
    selectFiles([makeFile('a.mp3', 100), makeFile('b.mp3', 100)])
    await waitFor(() => expect(screen.getByText('b.mp3')).toBeInTheDocument())

    selectFiles([makeFile('a.mp3', 100), makeFile('c.mp3', 100)])

    await waitFor(() => expect(screen.getByText('c.mp3')).toBeInTheDocument())
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
  })

  it('순서 리스트 렌더 상태에서 리스트 영역(드롭존 밖)에 떨군 파일도 추가된다', async () => {
    renderModal()
    selectFiles([makeFile('a.mp3'), makeFile('b.mp3')])
    const list = await screen.findByRole('list')

    // 드롭존이 아니라 순서 리스트(<ul>) 자체 위에 드롭 — 래퍼가 흡수해야 한다
    dropFilesOn(list, [makeFile('c.mp3')])

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    expect(screen.getByText('c.mp3')).toBeInTheDocument()
  })

  it('파일 없는 drop(리스트 재정렬 드래그)은 래퍼가 무시한다', async () => {
    renderModal()
    selectFiles([makeFile('a.mp3'), makeFile('b.mp3')])
    const list = await screen.findByRole('list')

    fireEvent.drop(list, { dataTransfer: { files: [] } })

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
